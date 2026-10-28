import { Thread, Module } from 'bun-winapi';
import { Kernel32Impl, type ISyncCallableMemoryAccessor } from 'bun-xffi';
import { CallThreadDiedError, NThread, type NThreadOptions } from 'bun-nthread';
import { NShm } from 'bun-nshm';
import {
  attachNJava,
  findNJava,
  getNJava,
  getReflection,
  findReflection,
  getJavaClass,
  type NJavaAccessor,
  type ReflectionBridge,
  type ReflectedClass,
} from 'bun-njava';
import {
  HostAccessor,
  type HostAccessorSession,
  RedirectorHostAccessor,
} from './middleware-accessor.js';
import {
  IndirectNThreadHostAccessor,
  NThreadRaceAccessor,
} from './indirect-nthread-host-accessor.js';
import {
  createStealthJavaAccessor,
  spawnStealthWorkerThread,
} from './stealth-java.js';

export type { HostAccessorSession };

export {
  createStealthJavaAccessor,
  spawnStealthWorkerThread,
  attachNJava,
  findNJava,
  getNJava,
  getReflection,
  findReflection,
  getJavaClass,
  type NJavaAccessor,
  type ReflectionBridge,
  type ReflectedClass,
};

/** Policy for attaching Java/JVM reflection support ({@link NJavaAccessor}):
 * - `false`: Never attach njava.
 * - `true`: Always attach njava (throws if JVM / jvm.dll is not found).
 * - `'auto'`: Automatically detect if `jvm.dll` is loaded via `GetModuleHandleA` in the target process; if found, attach njava. Default: `'auto'`.
 * - `'stealth'`: Attaches via a temporary bootstrap accessor, spawns a dedicated worker thread in the target JVM (zero bytecode definitions), closes bootstrap accessor, and attaches directly and exclusively to the dedicated thread.
 */
export type JavaAttachOption = boolean | 'auto' | 'stealth';

/** What {@link createAccessor}'s `id` parameter identifies. */
export type AccessorIdType = 'thread' | 'process' | 'processAllThreadIds';

/**
 * Default for {@link AccessorOptions.idType} when omitted -- `id` is treated
 * as a pid and every one of its threads races for the hijack (see
 * {@link NThreadRaceAccessor}), so callers don't have to pick a thread
 * themselves.
 */
const DEFAULT_ID_TYPE: AccessorIdType = 'processAllThreadIds';

/**
 * Options for {@link createAccessor}.
 */
