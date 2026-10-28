import { concreteLocalMemoryAccessor } from './accessor.js';
import { type DynamicCFunction } from './cfunction.js';
import { createMachineCode } from './cmachinecode.js';
import { Pattern } from './win/scanner.js';
import { MemoryProtection } from './win/defines.js';
import {
  type ICallableMemoryAccessor,
  type ISyncCallableMemoryAccessor,
} from './iaccessor.js';
import { type CCallResult } from './types.js';
import { resolveAddress } from './ffi.js';

// ---------------------------------------------------------------------------
// EXEC_ONLY protection mask
// Ensures discovered addresses are executable in all processes sharing the
// same system DLL mapping (ntdll, kernel32, kernelbase load identically).
// ---------------------------------------------------------------------------
const EXEC_ONLY =
  MemoryProtection.EXECUTE |
  MemoryProtection.EXECUTE_READ |
  MemoryProtection.EXECUTE_READWRITE |
  MemoryProtection.EXECUTE_WRITECOPY;

// ---------------------------------------------------------------------------
// StubScanRegion
// ---------------------------------------------------------------------------

/**
 * A plain base+size descriptor for a memory region to scan.
 * Use raw numbers/bigints so xffi has no dependency on bun-winapi.
 *
 * @example
 * ```ts
 * // Passing a Native.Module:
 * { base: Module.ntdll.base.address, size: Module.ntdll.size }
 * ```
 */
export interface StubScanRegion {
  readonly base: bigint | number;
  readonly size: number;
}

// ---------------------------------------------------------------------------
// Stub
// ---------------------------------------------------------------------------

/**
 * A stub is a short byte sequence (e.g. `C3`, `EB FE`, `FF E3`) that already
 * exists inside a system DLL loaded at a fixed address in every process.
 *
 * Unlike `CMachineCode`, a `Stub` never allocates remote memory — it simply
 * points to the address where the bytes were found locally. Because system DLLs
 * share the same virtual address in all processes, the stub is immediately
 * usable in any remote accessor without injection.
 *
 * It satisfies the `CMachineCode` interface so it can be passed directly to
 * `accessor.machineCode()` — which
 * returns the existing address with no alloc or write.
 */
export interface Stub extends DynamicCFunction {
  readonly bytes: Uint8Array | number[];
  readonly size: number;
  readonly isStub: true;
  shouldCloneForAccessor(accessor: any): boolean;

  machineCode(accessor: ICallableMemoryAccessor): Promise<number>;
  machineCodeSync(accessor: any): number;
  cloneForAddress(address: number): Stub;
  call(accessor: ICallableMemoryAccessor, ...args: any[]): Promise<CCallResult>;
  callSync(accessor: ISyncCallableMemoryAccessor, ...args: any[]): CCallResult;
}

// ---------------------------------------------------------------------------
// Internal factory
// ---------------------------------------------------------------------------
export function makeStub(
  address: number | bigint,
  bytes: number[] = [0xc3],
): Stub {
  const addr = Number(address);
  const wrapper = createMachineCode(addr, ['ptr', []], bytes) as any;

  Object.defineProperty(wrapper, 'isStub', {
    value: true,
    configurable: true,
    enumerable: true,
    writable: false,
  });

  wrapper.cloneForAddress = (targetAddr: number): Stub => {
    if (targetAddr === addr) return wrapper;
    return makeStub(targetAddr, bytes);
  };

  return wrapper as Stub;
}

async function collectStubsFromRange(
  pool: Stub[],
  seen: Set<number>,
  pat: Pattern,
  bytes: number[],
  base: bigint,
  size: number,
  limit: number,
): Promise<void> {
  for await (const mem of concreteLocalMemoryAccessor.scan(base, size, pat)) {
    const address = Number(resolveAddress(mem.address));
    if (!seen.has(address)) {
      seen.add(address);
      pool.push(makeStub(address, bytes));
    }
    if (pool.length >= limit) break;
  }
}

// ---------------------------------------------------------------------------
// StubDescriptor
// ---------------------------------------------------------------------------

/**
 * Handle returned by `registerStub()`.
 *
 * Scanning starts eagerly in the background. `getStub()` is synchronous and
 * picks randomly from the discovered pool — await `whenReady()` before calling
 * it if you cannot tolerate a `StubNotReadyError`.
 */
export interface StubDescriptor {
  /** True once the initial background scan has completed. */
  readonly ready: boolean;

  /**
   * Synchronously returns a `Stub` chosen at random from the pool.
   * @throws {StubNotReadyError} if scanning hasn't finished yet.
   * @throws {NoStubFoundError} if scanning finished but found nothing.
   */
  getStub(): Stub;

