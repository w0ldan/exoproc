/**
 * Real sub-allocating heap, backing `HeapAlloc`/`HeapFree` and, through
 * their own dedicated heap, `malloc`/`free`/`calloc`/`realloc`.
 *
 * Distinct from `Win64Process.allocate()` (the `VirtualAlloc`-style bump
 * allocator backing `VirtualAlloc`/`VirtualAllocEx`): that one hands out a
 * brand-new page-granular OS mapping per call and never reuses freed space.
 * A heap instead sub-allocates chunks out of one fixed-size backing mapping,
 * reusing and coalescing freed chunks -- what `HeapFree`/`free` actually
 * need to mean something.
 *
 * Bookkeeping (chunk offsets/sizes/free flags) lives entirely host-side, in
 * this class -- nothing about it is encoded into guest-readable memory. Only
 * the bytes a caller explicitly writes into an allocated chunk live in the
 * guest's address space.
 */
export interface Win64HeapChunk {
  offset: number;
  size: number;
  free: boolean;
}

/** Below this many leftover bytes, splitting a reused chunk isn't worth it. */
const MIN_SPLIT_REMAINDER = 32;

export class Win64Heap {
  private readonly chunks: Win64HeapChunk[] = [];
  private bumpOffset = 0;
  private pageSequence = 0;
  /** Live page-per-allocation chunks: chunk offset (== the mapping's base,
   * since this mode's `base` is 0) -> the mapping id backing it. */
  private readonly pageMappings = new Map<number, string>();

  constructor(
    /** Address of this heap's backing mapping -- pointers are `base + offset`. */
    public readonly base: bigint,
    /** Total usable size of the backing mapping, in bytes. */
    public readonly capacity: number,
    /** Mapping id of the backing region, for `HeapDestroy` to unmap. */
    public readonly regionMappingId: string,
    /**
     * Page-per-allocation mode: every `alloc()` gets its own dedicated
     * (exact-size) mapping via this callback instead of a chunk carved out
     * of one shared backing region, so every returned pointer is a mapping
     * *base*. That is what lets `bun:ffi`'s `toArrayBuffer` hand back a
     * genuine, writable live view of a heap allocation (see
     * `runtime/bun-ffi.ts`) -- an ArrayBuffer can never express an offset
     * view into a larger shared region.
     */
    private readonly pageAllocator?: (
      size: number,
      mappingId: string,
      requestedBase?: bigint,
    ) => bigint,
    private readonly pageDeallocator?: (mappingId: string) => void,
  ) {}

  /** Allocates `size` bytes, reusing a freed chunk first-fit before growing. */
  public alloc(size: number): number | undefined {
    const requested = Math.max(1, Math.trunc(size));

    if (this.pageAllocator) {
      const reused = this.chunks.find(
        (chunk) => chunk.free && chunk.size >= requested,
      );
      if (reused) {
        reused.free = false;
        const mappingId = this.pageMappings.get(reused.offset)!;
        this.pageAllocator(reused.size, mappingId, BigInt(reused.offset));
        return reused.offset;
      }

      const mappingId = `${this.regionMappingId}:${this.pageSequence++}`;
      const base = this.pageAllocator(requested, mappingId);
      const offset = Number(base);
      this.chunks.push({ offset, size: requested, free: false });
      this.pageMappings.set(offset, mappingId);
      return offset;
    }

    const reused = this.chunks.find(
      (chunk) => chunk.free && chunk.size >= requested,
    );
    if (reused) {
      const remainder = reused.size - requested;
      reused.free = false;
      if (remainder >= MIN_SPLIT_REMAINDER) {
        const remainderChunk: Win64HeapChunk = {
          offset: reused.offset + requested,
          size: remainder,
          free: true,
        };
        reused.size = requested;
        this.chunks.push(remainderChunk);
        this.chunks.sort((a, b) => a.offset - b.offset);
      }
      return reused.offset;
    }

    if (this.bumpOffset + requested > this.capacity) return undefined;
    const offset = this.bumpOffset;
    this.chunks.push({ offset, size: requested, free: false });
    this.bumpOffset += requested;
    return offset;
  }

  /** Returns a chunk to the free list. `false` if `offset` isn't a live allocation. */
  public free(offset: number): boolean {
    const chunk = this.chunks.find(
      (candidate) => candidate.offset === offset && !candidate.free,
    );
    if (!chunk) return false;
    if (this.pageDeallocator) {
      const mappingId = this.pageMappings.get(offset);
      if (mappingId !== undefined) {
        this.pageDeallocator(mappingId);
      }
    }
    chunk.free = true;
    this.coalesce();
    return true;
  }

  /** Unmaps every live page-per-allocation chunk (for `HeapDestroy`). */
  public destroyAll(): void {
    if (this.pageDeallocator) {
      for (const mappingId of this.pageMappings.values()) {
        this.pageDeallocator(mappingId);
      }
      this.pageMappings.clear();
    }
    this.chunks.length = 0;
  }

  /** Usable size of a live allocation, or `undefined` if `offset` isn't one. */
  public sizeOf(offset: number): number | undefined {
    return this.chunks.find((chunk) => chunk.offset === offset && !chunk.free)
      ?.size;
  }

  private coalesce(): void {
    this.chunks.sort((a, b) => a.offset - b.offset);
    for (let index = 0; index < this.chunks.length - 1;) {
      const current = this.chunks[index]!;
      const next = this.chunks[index + 1]!;
      if (
        current.free &&
        next.free &&
        current.offset + current.size === next.offset
      ) {
        current.size += next.size;
        this.chunks.splice(index + 1, 1);
      } else {
        index += 1;
      }
    }
  }

  public snapshotState(): Win64HeapStateSnapshot {
    return {
      chunks: this.chunks.map((chunk) => ({ ...chunk })),
      bumpOffset: this.bumpOffset,
      pageSequence: this.pageSequence,
      pageMappings: [...this.pageMappings.entries()],
    };
  }

  /** `pageAllocator`/`pageDeallocator` are never touched here -- they're live closures the caller must have already re-supplied via the constructor (see `Win64Machine.buildHeap`). This only restores the plain bookkeeping data. */
  public restoreState(state: Win64HeapStateSnapshot): void {
    this.chunks.length = 0;
    this.chunks.push(...state.chunks.map((chunk) => ({ ...chunk })));
    this.bumpOffset = state.bumpOffset;
    this.pageSequence = state.pageSequence;
    this.pageMappings.clear();
    for (const [offset, mappingId] of state.pageMappings) {
      this.pageMappings.set(offset, mappingId);
    }
  }
}

export interface Win64HeapStateSnapshot {
  readonly chunks: readonly Win64HeapChunk[];
  readonly bumpOffset: number;
  readonly pageSequence: number;
  readonly pageMappings: readonly (readonly [
    offset: number,
    mappingId: string,
  ])[];
}
