import { log } from './logger.js';
import { NativePointer, resolveAddress } from 'bun-xffi';
import {
  Kernel32Impl,
  ThreadAccess,
  ContextFlags,
  ThreadCreationFlags,
  type SecurityAttributes,
} from 'bun-xffi';
type HANDLE = bigint;
type SIZE_T = bigint;
type LPVOID = bigint;
import { Handle } from './handle.js';
import {
  ThreadClosedError,
  ThreadOpenError,
  CreateLocalThreadError,
  SuspendThreadError,
  ResumeThreadError,
  GetContextError,
  SetContextError,
  GetExitCodeError,
  TerminateThreadError,
} from './errors.js';
import { ToolhelpSnapshot, ThreadEntry } from './snapshot.js';
import { ToolhelpSnapshotFlag } from 'bun-xffi';
import { ptr } from 'bun:ffi';

function getThreadLog() {
  return log.add('Thread');
}

const threadLog = {
  info: (m: string, d?: unknown) => getThreadLog().info(m, d),
  warn: (m: string, d?: unknown) => getThreadLog().warn(m, d),
  debug: (m: string, d?: unknown) => getThreadLog().debug(m, d),
  error: (m: string, d?: unknown) => getThreadLog().error(m, d),
  fatal: (m: string, d?: unknown) => getThreadLog().fatal(m, d),
  trace: (m: string, d?: unknown) => getThreadLog().trace(m, d),
};

/**
 * High-performance binding for THREAD_CONTEXT structure.
 * Wraps a single persistent ArrayBuffer and provides direct access to registers.
 */
export class ThreadContext {
  private readonly buffer = new ArrayBuffer(1232);
  private readonly view = new DataView(this.buffer);
  private readonly thread: Thread;

  constructor(thread: Thread) {
    this.thread = thread;
  }

  /**
   * Pointer to the internal buffer for use with FFI calls.
   */
  get pointer(): LPVOID {
    return BigInt(ptr(this.buffer)) as LPVOID;
  }

  /**
   * Fetches the current context from the native thread into the internal buffer.
   */
  fetch(flags: number = ContextFlags.FULL): void {
    if (!this.thread.isValid()) throw new ThreadClosedError();
    this.view.setUint32(0x30, flags, true);
    const success = Kernel32Impl.GetThreadContext(
      this.thread.rawHandle,
      this.pointer,
    );
    if (!success) throw new GetContextError();
  }

  /**
   * Applies the values in the internal buffer back to the native thread.
   */
  apply(): void {
    if (!this.thread.isValid()) throw new ThreadClosedError();
    const success = Kernel32Impl.SetThreadContext(
      this.thread.rawHandle,
      this.pointer,
    );
    if (!success) throw new SetContextError();
  }

  copyFrom(other: ThreadContext): void {
    new Uint8Array(this.buffer).set(new Uint8Array(other.buffer));
  }

  clone(): ThreadContext {
    const clone = new ThreadContext(this.thread);
    clone.copyFrom(this);
    return clone;
  }

  toBase64(): string {
    return Buffer.from(this.buffer).toString('base64');
  }

  fromBase64(base64: string): void {
    const bytes = Buffer.from(base64, 'base64');
    new Uint8Array(this.buffer).set(bytes);
  }

  // ── Register Accessors ──────────────────────────────────────────────────

  get ContextFlags(): number {
    return this.view.getUint32(0x30, true);
  }
  set ContextFlags(v: number) {
    this.view.setUint32(0x30, v, true);
  }

  get MxCsr(): number {
    return this.view.getUint32(0x34, true);
  }
  set MxCsr(v: number) {
    this.view.setUint32(0x34, v, true);
  }

  get EFlags(): number {
    return this.view.getUint32(0x44, true);
  }
  set EFlags(v: number) {
    this.view.setUint32(0x44, v, true);
  }

  get Rax(): bigint {
    return this.view.getBigUint64(0x78, true);
  }
  set Rax(v: bigint | number) {
    this.view.setBigUint64(0x78, BigInt(v), true);
  }

  get Rcx(): bigint {
    return this.view.getBigUint64(0x80, true);
  }
  set Rcx(v: bigint | number) {
    this.view.setBigUint64(0x80, BigInt(v), true);
  }

  get Rdx(): bigint {
    return this.view.getBigUint64(0x88, true);
  }
  set Rdx(v: bigint | number) {
    this.view.setBigUint64(0x88, BigInt(v), true);
  }

  get Rbx(): bigint {
    return this.view.getBigUint64(0x90, true);
  }
  set Rbx(v: bigint | number) {
    this.view.setBigUint64(0x90, BigInt(v), true);
  }

  get Rsp(): bigint {
    return this.view.getBigUint64(0x98, true);
  }
  set Rsp(v: bigint | number) {
    this.view.setBigUint64(0x98, BigInt(v), true);
  }

  get Rbp(): bigint {
    return this.view.getBigUint64(0xa0, true);
  }
  set Rbp(v: bigint | number) {
    this.view.setBigUint64(0xa0, BigInt(v), true);
  }