export interface AccessorOptions {
  /** Optional timeout in milliseconds for operations like thread race or stealth attach. */
  timeoutMs?: number;
  /**
   * Whether `id` is a thread id or a process id. Default:
   * `'processAllThreadIds'` -- `id` is a pid, and this builds a genuine
   * {@link IndirectNThreadHostAccessor} (via a {@link NThreadRaceAccessor}
   * standing in for its `NThread`, internally -- see that class's doc
   * comment) that, once initialized, races an `NThread` hijack attempt
   * against *every* thread the process currently has, since there's no way
   * to tell in advance which thread(s) (if any) will ever return to user
   * mode (see CLAUDE.md's `ping.exe`/`DummyProcess` notes on why a thread
   * parked in an indefinite kernel wait never lands the redirect).
   * Whichever one's hijack lands first wins; every other candidate is
   * aborted and deinitialized right away. Resolving *which* thread only
   * happens inside `init()` (no `initSync()` support -- racing is
   * inherently async) -- both {@link createAccessor} and
   * {@link createAccessorWithoutInit} support this idType now, the latter
   * just returns the accessor before racing anything (same as any other
   * idType). Heavier than `'thread'`/`'process'` (one hijack attempt per
   * thread, run concurrently) -- see CLAUDE.md's throughput-vs-stability
   * notes on stressing a target harder.
   *
   * Pass `'thread'` to name one specific, already-live thread directly
   * ({@link IndirectNThreadHostAccessor}) instead of racing -- the precise,
   * unambiguous form when you already know which thread will work. Pass
   * `'process'` to hand in a pid and let this pick the process's first
   * enumerable thread ({@link Thread.getThreads}) for you, without racing
   * the rest.
   */
  idType?: AccessorIdType;
  /**
   * The `HostAccessor` class to build for the default chain. Default:
   * {@link IndirectNThreadHostAccessor}. Ignored when `backend` is supplied.
   *
   * When `host` is left at the default, `idType: 'processAllThreadIds'`
   * behaves exactly as documented there (races every thread via
   * `NThreadRaceAccessor`) and `hostOptions` is forwarded as `NThreadOptions`
   * to the `NThread`(s) it builds -- the same thing `nthreadOptions` used to
   * do, just renamed now that this isn't `NThread`-specific. A custom `host`
   * is built directly as `new host(pid, threadId, hostOptions)`; there's no
   * generic way to race across an arbitrary host class's threads, so
   * `idType: 'processAllThreadIds'` isn't supported for one (throws).
   */
  host?: new (
    pid: number,
    threadId: number,
    options?: Record<string, unknown>,
  ) => HostAccessor;
  /** Forwarded to `host`'s constructor. Ignored when `backend` is supplied. */
  hostOptions?: Record<string, unknown>;
  /**
   * Use this accessor instead of building the default
   * {@link IndirectNThreadHostAccessor} chain -- any `HostAccessor` (or
   * subclass) works, e.g. an already-wired one of your own, or a plain
   * custom backend wrapped in `new HostAccessor(myAccessor)`. When supplied,
   * `id`/`idType` are never resolved at all. Still eligible for
   * `sharedMemory` wrapping, same as the default chain.
   */
  backend?: HostAccessor;
  /**
   * Wrap the resolved accessor (the default chain, or `backend` if
   * supplied) with a shared-memory middleware: plain `READWRITE`
   * allocations get backed by cross-process shared memory, so reads/writes
   * against them skip the remote round-trip entirely after the initial
   * `alloc()`. The middleware itself (e.g. {@link NShm}) is a plain,
   * non-inittable `MiddlewareAccessor` -- {@link createAccessor}/
   * {@link createAccessorWithoutInit} wrap it in an outer `HostAccessor` so
   * the returned value is always a real `HostAccessor` regardless of this
   * flag. Default: `false`.
   */
  sharedMemory?: boolean;
  /**
   * Shared-memory middleware class used when `sharedMemory` is `true`.
   * Default: {@link NShm}. `options` is untyped ({@link Record}) rather than
   * {@link NShmOptions} on purpose -- a custom middleware isn't required to
   * share NShm's options shape at all.
   */
  sharedMemoryMiddleware?: new (
    backend: ISyncCallableMemoryAccessor,
    root: HostAccessor,
    options?: Record<string, unknown>,
  ) => ISyncCallableMemoryAccessor;
  /**
   * Forwarded to `sharedMemoryMiddleware`. Ignored when `sharedMemory` is
   * `false`. Usually left empty -- {@link NShm}'s constructor (the default
   * `sharedMemoryMiddleware`) treats a missing/empty options object as "use
   * the defaults".
   */
  sharedMemoryOptions?: Record<string, unknown>;
  /**
   * Whether to attach {@link NJavaAccessor} to the created accessor chain:
   * - `false`: Do not attach njava.
   * - `true`: Always attach njava (throws if JVM / jvm.dll is not found).
   * - `'auto'` (default): Checks whether `jvm.dll` is loaded in the target
   *   process via `GetModuleHandleA('jvm.dll')`, and automatically attaches njava if found.
   */
  njava?: JavaAttachOption;
}

