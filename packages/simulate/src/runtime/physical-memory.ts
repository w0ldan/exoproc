/**
 * Physical-page-backed Copy-on-Write (CoW) memory layer.
 *
 * Models a simplified OS page table: a global physical page pool holds the
 * actual data, while per-process page table entries (PTEs) point into it.
 * Multiple PTEs can reference the same physical page (shared/CoW), and a
 * write to a CoW page transparently allocates a private copy.
 *
 * Integrates into `Win64AddressSpace` via the `MemoryMapping.cow` field.
 * When present, read/write ops route through `CoWMapping` instead of
 * accessing `mapping.data` directly.
 *
 * Future: .text segment sharing is architecturally supported (read-only
 * pages are naturally shared and never trigger CoW). Self-modifying code
 * or fork/exec writable-code scenarios would just need to mark .text PTEs
 * as CoW and the same fault logic applies.
 */

export const COW_PAGE_SIZE = 0x1000;

// ── Physical page pool ───────────────────────────────────────────────

/** A single physical page -- the unit of sharing. */
export interface PhysicalPage {
  /** Pool-unique page frame number (PFN). */
  readonly pfn: number;
  /** Mutable 4096-byte backing store. */
  readonly data: Uint8Array;
  /** How many PTEs currently reference this page. */
  refCount: number;
}

/**
 * Global pool of physical pages.  One per `Win64Machine`.
 */
export class PhysicalPagePool {
  private nextPfn = 1;
  private readonly pages = new Map<number, PhysicalPage>();

  /** The single "zero page" -- .bss and freshly-committed pages point here
   *  until their first write.  Never mutated; CoW always copies from it. */
  public readonly zeroPage: PhysicalPage;

  constructor() {
    this.zeroPage = {
      pfn: 0,
      data: new Uint8Array(COW_PAGE_SIZE), // permanently zeroed
      refCount: 0, // managed separately -- never freed
    };
  }

  /** Allocate a fresh physical page, optionally pre-filled with `source`. */
  public allocate(source?: Uint8Array): PhysicalPage {
    const pfn = this.nextPfn++;
    const data = new Uint8Array(COW_PAGE_SIZE);
    if (source) {
      data.set(source.subarray(0, COW_PAGE_SIZE));
    }
    const page: PhysicalPage = { pfn, data, refCount: 1 };
    this.pages.set(pfn, page);
    return page;
  }

  /** Increment the reference count (another PTE now points to this page). */
  public retain(page: PhysicalPage): void {
    page.refCount += 1;
  }

  /** Decrement the reference count; free the page if it drops to zero. */
  public release(page: PhysicalPage): void {
    if (page === this.zeroPage) return;
    page.refCount -= 1;
    if (page.refCount <= 0) {
      this.pages.delete(page.pfn);
    }
  }

  /** Create a private copy of a physical page (the "copy" in CoW). */
  public copyPage(source: PhysicalPage): PhysicalPage {
    return this.allocate(source.data);
  }

  /** Number of live physical pages (excluding the zero page). */
  public get livePageCount(): number {
    return this.pages.size;
  }

  /** Total physical memory consumed, in bytes (excluding zero page). */
  public get physicalMemoryUsed(): number {
    return this.pages.size * COW_PAGE_SIZE;
  }

  /** Snapshot every live physical page's bytes, keyed by PFN. The zero page (PFN 0) is never included -- it's a well-known singleton, recreated by the constructor. */
  public snapshotPages(): readonly PhysicalPageSnapshot[] {
    return [...this.pages.values()].map((page) => ({
      pfn: page.pfn,
      data: page.data.slice(),
    }));
  }

  /**
   * Replaces the pool's contents with a snapshot. Every restored page's
   * `refCount` starts at `0` -- callers (`CoWMapping` restoration) must
   * `retain()` once per PTE that references it, so the count is rebuilt
   * by construction rather than trusted from a persisted number (the same
   * invariant `cloneAsCoW`/`initializeFromData` already maintain live).
   */
  public restorePages(pages: readonly PhysicalPageSnapshot[]): void {
    this.pages.clear();
    let maxPfn = 0;
    for (const { pfn, data } of pages) {
      this.pages.set(pfn, { pfn, data: data.slice(), refCount: 0 });
      if (pfn > maxPfn) maxPfn = pfn;
    }
    this.nextPfn = maxPfn + 1;
  }

