import type { Win64AddressSpace } from './address-space.js';
import type { MemoryMapping } from './types.js';
import type { Win64Process } from './win64-machine.js';

/**
 * Value kinds a scan can search for.
 *
 * Integers decode to `bigint` (matching how every other address/value in this
 * runtime is represented), floats to `number`, `bytes` to `Uint8Array` and
 * `string` to `string`.
 */
export type Win64ScanValueType =
  'i8' | 'i16' | 'i32' | 'i64' | 'f32' | 'f64' | 'bytes' | 'string';

export type Win64ScanStringEncoding = 'ascii' | 'utf16';

export type Win64ScanValue = bigint | number | string | Uint8Array;

/** What a caller may hand to an `exact` scan or to `writeScanValue`. */
export type Win64ScanValueInput = bigint | number | string | Uint8Array;

export type Win64FirstScanCompare = 'exact' | 'unknown';

export type Win64NextScanCompare =
  | 'exact'
  | 'changed'
  | 'unchanged'
  | 'increased'
  | 'decreased'
  | 'bigger-than'
  | 'smaller-than';

export interface Win64ScanRange {
  readonly start: bigint;
  /** Exclusive. */
  readonly end: bigint;
}

export interface Win64ScanRegionFilter {
  /** Restrict the scan to these mapping ids (see `Win64AddressSpace.getMappings`). */
  readonly mappingIds?: readonly string[];
  /** Restrict the scan to a `[start, end)` virtual address window. */
  readonly range?: Win64ScanRange;
}

export interface Win64FirstScanOptions extends Win64ScanRegionFilter {
  readonly type: Win64ScanValueType;
  /** Defaults to `exact` when a `value` is given, otherwise `unknown`. */
  readonly compare?: Win64FirstScanCompare;
  readonly value?: Win64ScanValueInput;
  /** Candidate address stride. Defaults to the value size (1 for bytes/string). */
  readonly alignment?: number;
  /** Encoding used by the `string` value type. Defaults to `ascii`. */
  readonly encoding?: Win64ScanStringEncoding;
}

export interface Win64NextScanOptions {
  readonly compare: Win64NextScanCompare;
  /** Required by `exact`, `bigger-than` and `smaller-than`. */
  readonly value?: Win64ScanValueInput;
}

export interface Win64ScanResult {
  readonly address: bigint;
  /** Decoded value read from live process memory during this scan. */
  readonly value: Win64ScanValue;
  /** Decoded snapshot this candidate carried into this scan. */
  readonly previousValue: Win64ScanValue;
}

export interface Win64ScanReport {
  readonly type: Win64ScanValueType;
  readonly valueSize: number;
  /** Every surviving candidate, including the ones beyond `results`. */
  readonly total: number;
  readonly results: readonly Win64ScanResult[];
  /** `true` when `total` exceeded the result cap and `results` is a page. */
  readonly truncated: boolean;
}

/**
 * How many results a single report materializes. Narrowing always runs over
 * the full candidate set held internally -- this only caps how much a caller
 * is handed at once, so a first `unknown` scan over a whole address space
 * doesn't try to build a million result objects for a UI list.
 */
export const WIN64_SCAN_RESULT_LIMIT = 4096;

const FIXED_VALUE_SIZE: Readonly<Record<string, number>> = {
  i8: 1,
  i16: 2,
  i32: 4,
  i64: 8,
  f32: 4,
  f64: 8,
};

const isFloatType = (type: Win64ScanValueType) =>
  type === 'f32' || type === 'f64';

const isIntegerType = (type: Win64ScanValueType) =>
  type === 'i8' || type === 'i16' || type === 'i32' || type === 'i64';

const isNumericType = (type: Win64ScanValueType) =>
  isFloatType(type) || isIntegerType(type);

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Encodes a typed value into the exact little-endian bytes that would sit in
 * guest memory. Shared by `exact` scans, "edit value" writes and the machine's
 * frozen-value registry so all three agree on the on-wire representation.
 */
