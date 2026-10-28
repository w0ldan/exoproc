import { MemoryProtection } from './defines.js';
import { NativeMemory } from '../pointer.js';
import { resolveAddress } from '../ffi.js';

import { smartMemmem } from './memmem.js';

export class InvalidPatternError extends Error {
  constructor(
    message: string,
    public readonly part?: string,
  ) {
    super(message);
    this.name = 'InvalidPatternError';
  }
}

/**
 * Default protection mask: all readable memory regions.
 */
export const DEFAULT_PROTECT =
  MemoryProtection.READONLY |
  MemoryProtection.READWRITE |
  MemoryProtection.EXECUTE_READ |
  MemoryProtection.EXECUTE_READWRITE;

/**
 * Pure data representation of a memory signature.
 * Defines the bytes, mask, limits, and memory protection preferences.
 */
export class Pattern {
  public bytes: Buffer;
  private _limit: number = 1; // Default to 1 result
  public protect: number = DEFAULT_PROTECT;

  constructor(signature: string | number[]) {
    const bytes: number[] = [];

    if (typeof signature === 'string') {
      // Clean up common prefixes like 0x or \x
      let cleanSig = signature.replace(/(0x|\\x)/gi, '');

      // If there are no spaces, assume it's a continuous hex string (e.g. DEADBEEF)
      if (!cleanSig.includes(' ')) {
        // Inject spaces between every 2 characters
        cleanSig = cleanSig.replace(/(.{2})/g, '$1 ').trim();
      }

      const parts = cleanSig.split(/\s+/).filter(Boolean);
      for (const part of parts) {
        const byte = parseInt(part, 16);
        if (isNaN(byte) || byte < 0 || byte > 255) {
          throw new InvalidPatternError(
            `Invalid byte in signature: ${part} (from original: ${signature})`,
            part,
          );
        }
        bytes.push(byte);
      }
    } else if (Array.isArray(signature)) {
      for (let i = 0; i < signature.length; i++) {
        const val = signature[i];
        if (val == null || typeof val !== 'number' || val < 0 || val > 255) {
          throw new InvalidPatternError(
            `Invalid byte in array signature at index ${i}: ${val}`,
          );
        }
        bytes.push(val);
      }
    } else {
      throw new InvalidPatternError(
        'Signature must be a string or an array of numbers',
      );
    }

    this.bytes = Buffer.from(bytes);
  }

  get length(): number {
    return this.bytes.length;
  }

  get maxResults(): number {
    return this._limit;
  }

  get hasLimit(): boolean {
    return this._limit > 0;
  }

  /**
   * Sets a specific scan limit.
   */
  limit(n: number): this {
    this._limit = n;
    return this;
  }

  /**
   * Removes any limits (scan the whole memory for matches).
   */
  noLimit(): this {
    this._limit = 0;
    return this;
  }

  /**
   * Adds flags to the protection mask (OR). Useful for expanding coverage.
   */
  addProtect(flag: number | MemoryProtection): this {
    this.protect |= flag;
    return this;
  }

  /**
   * Replaces the protection mask entirely. Use this to restrict scanning
   * to specific protection types (e.g. only EXECUTE_READ regions).
   */
  setProtect(flag: number | MemoryProtection): this {
    this.protect = flag as number;
    return this;
  }

  /**
   * Automatically applies typical readable/executable filters.
   */
  defaultProtect(): this {
    this.protect = DEFAULT_PROTECT;
    return this;
  }
}

/**
 * A single pattern match entry.
 * Stores the decoded numeric address (bigint) of the match.
 * Call `toAddress()` to retrieve it — consistent with how ffi.address() works.
 */
export class ScanEntry {
  readonly address: bigint;
  readonly size: number;
  readonly module?: any;
  private _pointer?: NativeMemory;

  constructor(address: bigint, size: number, module?: any) {
    this.address = address;
    this.size = size;
    this.module = module;
  }

  /** Returns a NativeMemory instance for this match. Supports add/sub arithmetic. */
  get pointer(): NativeMemory {
    if (!this._pointer) {
      this._pointer = new NativeMemory(this.address, this.size);
    }
    return this._pointer;
  }

  toAddress(): bigint {
    return this.address;
  }

  toString(): string {
    const addressString = '0x' + this.address.toString(16).toUpperCase();
    return this.module
      ? `${this.module.toString()}+${addressString}`
      : addressString;
  }
}

/**
 * Result of a pattern scan operation.
 * Lazily evaluates the underlying generator and caches findings.
 * Supports taking matches one-by-one or materializing the full result via promises.
 */
