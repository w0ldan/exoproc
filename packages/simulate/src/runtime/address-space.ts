import type { MemoryMapping, MemoryProtection } from './types.js';
import {
  CoWMapping,
  snapshotCoWMapping,
  restoreCoWMapping,
  type PhysicalPagePool,
  type CoWPageEntrySnapshot,
} from './physical-memory.js';

const PAGE_SIZE = 0x1000n;
const ALLOCATION_GRANULARITY = 0x10000n;

const alignDown = (value: bigint, alignment: bigint) =>
  value - (value % alignment);
const alignUp = (value: bigint, alignment: bigint) =>
  alignDown(value + alignment - 1n, alignment);

export class MemoryAccessFault extends Error {
  public readonly status = 0xc0000005;

  constructor(
    public readonly operation: 'read' | 'write' | 'execute',
    public readonly address: bigint,
    detail: string,
  ) {
    super(
      `STATUS_ACCESS_VIOLATION (0xC0000005): ${operation} at 0x${address
        .toString(16)
        .toUpperCase()} — ${detail}`,
    );
    this.name = 'MemoryAccessFault';
  }
}

export class Win64AddressSpace {
  private readonly mappings: MemoryMapping[] = [];
  private nextAllocationBase = 0x0000020000000000n;

  public map(
    id: string,
    label: string,
    requestedBase: bigint,
    requestedSize: number,
    protection: MemoryProtection,
    initialData?: Uint8Array,
    options: {
      /** Keep `requestedSize` as the mapping size (the base stays
       * page-granular) instead of page-aligning the size too. Heap
       * allocations and externally-backed buffers use this so a mapping's
       * extent is exactly the allocation it backs -- which is what makes a
       * zero-copy live view (`bun:ffi`'s `toArrayBuffer` returning real,
       * writable memory) possible at the allocation's base address. */
      readonly exactSize?: boolean;
      /** Back the mapping with this exact buffer (a zero-copy alias of
       * caller-owned memory, e.g. `bun:ffi`'s `ptr(uint8array)`) instead of
       * a freshly allocated one. Implies `exactSize`. */
      readonly data?: Uint8Array;
    } = {},
  ): MemoryMapping {
    if (!Number.isSafeInteger(requestedSize) || requestedSize <= 0) {
      throw new RangeError(`Invalid mapping size: ${requestedSize}`);
    }

    const exact = options.exactSize === true || options.data !== undefined;
    const size = exact
      ? requestedSize
      : Number(alignUp(BigInt(requestedSize), PAGE_SIZE));
    const base =
      requestedBase === 0n
        ? this.findFreeRange(size)
        : alignDown(requestedBase, PAGE_SIZE);
    const end = base + BigInt(size);

    const conflict = this.mappings.find(
      (mapping) =>
        base < mapping.base + BigInt(mapping.size) && end > mapping.base,
    );
    if (conflict) {
      throw new Error(
        `Virtual address range overlaps ${conflict.id}: 0x${base.toString(
          16,
        )}..0x${end.toString(16)}`,
      );
    }

    const mapping: MemoryMapping = {
      id,
      label,
      base,
      size,
      protection,
      data: options.data ?? new Uint8Array(size),
    };
    if (initialData) {
      mapping.data.set(initialData.subarray(0, size));
    }

    this.mappings.push(mapping);
    this.mappings.sort((left, right) =>
      left.base < right.base ? -1 : left.base > right.base ? 1 : 0,
    );
    return mapping;
  }