export function encodeScanValue(
  type: Win64ScanValueType,
  value: Win64ScanValueInput,
  encoding: Win64ScanStringEncoding = 'ascii',
): Uint8Array {
  if (type === 'bytes') {
    if (!(value instanceof Uint8Array)) {
      throw new TypeError("The 'bytes' scan type needs a Uint8Array value");
    }
    if (value.length === 0) {
      throw new RangeError("The 'bytes' scan type needs at least one byte");
    }
    return value.slice();
  }
  if (type === 'string') {
    if (typeof value !== 'string') {
      throw new TypeError("The 'string' scan type needs a string value");
    }
    if (value.length === 0) {
      throw new RangeError("The 'string' scan type needs a non-empty string");
    }
    if (encoding === 'ascii') return new TextEncoder().encode(value);
    const bytes = new Uint8Array(value.length * 2);
    const view = viewOf(bytes);
    for (let index = 0; index < value.length; index += 1) {
      view.setUint16(index * 2, value.charCodeAt(index), true);
    }
    return bytes;
  }

  const size = FIXED_VALUE_SIZE[type]!;
  const bytes = new Uint8Array(size);
  const view = viewOf(bytes);
  if (isFloatType(type)) {
    if (typeof value !== 'number' && typeof value !== 'bigint') {
      throw new TypeError(`The '${type}' scan type needs a numeric value`);
    }
    const numeric = Number(value);
    if (type === 'f32') view.setFloat32(0, numeric, true);
    else view.setFloat64(0, numeric, true);
    return bytes;
  }

  if (typeof value !== 'number' && typeof value !== 'bigint') {
    throw new TypeError(`The '${type}' scan type needs an integer value`);
  }
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new RangeError(`${value} is not an integer`);
  }
  const integer = BigInt.asUintN(size * 8, BigInt(value));
  if (size === 1) view.setUint8(0, Number(integer));
  else if (size === 2) view.setUint16(0, Number(integer), true);
  else if (size === 4) view.setUint32(0, Number(integer), true);
  else view.setBigUint64(0, integer, true);
  return bytes;
}

/** Decodes bytes previously read from guest memory back into a typed value. */
export function decodeScanValue(
  type: Win64ScanValueType,
  bytes: Uint8Array,
  encoding: Win64ScanStringEncoding = 'ascii',
): Win64ScanValue {
  if (type === 'bytes') return bytes.slice();
  if (type === 'string') {
    if (encoding === 'ascii') return new TextDecoder().decode(bytes);
    const view = viewOf(bytes);
    let text = '';
    for (let index = 0; index + 1 < bytes.length; index += 2) {
      text += String.fromCharCode(view.getUint16(index, true));
    }
    return text;
  }
  const view = viewOf(bytes);
  switch (type) {
    case 'i8':
      return BigInt(view.getInt8(0));
    case 'i16':
      return BigInt(view.getInt16(0, true));
    case 'i32':
      return BigInt(view.getInt32(0, true));
    case 'i64':
      return view.getBigInt64(0, true);
    case 'f32':
      return view.getFloat32(0, true);
    default:
      return view.getFloat64(0, true);
  }
}

/**
 * Writes a typed value into a process's real address space (the "edit value"
 * side of a scanner). Returns the bytes written so a caller can hand the exact
 * same buffer to `Win64Machine.freezeAddress`.
 */
export function writeScanValue(
  process: Win64Process,
  address: bigint,
  type: Win64ScanValueType,
  value: Win64ScanValueInput,
  encoding: Win64ScanStringEncoding = 'ascii',
): Uint8Array {
  const bytes = encodeScanValue(type, value, encoding);
  process.memory.write(address, bytes);
  return bytes;
}

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
};

/**
 * A Cheat-Engine-style scanner over one process's real address space.
 *
 * Every candidate value is produced by an actual `Win64AddressSpace.read` of
 * live guest memory; no copy of guest memory survives a scan pass. The only
 * state carried between scans is each candidate's *value* snapshot
 * (`snapshot`/`previous`), which is what `changed`/`increased`/... compare
 * against -- exactly what a real scanner keeps, and deliberately kept
 * separate from the freshly read bytes it is compared with.
 */