export class ScanResult implements AsyncIterable<ScanEntry> {
  public readonly pattern: Pattern;
  private generator: AsyncIterator<ScanEntry>;
  private _cached: ScanEntry[] = [];
  private _isExhausted = false;

  constructor(iterable: AsyncIterable<ScanEntry>, pattern: Pattern) {
    this.pattern = pattern;
    this.generator = iterable[Symbol.asyncIterator]();
  }

  /**
   * Evaluates the generator up to 'n' elements and caches them internally.
   */
  private async pump(n?: number) {
    while (!this._isExhausted && (n === undefined || this._cached.length < n)) {
      const res = await this.generator.next();
      if (res.done) {
        this._isExhausted = true;
      } else {
        this._cached.push(res.value);
      }
    }
  }

  /** Gets the first match and stops scanning further unless requested again. */
  async first(): Promise<ScanEntry | undefined> {
    await this.pump(1);
    return this._cached[0];
  }

  /** Gets up to N matches. Scans only as much memory as needed. */
  async take(n: number): Promise<ScanEntry[]> {
    await this.pump(n);
    return this._cached.slice(0, n);
  }

  /** Evaluates the scan fully, up to the pattern's configured limit. */
  async all(): Promise<ScanEntry[]> {
    const limit = this.pattern.maxResults;
    if (limit > 0) {
      await this.pump(limit);
      return this._cached.slice(0, limit);
    } else {
      await this.pump();
      return [...this._cached];
    }
  }

  /** Convenience method strictly evaluating all based on bounds limits */
  async getEntries(): Promise<ScanEntry[]> {
    return this.all();
  }

  /** Number of matched entries (fully evaluates scan). */
  async getLength(): Promise<number> {
    return (await this.all()).length;
  }

  /** All matched addresses directly derived from entries. */
  async getAddresses(): Promise<bigint[]> {
    return (await this.all()).map((e) => e.address);
  }

  /** All matched entries as NativeMemory pointers. Supports arithmetic (add/sub). */
  async getPointers(): Promise<NativeMemory[]> {
    return (await this.all()).map((e) => e.pointer);
  }

  /** Combines another ScanResult efficiently. */
  merge(other: ScanResult): ScanResult {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const me = this;
    const combined = async function* () {
      yield* await me.all(); // Yields cached/evaluated from this
      yield* await other.all(); // Yields cached/evaluated from other
    };
    return new ScanResult(combined(), this.pattern);
  }

  /**
   * Lazily iterates over available entries, fetching from the scan engine only when needed.
   * Bound efficiently by the limit configured on the `Pattern`.
   */
  async *[Symbol.asyncIterator](): AsyncIterator<ScanEntry> {
    const limit = this.pattern.maxResults;
    let yielded = 0;
    // First yield already evaluated results
    for (const cachedEntry of this._cached) {
      if (limit > 0 && yielded >= limit) return;
      yield cachedEntry;
      yielded++;
    }
    // Now evaluate fresh parts if needed
    while (!this._isExhausted && (limit === 0 || yielded < limit)) {
      const res = await this.generator.next();
      if (res.done) {
        this._isExhausted = true;
      } else {
        this._cached.push(res.value);
        yield res.value;
        yielded++;
      }
    }
  }
}

/**
 * Memory scanning utility.
 * Assumes the target memory is directly accessible in the current process.
 */
