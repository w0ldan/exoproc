import { AsyncLocalStorage } from 'node:async_hooks';
import {
  isMiddlewareAccessor,
  type ISyncCallableMemoryAccessor,
  type IHostAccessor,
  type IInittableAccessor,
  type CFunction,
  type CCallResult,
} from 'bun-xffi';
import { Thread } from 'bun-winapi';
import { NThread, type NThreadOptions } from 'bun-nthread';
import {
  HostAccessor,
  type HostAccessorSession,
  ThrowingMemoryAccessor,
  RedirectorHostAccessor,
  BootstrapHostAccessor,
  RacingHostAccessor,
  IndirectCallRedirectorAccessor,
  MachineCodePoolMiddleware,
  MemsetWriteAccessor,
  MemcmpReadAccessor,
  FileTransferWriteAccessor,
  FileTransferReadAccessor,
  ScannerMiddleware,
  MarshallingCallableAccessor,
} from './middleware-accessor.js';

/**
 * A {@link HostAccessor} whose base "call" mechanism is {@link NThread} (x64
 * thread redirection) instead of `RemoteCallableMemoryAccessor` (a fresh
 * `CreateRemoteThread` per call). This directly replaces the old
 * `IndirectCallableAccessor` + manual `NThread`/`RedirectorHostAccessor`
 * wiring -- it builds the same indirect chain
 * (`IndirectCallRedirectorAccessor` → machineCode pool → memset write →
 * memcmp read → file-transfer R/W → scanner → marshalling) on top of an
 * `NThread`-*like* backend directly.
 *
 * Only the thing that actually executes remote calls changes: no
 * `CreateRemoteThread` at all -- a live thread in the target is redirected,
 * parked at a `jmp $` stub, and driven per call. This also sidesteps a
 * GHA/Wine bug where WinAPI calls (VirtualAlloc, malloc, fopen, ...) executed
 * on a freshly-created thread (local or remote) are unreliable -- see CLAUDE.md.
 *
 * Accepts an already-constructed `NThread`, a `(pid, threadId, options)`
 * triple to build one internally, or a {@link NThreadRaceAccessor} standing
 * in for a not-yet-known winner among every thread of a process (the
 * `idType: 'processAllThreadIds'` support behind `createAccessor` --  see
 * that class's own doc comment):
 *
 *   const memory = new IndirectNThreadHostAccessor(pid, tid);
 *   const addr = await memory.alloc(64);              // VirtualAlloc via redirect
 *   await memory.call(SomeFunc, addr);                // executed on the thread
 *
 *   const race = new NThreadRaceAccessor(pid);
 *   const memory = new IndirectNThreadHostAccessor(race); // built once, synchronously
 *   await memory.init();                                  // races, resolves `race` internally
 *
 * With the `(pid, threadId, options)` form, this accessor builds the
 * `NThread`'s `RedirectorHostAccessor` root itself and wires its `target`
 * to `this` -- it owns that object, nothing else could reach it.
 *
 * With the `backend: NThread | NThreadRaceAccessor` form, the backend (and
 * whatever `root` it was constructed with) belongs to the caller. This
 * accessor does not reach into its `root` to rewire it -- if its bootstrap
 * stub calls need to route through this indirect chain (e.g. `root` is a
 * `RedirectorHostAccessor`), the caller sets `root.target = indirect` itself
 * after construction, same as building the chain by hand:
 *
 *   const redirector = new RedirectorHostAccessor(pid);
 *   const nthread = new NThread(backend, tid, options, redirector);
 *   const indirect = new IndirectNThreadHostAccessor(nthread);
 *   redirector.target = indirect;
 */
export class IndirectNThreadHostAccessor extends HostAccessor {
  private readonly nthreadRef: NThread | NThreadRaceAccessor;
  private bootstrapRoot: BootstrapHostAccessor;

  /**
   * The real `NThread` this accessor's chain ultimately runs on. When built
   * from a {@link NThreadRaceAccessor} (the `idType: 'processAllThreadIds'`
   * case), that accessor's own `target` (inherited from
   * `RedirectorHostAccessor`) is the winning `NThread` by the time `init()`
   * resolves (see its doc comment), so this drills through to it rather
   * than exposing the race stand-in itself -- callers that reach past the
   * generic `HostAccessor` surface into `NThread`-specific members (e.g.
   * `.savedContext`, `.setContext()`) need the genuine instance.
   */
  get nthread(): NThread {
    return this.nthreadRef instanceof NThreadRaceAccessor
      ? (this.nthreadRef.target as NThread)
      : this.nthreadRef;
  }