/** Resolves `id` (a raw thread id) to its owning `{ pid, threadId }` pair. */
function resolveFromThreadId(id: number): { pid: number; threadId: number } {
  // pid=0 means "all processes" -- a bare thread id doesn't tell us which
  // process owns it, so the system-wide snapshot has to be searched.
  const entry = Thread.getThreads(0).find((t) => t.tid === id);
  if (!entry) {
    throw new Error(`createAccessor: no thread with id ${id} found`);
  }
  return { pid: entry.ownerPid, threadId: id };
}

/** Resolves `id` (a process id) to `{ pid, threadId }` via its first enumerable thread. */
function resolveFromProcessId(id: number): { pid: number; threadId: number } {
  const threadId = Thread.getThreads(id)[0]?.tid;
  if (threadId === undefined) {
    throw new Error(`createAccessor: process ${id} has no threads to redirect`);
  }
  return { pid: id, threadId };
}

/** The default chain or `options.backend`, before any `sharedMemory` wrapping. */
function resolveBaseAccessor(
  id: number,
  options: AccessorOptions,
): HostAccessor {
  if (options.backend) {
    return options.backend;
  }

  const Host = options.host ?? IndirectNThreadHostAccessor;
  const idType = options.idType ?? DEFAULT_ID_TYPE;

  if (idType === 'processAllThreadIds') {
    if (Host !== IndirectNThreadHostAccessor) {
      throw new Error(
        'createAccessor: idType "processAllThreadIds" is only supported ' +
          "with the default host (IndirectNThreadHostAccessor) -- there's " +
          "no generic way to race across an arbitrary host class's threads.",
      );
    }
    return new IndirectNThreadHostAccessor(
      new NThreadRaceAccessor(
        id,
        options.hostOptions as NThreadOptions | undefined,
      ),
    );
  }

  const { pid, threadId } =
    idType === 'thread' ? resolveFromThreadId(id) : resolveFromProcessId(id);

  return new Host(pid, threadId, options.hostOptions);
}

/**
 * Builds the same accessor {@link createAccessor} does, without initializing
 * it -- the result still lazily initializes on its first real operation
 * (every {@link InittableMiddlewareAccessor} op is guarded by
 * `!isInitializing -> await this.init()`), it's just not pre-initialized up
 * front. Defaults to {@link IndirectNThreadHostAccessor} (thread redirection
 * -- no `CreateRemoteThread` and no remote allocation for the call mechanism
 * itself); pass `options.backend` to use a different strategy instead.
 *
 * Always returns a real {@link HostAccessor} -- `init`/`deinit`/etc. are
 * directly callable on the result, `sharedMemory: true` included. Rather
 * than wrapping the resolved base accessor in a new outer `HostAccessor`,
 * `sharedMemory: true` splices the shared-memory middleware ({@link NShm} by
 * default, a plain non-inittable `MiddlewareAccessor`) directly into the
 * base accessor's own `backend` chain (`base.backend` becomes the
 * middleware, whose own `backend` becomes whatever `base.backend` used to
 * be) and returns `base` itself -- so the result is still the concrete
 * class `resolveBaseAccessor` produced (e.g. `IndirectNThreadHostAccessor`,
 * `.nthread` and all), just with allocations transparently intercepted.
 * `HostAccessor.init()`/`.deinit()` skip over non-inittable middleware
 * layers when walking the chain (see `InittableMiddlewareAccessor.initNext()`
 * in bun-xffi), so this still reaches down and initializes/deinitializes
 * the spliced-in middleware's own backend correctly.
 *
 * `options.idType` defaults to `'processAllThreadIds'`, which races every
 * thread of the process via a {@link NThreadRaceAccessor} nested inside the
 * built `IndirectNThreadHostAccessor` -- see {@link AccessorOptions.idType}.
 * Building it still doesn't touch the target process (beyond a local
 * `Thread.getThreads` snapshot to discover candidates) -- the actual hijack
 * attempts, and picking a winner among them, only happen once `init()` runs,
 * whether that's this function's caller doing it lazily on first real use,
 * or {@link createAccessor} doing it eagerly.
 */