  /**
   * Map a region backed by a CoW page table.
   *
   * The returned `MemoryMapping.data` is a dummy zero buffer (kept for
   * type compatibility); all actual I/O goes through `mapping.cow`.
   *
   * @param shared - when true, pages start CoW (first write triggers copy)
   */
  public mapCoW(
    id: string,
    label: string,
    requestedBase: bigint,
    requestedSize: number,
    protection: MemoryProtection,
    pool: PhysicalPagePool,
    initialData?: Uint8Array,
    shared = false,
  ): MemoryMapping {
    if (!Number.isSafeInteger(requestedSize) || requestedSize <= 0) {
      throw new RangeError(`Invalid mapping size: ${requestedSize}`);
    }

    const size = Number(alignUp(BigInt(requestedSize), PAGE_SIZE));
    const base =
      requestedBase === 0n
        ? this.findFreeRange(size)
        : alignDown(requestedBase, PAGE_SIZE);
    const end = base + BigInt(size);

    const conflict = this.mappings.find(
      (mapping) =>
        base < mapping.base + BigInt(mapping.size) && end > mapping.base,
    );
    if (conflict) {
      throw new Error(
        `Virtual address range overlaps ${conflict.id}: 0x${base.toString(
          16,
        )}..0x${end.toString(16)}`,
      );
    }

    const pageCount = size / Number(PAGE_SIZE);
    const cow = new CoWMapping(pool, pageCount);
    if (initialData && initialData.length > 0) {
      cow.initializeFromData(initialData, shared);
    } else {
      cow.initializeAsZero();
    }

    const mapping: MemoryMapping = {
      id,
      label,
      base,
      size,
      protection,
      data: new Uint8Array(size), // dummy for type compat
      cow,
    };

    this.mappings.push(mapping);
    this.mappings.sort((left, right) =>
      left.base < right.base ? -1 : left.base > right.base ? 1 : 0,
    );
    return mapping;
  }

  /**
   * Map a region using a pre-existing CoW clone (from `CoWMapping.cloneAsCoW`).
   * Used when spawning a second process that shares pages with the first.
   */
  public mapWithCoW(
    id: string,
    label: string,
    requestedBase: bigint,
    size: number,
    protection: MemoryProtection,
    cow: CoWMapping,
  ): MemoryMapping {
    const alignedSize = Number(alignUp(BigInt(size), PAGE_SIZE));
    const base =
      requestedBase === 0n
        ? this.findFreeRange(alignedSize)
        : alignDown(requestedBase, PAGE_SIZE);
    const end = base + BigInt(alignedSize);

    const conflict = this.mappings.find(
      (mapping) =>
        base < mapping.base + BigInt(mapping.size) && end > mapping.base,
    );
    if (conflict) {
      throw new Error(
        `Virtual address range overlaps ${conflict.id}: 0x${base.toString(
          16,
        )}..0x${end.toString(16)}`,
      );
    }

    const mapping: MemoryMapping = {
      id,
      label,
      base,
      size: alignedSize,
      protection,
      data: new Uint8Array(alignedSize),
      cow,
    };

    this.mappings.push(mapping);
    this.mappings.sort((left, right) =>
      left.base < right.base ? -1 : left.base > right.base ? 1 : 0,
    );
    return mapping;
  }

  public allocate(
    id: string,
    label: string,
    size: number,
    protection: MemoryProtection = 'rw',
    requestedBase: bigint = 0n,
  ): MemoryMapping {
    return this.map(id, label, requestedBase, size, protection);
  }

  public getMappings(): readonly MemoryMapping[] {
    return this.mappings;
  }

  public getMapping(id: string): MemoryMapping | undefined {
    return this.mappings.find((mapping) => mapping.id === id);
  }

  public unmap(id: string): boolean {
    const index = this.mappings.findIndex((mapping) => mapping.id === id);
    if (index < 0) return false;
    const mapping = this.mappings[index]!;
    if (mapping.cow) {
      mapping.cow.dispose();
    }
    this.mappings.splice(index, 1);
    return true;
  }

  public findMapping(address: bigint): MemoryMapping | undefined {
    return this.mappings.find(
      (mapping) =>
        address >= mapping.base &&
        address < mapping.base + BigInt(mapping.size),
    );
  }

