import {
  InittableMiddlewareAccessor,
  RemoteCallableMemoryAccessor,
  type ISyncCallableMemoryAccessor,
  type CCallResult,
  type CFunction,
  parseCallResult,
  normalizeType,
  ContextFlags,
  INFINITE,
  MemoryProtection,
  WaitReturn,
  resolveAddress,
  stackAlign16,
  type IHostAccessor,
  makeStub,
} from 'bun-xffi';
import {
  getRandomSpinStub,
  getRandomPushretStub,
  getRandomJumpStub,
  getRandomRetStub,
  getRandomAddRsp28RetStub,
  whenStubsReady,
  type ThreadStubs,
} from './stubs.js';
import * as Native from 'bun-winapi';
import {
  NoSleepAddressError,
  NoPushretAddressError,
  NoJumpAddressError,
  NoRetAddressError,
  NoAddRsp28RetAddressError,
  CallTimeoutError,
  CallThreadDiedError,
  WaitAbortedError,
} from './errors.js';
import { log } from './logger.js';

const nthreadLog = log.add('NThread');

export interface NThreadState {
  threadId: number;
  callRsp: string;
  savedContext: string;
  stubs: {
    spinStub: string;
    pushRetStub: string;
    pushRetRegKey: string;
    jumpStub: string;
    jumpRegKey: string;
    retStub: string;
    addRsp28RetStub: string;
  };
}

/**
 * Stack slack below the captured RSP reserved for the call-dispatch return chain.
 *
 * This must stay well clear of ordinary stack usage: after `releaseThread()` restores
 * the original RIP/RSP and resumes, ordinary execution (nested calls, function-local
 * frames) can push RSP down past this offset *before* any of its own `call`s overwrite
 * that memory with real return addresses. If a `ret` later executes with RSP still at
 * or below `callRsp`, it pops one of our stale dispatch-chain pointers (addRsp28RetStub/
 * spinStub) instead of a real return address and crashes. 256 bytes proved too small —
 * plausible internal call chains (loader lock, string conversion buffers, etc.) blow
 * past it — so this reserves a full page instead.
 */
const STACK_ADD = -4096n;

/**
 * Context register groups we fetch/apply for redirection. INTEGER (GP regs) +
 * CONTROL (Rip/Rsp/EFlags/segments) + FLOATING_POINT (XMM). Fetching and
 * restoring with this set keeps the saved snapshot faithful enough that
 * releasing the thread lands it back exactly where it was.
 */
const CTX_FLAGS =
  ContextFlags.INTEGER | ContextFlags.CONTROL | ContextFlags.FLOATING_POINT;

export interface NThreadOptions {
  /** Maximum ms to wait for the operation to complete. Default: 5000. */
  timeoutMs?: number;
  /** Poll interval (ms) used during redirection wait. Default: 2. */
  pollIntervalMs?: number;
  /** Optional cancellation signal. */
  signal?: AbortSignal;
  /**
   * Set to true if the thread is already parked at a spin/breakpoint stub (e.g. EB FE by nhook).
   * Skips initial jumpStub redirection and preserves original context.
   */
  isParked?: boolean;
}

export type InjectOptions = NThreadOptions;
export type ThreadCallOptions = NThreadOptions;

/**
 * Thread redirection without `CreateRemoteThread` or machineCode allocation.
 *
 * A single `NThread` always manages exactly one redirected OS thread (there is
 * no separate "manager" tracking many captured threads at once), so the
 * redirected-thread state and its suspend/resume/context primitives live
 * directly on `NThread` itself as instance fields/methods, operating on a
 * plain `Native.Thread` held in `nativeThread` -- there used to be a separate
 * `CapturedThread extends Native.Thread` wrapper class for this, but since
 * it's always 1:1 with an `NThread`, folding it in here removes a layer with
 * no remaining benefit.
 */
export class NThread extends InittableMiddlewareAccessor {
  // ── Captured-thread state (folded in from the former CapturedThread) ──────
  private nativeThread?: Native.Thread;
  private suspendCount = 0;
  /** Full-fidelity snapshot of the pre-redirection context, restored on release. */
  public savedContext!: Native.ThreadContext;
  private _ctxFetched = false;
  public callRsp: bigint = 0n;
  public expectedRsp: bigint = 0n;
  public pollIntervalMs: number = 2;

  public stubs: Partial<ThreadStubs> = {};
  public debug = false;
  private _stackArgStubs = new Map<number, bigint>();

  constructor(
    backend: ISyncCallableMemoryAccessor | number,
    public readonly threadId: number,
    public readonly options: NThreadOptions = {},
    root: IHostAccessor,
  ) {
    const actualBackend =
      typeof backend === 'number'
        ? new RemoteCallableMemoryAccessor(backend)
        : backend;
    super(actualBackend, root);
  }

  // No-op -- see IHostAccessor.registerChild's doc comment. NThread is only
  // ever used as an IHostAccessor (e.g. a RedirectorHostAccessor's `target`),
  // never as a racing host itself, so it has nothing to do with a child.
  registerChild(): void {}

  /** The OS thread ID of the redirected thread. Only valid once initialized. */
  get tid(): number {
    return this.nativeThread!.tid;
  }

  /** The live CONTEXT buffer of the redirected thread (read/write in place). */
  private get ctx(): Native.ThreadContext {
    return this.nativeThread!.context;
  }