export function createAccessorWithoutInit(
  id: number,
  options: AccessorOptions = {},
): HostAccessor {
  const base = resolveBaseAccessor(id, options);
  base._options = options;
  if (!options.sharedMemory) {
    return base;
  }

  // Splice the shared-memory middleware into `base`'s own backend chain
  // (base.backend -> middleware -> base's original backend) and return
  // `base` itself, rather than allocating a new outer HostAccessor to wrap
  // it -- this keeps `base`'s concrete class/identity intact (e.g. an
  // IndirectNThreadHostAccessor's `.nthread` stays reachable) while every op
  // still gets intercepted by the middleware, since `base`'s own ops already
  // forward to `base.backend`.
  base.backend = new (options.sharedMemoryMiddleware ?? NShm)(
    base.backend,
    base,
    options.sharedMemoryOptions,
  );
  return base;
}

/**
 * {@link createAccessorWithoutInit}, followed by `await`ing the result's
 * `init()` so the accessor is already initialized by the time this resolves,
 * instead of initializing lazily on its first real operation. Same
 * always-`HostAccessor` return type as {@link createAccessorWithoutInit}.
 *
 * For `options.idType === 'processAllThreadIds'` (see
 * {@link AccessorOptions.idType}), this `init()` call is what actually runs
 * the race ({@link NThreadRaceAccessor.onInit}, nested inside the resolved
 * {@link IndirectNThreadHostAccessor}'s own chain) -- picking a winner,
 * aborting the rest, and (when `sharedMemory: true`) initializing the
 * shared-memory middleware on top, all as part of this one `await`. The
 * result is always a genuine `IndirectNThreadHostAccessor` for every
 * `idType`, `processAllThreadIds` included -- `NThreadRaceAccessor` never
 * surfaces to callers; see its own doc comment.
 */
async function remoteGetModuleHandleA(
  accessor: HostAccessor,
  name: string,
): Promise<bigint> {
  const buf = Buffer.from(`${name}\0`);
  const ptr = await accessor.alloc(buf.length);
  try {
    await accessor.write(ptr, buf);
    return BigInt(await accessor.call(Kernel32Impl.GetModuleHandleA, ptr));
  } finally {
    await accessor.free(ptr).catch(() => {});
  }
}

function isThreadDiedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err instanceof CallThreadDiedError ||
    err.name === 'CallThreadDiedError' ||
    err.constructor?.name === 'CallThreadDiedError' ||
    /Thread died/i.test(err.message)
  );
}