  public read(
    address: bigint,
    length: number,
    operation: 'read' | 'execute' = 'read',
  ): Uint8Array {
    const mapping = this.assertRange(address, length, operation);
    const offset = Number(address - mapping.base);
    if (mapping.cow) {
      return mapping.cow.read(offset, length);
    }
    return mapping.data.slice(offset, offset + length);
  }

  public write(address: bigint, bytes: Uint8Array | readonly number[]): void {
    const input = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    const mapping = this.assertRange(address, input.length, 'write');
    const offset = Number(address - mapping.base);
    if (mapping.cow) {
      mapping.cow.write(offset, input);
      return;
    }
    mapping.data.set(input, offset);
  }

  /**
   * Loader-only write which deliberately bypasses page protection.
   * This mirrors mapping PE section bytes before final protection is applied.
   */
  public load(address: bigint, bytes: Uint8Array | readonly number[]): void {
    const input = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    const mapping = this.findRange(address, input.length);
    if (!mapping) {
      throw new MemoryAccessFault(
        'write',
        address,
        'loader target is not mapped',
      );
    }
    const offset = Number(address - mapping.base);
    if (mapping.cow) {
      mapping.cow.write(offset, input);
      return;
    }
    mapping.data.set(input, offset);
  }

  public readU32(address: bigint): number {
    const bytes = this.read(address, 4);
    return new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getUint32(0, true);
  }

  public readI32(address: bigint): number {
    const bytes = this.read(address, 4);
    return new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getInt32(0, true);
  }