  isCallRspSet(): boolean {
    return this.callRsp !== 0n;
  }

  isExpectedRspSet(): boolean {
    return this.expectedRsp !== 0n;
  }

  calcStackBegin(baseRsp: bigint = this.getContext().Rsp): bigint {
    return stackAlign16(baseRsp + STACK_ADD);
  }

  getPushRetStubReg(): bigint {
    return (this.getContext() as any)[
      (this.stubs as ThreadStubs).pushRetRegKey
    ];
  }

  setPushRetStubReg(reg: bigint): void {
    (this.ctx as any)[(this.stubs as ThreadStubs).pushRetRegKey] = reg;
  }

  getJumpStubReg(): bigint {
    return (this.getContext() as any)[(this.stubs as ThreadStubs).jumpRegKey];
  }

  setJumpStubReg(reg: bigint): void {
    (this.ctx as any)[(this.stubs as ThreadStubs).jumpRegKey] = reg;
  }

  getRSP(): bigint {
    return this.getContext().Rsp;
  }

  setRSP(rsp: bigint): void {
    this.ctx.Rsp = rsp;
  }

  getRIP(): bigint {
    return this.getContext().Rip;
  }

  setRIP(rip: bigint): void {
    this.ctx.Rip = rip;
  }

  getXmmFloat(n: 0 | 1 | 2 | 3): number {
    return this.ctx.getXmmFloat(n);
  }
  setXmmFloat(n: 0 | 1 | 2 | 3, v: number): void {
    this.ctx.setXmmFloat(n, v);
  }
  getXmmDouble(n: 0 | 1 | 2 | 3): number {
    return this.ctx.getXmmDouble(n);
  }
  setXmmDouble(n: 0 | 1 | 2 | 3, v: number): void {
    this.ctx.setXmmDouble(n, v);
  }

  /**
   * Returns the live context buffer, fetching it once if it hasn't been read
   * yet. Callers read/write register properties on it directly and then call
   * {@link applyContext} to push changes to the thread.
   */
  getContext(): Native.ThreadContext {
    if (!this._ctxFetched) {
      this.fetchContext();
    }
    return this.ctx;
  }

  /**
   * Copies a foreign context snapshot into the live buffer. A no-op when passed
   * the live context itself (callers usually mutate it in place).
   */
  setContext(ctx: Native.ThreadContext): void {
    if (ctx !== this.ctx) {
      this.ctx.copyFrom(ctx);
    }
  }

  // Deliberately never suspends around fetch/apply -- NThread suspends
  // exactly once, during onInit()'s landing sequence, and resumes once
  // (via that same landing call's own resumeThread()); every op after that
  // runs against the thread while it's parked (running) at the spin stub,
  // relying on EB FE ('jmp $') never touching registers/memory between
  // instructions for this to be safe. A caller-configurable "auto-suspend
  // around every fetch/apply" option used to exist here but only ever added
  // extra suspend/resume cycles beyond that single setup one -- exactly the
  // kind of accounting an external suspend (e.g. NHook.enable()'s own
  // SuspendThread on the same thread) can't see or coordinate with.
  fetchContext(): void {
    this.ctx.fetch(CTX_FLAGS);
    this._ctxFetched = true;
  }

  applyContext(): void {
    this.ctx.apply();
  }

  private suspendThread(): number {
    const result = this.nativeThread!.suspend();
    this.suspendCount++;
    return result;
  }

  private onceSuspendThread(): void {
    if (this.suspendCount === 0) {
      this.suspendThread();
    }
  }

  private resumeThread(): number {
    const result = this.nativeThread!.resume();
    if (result === 0) {
      this.suspendCount = 0;
    } else {
      this.suspendCount--;
    }
    return result;
  }

  private resumeAllThread(remaining: number = 0): void {
    while (this.suspendCount > remaining) {
      this.resumeThread();
    }
  }

  private releaseThread(): void {
    this.onceSuspendThread();
    if (this.savedContext) {
      // Restore the full pre-redirection buffer (GP + control + XMM) so the thread
      // resumes exactly where it was, then let it run.
      this.ctx.copyFrom(this.savedContext);
      this.applyContext();
    }
    this.resumeAllThread();
    try {
      while (this.nativeThread && this.nativeThread.resume() > 0) {
        // drain extra suspensions
      }
    } catch {
      /* ignore */
    }
  }

  private closeThread(): void {
    try {
      this.releaseThread();
    } catch {
      // ignore
    }
    this.nativeThread?.close();
  }

  /** Waits for the redirected thread to land back at the sleep stub. */
  private async waitForLanding(
    timeoutMs: number = INFINITE as number,
    signal?: AbortSignal,
  ): Promise<WaitReturn> {
    const pollIntervalMs = Math.max(0, this.pollIntervalMs | 0);
    const deadline =
      timeoutMs === (INFINITE as number)
        ? Number.POSITIVE_INFINITY
        : Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (signal?.aborted) {
        throw new WaitAbortedError();
      }

      try {
        this.fetchContext();
        const rip = this.getContext().Rip;
        if (
          BigInt(rip) === BigInt((this.stubs as ThreadStubs).spinStub.address)
        ) {
          this.suspendThread();
          return WaitReturn.OBJECT_0;
        }
      } catch (_) {
        if (this.nativeThread) {
          const res = await this.nativeThread.wait(0);
          if (res === WaitReturn.OBJECT_0) {
            return WaitReturn.FAILED;
          }
          return res;
        }
        return WaitReturn.FAILED;
      }

      if (pollIntervalMs === 0) {
        await this.sleepAbortable(0, signal);
        continue;
      }

      const remainingMs = deadline - Date.now();
      const sleepMs = Math.min(pollIntervalMs, remainingMs);
      await this.sleepAbortable(sleepMs, signal);
    }