export async function createAccessor(
  idOrPath: number | string,
  options: AccessorOptions = {},
): Promise<HostAccessor> {
  if (typeof idOrPath === 'string') {
    return await HostAccessor.load(idOrPath, options);
  }
  const id = idOrPath;

  const initOne = async (
    targetId: number,
    opt: AccessorOptions,
  ): Promise<HostAccessor> => {
    const accessor = createAccessorWithoutInit(targetId, opt);
    accessor._options = opt;
    try {
      await accessor.init();

      const njavaOpt = opt.njava ?? 'auto';
      if (njavaOpt === true) {
        await attachNJava(accessor);
      } else if (njavaOpt === 'auto') {
        try {
          let hJvm = await remoteGetModuleHandleA(accessor, 'jvm.dll');
          if (hJvm === 0n) {
            const modules = Module.getModules(accessor.processId);
            const isJavaLauncher = modules.some((m) =>
              /java(\.exe|w\.exe|\.dll)/i.test(m.name),
            );
            if (isJavaLauncher) {
              const deadline = Date.now() + 10000;
              while (hJvm === 0n && Date.now() < deadline) {
                await Bun.sleep(100);
                hJvm = await remoteGetModuleHandleA(accessor, 'jvm.dll');
              }
            }
          }
          if (hJvm !== 0n) {
            await attachNJava(accessor);
          }
        } catch (err) {
          if (isThreadDiedError(err)) {
            accessor.close();
            throw err;
          }
        }
      }
      return accessor;
    } catch (err) {
      accessor.close();
      throw err;
    }
  };

  if (options.njava === 'stealth') {
    return await createStealthJavaAccessor(id, options);
  }

  if (options.backend || options.idType === 'thread') {
    return await initOne(id, options);
  }

  // If the target is a Java process and no specific idType was requested,
  // iterate threads sequentially prioritizing HotSpot worker threads first
  // to avoid racing onto a short-lived launcher / helper thread that exits.
  if (!options.idType) {
    try {
      const modules = Module.getModules(id);
      const isJava = modules.some((m) =>
        /java(\.exe|w\.exe|\.dll)/i.test(m.name),
      );
      if (isJava) {
        const threads = Thread.getThreads(id);
        const candidateThreads =
          threads.length > 1 ? [...threads.slice(1), threads[0]!] : threads;
        for (const t of candidateThreads) {
          try {
            return await initOne(t.tid, {
              ...options,
              idType: 'thread',
            });
          } catch {
            // Try next candidate thread
          }
        }
      }
    } catch {
      // Fall through to standard race
    }
  }

  try {
    return await initOne(id, options);
  } catch (err) {
    if (isThreadDiedError(err)) {
      const threads = Thread.getThreads(id);
      for (const t of threads) {
        try {
          return await initOne(t.tid, {
            ...options,
            idType: 'thread',
          });
        } catch {
          // Candidate thread didn't work, try next
        }
      }
    }
    throw err;
  }
}

/**
 * How aggressively the default {@link createAccessor} chain drives the
 * redirected thread: tighter polling and shorter timeouts squeeze more
 * read/write/call throughput out of it (less latency added per operation),
 * at the cost of stressing the target harder and raising the odds of
 * destabilizing/crashing a fragile one -- see CLAUDE.md's NThread
 * timeout-tuning notes for why some targets need more slack. Purely a
 * throughput-vs-stability dial on NThread's own wait/poll timing (plus,
 * at level 2, turning on shared memory for extra throughput).
 *
 *   1 = gentle: long timeout, NThread's own fast polling -- safest for a fragile/loaded target.
 *   2 = balanced: NThread's own defaults (5000ms timeout, 2ms poll) + shared memory.
 */
export type AccessorAggressiveness = 1 | 2;

const AGGRESSIVENESS_PRESETS: Record<
  AccessorAggressiveness,
  { hostOptions: NThreadOptions; sharedMemory: boolean }
> = {
  1: {
    hostOptions: { timeoutMs: 20000, pollIntervalMs: 2 },
    sharedMemory: false,
  },
  2: {
    hostOptions: { timeoutMs: 5000, pollIntervalMs: 2 },
    sharedMemory: true,
  },
};

/**
 * Returns a ready-made {@link AccessorOptions} template tuned for the given
 * {@link AccessorAggressiveness} level -- pass it straight to
 * {@link createAccessor}, or spread/extend it (e.g. to also set `idType`).
 */
export function createAccessorOptions(
  aggressiveness: AccessorAggressiveness = 1,
): AccessorOptions {
  const preset = AGGRESSIVENESS_PRESETS[aggressiveness];
  return {
    hostOptions: { ...preset.hostOptions },
    sharedMemory: preset.sharedMemory,
  };
}

/**
 * Restores an active {@link HostAccessor} from a previously saved {@link HostAccessorSession}.
 *
 * If `session.threadId` is recorded and that thread is still alive in the target process,
 * it attempts direct re-attachment (`idType: 'thread'`), resuming access in milliseconds
 * without re-racing thread candidates. If the thread died or is unavailable, it falls back
 * to process-wide attachment (`idType: 'processAllThreadIds'`).
 *
 * @param session Parsed session object.
 * @param overrideOptions Optional options to merge with or override the saved options.
 * @returns Initialized HostAccessor instance.
 */