  public readU64(address: bigint): bigint {
    const bytes = this.read(address, 8);
    return new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).getBigUint64(0, true);
  }

  public writeU32(address: bigint, value: number): void {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
    this.write(address, bytes);
  }

  public writeU64(address: bigint, value: bigint): void {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, BigInt.asUintN(64, value), true);
    this.write(address, bytes);
  }

  public readCString(address: bigint, maxLength = 4096): string {
    const mapping = this.assertRange(address, 1, 'read');
    const offset = Number(address - mapping.base);
    const endLimit = Math.min(mapping.size, offset + maxLength);

    if (mapping.cow) {
      // Read through CoW mapping
      const cow = mapping.cow;
      let end = offset;
      while (end < endLimit && cow.readByte(end) !== 0) end += 1;
      const bytes = cow.read(offset, end - offset);
      return new TextDecoder().decode(bytes);
    }

    let end = offset;
    while (end < endLimit && mapping.data[end] !== 0) end += 1;
    return new TextDecoder().decode(mapping.data.subarray(offset, end));
  }

  public readWideCString(address: bigint, maxCharacters = 4096): string {
    const mapping = this.assertRange(address, 2, 'read');
    const offset = Number(address - mapping.base);
    const endLimit = Math.min(mapping.size, offset + maxCharacters * 2);

    if (mapping.cow) {
      const cow = mapping.cow;
      let end = offset;
      while (
        end + 1 < endLimit &&
        (cow.readByte(end) !== 0 || cow.readByte(end + 1) !== 0)
      ) {
        end += 2;
      }
      let value = '';
      for (let index = offset; index < end; index += 2) {
        value += String.fromCharCode(
          cow.readByte(index) | (cow.readByte(index + 1) << 8),
        );
      }
      return value;
    }

    let end = offset;
    while (
      end + 1 < endLimit &&
      (mapping.data[end] !== 0 || mapping.data[end + 1] !== 0)
    ) {
      end += 2;
    }
    let value = '';
    for (let index = offset; index < end; index += 2) {
      value += String.fromCharCode(
        (mapping.data[index] ?? 0) | ((mapping.data[index + 1] ?? 0) << 8),
      );
    }
    return value;
  }

  private findRange(
    address: bigint,
    length: number,
  ): MemoryMapping | undefined {
    if (!Number.isSafeInteger(length) || length < 0) return undefined;
    const end = address + BigInt(length);
    return this.mappings.find(
      (mapping) =>
        address >= mapping.base && end <= mapping.base + BigInt(mapping.size),
    );
  }

  private assertRange(
    address: bigint,
    length: number,
    operation: 'read' | 'write' | 'execute',
  ): MemoryMapping {
    const mapping = this.findRange(address, length);
    if (!mapping) {
      throw new MemoryAccessFault(operation, address, 'address is not mapped');
    }

    const allowed =
      operation === 'read'
        ? mapping.protection.includes('r')
        : operation === 'write'
          ? mapping.protection.includes('w')
          : mapping.protection.includes('x');
    if (!allowed) {
      throw new MemoryAccessFault(
        operation,
        address,
        `${mapping.id} is ${mapping.protection}`,
      );
    }
    return mapping;
  }

  private findFreeRange(size: number): bigint {
    let candidate = alignUp(this.nextAllocationBase, ALLOCATION_GRANULARITY);
    for (;;) {
      const end = candidate + BigInt(size);
      const conflict = this.mappings.find(
        (mapping) =>
          candidate < mapping.base + BigInt(mapping.size) && end > mapping.base,
      );
      if (!conflict) break;
      candidate = alignUp(
        conflict.base + BigInt(conflict.size),
        ALLOCATION_GRANULARITY,
      );
    }
    this.nextAllocationBase =
      candidate + alignUp(BigInt(size), ALLOCATION_GRANULARITY);
    return candidate;
  }

  public snapshotState(): AddressSpaceSnapshot {
    return {
      mappings: this.mappings.map((mapping): MemoryMappingSnapshot =>
        mapping.cow
          ? {
              id: mapping.id,
              label: mapping.label,
              base: mapping.base,
              size: mapping.size,
              protection: mapping.protection,
              cow: {
                pageCount: mapping.cow.pageCount,
                entries: snapshotCoWMapping(mapping.cow),
              },
            }
          : {
              id: mapping.id,
              label: mapping.label,
              base: mapping.base,
              size: mapping.size,
              protection: mapping.protection,
              data: mapping.data.slice(),
            },
      ),
      nextAllocationBase: this.nextAllocationBase,
    };
  }

  /** Replaces every mapping (discarding whatever the constructor pre-created) with the snapshot's, rebuilding CoW page tables against the already-restored `pool` so shared physical pages stay shared. */
  public restoreMappings(
    pool: PhysicalPagePool,
    snapshot: AddressSpaceSnapshot,
  ): void {
    for (const mapping of this.mappings) {
      mapping.cow?.dispose();
    }
    this.mappings.length = 0;
    for (const mapping of snapshot.mappings) {
      this.mappings.push(
        mapping.cow
          ? {
              id: mapping.id,
              label: mapping.label,
              base: mapping.base,
              size: mapping.size,
              protection: mapping.protection,
              data: new Uint8Array(mapping.size), // dummy for type compat, matches mapCoW's own convention
              cow: restoreCoWMapping(
                pool,
                mapping.cow.pageCount,
                mapping.cow.entries,
              ),
            }
          : {
              id: mapping.id,
              label: mapping.label,
              base: mapping.base,
              size: mapping.size,
              protection: mapping.protection,
              data: mapping.data!.slice(),
            },
      );
    }
    this.mappings.sort((left, right) =>
      left.base < right.base ? -1 : left.base > right.base ? 1 : 0,
    );
    this.nextAllocationBase = snapshot.nextAllocationBase;
  }
}

export interface MemoryMappingSnapshot {
  readonly id: string;
  readonly label: string;
  readonly base: bigint;
  readonly size: number;
  readonly protection: MemoryProtection;
  /** Present for non-CoW mappings. */
  readonly data?: Uint8Array;
  /** Present for CoW mappings. */
  readonly cow?: {
    readonly pageCount: number;
    readonly entries: readonly CoWPageEntrySnapshot[];
  };
}

export interface AddressSpaceSnapshot {
  readonly mappings: readonly MemoryMappingSnapshot[];
  readonly nextAllocationBase: bigint;
}