export class Win64MemoryScanner {
  private readonly memory: Win64AddressSpace;
  private type: Win64ScanValueType = 'i32';
  private encoding: Win64ScanStringEncoding = 'ascii';
  private size = 4;
  /** Candidate addresses, ascending. */
  private addresses = new BigUint64Array(0);
  /**
   * `size` bytes per candidate: the value each one had at the *last* scan.
   * This is what a narrowing compare (`changed`, `increased`, ...) measures
   * live memory against.
   */
  private snapshot = new Uint8Array(0);
  /**
   * `size` bytes per candidate: the value each one had at the scan *before*
   * that -- Cheat Engine's "Previous" column, which stays put while the value
   * column keeps refreshing from live memory. Equal to `snapshot` after a
   * first scan, since there is no earlier scan to remember.
   */
  private previous = new Uint8Array(0);
  private candidateCount = 0;

  constructor(public readonly process: Win64Process) {
    this.memory = process.memory;
  }

  public get valueType(): Win64ScanValueType {
    return this.type;
  }

  public get valueSize(): number {
    return this.size;
  }

  /** Surviving candidate count (may be far larger than one report page). */
  public get total(): number {
    return this.candidateCount;
  }

  /** Drops every candidate without scanning ("New scan" in Cheat Engine). */
  public reset(): void {
    this.addresses = new BigUint64Array(0);
    this.snapshot = new Uint8Array(0);
    this.previous = new Uint8Array(0);
    this.candidateCount = 0;
  }

  public firstScan(options: Win64FirstScanOptions): Win64ScanReport {
    const compare =
      options.compare ?? (options.value === undefined ? 'unknown' : 'exact');
    const encoding = options.encoding ?? 'ascii';
    const needle =
      compare === 'exact'
        ? encodeScanValue(
            options.type,
            this.requireValue(options.value, 'exact'),
            encoding,
          )
        : undefined;
    if (!needle && !isNumericType(options.type)) {
      // Cheat Engine disables "unknown initial value" for AOB/string scans for
      // the same reason: with no needle there is no value width to snapshot.
      throw new Error(
        `An 'unknown' first scan needs a fixed-width value type, not '${options.type}'`,
      );
    }
    const size = needle?.length ?? FIXED_VALUE_SIZE[options.type]!;
    // Numeric values are naturally aligned in practice; byte/string patterns
    // are not, so they default to a dense stride like a real AOB scan.
    const alignment =
      options.alignment ??
      (isNumericType(options.type) ? FIXED_VALUE_SIZE[options.type]! : 1);
    if (!Number.isSafeInteger(alignment) || alignment <= 0) {
      throw new RangeError(`Invalid scan alignment: ${alignment}`);
    }

    this.type = options.type;
    this.encoding = encoding;
    this.size = size;

    const addresses: bigint[] = [];
    const snapshots: Uint8Array[] = [];
    for (const region of this.readRegions(options)) {
      const { mapping, data, startOffset, endOffset } = region;
      const first =
        startOffset + ((alignment - (startOffset % alignment)) % alignment);
      for (
        let offset = first;
        offset + size <= endOffset;
        offset += alignment
      ) {
        const candidate = data.subarray(offset, offset + size);
        if (needle && !bytesEqual(candidate, needle)) continue;
        addresses.push(mapping.base + BigInt(offset));
        snapshots.push(candidate);
      }
    }

    // Nothing preceded a first scan, so "previous" starts out as this scan.
    this.storeCandidates(addresses, snapshots, snapshots);
    return this.page(0);
  }