export async function restoreAccessorFromSession(
  session: HostAccessorSession,
  overrideOptions: AccessorOptions = {},
): Promise<HostAccessor> {
  const baseOptions: AccessorOptions = {
    ...(session.options as AccessorOptions | undefined),
    ...overrideOptions,
  };

  const nthreadLayer = session.pipeline?.find((p) => p.type === 'NThread');
  if (nthreadLayer?.state && nthreadLayer.state.threadId) {
    try {
      const testThread = Thread.open(nthreadLayer.state.threadId);
      const isAlive = testThread.isValid() && testThread.getExitCode() === 259;
      testThread.close();

      if (isAlive) {
        const redirector = new RedirectorHostAccessor(session.processId);
        const nthread = new NThread(
          session.processId,
          nthreadLayer.state.threadId,
          (baseOptions.hostOptions as NThreadOptions) ?? {},
          redirector,
        );
        nthread.resumeFromHibernation(nthreadLayer.state as any);

        const accessor = new IndirectNThreadHostAccessor(nthread);
        redirector.target = accessor;

        const hasNShm =
          session.pipeline?.some((p) => p.type === 'NShm') ||
          baseOptions.sharedMemory;
        if (hasNShm) {
          accessor.backend = new (baseOptions.sharedMemoryMiddleware ?? NShm)(
            accessor.backend,
            accessor,
            baseOptions.sharedMemoryOptions,
          );
        }

        await accessor.init();

        const hasNJava =
          session.pipeline?.some((p) => p.type === 'NJavaAccessor') ||
          Boolean(baseOptions.njava);
        if (hasNJava) {
          await attachNJava(accessor);
        }

        (accessor as any)._options = baseOptions;
        if (session.metadata) {
          for (const [key, value] of Object.entries(session.metadata)) {
            accessor.setSessionMetadata(key, value);
          }
        }
        return accessor;
      }
    } catch {
      // Hibernated resume failed; fall through to normal reconnection
    }
  }

  let targetId = session.processId;
  let useThread = false;

  try {
    const threads = Thread.getThreads(session.processId);
    if (threads.length === 0) {
      throw new Error(
        `Cannot restore accessor: process ${session.processId} is not running (no threads found).`,
      );
    }
    if (
      session.threadId !== undefined &&
      threads.some((t) => t.tid === session.threadId)
    ) {
      targetId = session.threadId;
      useThread = true;
    }
  } catch (err: any) {
    if (err.message?.includes('Cannot restore accessor:')) {
      throw err;
    }
    // If thread snapshot query threw, fall back to process-level attach
  }

  const finalOptions: AccessorOptions = {
    ...baseOptions,
    idType: useThread
      ? 'thread'
      : (baseOptions.idType ?? 'processAllThreadIds'),
  };

  const accessor = await createAccessor(targetId, finalOptions);

  // Restore saved session metadata
  if (session.metadata) {
    for (const [key, value] of Object.entries(session.metadata)) {
      accessor.setSessionMetadata(key, value);
    }
  }

  return accessor;
}

/**
 * Convenience helper to restore an accessor directly from a saved JSON session file.
 *
 * @param filePath Path to the saved session JSON file.
 * @param overrideOptions Optional options to merge with or override the saved options.
 * @returns Initialized HostAccessor instance.
 */
export async function createAccessorFromFile(
  filePath: string,
  overrideOptions?: AccessorOptions,
): Promise<HostAccessor> {
  return await HostAccessor.restoreFromFile(filePath, overrideOptions);
}

// Register default restorers with HostAccessor
HostAccessor.registerRestorer(
  'IndirectNThreadHostAccessor',
  async (session, overrideOptions) => {
    return await restoreAccessorFromSession(session, overrideOptions);
  },
);

HostAccessor.registerRestorer('default', async (session, overrideOptions) => {
  return await restoreAccessorFromSession(session, overrideOptions);
});
