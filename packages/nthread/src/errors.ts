import { ExoprocError } from 'exoproc-utils';

// ── Base ──────────────────────────────────────────────────────────────────────

abstract class BaseError extends ExoprocError {
  constructor(
    message: string,
    options?: { data?: unknown; code?: string; cause?: Error },
  ) {
    super(message, options);
  }
}

// ── NThread errors ────────────────────────────────────────────────────────────

export class NThreadError extends BaseError {}

export class NoSleepAddressError extends NThreadError {
  constructor() {
    super('No valid sleep address could be found or auto-discovered');
  }
}

export class NoPushretAddressError extends NThreadError {
  constructor() {
    super('No valid pushret stub could be found or auto-discovered');
  }
}

export class NoJumpAddressError extends NThreadError {
  constructor() {
    super('No valid jump stub could be found or auto-discovered');
  }
}

export class NoRetAddressError extends NThreadError {
  constructor() {
    super('No valid ret stub could be found or auto-discovered');
  }
}

export class NoAddRsp28RetAddressError extends NThreadError {
  constructor() {
    super('No valid add rsp, 0x28; ret stub could be found or auto-discovered');
  }
}

export class InjectError extends NThreadError {}

export class InjectTimeoutError extends InjectError {
  constructor(public readonly waitResult: number) {
    super(`Thread did not reach sleep address (wait result: ${waitResult})`);
  }
}

export class InjectAbortedError extends InjectError {
  constructor() {
    super('Thread injection was aborted');
  }
}

export class WaitAbortedError extends NThreadError {
  constructor() {
    super('Thread wait was aborted');
  }
}

export class MsvcrtNotLoadedError extends InjectError {
  constructor() {
    super("msvcrt.dll is not loaded in the target thread's process");
  }
}

export class ThreadReadNotImplementedError extends NThreadError {
  constructor() {
    super(
      'threadRead is not implemented; use fileRead or writeMemory with a local buffer instead',
    );
  }
}

// ── Call errors ───────────────────────────────────────────────────────────────

export class CallError extends NThreadError {
  public readonly target: bigint;

  constructor(message: string, target: bigint) {
    super(message);
    this.target = target;
  }
}

export class CallNotInjectedError extends CallError {
  constructor() {
    super('Thread not injected. Call inject() first.', 0n);
  }
}

export class CallTooManyArgsError extends CallError {
  public readonly argCount: number;

  constructor(argCount: number) {
    super(
      `x64 calling convention supports max 4 register arguments (RCX, RDX, R8, R9), got ${argCount}`,
      0n,
    );
    this.argCount = argCount;
  }
}

export class CallTimeoutError extends CallError {
  public readonly waitResult: number;

  constructor(target: bigint, waitResult: number) {
    super(
      `Thread did not return to sleep address (wait result: ${waitResult})`,
      target,
    );
    this.waitResult = waitResult;
  }
}

export class CallThreadDiedError extends CallError {
  constructor(target: bigint) {
    super(
      'Thread died during call (e.g. ExitThread / noreturn function)',
      target,
    );
  }
}

// ── Read errors ──────────────────────────────────────────────────────────────

export class ReadError extends NThreadError {}

// ── Write errors ─────────────────────────────────────────────────────────────────

export class WriteError extends NThreadError {}

export class WriteSizeRequiredError extends WriteError {
  constructor() {
    super('Size must be specified when writing from a NativePointer source');
  }
}

export class WriteFailedError extends WriteError {
  constructor() {
    super('Failed to write memory');
  }
}

// ── Alloc errors ─────────────────────────────────────────────────────────────

export class AllocError extends NThreadError {}

export class CallocNullError extends AllocError {
  public readonly size: number;

  constructor(size: number) {
    super(`calloc(1, ${size}) returned NULL`);
    this.size = size;
  }
}

export class ReallocNullError extends AllocError {
  public readonly address: bigint;
  public readonly size: number;

  constructor(address: bigint, size: number) {
    super(`realloc(0x${address.toString(16)}, ${size}) returned NULL`);
    this.address = address;
    this.size = size;
  }
}

// ── Proxy errors ─────────────────────────────────────────────────────────────

export class ProxyError extends NThreadError {}

export class ProxyReadNotConfiguredError extends ProxyError {
  constructor() {
    super('read not configured and no Process provided');
  }
}

export class ProxyWriteNotConfiguredError extends ProxyError {
  constructor() {
    super('write not configured and no Process provided');
  }
}

export class ProxyCallNotConfiguredError extends ProxyError {
  constructor() {
    super('call not configured');
  }
}

// ── Heap errors ──────────────────────────────────────────────────────────────

export class HeapError extends NThreadError {}

export class HeapInvalidSizeError extends HeapError {
  public readonly roSize: number;
  public readonly rwSize: number;

  constructor(roSize: number, rwSize: number) {
    super(`Invalid heap sizes: roSize=${roSize}, rwSize=${rwSize}`);
    this.roSize = roSize;
    this.rwSize = rwSize;
  }
}

export class HeapAllocSizeError extends HeapError {
  public readonly size: number;

  constructor(size: number) {
    super(`Invalid alloc size: ${size}`);
    this.size = size;
  }
}

export class HeapZoneExhaustedError extends HeapError {
  public readonly zone: 'readonly' | 'readwrite';
  public readonly requested: number;
  public readonly available: number;

  constructor(
    zone: 'readonly' | 'readwrite',
    requested: number,
    available: number,
  ) {
    super(
      `${zone === 'readonly' ? 'Readonly' : 'ReadWrite'} zone exhausted: requested ${requested}, available ${available}`,
    );
    this.zone = zone;
    this.requested = requested;
    this.available = available;
  }
}

export class HeapFreeInvalidError extends HeapError {
  public readonly address: bigint;

  constructor(address: bigint) {
    super(`Address 0x${address.toString(16)} does not belong to this heap`);
    this.address = address;
  }
}

// ── File I/O errors ───────────────────────────────────────────────────────────

export class FileError extends NThreadError {}

// ── Stub errors ─────────────────────────────────────────────────────────────

export class StubError extends NThreadError {}

export class StubScanError extends StubError {
  public readonly pattern: string;

  constructor(pattern: string) {
    super(`Failed to scan for stub pattern: ${pattern}`);
    this.pattern = pattern;
  }
}