  public nextScan(options: Win64NextScanOptions): Win64ScanReport {
    const compare = options.compare;
    const needsValue =
      compare === 'exact' ||
      compare === 'bigger-than' ||
      compare === 'smaller-than';
    const needle = needsValue
      ? encodeScanValue(
          this.type,
          this.requireValue(options.value, compare),
          this.encoding,
        )
      : undefined;
    if (needle && needle.length !== this.size) {
      throw new RangeError(
        `A ${needle.length}-byte value cannot narrow a ${this.size}-byte scan`,
      );
    }
    const ordered =
      compare === 'increased' ||
      compare === 'decreased' ||
      compare === 'bigger-than' ||
      compare === 'smaller-than';
    if (ordered && !isNumericType(this.type)) {
      throw new Error(
        `'${compare}' needs a numeric scan type, not '${this.type}'`,
      );
    }

    const needleValue = needle && ordered ? this.toNumeric(needle) : undefined;
    const addresses: bigint[] = [];
    const snapshots: Uint8Array[] = [];
    const priors: Uint8Array[] = [];
    const reader = this.createLiveReader();
    for (let index = 0; index < this.candidateCount; index += 1) {
      const address = this.addresses[index]!;
      const current = reader(address, this.size);
      // Dropped mapping (freed allocation, exited process): the candidate no
      // longer refers to readable memory, so it cannot survive this scan.
      if (!current) continue;
      const compared = this.snapshot.subarray(
        index * this.size,
        (index + 1) * this.size,
      );
      if (!this.matches(compare, current, compared, needle, needleValue)) {
        continue;
      }
      addresses.push(address);
      snapshots.push(current);
      priors.push(compared);
    }

    this.storeCandidates(addresses, snapshots, priors);
    return this.page(0);
  }

  /**
   * Materializes one page of the surviving candidates, re-reading each value
   * from live memory (so a report is always current, never a replay).
   */
  public page(offset = 0, limit = WIN64_SCAN_RESULT_LIMIT): Win64ScanReport {
    const start = Math.max(0, Math.min(offset, this.candidateCount));
    const end = Math.min(this.candidateCount, start + Math.max(0, limit));
    const results: Win64ScanResult[] = [];
    const reader = this.createLiveReader();
    for (let index = start; index < end; index += 1) {
      const address = this.addresses[index]!;
      const current = reader(address, this.size);
      if (!current) continue;
      results.push({
        address,
        value: decodeScanValue(this.type, current, this.encoding),
        previousValue: decodeScanValue(
          this.type,
          this.previous.slice(index * this.size, (index + 1) * this.size),
          this.encoding,
        ),
      });
    }
    return {
      type: this.type,
      valueSize: this.size,
      total: this.candidateCount,
      results,
      truncated: results.length < this.candidateCount,
    };
  }

  /** Reads one address with this scanner's value type, straight from memory. */
  public readValue(address: bigint): Win64ScanValue {
    return decodeScanValue(
      this.type,
      this.memory.read(address, this.size),
      this.encoding,
    );
  }

  /** Writes one address with this scanner's value type. See `writeScanValue`. */
  public writeValue(address: bigint, value: Win64ScanValueInput): Uint8Array {
    return writeScanValue(
      this.process,
      address,
      this.type,
      value,
      this.encoding,
    );
  }

  private requireValue(
    value: Win64ScanValueInput | undefined,
    compare: string,
  ): Win64ScanValueInput {
    if (value === undefined) {
      throw new Error(`A '${compare}' scan needs a value`);
    }
    return value;
  }

  private storeCandidates(
    addresses: readonly bigint[],
    snapshots: readonly Uint8Array[],
    priors: readonly Uint8Array[],
  ): void {
    const count = addresses.length;
    const packedSnapshot = new Uint8Array(count * this.size);
    const packedPrevious = new Uint8Array(count * this.size);
    const packedAddresses = new BigUint64Array(count);
    for (let index = 0; index < count; index += 1) {
      packedAddresses[index] = addresses[index]!;
      packedSnapshot.set(snapshots[index]!, index * this.size);
      packedPrevious.set(priors[index]!, index * this.size);
    }
    this.addresses = packedAddresses;
    this.snapshot = packedSnapshot;
    this.previous = packedPrevious;
    this.candidateCount = count;
  }