  /** PFN 0 is the well-known zero-page sentinel, never stored in `pages`. */
  public getPage(pfn: number): PhysicalPage | undefined {
    return pfn === 0 ? this.zeroPage : this.pages.get(pfn);
  }
}

export interface PhysicalPageSnapshot {
  readonly pfn: number;
  readonly data: Uint8Array;
}

// ── Page table entry ─────────────────────────────────────────────────

export interface PageTableEntry {
  /** The physical page this virtual page maps to. */
  physicalPage: PhysicalPage;
  /** When true, writes to this page must trigger copy-on-write. */
  cow: boolean;
}

// ── CoW-aware virtual-to-physical mapping ────────────────────────────

/**
 * A region of virtual memory backed by physical pages with CoW support.
 *
 * Attached to a `MemoryMapping` via the optional `cow` field.
 * `Win64AddressSpace.read/write` check this field and route through
 * `CoWMapping.read/write` when present.
 */
export class CoWMapping {
  /** One PTE per 4 KiB page in this mapping. */
  public readonly pageTable: PageTableEntry[];
  /** Total mapping size in bytes (page-aligned). */
  public readonly size: number;

  constructor(
    public readonly pool: PhysicalPagePool,
    public readonly pageCount: number,
  ) {
    this.pageTable = [];
    this.size = pageCount * COW_PAGE_SIZE;
  }

  /** Initialize all pages as CoW-shared references to the zero page. */
  public initializeAsZero(): void {
    for (let i = 0; i < this.pageCount; i++) {
      this.pageTable.push({
        physicalPage: this.pool.zeroPage,
        cow: true,
      });
    }
  }

  /**
   * Initialize from existing data (e.g. .data section content from a PE).
   * Each non-zero page gets its own physical page; `shared` controls
   * whether pages start as CoW (for cross-process sharing) or private.
   */
  public initializeFromData(data: Uint8Array, shared: boolean): void {
    for (let i = 0; i < this.pageCount; i++) {
      const offset = i * COW_PAGE_SIZE;
      const slice = data.subarray(offset, offset + COW_PAGE_SIZE);
      if (slice.length === 0 || slice.every((b) => b === 0)) {
        this.pageTable.push({
          physicalPage: this.pool.zeroPage,
          cow: true,
        });
      } else {
        const page = this.pool.allocate(slice);
        this.pageTable.push({
          physicalPage: page,
          cow: shared,
        });
      }
    }
  }

  /**
   * Create a CoW clone: every PTE points to the same physical page as the
   * source, with CoW=true.  Both the source and clone are marked CoW so
   * whichever writes first gets the copy.
   */
  public static cloneAsCoW(
    source: CoWMapping,
    pool: PhysicalPagePool,
  ): CoWMapping {
    const clone = new CoWMapping(pool, source.pageCount);
    for (const sourcePte of source.pageTable) {
      sourcePte.cow = true;
      if (sourcePte.physicalPage !== pool.zeroPage) {
        pool.retain(sourcePte.physicalPage);
      }
      clone.pageTable.push({
        physicalPage: sourcePte.physicalPage,
        cow: true,
      });
    }
    return clone;
  }

  /** Read `length` bytes starting at byte `offset` within this mapping. */
  public read(offset: number, length: number): Uint8Array {
    const result = new Uint8Array(length);
    let remaining = length;
    let sourceOffset = offset;
    let destOffset = 0;

    while (remaining > 0) {
      const pageIndex = Math.floor(sourceOffset / COW_PAGE_SIZE);
      const pageOffset = sourceOffset % COW_PAGE_SIZE;
      const pte = this.pageTable[pageIndex];
      if (!pte) break;

      const chunkSize = Math.min(remaining, COW_PAGE_SIZE - pageOffset);
      result.set(
        pte.physicalPage.data.subarray(pageOffset, pageOffset + chunkSize),
        destOffset,
      );

      sourceOffset += chunkSize;
      destOffset += chunkSize;
      remaining -= chunkSize;
    }
    return result;
  }