  /**
   * Resolves once the initial scan completes.
   * After this you can call `getStub()` safely.
   */
  whenReady(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class StubNotReadyError extends Error {
  constructor() {
    super(
      'Stub scan has not completed yet. ' +
        'Await StubDescriptor.whenReady() before calling getStub().',
    );
    this.name = 'StubNotReadyError';
  }
}

export class NoStubFoundError extends Error {
  constructor(pattern: string) {
    super(`No executable stub found for pattern: ${pattern}`);
    this.name = 'NoStubFoundError';
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface StubOptions {
  /**
   * Memory regions to scan. Each entry provides `base` + `size`.
   *
   * When omitted the scanner walks the full process address space but filters
   * by the `EXECUTE_*` protection mask — which in practice hits only ntdll,
   * kernel32, and kernelbase code sections.
   *
   * Pass explicit module ranges to restrict and speed up scanning:
   * ```ts
   * regions: [{ base: Module.ntdll.base.address, size: Module.ntdll.size }]
   * ```
   */
  regions?: StubScanRegion[];

  /**
   * Maximum number of stub addresses to collect.
   * @default 50
   */
  limit?: number;
}

// ---------------------------------------------------------------------------
// registerStub
// ---------------------------------------------------------------------------

/**
 * Registers a stub pattern and begins scanning immediately in the background.
 *
 * @param pattern  A hex byte string (`'C3'`, `'EB FE'`, `'FF E3'`) or a
 *                 pre-built `Pattern` instance.  The `EXECUTE_*` protection
 *                 filter is always applied to ensure only executable regions
 *                 are matched.
 * @param options  Optional scan configuration (regions, limit).
 * @returns        A `StubDescriptor` whose `getStub()` delivers sync access
 *                 after `whenReady()` resolves.
 *
 * @example
 * ```ts
 * // Eagerly register and wait
 * const retStub = registerStub('C3');
 * await retStub.whenReady();
 * const stub = retStub.getStub();
 * console.log('ret @ 0x' + stub.address.toString(16));
 *
 * // Restrict to specific modules
 * const spinStub = registerStub('EB FE', {
 *   regions: [
 *     { base: Module.ntdll.base.address, size: Module.ntdll.size },
 *     { base: Module.kernel32.base.address, size: Module.kernel32.size },
 *   ],
 * });
 * await spinStub.whenReady();
 * ```
 */
export function registerStub(
  pattern: string | Pattern,
  options?: StubOptions,
): StubDescriptor {
  const limit = options?.limit ?? 50;

  // Clone/build the Pattern; always restrict to executable regions.
  // When the caller passes a pre-built Pattern we clone it (via its bytes)
  // to avoid mutating the caller's object with setProtect/limit.
  const pat: Pattern =
    pattern instanceof Pattern
      ? new Pattern(Array.from(pattern.bytes))
          .setProtect(EXEC_ONLY)
          .limit(limit)
      : new Pattern(pattern).setProtect(EXEC_ONLY).limit(limit);

  const patternStr =
    pattern instanceof Pattern ? `<Pattern len=${pattern.length}>` : pattern;

  const pool: Stub[] = [];
  const seen = new Set<number>();
  const bytes = Array.from(pat.bytes);
  let _ready = false;
  let _readyResolve!: () => void;
  let _readyReject!: (err: unknown) => void;
  const _readyPromise = new Promise<void>((res, rej) => {
    _readyResolve = res;
    _readyReject = rej;
  });

  // Eager background scan
  (async () => {
    try {
      if (typeof process !== 'undefined' && process.platform !== 'win32') {
        _ready = true;
        _readyResolve();
        return;
      }

      const regions = options?.regions;

      if (regions && regions.length > 0) {
        for (const region of regions) {
          if (pool.length >= limit) break;
          const base =
            typeof region.base === 'bigint' ? region.base : BigInt(region.base);
          try {
            await collectStubsFromRange(
              pool,
              seen,
              pat,
              bytes,
              base,
              region.size,
              limit,
            );
          } catch {
            // region can be partially unmapped or protected at runtime
          }
        }
      } else {
        const MAX_ADDR = 0x7fffffffffff;
        try {
          await collectStubsFromRange(
            pool,
            seen,
            pat,
            bytes,
            0n,
            MAX_ADDR,
            limit,
          );
        } catch {
          // full scan can hit transient unreadable pages; keep best-effort behavior
        }
      }

      _ready = true;
      _readyResolve();
    } catch (err) {
      _ready = true;
      _readyReject(err);
    }
  })();

  return {
    get ready() {
      return _ready;
    },

    whenReady(): Promise<void> {
      return _readyPromise;
    },

    getStub(): Stub {
      if (pool.length > 0) {
        return pool[Math.floor(Math.random() * pool.length)]!;
      }
      if (!_ready) throw new StubNotReadyError();
      throw new NoStubFoundError(patternStr);
    },
  };
}

// ---------------------------------------------------------------------------
// Type guard
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the value is a `Stub` (and therefore requires no
 * remote allocation when passed to `accessor.getMachineCode()`).
 */
export function isStub(value: unknown): value is Stub {
  return typeof value === 'function' && (value as any).isStub === true;
}