  /**
   * Reads every readable mapping selected by the filter, once, in one bulk
   * `Win64AddressSpace.read` per mapping. That single read is a real,
   * protection-checked, CoW-aware read of live memory taken at scan time --
   * the buffer only exists for the duration of this scan pass.
   */
  private *readRegions(filter: Win64ScanRegionFilter): Generator<{
    mapping: MemoryMapping;
    data: Uint8Array;
    startOffset: number;
    endOffset: number;
  }> {
    for (const mapping of this.selectMappings(filter)) {
      const window = this.clampToRange(mapping, filter.range);
      if (!window) continue;
      yield {
        mapping,
        data: this.memory.read(mapping.base, mapping.size),
        startOffset: window.startOffset,
        endOffset: window.endOffset,
      };
    }
  }

  private selectMappings(filter: Win64ScanRegionFilter): MemoryMapping[] {
    const allowed = filter.mappingIds && new Set(filter.mappingIds);
    return this.memory
      .getMappings()
      .filter(
        (mapping) =>
          mapping.protection.includes('r') &&
          (!allowed || allowed.has(mapping.id)),
      );
  }

  private clampToRange(
    mapping: MemoryMapping,
    range: Win64ScanRange | undefined,
  ): { startOffset: number; endOffset: number } | undefined {
    if (!range) return { startOffset: 0, endOffset: mapping.size };
    const mappingEnd = mapping.base + BigInt(mapping.size);
    const start = range.start > mapping.base ? range.start : mapping.base;
    const end = range.end < mappingEnd ? range.end : mappingEnd;
    if (start >= end) return undefined;
    return {
      startOffset: Number(start - mapping.base),
      endOffset: Number(end - mapping.base),
    };
  }

  /**
   * Per-scan reader that re-reads each mapping in bulk the first time a
   * candidate lands in it. Candidates are stored ascending, so this walks
   * mappings forward exactly once instead of re-resolving the mapping list per
   * candidate -- while still reading real memory through the address space.
   */
  private createLiveReader(): (
    address: bigint,
    size: number,
  ) => Uint8Array | undefined {
    const mappings = this.memory
      .getMappings()
      .filter((mapping) => mapping.protection.includes('r'));
    let index = 0;
    let cachedId: string | undefined;
    let cachedData: Uint8Array | undefined;
    return (address, size) => {
      while (
        index < mappings.length &&
        address >= mappings[index]!.base + BigInt(mappings[index]!.size)
      ) {
        index += 1;
      }
      const mapping = mappings[index];
      if (!mapping || address < mapping.base) return undefined;
      const offset = Number(address - mapping.base);
      if (offset + size > mapping.size) return undefined;
      if (cachedId !== mapping.id) {
        cachedId = mapping.id;
        cachedData = this.memory.read(mapping.base, mapping.size);
      }
      return cachedData!.slice(offset, offset + size);
    };
  }

  private toNumeric(bytes: Uint8Array): number | bigint {
    return decodeScanValue(this.type, bytes, this.encoding) as number | bigint;
  }

  /** `compared` is the value this candidate carried out of the last scan. */
  private matches(
    compare: Win64NextScanCompare,
    current: Uint8Array,
    compared: Uint8Array,
    needle: Uint8Array | undefined,
    needleValue: number | bigint | undefined,
  ): boolean {
    if (compare === 'exact') return bytesEqual(current, needle!);
    if (compare === 'changed') return !bytesEqual(current, compared);
    if (compare === 'unchanged') return bytesEqual(current, compared);

    const currentValue = this.toNumeric(current);
    if (compare === 'bigger-than') return currentValue > needleValue!;
    if (compare === 'smaller-than') return currentValue < needleValue!;
    const comparedValue = this.toNumeric(compared);
    return compare === 'increased'
      ? currentValue > comparedValue
      : currentValue < comparedValue;
  }
}