  /**
   * Write `data` starting at byte `offset` within this mapping.
   * Triggers CoW fault on any touched shared/CoW page.
   */
  public write(offset: number, data: Uint8Array): void {
    let remaining = data.length;
    let sourceOffset = 0;
    let destOffset = offset;

    while (remaining > 0) {
      const pageIndex = Math.floor(destOffset / COW_PAGE_SIZE);
      const pageOffset = destOffset % COW_PAGE_SIZE;
      const pte = this.pageTable[pageIndex];
      if (!pte) break;

      if (pte.cow) {
        this.handleCoWFault(pageIndex);
      }

      const chunkSize = Math.min(remaining, COW_PAGE_SIZE - pageOffset);
      pte.physicalPage.data.set(
        data.subarray(sourceOffset, sourceOffset + chunkSize),
        pageOffset,
      );

      sourceOffset += chunkSize;
      destOffset += chunkSize;
      remaining -= chunkSize;
    }
  }

  /** Read a single byte at `offset`. */
  public readByte(offset: number): number {
    const pageIndex = Math.floor(offset / COW_PAGE_SIZE);
    const pageOffset = offset % COW_PAGE_SIZE;
    const pte = this.pageTable[pageIndex];
    return pte ? pte.physicalPage.data[pageOffset]! : 0;
  }

  /** The CoW fault handler: allocate a private copy and update the PTE. */
  private handleCoWFault(pageIndex: number): void {
    const pte = this.pageTable[pageIndex]!;
    const oldPage = pte.physicalPage;

    if (oldPage === this.pool.zeroPage) {
      pte.physicalPage = this.pool.allocate();
    } else if (oldPage.refCount <= 1) {
      // sole owner -- just clear CoW, no copy needed
    } else {
      pte.physicalPage = this.pool.copyPage(oldPage);
      this.pool.release(oldPage);
    }
    pte.cow = false;
  }

  /** Release all physical pages held by this mapping. */
  public dispose(): void {
    for (const pte of this.pageTable) {
      this.pool.release(pte.physicalPage);
    }
    this.pageTable.length = 0;
  }

  // ── Diagnostics (for UI visualization) ─────────────────────────────

  /** Returns per-page sharing/CoW status. */
  public getPageStatus(): Array<{
    pageIndex: number;
    pfn: number;
    cow: boolean;
    shared: boolean;
    isZeroPage: boolean;
  }> {
    return this.pageTable.map((pte, index) => ({
      pageIndex: index,
      pfn: pte.physicalPage.pfn,
      cow: pte.cow,
      shared:
        pte.physicalPage.refCount > 1 ||
        pte.physicalPage === this.pool.zeroPage,
      isZeroPage: pte.physicalPage === this.pool.zeroPage,
    }));
  }
}

export interface CoWPageEntrySnapshot {
  readonly pfn: number;
  readonly cow: boolean;
}

/** References physical pages by PFN rather than inlining their bytes -- the pool itself is snapshotted once, separately (`PhysicalPagePool.snapshotPages`), so sharing between mappings survives a round trip instead of being flattened into independent copies. */
export function snapshotCoWMapping(
  cow: CoWMapping,
): readonly CoWPageEntrySnapshot[] {
  return cow.pageTable.map((pte) => ({
    pfn: pte.physicalPage.pfn,
    cow: pte.cow,
  }));
}

/**
 * Rebuilds a `CoWMapping` against an already-restored `pool`, re-linking
 * every PTE to the pool's own (shared) `PhysicalPage` objects and calling
 * `pool.retain()` exactly once per PTE -- mirroring `cloneAsCoW`'s own
 * pattern -- so `refCount` ends up correct by construction. Two mappings
 * restored from entries that reference the same `pfn` end up pointing at
 * the identical `PhysicalPage` object, preserving CoW sharing exactly.
 */
export function restoreCoWMapping(
  pool: PhysicalPagePool,
  pageCount: number,
  entries: readonly CoWPageEntrySnapshot[],
): CoWMapping {
  const cow = new CoWMapping(pool, pageCount);
  for (const entry of entries) {
    const page = pool.getPage(entry.pfn);
    if (!page)
      throw new Error(
        `vm-snapshot: dangling physical page reference (pfn ${entry.pfn}).`,
      );
    if (page !== pool.zeroPage) pool.retain(page);
    cow.pageTable.push({ physicalPage: page, cow: entry.cow });
  }
  return cow;
}