  get Rsi(): bigint {
    return this.view.getBigUint64(0xa8, true);
  }
  set Rsi(v: bigint | number) {
    this.view.setBigUint64(0xa8, BigInt(v), true);
  }

  get Rdi(): bigint {
    return this.view.getBigUint64(0xb0, true);
  }
  set Rdi(v: bigint | number) {
    this.view.setBigUint64(0xb0, BigInt(v), true);
  }

  get R8(): bigint {
    return this.view.getBigUint64(0xb8, true);
  }
  set R8(v: bigint | number) {
    this.view.setBigUint64(0xb8, BigInt(v), true);
  }

  get R9(): bigint {
    return this.view.getBigUint64(0xc0, true);
  }
  set R9(v: bigint | number) {
    this.view.setBigUint64(0xc0, BigInt(v), true);
  }

  get R10(): bigint {
    return this.view.getBigUint64(0xc8, true);
  }
  set R10(v: bigint | number) {
    this.view.setBigUint64(0xc8, BigInt(v), true);
  }

  get R11(): bigint {
    return this.view.getBigUint64(0xd0, true);
  }
  set R11(v: bigint | number) {
    this.view.setBigUint64(0xd0, BigInt(v), true);
  }

  get R12(): bigint {
    return this.view.getBigUint64(0xd8, true);
  }
  set R12(v: bigint | number) {
    this.view.setBigUint64(0xd8, BigInt(v), true);
  }

  get R13(): bigint {
    return this.view.getBigUint64(0xe0, true);
  }
  set R13(v: bigint | number) {
    this.view.setBigUint64(0xe0, BigInt(v), true);
  }

  get R14(): bigint {
    return this.view.getBigUint64(0xe8, true);
  }
  set R14(v: bigint | number) {
    this.view.setBigUint64(0xe8, BigInt(v), true);
  }

  get R15(): bigint {
    return this.view.getBigUint64(0xf0, true);
  }
  set R15(v: bigint | number) {
    this.view.setBigUint64(0xf0, BigInt(v), true);
  }

  get Rip(): bigint {
    return this.view.getBigUint64(0xf8, true);
  }
  set Rip(v: bigint | number) {
    this.view.setBigUint64(0xf8, BigInt(v), true);
  }

  // ── XMM Registers (FLOATING_POINT context) ─────────────────────────────
  // Windows x64 CONTEXT: XmmRegisters start at 0x1a0, each register is 16 bytes.
  // Float args/return use low 32 bits, double args/return use low 64 bits.

  getXmmFloat(n: 0 | 1 | 2 | 3): number {
    return this.view.getFloat32(0x1a0 + n * 16, true);
  }
  setXmmFloat(n: 0 | 1 | 2 | 3, v: number): void {
    this.view.setFloat32(0x1a0 + n * 16, v, true);
  }

  getXmmDouble(n: 0 | 1 | 2 | 3): number {
    return this.view.getFloat64(0x1a0 + n * 16, true);
  }
  setXmmDouble(n: 0 | 1 | 2 | 3, v: number): void {
    this.view.setFloat64(0x1a0 + n * 16, v, true);
  }

  // ── Functional Aliases ──────────────────────────────────────────────────
  getRip(): bigint {
    return this.Rip;
  }
  setRip(v: bigint | number): void {
    this.Rip = v;
  }
  getRsp(): bigint {
    return this.Rsp;
  }
  setRsp(v: bigint | number): void {
    this.Rsp = v;
  }
}

/**
 * Represents a thread handle
 */
export class Thread extends Handle {
  public readonly tid: number;
  public readonly context: ThreadContext;

  constructor(handle: HANDLE, tid?: number, checkValid: boolean = true) {
    super(handle, checkValid);
    this.tid = tid ?? Kernel32Impl.GetThreadId(handle);
    this.context = new ThreadContext(this);
  }

  /**
   * Opens an existing thread object.
   * @param tid Thread ID
   * @param access Access rights (default: ALL_ACCESS)
   */
  static open(tid: number, access: number = ThreadAccess.ALL_ACCESS): Thread {
    threadLog.debug(`Opening thread ${tid} with access ${access}`);
    const handle = Kernel32Impl.OpenThread(access, 0, tid);
    if (!handle) {
      threadLog.warn(`Failed to open thread ${tid}`);
      throw new ThreadOpenError(tid);
    }
    return new Thread(handle, tid);
  }