export class Scanner {
  /**
   * Scans memory for a pattern using a synchronous generator.
   * Yields each matched address as a decoded bigint.
   */
  static *scanSync(
    memory: NativeMemory,
    pattern: Pattern,
    memmemFn: (
      _haystack: bigint,
      _haystackLen: bigint,
      _needle: bigint | Uint8Array,
      _needleLen: bigint,
    ) => bigint = smartMemmem,
    chunkSize: number = 1024 * 1024,
  ): Generator<NativeMemory> {
    const baseAddr = BigInt(resolveAddress(memory.address));
    const size = BigInt(memory.size);
    const patternLen = BigInt(pattern.length);
    if (patternLen === 0n) return;
    if (size < patternLen) return;
    const step = BigInt(chunkSize) - (patternLen - 1n);
    let lastYieldedAddr = -1n;
    if (step <= 0n || size <= BigInt(chunkSize)) {
      // Small region: scan whole region
      let currentBase = baseAddr;
      let remainingSize = size;
      while (remainingSize >= patternLen) {
        const found = memmemFn(
          currentBase,
          remainingSize,
          pattern.bytes,
          patternLen,
        );
        if (!found) break;
        const foundAddr = BigInt(resolveAddress(found));
        if (foundAddr > lastYieldedAddr) {
          yield new NativeMemory(foundAddr, pattern.length);
          lastYieldedAddr = foundAddr;
        }
        const offset = foundAddr - currentBase + 1n;
        currentBase += offset;
        remainingSize -= offset;
      }
    } else {
      // Large region: chunked to prevent blocking
      const stepNum = Number(step);
      const sizeNum = Number(size);
      for (let offset = 0; offset < sizeNum; offset += stepNum) {
        const remaining = sizeNum - offset;
        const currentChunkSize = Math.min(chunkSize, remaining);
        const currentChunkSizeBig = BigInt(currentChunkSize);
        if (currentChunkSizeBig < patternLen) break;
        const currentBase = baseAddr + BigInt(offset);
        let internalOffset = 0n;
        while (internalOffset <= currentChunkSizeBig - patternLen) {
          const searchBase = currentBase + internalOffset;
          const searchSize = currentChunkSizeBig - internalOffset;
          const found = memmemFn(
            searchBase,
            searchSize,
            pattern.bytes,
            patternLen,
          );
          if (!found) break;
          const foundAddr = BigInt(resolveAddress(found));
          if (foundAddr > lastYieldedAddr) {
            yield new NativeMemory(foundAddr, pattern.length);
            lastYieldedAddr = foundAddr;
          }
          internalOffset = foundAddr - currentBase + 1n;
        }
      }
    }
  }

  /**
   * Scans memory for a pattern using a generator.
   * Yields each matched address as a decoded bigint.
   *
   * @param memory Memory region to scan (address and size)
   * @param pattern Pattern to search for
   * @param memmemFn Optional custom memmem implementation (defaults to smartMemmem).
   * @param chunkSize Size of each scan chunk (default: 1MB)
   */
  static async *scan(
    memory: NativeMemory,
    pattern: Pattern,
    memmemFn: (
      _haystack: bigint,
      _haystackLen: bigint,
      _needle: bigint | Uint8Array,
      _needleLen: bigint,
    ) => bigint | Promise<bigint> = smartMemmem,
    chunkSize: number = 1024 * 1024,
  ): AsyncGenerator<NativeMemory> {
    const baseAddr = BigInt(resolveAddress(memory.address));
    const size = BigInt(memory.size);
    const patternLen = BigInt(pattern.length);
    if (patternLen === 0n) return;
    if (size < patternLen) return;
    const step = BigInt(chunkSize) - (patternLen - 1n);
    let lastYieldedAddr = -1n;
    if (step <= 0n || size <= BigInt(chunkSize)) {
      // Small region: scan whole region
      let currentBase = baseAddr;
      let remainingSize = size;
      while (remainingSize >= patternLen) {
        const found = await memmemFn(
          currentBase,
          remainingSize,
          pattern.bytes,
          patternLen,
        );
        if (!found) break;
        const foundAddr = BigInt(resolveAddress(found));
        if (foundAddr > lastYieldedAddr) {
          yield new NativeMemory(foundAddr, pattern.length);
          lastYieldedAddr = foundAddr;
        }
        const offset = foundAddr - currentBase + 1n;
        currentBase += offset;
        remainingSize -= offset;
      }
    } else {
      // Large region: chunked to prevent blocking
      const stepNum = Number(step);
      const sizeNum = Number(size);
      for (let offset = 0; offset < sizeNum; offset += stepNum) {
        const remaining = sizeNum - offset;
        const currentChunkSize = Math.min(chunkSize, remaining);
        const currentChunkSizeBig = BigInt(currentChunkSize);
        if (currentChunkSizeBig < patternLen) break;
        const currentBase = baseAddr + BigInt(offset);
        let internalOffset = 0n;
        while (internalOffset <= currentChunkSizeBig - patternLen) {
          const searchBase = currentBase + internalOffset;
          const searchSize = currentChunkSizeBig - internalOffset;
          const found = await memmemFn(
            searchBase,
            searchSize,
            pattern.bytes,
            patternLen,
          );
          if (!found) break;
          const foundAddr = BigInt(resolveAddress(found));
          if (foundAddr > lastYieldedAddr) {
            yield new NativeMemory(foundAddr, pattern.length);
            lastYieldedAddr = foundAddr;
          }
          internalOffset = foundAddr - currentBase + 1n;
        }
      }
    }
  }
}
