import { log } from './logger.js';
import { Kernel32Impl, INFINITE, WaitReturn, waitAsync } from 'bun-xffi';
type HANDLE = bigint;
import { NativePointer } from 'bun-xffi';
import { InvalidHandleError } from './errors.js';

function getHandleLog() {
  return log.add('Handle');
}

const handleLog = {
  info: (m: string, d?: unknown) => getHandleLog().info(m, d),
  warn: (m: string, d?: unknown) => getHandleLog().warn(m, d),
  debug: (m: string, d?: unknown) => getHandleLog().debug(m, d),
  error: (m: string, d?: unknown) => getHandleLog().error(m, d),
  fatal: (m: string, d?: unknown) => getHandleLog().fatal(m, d),
  trace: (m: string, d?: unknown) => getHandleLog().trace(m, d),
};

/**
 * Waits at or below this threshold use a tight 1ms poll-sleep loop instead
 * of `waitAsync`'s backoff ramp -- short enough that the ramp's instant
 * checks + first backoff step would already overshoot the timeout.
 */
const SHORT_WAIT_POLL_THRESHOLD_MS = 15;

/**
 * Base class for Win32 handles.
 * Extends FixedNativePointer — the handle value itself IS the pointer address.
 */
export class Handle extends NativePointer {
  protected closed: boolean = false;

  constructor(handle: HANDLE, checkValid: boolean = true) {
    if (checkValid && !Handle.checkValid(handle))
      throw new InvalidHandleError();
    super(handle);
  }

  static checkValid(handle: HANDLE): boolean {
    const address = BigInt(handle);
    if (address === 0n || address === -1n || address === 0xffffffffffffffffn)
      return false;
    return true;
  }

  /** Self-reference for backwards compatibility — Handle IS the pointer. */
  get handle(): this {
    return this;
  }

  /** Raw koffi HANDLE for use in Win32 API calls. */
  get rawHandle(): HANDLE {
    const addr = BigInt(this.address);
    return (addr < 0n ? addr & 0xffffffffffffffffn : addr) as HANDLE;
  }

  /**
   * Checks if the handle is valid
   */
  isValid(): boolean {
    return !this.isNull() && !this.closed;
  }

  /**
   * Closes the handle
   */
  close() {
    if (this.isValid()) {
      const raw = this.rawHandle;
      this.closed = true;
      Kernel32Impl.CloseHandle(raw);
    }
  }

  /**
   * Waits for the handle to signal
   * @param timeoutMs Timeout in milliseconds (default: INFINITE)
   */
  async wait(timeoutMs: number = INFINITE): Promise<WaitReturn> {
    if (!this.isValid()) throw new Error('Handle is closed');
    handleLog.debug(`Waiting for ${this} to signal (Timeout: ${timeoutMs}ms)`);

    if (timeoutMs === 0) {
      return Kernel32Impl.WaitForSingleObject(this.rawHandle, 0) as WaitReturn;
    }

    if (timeoutMs <= SHORT_WAIT_POLL_THRESHOLD_MS) {
      const start = performance.now();
      let res: WaitReturn = WaitReturn.TIMEOUT;
      while (performance.now() - start < timeoutMs) {
        const code = Kernel32Impl.WaitForSingleObject(
          this.rawHandle,
          0,
        ) as WaitReturn;
        if (code === WaitReturn.OBJECT_0 || code === WaitReturn.FAILED) {
          res = code;
          break;
        }
        await (typeof Bun !== 'undefined'
          ? Bun.sleep(1)
          : new Promise((r) => setTimeout(r, 1)));
      }
      return res;
    }

    const outcome = await waitAsync(
      this.rawHandle,
      timeoutMs === INFINITE ? -1 : timeoutMs,
    );
    if (outcome === 'signaled') return WaitReturn.OBJECT_0;
    if (outcome === 'error') return WaitReturn.FAILED;
    return WaitReturn.TIMEOUT;
  }

  override toString(): string {
    if (!this.isValid()) return 'Handle(Closed)';
    return `Handle(${super.toString()})`;
  }
}