  static create(
    startAddress: NativePointer,
    parameter: NativePointer | null = null,
    stackSize: SIZE_T = 0n as SIZE_T,
    flags: ThreadCreationFlags | number = ThreadCreationFlags.IMMEDIATE,
    attributes: SecurityAttributes | null = null,
  ): Thread {
    threadLog.debug(
      `Creating thread at ${startAddress.toString()} with param ${(parameter || 0).toString()}`,
    );
    const tidBuf = Buffer.alloc(4);
    const handle = Kernel32Impl.CreateThread(
      attributes,
      stackSize,
      resolveAddress(startAddress),
      parameter ? resolveAddress(parameter) : null,
      flags,
      tidBuf,
    );
    if (!handle) {
      throw new CreateLocalThreadError(startAddress);
    }
    return new Thread(handle, tidBuf.readUInt32LE(0));
  }
  static current(): CurrentThread {
    return currentThread;
  }
  static currentId(): number {
    return Kernel32Impl.GetCurrentThreadId();
  }
  /**
   * Enumerates all threads, optionally filtered by process ID.
   * @param pid Process ID to filter by (0 = all threads)
   */
  static getThreads(pid: number = 0): ThreadEntry[] {
    const snapshot = new ToolhelpSnapshot(ToolhelpSnapshotFlag.SNAPTHREAD, pid);
    const entries = [...snapshot.getThreads()];
    snapshot.close();
    return entries;
  }

  /**
   * Suspends all threads in the given array, except the current one.
   * @param threads Array of Thread instances
   * @returns Total number of threads successfully suspended
   */
  static suspendAll(threads: Thread[]): number {
    let count = 0;
    for (const t of threads) {
      try {
        t.suspend();
        count++;
      } catch {
        /* skip dead threads */
      }
    }
    return count;
  }

  /**
   * Resumes all threads in the given array.
   * @param threads Array of Thread instances to resume
   * @returns Total number of threads successfully resumed
   */
  static resumeAll(threads: Thread[]): number {
    let count = 0;
    for (const t of threads) {
      try {
        t.resume();
        count++;
      } catch {
        /* skip */
      }
    }
    return count;
  }
  override toString(): string {
    if (!this.isValid()) return `Thread(${this.tid})[Closed]`;
    return `Thread(${this.tid})[${super.toString()}]`;
  }
  suspend(): number {
    if (!this.isValid()) throw new ThreadClosedError();
    if (this.tid === Thread.currentId()) {
      threadLog.warn(
        'Attempted to suspend current thread - operation cancelled to prevent deadlock.',
      );
      return 0;
    }
    threadLog.debug(`Suspending ${this}`);
    const count = Kernel32Impl.SuspendThread(this.rawHandle);
    if (count === 0xffffffff) {
      throw new SuspendThreadError();
    }
    return count;
  }
  resume(): number {
    if (!this.isValid()) throw new ThreadClosedError();
    threadLog.debug(`Resuming ${this}`);
    const count = Kernel32Impl.ResumeThread(this.rawHandle);
    if (count === 0xffffffff) {
      throw new ResumeThreadError();
    }
    return count;
  }

  /**
   * Gets the thread exit code
   * @returns Exit code (STILL_ACTIVE means it's still running)
   */
  getExitCode(): number {
    if (!this.isValid()) throw new ThreadClosedError();
    const buf = Buffer.alloc(4);
    const success = Kernel32Impl.GetExitCodeThread(this.rawHandle, buf);
    if (!success) {
      throw new GetExitCodeError();
    }
    return buf.readUInt32LE(0);
  }
  /**
   * Terminates the thread.
   * @param exitCode Exit code for the thread
   */
  terminate(exitCode: number = 0): void {
    if (!this.isValid()) throw new ThreadClosedError();
    threadLog.debug(`Terminating ${this} with exit code ${exitCode}`);
    const success = Kernel32Impl.TerminateThread(this.rawHandle, exitCode);
    if (!success) {
      throw new TerminateThreadError();
    }
  }
}
/**
 * Thread states
 */
export const ThreadState = {
  STILL_ACTIVE: 259,
};
/**
 * Represents the current thread (singleton)
 */
export class CurrentThread extends Thread {
  constructor() {
    // Current thread uses a pseudo-handle that doesn't need closing
    super(
      Kernel32Impl.GetCurrentThread(),
      Kernel32Impl.GetCurrentThreadId(),
      false,
    );
  }
  override close() {
    // Current thread uses a pseudo-handle that doesn't need closing
  }
  override isValid(): boolean {
    return true;
  }
}
let _currentThread: CurrentThread | undefined;
export function getCurrentThread(): CurrentThread {
  if (!_currentThread) {
    _currentThread = new CurrentThread();
  }
  return _currentThread;
}
export const currentThread: CurrentThread = new Proxy({} as CurrentThread, {
  get(_target, prop, receiver) {
    return Reflect.get(getCurrentThread(), prop, receiver);
  },
  set(_target, prop, value, receiver) {
    return Reflect.set(getCurrentThread(), prop, value, receiver);
  },
});

/**
 * Mapping of lowercase register names to ThreadContext property names.
 */
export const REG_NAME_MAP: Record<string, any> = {
  rax: 'Rax',
  rbx: 'Rbx',
  rcx: 'Rcx',
  rdx: 'Rdx',
  rsi: 'Rsi',
  rdi: 'Rdi',
  rbp: 'Rbp',
  rsp: 'Rsp',
  r8: 'R8',
  r9: 'R9',
  r10: 'R10',
  r11: 'R11',
  r12: 'R12',
  r13: 'R13',
  r14: 'R14',
  r15: 'R15',
  rip: 'Rip',
};