    return WaitReturn.TIMEOUT;
  }

  /**
   * Synchronous twin of {@link waitForLanding} for {@link callSync}: a tight
   * busy-spin over `fetchContext()`/RIP-check with *no* yield between
   * iterations (no `sleepAbortable`, unlike the async version's poll-interval
   * backoff) -- every check is back-to-back, bounded only by the wall-clock
   * `deadline`. This pins a CPU core for however long the call takes, so it
   * only makes sense for calls expected to land almost immediately (which is
   * exactly {@link callSync}'s intended use case); for anything slower, the
   * async `call()`/`waitForLanding()` path (which yields via `setTimeout`
   * between polls) is the right tool.
   */
  private waitForLandingSync(
    timeoutMs: number = INFINITE as number,
    signal?: AbortSignal,
  ): WaitReturn {
    const deadline =
      timeoutMs === (INFINITE as number)
        ? Number.POSITIVE_INFINITY
        : Date.now() + timeoutMs;

    let spins = 0;
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        throw new WaitAbortedError();
      }

      try {
        this.fetchContext();
        const rip = this.getContext().Rip;
        if (
          BigInt(rip) === BigInt((this.stubs as ThreadStubs).spinStub.address)
        ) {
          this.suspendThread();
          return WaitReturn.OBJECT_0;
        }
      } catch (_) {
        // Unlike waitForLanding's async fallback (a real wait(0) on the
        // thread handle to distinguish "exited" from "still alive but this
        // check failed"), there's no synchronous equivalent to reach for
        // here -- a fetchContext() failure this deep is almost always the
        // thread having died, so treat it as fatal rather than retrying.
        return WaitReturn.FAILED;
      }

      spins++;
      if (
        spins >= 4 &&
        typeof Bun !== 'undefined' &&
        typeof Bun.sleepSync === 'function'
      ) {
        Bun.sleepSync(1);
      }
    }

    return WaitReturn.TIMEOUT;
  }

  private async sleepAbortable(
    ms: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!signal) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return;
    }

    if (signal.aborted) {
      throw new WaitAbortedError();
    }

    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        reject(new WaitAbortedError());
      };

      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);

      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  // ── Accessor lifecycle ──────────────────────────────────────────────────

  protected override async onInit(): Promise<void> {
    // The stub descriptors (spin/pushRet/jump/ret/addRsp28Ret) start their
    // background scans eagerly at module load, but scanning takes real time
    // (walking kernel32/ntdll/kernelbase's executable sections). A caller
    // that reaches onInit() soon after process start -- before those scans
    // finish -- would otherwise get a misleading NoSleepAddressError/etc.
    // below (getRandomXStub() swallows the real "still scanning" error and
    // returns undefined, indistinguishable from "genuinely not found").
    await whenStubsReady();

    if (this.options.pollIntervalMs) {
      const pollIntervalMs = Math.max(0, this.options.pollIntervalMs);
      this.pollIntervalMs = pollIntervalMs;
    }

    if (!this.stubs.spinStub) {
      const sleep = getRandomSpinStub();
      if (!sleep) throw new NoSleepAddressError();
      this.stubs.spinStub = sleep;
    }
    if (!this.stubs.pushRetStub || !this.stubs.pushRetRegKey) {
      const randomPushret = getRandomPushretStub(this.stubs.pushRetRegKey);
      if (!randomPushret) throw new NoPushretAddressError();
      this.stubs.pushRetStub = randomPushret.stub;
      this.stubs.pushRetRegKey = randomPushret.regKey;
    }
    if (!this.stubs.jumpStub || !this.stubs.jumpRegKey) {
      const randomJump = getRandomJumpStub(this.stubs.jumpRegKey);
      if (!randomJump) throw new NoJumpAddressError();
      this.stubs.jumpStub = randomJump.stub;
      this.stubs.jumpRegKey = randomJump.regKey;
    }
    if (!this.stubs.retStub) {
      const ret = getRandomRetStub();
      if (!ret) throw new NoRetAddressError();
      this.stubs.retStub = ret;
    }
    if (!this.stubs.addRsp28RetStub) {
      const addRsp = getRandomAddRsp28RetStub();
      if (!addRsp) throw new NoAddRsp28RetAddressError();
      this.stubs.addRsp28RetStub = addRsp;
    }

    const stubs = this.stubs as ThreadStubs;
    this.nativeThread = Native.Thread.open(this.threadId);

    try {
      this.onceSuspendThread();

      // Capture initial state while thread is suspended
      this.fetchContext();
      this.savedContext = this.ctx.clone();

      if (this.options.isParked) {
        nthreadLog.debug(
          `Thread ${this.tid} is already parked at 0x${this.savedContext.Rip.toString(16)}. Skipping jumpStub redirection.`,
        );

        if (!this.isCallRspSet()) {
          const stackBegin = this.calcStackBegin();
          const callRsp = stackBegin - 136n;

          // Stage A: Write spinStub address at [callRsp + 48]
          const sleepBuf = Buffer.allocUnsafe(8);
          sleepBuf.writeBigUInt64LE(BigInt(stubs.spinStub.address));
          await this.backend.write(callRsp + 48n, sleepBuf);

          // Stage B: Write addRsp28RetStub address at [callRsp]
          const addRspBuf = Buffer.allocUnsafe(8);
          addRspBuf.writeBigUInt64LE(BigInt(stubs.addRsp28RetStub.address));
          await this.backend.write(callRsp, addRspBuf);

          this.callRsp = callRsp;
        }
        return;
      }

      // Pre-set the jump register to point at spinStub
      this.setJumpStubReg(BigInt(stubs.spinStub.address));

      nthreadLog.debug(
        `Parking thread ${this.tid} at spinStub 0x${stubs.spinStub.address.toString(16)}...`,
      );

      // call sets RIP = jumpStub, applies context, waits for spinStub
      await this.root.call(stubs.jumpStub as any);

      // Thread is parked. Fetch context into ctx so subsequent setup operates on parked thread.
      // savedContext remains the pristine initial context captured before redirection.
      this.fetchContext();

      if (!this.isCallRspSet()) {
        const baseRsp = BigInt(this.getContext().Rsp);
        const stackBegin = this.calcStackBegin();
        const callRsp = stackBegin - 136n;
        nthreadLog.trace(
          `[NThread.onInit] baseRsp: 0x${baseRsp.toString(16)}, stackBegin: 0x${stackBegin.toString(16)}, callRsp: 0x${callRsp.toString(16)}`,
        );

        // Stage A: Write spinStub address at [callRsp + 48]
        this.setPushRetStubReg(BigInt(stubs.spinStub.address));
        this.setRSP(callRsp + 56n);
        await this.root.call(stubs.pushRetStub as any);

        nthreadLog.trace(
          `Stage A complete. callRsp: 0x${callRsp.toString(16)}`,
        );

        // Stage B: Write addRsp28RetStub address at [callRsp]
        this.setPushRetStubReg(BigInt(stubs.addRsp28RetStub.address));
        this.setRSP(callRsp + 8n);
        await this.root.call(stubs.pushRetStub as any);

        nthreadLog.trace(
          `Stage B complete. callRsp: 0x${callRsp.toString(16)}`,
        );

        this.callRsp = callRsp;
      }
    } catch (err) {
      this.closeThread();
      this.nativeThread = undefined;
      throw err;
    }
  }

  /**
   * Synchronous twin of {@link onInit}: identical thread-parking sequence --
   * everything here besides the three bootstrap stub calls was already
   * synchronous (register/context manipulation, stub lookup), so only those
   * three `await this.root.call(...)` calls become `this.root.callSync(...)`.
   */
  protected override onInitSync(): void {
    if (this.options.pollIntervalMs) {
      const pollIntervalMs = Math.max(0, this.options.pollIntervalMs);
      this.pollIntervalMs = pollIntervalMs;
    }

    if (!this.stubs.spinStub) {
      const sleep = getRandomSpinStub();
      if (!sleep) throw new NoSleepAddressError();
      this.stubs.spinStub = sleep;
    }
    if (!this.stubs.pushRetStub || !this.stubs.pushRetRegKey) {
      const randomPushret = getRandomPushretStub(this.stubs.pushRetRegKey);
      if (!randomPushret) throw new NoPushretAddressError();
      this.stubs.pushRetStub = randomPushret.stub;
      this.stubs.pushRetRegKey = randomPushret.regKey;
    }
    if (!this.stubs.jumpStub || !this.stubs.jumpRegKey) {
      const randomJump = getRandomJumpStub(this.stubs.jumpRegKey);
      if (!randomJump) throw new NoJumpAddressError();
      this.stubs.jumpStub = randomJump.stub;
      this.stubs.jumpRegKey = randomJump.regKey;
    }
    if (!this.stubs.retStub) {
      const ret = getRandomRetStub();
      if (!ret) throw new NoRetAddressError();
      this.stubs.retStub = ret;
    }
    if (!this.stubs.addRsp28RetStub) {
      const addRsp = getRandomAddRsp28RetStub();
      if (!addRsp) throw new NoAddRsp28RetAddressError();
      this.stubs.addRsp28RetStub = addRsp;
    }

    const stubs = this.stubs as ThreadStubs;
    this.nativeThread = Native.Thread.open(this.threadId);

    try {
      this.onceSuspendThread();

      this.fetchContext();
      this.savedContext = this.ctx.clone();

      if (this.options.isParked) {
        if (!this.isCallRspSet()) {
          const stackBegin = this.calcStackBegin();
          const callRsp = stackBegin - 136n;

          const sleepBuf = Buffer.allocUnsafe(8);
          sleepBuf.writeBigUInt64LE(BigInt(stubs.spinStub.address));
          this.backend.writeSync(callRsp + 48n, sleepBuf);

          const addRspBuf = Buffer.allocUnsafe(8);
          addRspBuf.writeBigUInt64LE(BigInt(stubs.addRsp28RetStub.address));
          this.backend.writeSync(callRsp, addRspBuf);

          this.callRsp = callRsp;
        }
        return;
      }

      this.setJumpStubReg(BigInt(stubs.spinStub.address));

      nthreadLog.debug(
        `Parking thread ${this.tid} at spinStub 0x${stubs.spinStub.address.toString(16)}...`,
      );

      this.root.callSync(stubs.jumpStub as any);

      this.fetchContext();

      if (!this.isCallRspSet()) {
        const baseRsp = BigInt(this.getContext().Rsp);
        const stackBegin = this.calcStackBegin();
        const callRsp = stackBegin - 136n;
        nthreadLog.trace(
          `[NThread.onInitSync] baseRsp: 0x${baseRsp.toString(16)}, stackBegin: 0x${stackBegin.toString(16)}, callRsp: 0x${callRsp.toString(16)}`,
        );

        this.setPushRetStubReg(BigInt(stubs.spinStub.address));
        this.setRSP(callRsp + 56n);
        this.root.callSync(stubs.pushRetStub as any);

        nthreadLog.trace(
          `Stage A complete. callRsp: 0x${callRsp.toString(16)}`,
        );

        this.setPushRetStubReg(BigInt(stubs.addRsp28RetStub.address));
        this.setRSP(callRsp + 8n);
        this.root.callSync(stubs.pushRetStub as any);

        nthreadLog.trace(
          `Stage B complete. callRsp: 0x${callRsp.toString(16)}`,
        );

        this.callRsp = callRsp;
      }
    } catch (err) {
      this.closeThread();
      this.nativeThread = undefined;
      throw err;
    }
  }

  protected override async onDeinit(): Promise<void> {
    for (const [, addr] of this._stackArgStubs) {
      try {
        await this.free(addr);
      } catch {
        /* ignore */
      }
    }
    this._stackArgStubs.clear();
    if (this.nativeThread) {
      this.closeThread();
      this.nativeThread = undefined;
    }
  }

  /**
   * Captures the full state descriptor (registers, callRsp, stubs) without hibernating or closing the thread.
   */
  public saveState(): NThreadState {
    if (!this.nativeThread) {
      throw new Error('NThread is not initialized or already closed');
    }

    return {
      threadId: this.threadId,
      callRsp: `0x${this.callRsp.toString(16)}`,
      savedContext: this.savedContext.toBase64(),
      stubs: {
        spinStub: `0x${this.stubs.spinStub!.address.toString(16)}`,
        pushRetStub: `0x${this.stubs.pushRetStub!.address.toString(16)}`,
        pushRetRegKey: this.stubs.pushRetRegKey as string,
        jumpStub: `0x${this.stubs.jumpStub!.address.toString(16)}`,
        jumpRegKey: this.stubs.jumpRegKey as string,
        retStub: `0x${this.stubs.retStub!.address.toString(16)}`,
        addRsp28RetStub: `0x${this.stubs.addRsp28RetStub!.address.toString(16)}`,
      },
    };
  }

  /**
   * Puts this NThread into hibernation:
   * - Captures full state (registers, callRsp, stubs).
   * - Closes the local thread handle without releasing the thread back to user mode.
   * - Leaves the remote thread parked at spinStub (EB FE / jmp $).
   * - Marks this instance as uninitialized/closed.
   */
  public hibernate(): NThreadState {
    const state = this.saveState();

    // Close host handle without releasing thread back to user code
    this.nativeThread!.close();
    this.nativeThread = undefined;
    this.markUninitialized();

    return state;
  }

  /**
   * Resumes this NThread from a hibernated state descriptor without re-hijacking.
   * The remote thread is already waiting at spinStub.
   */
  public resumeFromHibernation(state: NThreadState): void {
    this.nativeThread = Native.Thread.open(state.threadId);
    if (!this.nativeThread.isValid()) {
      throw new Error(`Failed to open hibernated thread ${state.threadId}`);
    }

    this.suspendCount = 1;

    this.stubs = {
      spinStub: makeStub(BigInt(state.stubs.spinStub), [0xeb, 0xfe]),
      pushRetStub: makeStub(BigInt(state.stubs.pushRetStub)),
      pushRetRegKey: state.stubs.pushRetRegKey as any,
      jumpStub: makeStub(BigInt(state.stubs.jumpStub)),
      jumpRegKey: state.stubs.jumpRegKey as any,
      retStub: makeStub(BigInt(state.stubs.retStub), [0xc3]),
      addRsp28RetStub: makeStub(
        BigInt(state.stubs.addRsp28RetStub),
        [0x48, 0x83, 0xc4, 0x28, 0xc3],
      ),
    };

    this.savedContext = new Native.ThreadContext(this.nativeThread);
    this.savedContext.fromBase64(state.savedContext);
    this.callRsp = BigInt(state.callRsp);
    this.expectedRsp = 0n;
    this._ctxFetched = false;

    // Mark as initialized so init() doesn't re-run the hijack handshake
    this.markInitialized();
  }

  /**
   * Factory function that constructs an NThread directly from a hibernated state.
   */
  static restoreFromState(
    backendOrPid: ISyncCallableMemoryAccessor | number,
    state: NThreadState,
    options: NThreadOptions = {},
    root?: IHostAccessor,
  ): NThread {
    const nt = new NThread(backendOrPid, state.threadId, options, root!);
    nt.resumeFromHibernation(state);
    return nt;
  }

  protected override onDeinitSync(): void {
    for (const [, addr] of this._stackArgStubs) {
      try {
        this.freeSync(addr);
      } catch {
        /* ignore */
      }
    }
    this._stackArgStubs.clear();
    if (this.nativeThread) {
      this.closeThread();
      this.nativeThread = undefined;
    }
  }

  protected override async callAfterInit(
    func: CFunction,
    args: any[],
  ): Promise<CCallResult> {
    if (!this.nativeThread) {
      throw new Error('NThread is not initialized.');
    }

    if (
      typeof (func as any).shouldCloneForAccessor === 'function' &&
      (func as any).shouldCloneForAccessor(this)
    ) {
      const addr = await this.root.machineCode(func as any);
      func = (func as any).cloneForAddress(addr);
    }

    const timeoutMs = this.options.timeoutMs ?? 15000;
    const normalizedArgTypes = (func.args ?? []).map((t) => normalizeType(t));
    const returnsType = normalizeType(func.returns);
    const targetAddr = BigInt(func.ptr);
    const N_stack = Math.max(0, args.length - 4);
    const stubs = this.stubs as ThreadStubs;

    // For calls with stack args (> 4), adjust the return chain and write
    // stack args into the remote thread's stack before resuming.
    if (N_stack > 0) {
      const callRsp = this.callRsp;

      // Get or allocate a per-N_stack stub: add rsp,(0x28+N_stack*8); ret
      let stubAddr = this._stackArgStubs.get(N_stack);
      if (!stubAddr) {
        const N = 0x28 + N_stack * 8;
        const stubBytes: number[] =
          N <= 0x7f
            ? [0x48, 0x83, 0xc4, N, 0xc3]
            : [
                0x48,
                0x81,
                0xc4,
                N & 0xff,
                (N >> 8) & 0xff,
                (N >> 16) & 0xff,
                (N >> 24) & 0xff,
                0xc3,
              ];
        while (stubBytes.length < 16) stubBytes.push(0x90);
        const allocAddr = await this.alloc(
          16,
          null,
          MemoryProtection.EXECUTE_READWRITE,
        );
        await this.write(allocAddr, Buffer.from(stubBytes));
        stubAddr = BigInt(resolveAddress(allocAddr));
        this._stackArgStubs.set(N_stack, stubAddr);
      }

      // Overwrite [callRsp] with stub address (replaces addRsp28RetStub)
      const retBuf = Buffer.allocUnsafe(8);
      retBuf.writeBigUInt64LE(stubAddr);
      await this.write(callRsp, retBuf);

      // Write each stack arg at [callRsp + 40 + i*8]
      for (let i = 4; i < args.length; i++) {
        const n = i - 4;
        const slotBuf = Buffer.alloc(8, 0);
        const argType = normalizedArgTypes[i] ?? 'ptr';
        const v = args[i];
        if (argType === 'f32') {
          slotBuf.writeFloatLE(Number(v), 0);
        } else if (argType === 'f64') {
          slotBuf.writeDoubleLE(Number(v), 0);
        } else {
          slotBuf.writeBigUInt64LE(BigInt(resolveAddress(v)));
        }
        await this.write(callRsp + 40n + BigInt(n * 8), slotBuf);
      }

      // Write spinStub at [callRsp + 48 + N_stack*8]
      // (where stub's ret lands: callRsp+8 + 0x28+N_stack*8 = callRsp+48+N_stack*8)
      const sleepBuf = Buffer.allocUnsafe(8);
      sleepBuf.writeBigUInt64LE(BigInt(stubs.spinStub.address));
      await this.write(callRsp + 48n + BigInt(N_stack * 8), sleepBuf);
    }

    const ctx = this.getContext();

    for (let i = 0; i < Math.min(args.length, 4); i++) {
      const argType = normalizedArgTypes[i] ?? 'ptr';
      const v = args[i];
      if (argType === 'f32') {
        this.setXmmFloat(i as 0 | 1 | 2 | 3, Number(v));
        const buf = Buffer.allocUnsafe(4);
        buf.writeFloatLE(Number(v), 0);
        const bits = BigInt(buf.readUInt32LE(0));
        if (i === 0) ctx.Rcx = bits;
        else if (i === 1) ctx.Rdx = bits;
        else if (i === 2) ctx.R8 = bits;
        else ctx.R9 = bits;
      } else if (argType === 'f64') {
        this.setXmmDouble(i as 0 | 1 | 2 | 3, Number(v));
        const buf = Buffer.allocUnsafe(8);
        buf.writeDoubleLE(Number(v), 0);
        const bits = buf.readBigUInt64LE(0);
        if (i === 0) ctx.Rcx = bits;
        else if (i === 1) ctx.Rdx = bits;
        else if (i === 2) ctx.R8 = bits;
        else ctx.R9 = bits;
      } else {
        const bits = BigInt(resolveAddress(v));
        if (i === 0) ctx.Rcx = bits;
        else if (i === 1) ctx.Rdx = bits;
        else if (i === 2) ctx.R8 = bits;
        else ctx.R9 = bits;
      }
    }

    ctx.Rip = targetAddr;
    if (this.isCallRspSet()) {
      ctx.Rsp = this.callRsp;
    }

    nthreadLog.trace(
      `[call] BEFORE target: 0x${targetAddr.toString(16)}, RIP: 0x${BigInt(ctx.Rip).toString(16)}, RSP: 0x${BigInt(ctx.Rsp).toString(16)}, RCX: 0x${BigInt(ctx.Rcx).toString(16)}, RDX: 0x${BigInt(ctx.Rdx).toString(16)}`,
    );
    if (this.debug) {
      nthreadLog.debug(
        `[call] BEFORE target: 0x${targetAddr.toString(16)}, RIP: 0x${BigInt(ctx.Rip).toString(16)}, RSP: 0x${BigInt(ctx.Rsp).toString(16)}, RCX: 0x${BigInt(ctx.Rcx).toString(16)}, RDX: 0x${BigInt(ctx.Rdx).toString(16)}`,
      );
    }

    this.setContext(ctx);
    this.applyContext();
    this.resumeThread();

    let waitResult: WaitReturn = WaitReturn.FAILED;
    try {
      waitResult = await this.waitForLanding(timeoutMs, this.options.signal);
    } finally {
      // Restore the original return chain after a stack-arg call so subsequent
      // 0-stack-arg calls find addRsp28RetStub and spinStub in place.
      if (N_stack > 0) {
        try {
          const callRsp = this.callRsp;
          const retBuf = Buffer.allocUnsafe(8);
          retBuf.writeBigUInt64LE(BigInt(stubs.addRsp28RetStub.address));
          await this.write(callRsp, retBuf);
          const sleepBuf = Buffer.allocUnsafe(8);
          sleepBuf.writeBigUInt64LE(BigInt(stubs.spinStub.address));
          await this.write(callRsp + 48n, sleepBuf);
        } catch {
          /* ignore restore errors */
        }
      }
    }

    if (waitResult === WaitReturn.FAILED) {
      throw new CallThreadDiedError(targetAddr);
    }
    if (waitResult !== WaitReturn.OBJECT_0) {
      throw new CallTimeoutError(targetAddr, waitResult);
    }

    const finalContext = this.getContext();
    const finalRsp = BigInt(finalContext.Rsp);
    const finalRax = BigInt(finalContext.Rax);
    const finalRip = BigInt(finalContext.Rip);
    nthreadLog.trace(
      `[call] AFTER target: 0x${targetAddr.toString(16)}, RIP: 0x${finalRip.toString(16)}, RSP: 0x${finalRsp.toString(16)}, RAX: 0x${finalRax.toString(16)}`,
    );
    if (this.debug) {
      nthreadLog.debug(
        `[call] AFTER target: 0x${targetAddr.toString(16)}, RIP: 0x${finalRip.toString(16)}, RSP: 0x${finalRsp.toString(16)}, RAX: 0x${finalRax.toString(16)}`,
      );
    }

    if (this.isExpectedRspSet()) {
      const expectedRsp = this.expectedRsp;
      if (finalRsp !== expectedRsp) {
        nthreadLog.warn(
          `Stack mismatch after call! Expected RSP: 0x${expectedRsp.toString(16)}, Actual: 0x${finalRsp.toString(16)}`,
        );
      }
    }

    let result: CCallResult;
    if (returnsType === 'f32') result = this.getXmmFloat(0);
    else if (returnsType === 'f64') result = this.getXmmDouble(0);
    else result = parseCallResult(finalRax, func.returns);

    return result;
  }

  /**
   * Synchronous twin of {@link callAfterInit}: identical setup (stack args,
   * register assignment, `applyContext`/`resumeThread`), but waits for the
   * call to land via {@link waitForLandingSync} (a tight busy-spin, no
   * `await`/yield anywhere in this method) instead of the async, backoff-
   * polling {@link waitForLanding}. Intended for calls expected to return
   * almost immediately -- it blocks the calling JS thread and pins a CPU
   * core for the duration, so it's a poor fit for anything slow; use the
   * async `call()` for that instead.
   */
  public override callSync(func: CFunction, ...args: any[]): CCallResult {
    if (!this.isInitializingSync) {
      this.initSync();
    }
    if (!this.nativeThread) {
      throw new Error('NThread is not initialized.');
    }

    if (
      typeof (func as any).shouldCloneForAccessor === 'function' &&
      (func as any).shouldCloneForAccessor(this)
    ) {
      const addr = this.root.machineCodeSync(func as any);
      func = (func as any).cloneForAddress(addr);
    }

    const timeoutMs = this.options.timeoutMs ?? 15000;
    const normalizedArgTypes = (func.args ?? []).map((t) => normalizeType(t));
    const returnsType = normalizeType(func.returns);
    const targetAddr = BigInt(func.ptr);
    const N_stack = Math.max(0, args.length - 4);
    const stubs = this.stubs as ThreadStubs;

    // For calls with stack args (> 4), adjust the return chain and write
    // stack args into the remote thread's stack before resuming.
    if (N_stack > 0) {
      const callRsp = this.callRsp;

      // Get or allocate a per-N_stack stub: add rsp,(0x28+N*8); ret
      let stubAddr = this._stackArgStubs.get(N_stack);
      if (!stubAddr) {
        const N = 0x28 + N_stack * 8;
        const stubBytes: number[] =
          N <= 0x7f
            ? [0x48, 0x83, 0xc4, N, 0xc3]
            : [
                0x48,
                0x81,
                0xc4,
                N & 0xff,
                (N >> 8) & 0xff,
                (N >> 16) & 0xff,
                (N >> 24) & 0xff,
                0xc3,
              ];
        while (stubBytes.length < 16) stubBytes.push(0x90);
        const allocAddr = this.allocSync(
          16,
          null,
          MemoryProtection.EXECUTE_READWRITE,
        );
        this.writeSync(allocAddr, Buffer.from(stubBytes));
        stubAddr = BigInt(resolveAddress(allocAddr));
        this._stackArgStubs.set(N_stack, stubAddr);
      }

      // Overwrite [callRsp] with stub address (replaces addRsp28RetStub)
      const retBuf = Buffer.allocUnsafe(8);
      retBuf.writeBigUInt64LE(stubAddr);
      this.writeSync(callRsp, retBuf);

      // Write each stack arg at [callRsp + 40 + i*8]
      for (let i = 4; i < args.length; i++) {
        const n = i - 4;
        const slotBuf = Buffer.alloc(8, 0);
        const argType = normalizedArgTypes[i] ?? 'ptr';
        const v = args[i];
        if (argType === 'f32') {
          slotBuf.writeFloatLE(Number(v), 0);
        } else if (argType === 'f64') {
          slotBuf.writeDoubleLE(Number(v), 0);
        } else {
          slotBuf.writeBigUInt64LE(BigInt(resolveAddress(v)));
        }
        this.writeSync(callRsp + 40n + BigInt(n * 8), slotBuf);
      }

      // Write spinStub at [callRsp + 48 + N_stack*8]
      const sleepBuf = Buffer.allocUnsafe(8);
      sleepBuf.writeBigUInt64LE(BigInt(stubs.spinStub.address));
      this.writeSync(callRsp + 48n + BigInt(N_stack * 8), sleepBuf);
    }

    const ctx = this.getContext();

    for (let i = 0; i < Math.min(args.length, 4); i++) {
      const argType = normalizedArgTypes[i] ?? 'ptr';
      const v = args[i];
      if (argType === 'f32') {
        this.setXmmFloat(i as 0 | 1 | 2 | 3, Number(v));
        const buf = Buffer.allocUnsafe(4);
        buf.writeFloatLE(Number(v), 0);
        const bits = BigInt(buf.readUInt32LE(0));
        if (i === 0) ctx.Rcx = bits;
        else if (i === 1) ctx.Rdx = bits;
        else if (i === 2) ctx.R8 = bits;
        else ctx.R9 = bits;
      } else if (argType === 'f64') {
        this.setXmmDouble(i as 0 | 1 | 2 | 3, Number(v));
        const buf = Buffer.allocUnsafe(8);
        buf.writeDoubleLE(Number(v), 0);
        const bits = buf.readBigUInt64LE(0);
        if (i === 0) ctx.Rcx = bits;
        else if (i === 1) ctx.Rdx = bits;
        else if (i === 2) ctx.R8 = bits;
        else ctx.R9 = bits;
      } else {
        const bits = BigInt(resolveAddress(v));
        if (i === 0) ctx.Rcx = bits;
        else if (i === 1) ctx.Rdx = bits;
        else if (i === 2) ctx.R8 = bits;
        else ctx.R9 = bits;
      }
    }

    ctx.Rip = targetAddr;
    if (this.isCallRspSet()) {
      ctx.Rsp = this.callRsp;
    }

    this.setContext(ctx);
    this.applyContext();
    this.resumeThread();

    let waitResult: WaitReturn = WaitReturn.FAILED;
    try {
      waitResult = this.waitForLandingSync(timeoutMs, this.options.signal);
    } finally {
      // Restore the original return chain after a stack-arg call so subsequent
      // 0-stack-arg calls find addRsp28RetStub and spinStub in place.
      if (N_stack > 0) {
        try {
          const callRsp = this.callRsp;
          const retBuf = Buffer.allocUnsafe(8);
          retBuf.writeBigUInt64LE(BigInt(stubs.addRsp28RetStub.address));
          this.writeSync(callRsp, retBuf);
          const sleepBuf = Buffer.allocUnsafe(8);
          sleepBuf.writeBigUInt64LE(BigInt(stubs.spinStub.address));
          this.writeSync(callRsp + 48n, sleepBuf);
        } catch {
          /* ignore restore errors */
        }
      }
    }

    if (waitResult === WaitReturn.FAILED) {
      throw new CallThreadDiedError(targetAddr);
    }
    if (waitResult !== WaitReturn.OBJECT_0) {
      throw new CallTimeoutError(targetAddr, waitResult);
    }

    const finalContext = this.getContext();
    const finalRsp = BigInt(finalContext.Rsp);
    const finalRax = BigInt(finalContext.Rax);

    if (this.isExpectedRspSet()) {
      const expectedRsp = this.expectedRsp;
      if (finalRsp !== expectedRsp) {
        nthreadLog.warn(
          `Stack mismatch after call! Expected RSP: 0x${expectedRsp.toString(16)}, Actual: 0x${finalRsp.toString(16)}`,
        );
      }
    }

    let result: CCallResult;
    if (returnsType === 'f32') result = this.getXmmFloat(0);
    else if (returnsType === 'f64') result = this.getXmmDouble(0);
    else result = parseCallResult(finalRax, func.returns);

    return result;
  }
}