  constructor(backend: NThread | NThreadRaceAccessor);
  constructor(pid: number, threadId: number, options?: NThreadOptions);
  constructor(
    backendOrPid: NThread | NThreadRaceAccessor | number,
    threadId?: number,
    options: NThreadOptions = {},
  ) {
    let nthread: NThread | NThreadRaceAccessor;
    let nthreadRoot: RedirectorHostAccessor | undefined;
    // `typeof ... === 'number'` rather than `instanceof NThread`: NThread now
    // lives in a different package than this class, so a caller's own
    // cross-package-resolved `NThread` copy can fail an `instanceof` check
    // here even though it's structurally identical (same root cause as
    // `isMiddlewareAccessor` elsewhere in this codebase -- see its doc
    // comment on why `instanceof` against a concrete class is unreliable
    // across a package boundary under Wine).
    if (typeof backendOrPid === 'number') {
      nthreadRoot = new RedirectorHostAccessor(backendOrPid);
      nthread = new NThread(backendOrPid, threadId!, options, nthreadRoot);
    } else {
      nthread = backendOrPid;
    }

    const pid = nthread.processId;
    super(new ThrowingMemoryAccessor(pid));

    const bootstrap = new BootstrapHostAccessor(pid, this);
    this.bootstrapRoot = bootstrap;
    bootstrap.backend = nthread;

    const redirector = new IndirectCallRedirectorAccessor(nthread, bootstrap);
    const machineCodePool = new MachineCodePoolMiddleware(
      redirector,
      bootstrap,
    );
    const memsetWrite = new MemsetWriteAccessor(machineCodePool, bootstrap);
    const memcmpRead = new MemcmpReadAccessor(memsetWrite, bootstrap);
    const fileWriter = new FileTransferWriteAccessor(memcmpRead, bootstrap);
    const fileReader = new FileTransferReadAccessor(fileWriter, bootstrap);
    const scanner = new ScannerMiddleware(fileReader, bootstrap);
    const marshalling = new MarshallingCallableAccessor(scanner, bootstrap);

    this.backend = marshalling;
    let b: ISyncCallableMemoryAccessor = marshalling;
    while (isMiddlewareAccessor(b)) {
      b = b.backend;
    }
    if (b) {
      this._processId = b.processId;
    }

    // Only for the (pid, threadId, options) form: we built `nthreadRoot`
    // ourselves above, so we're the only one who could ever wire it -- route
    // its bootstrap stub calls down through this indirect chain. For the
    // `backend: NThread | NThreadRaceAccessor` form, `nthreadRoot` is
    // undefined here and the caller's own `root` (whatever it is) is left
    // untouched -- see the class doc comment.
    if (nthreadRoot) {
      nthreadRoot.target = this;
    }

    this.nthreadRef = nthread;
  }

  protected override async onInit(): Promise<void> {
    await this.bootstrapRoot.init();
  }

  protected override onInitSync(): void {
    this.bootstrapRoot.initSync();
  }

  override async deinit(): Promise<void> {
    try {
      await super.deinit();
    } finally {
      try {
        await this.bootstrapRoot.deinit();
      } catch {}
    }
  }

  override deinitSync(): void {
    try {
      super.deinitSync();
    } finally {
      try {
        this.bootstrapRoot.deinitSync();
      } catch {}
    }
  }

  override toJSON(options?: { hibernate?: boolean }): HostAccessorSession {
    const session = super.toJSON(options);
    session.accessorType = 'IndirectNThreadHostAccessor';
    try {
      const nt = this.nthread;
      if (nt && typeof nt.threadId === 'number') {
        session.threadId = nt.threadId;
      }
      if (nt && nt.stubs) {
        const stubs: Record<string, string> = {};
        for (const [k, v] of Object.entries(nt.stubs)) {
          if (v && typeof (v as any).address === 'bigint') {
            stubs[k] = `0x${(v as any).address.toString(16)}`;
          }
        }
        if (Object.keys(stubs).length > 0) {
          session.stubs = stubs;
        }
      }
    } catch {
      // In case nthreadRef is not yet resolved or stubs are not populated
    }
    return session;
  }
}

/**
 * Module-scoped and shared across every `NThreadRaceAccessor` instance --
 * `AsyncLocalStorage` isolates by *async execution context*, not by which
 * object holds the reference, so sharing one instance across unrelated,
 * concurrently-racing `NThreadRaceAccessor`s (e.g. two independent
 * `createAccessor()` calls against two different processes at once) is safe
 * and idiomatic, the same way e.g. Express shares one ALS instance across
 * all concurrent request handlers.
 */
const currentCandidate = new AsyncLocalStorage<NThread>();

/**
 * Stands in for a not-yet-known `NThread` inside an
 * {@link IndirectNThreadHostAccessor}'s own chain -- pass an instance of
 * this directly as that class's `backend` (its `backend: NThread |
 * NThreadRaceAccessor` constructor form). The whole `IndirectNThreadHostAccessor`
 * chain gets built exactly once, synchronously, right alongside every other
 * `idType`; only the actual thread hijack is deferred to `init()`, same as
 * the rest of this class's own machinery.
 *
 * Extends {@link RacingHostAccessor} and overrides its `onInit()` to
 * actually race (`this.race()`), then sets its own `target` to the winning
 * `NThread` directly -- so every op this class forwards (inherited from
 * `RedirectorHostAccessor`) transparently reaches the winner from then on,
 * with nothing above it (in `IndirectNThreadHostAccessor`'s own chain) ever
 * needing to change.
 *
 * Only initializes the *raw* `NThread` hijack per candidate, not a full
 * `IndirectNThreadHostAccessor` chain -- that chain is built exactly once,
 * around *this* accessor rather than around any particular candidate, so the
 * real extra work beyond landing the hijack (`IndirectCallRedirectorAccessor`,
 * `MachineCodePoolMiddleware`, an msvcrt check, opening a remote temp file for
 * `FileTransferWriteAccessor`, ...) naturally only ever happens once, no
 * matter which candidate wins.
 *
 * Every candidate `NThread` is built with `this` (the single, shared
 * `NThreadRaceAccessor`) as its root directly -- no per-candidate proxy
 * object. That's normally unsafe: `NThread.onInit()`'s bootstrap
 * (`this.root.call(stubs.jumpStub)`, landing the hijack) needs `root.call()`
 * to resolve back to *that exact candidate's* own `call()`, and with N
 * candidates racing concurrently through one shared root, a single mutable
 * `backend`/`target` field can't hold N different answers at once (tried
 * this with a plain shared root first -- every candidate's bootstrap call
 * collided on the same placeholder and threw). The fix is `currentCandidate`
 * above: `startRacer` (below) wraps each candidate's `init()` in
 * `currentCandidate.run(candidate, ...)`, which threads that candidate
 * through its *entire* async continuation (every `await` inside its own
 * `onInit()`) in a context isolated from every other concurrently-racing
 * candidate. `call()` (below), when `target` is still self (race not yet
 * decided), reads `currentCandidate.getStore()` to find out which
 * candidate's own bootstrap call this is and forwards to *its* `call()`
 * directly -- no shared field involved. This keeps the ALS mechanism
 * entirely local to this class (`RacingHostAccessor` itself knows nothing
 * about it, see its doc comment) and needs zero changes to `NThread` --
 * `this.root.call(...)` there is untouched, so root-indirection stays a
 * generic, reusable mechanism, not something hardcoded around racing.
 */
export class NThreadRaceAccessor extends RacingHostAccessor {
  private readonly aborts = new Map<NThread, () => void>();

  constructor(
    pid: number,
    nthreadOptions: NThreadOptions = {},
    root?: IHostAccessor,
  ) {
    super(pid, root);
    // RedirectorHostAccessor's own constructor sets `target` to a fresh
    // placeholder `ThrowingHostAccessor`, never to `this` -- only
    // `BootstrapHostAccessor` self-loops that way. `call()` below needs
    // `target === this` to mean "race not yet decided", so set it
    // explicitly here too.
    this.target = this;

    const threads = Thread.getThreads(pid);
    if (threads.length === 0) {
      throw new Error(
        `createAccessor: process ${pid} has no threads to redirect`,
      );
    }

    const callerSignal = nthreadOptions.signal;
    for (const t of threads) {
      const controller = new AbortController();
      // Compose with a caller-supplied signal (if any) -- either one aborts this candidate.
      if (callerSignal) {
        if (callerSignal.aborted) controller.abort(callerSignal.reason);
        else
          callerSignal.addEventListener(
            'abort',
            () => controller.abort(callerSignal.reason),
            { once: true },
          );
      }

      // root = this directly -- auto-registers as a racer via
      // MiddlewareAccessor's constructor (root.registerChild(this)); see
      // the class doc comment for why a shared root is safe here only
      // because of startRacer()'s AsyncLocalStorage wrapping below.
      const nthread = new NThread(
        pid,
        t.tid,
        { ...nthreadOptions, signal: controller.signal },
        this,
      );
      this.aborts.set(nthread, () => controller.abort());
    }
  }

  protected override startRacer(racer: IInittableAccessor): Promise<void> {
    return currentCandidate.run(racer as unknown as NThread, () =>
      racer.init(),
    );
  }

  override async call(func: CFunction, ...args: any[]): Promise<CCallResult> {
    if (this.target === this) {
      const caller = currentCandidate.getStore();
      if (caller) return caller.call(func, ...args);
    }
    return super.call(func, ...args);
  }

  protected override releaseLoser(
    racer: IInittableAccessor,
    settled: Promise<void>,
  ): void {
    this.aborts.get(racer as unknown as NThread)?.();
    super.releaseLoser(racer, settled);
  }

  protected override async onInit(): Promise<void> {
    const winner = await this.race();
    this.target = winner as unknown as NThread;
  }

  protected override onInitSync(): never {
    throw new Error('NThreadRaceAccessor does not support initSync()');
  }
}
