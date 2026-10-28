import { Kernel32Impl } from './win/kernel32.js';
import {
  MAX_WAIT_SLOTS,
  NO_DEADLINE,
  WAKE_SLOT,
  WAITER_SAB_BYTES,
  createWaiterTable,
  acquireWaiterLock,
  releaseWaiterLock,
  type WaiterTable,
} from './waiter-shared.js';

export type WaitOutcome = 'signaled' | 'timeout' | 'error';

const WAIT_OBJECT_0 = 0;
const WAIT_FAILED = 0xffffffff;

/**
 * A few immediate checks (no delay at all) before backing off -- catches a
 * handle that's already signaled, or signals within microseconds, without
 * ever touching a timer.
 */
const INSTANT_CHECKS = 3;

/** Poll interval never grows past this, once the backoff ramp reaches it. */
const MAX_POLL_INTERVAL_MS = 10;

function pollDelayMs(attempt: number): number {
  if (attempt < INSTANT_CHECKS) return 0;
  return Math.min(attempt - INSTANT_CHECKS + 1, MAX_POLL_INTERVAL_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The original non-blocking poll-loop implementation. Kept as a fallback for
 * the one case the shared-table/worker path below can't serve: more than
 * `MAX_WAIT_SLOTS - 1` waits already outstanding at once, since
 * `WaitForMultipleObjects` itself refuses more than 64 handles total (a hard
 * Windows limit, not something a bigger table works around).
 */
async function waitAsyncPolling(
  handle: bigint,
  timeoutMs: number,
): Promise<WaitOutcome> {
  const deadline = timeoutMs < 0 ? Infinity : performance.now() + timeoutMs;

  for (let attempt = 0; ; attempt++) {
    const result = Kernel32Impl.WaitForSingleObject(handle, 0);
    if (result === WAIT_OBJECT_0) return 'signaled';
    if (result === WAIT_FAILED) return 'error';
    if (performance.now() >= deadline) {
      return 'timeout';
    }
    const delay = pollDelayMs(attempt);
    if (delay > 0) {
      await sleep(delay);
    }
  }
}

interface PendingWait {
  resolve: (outcome: WaitOutcome) => void;
  generation: number;
}

/**
 * Everything the shared-table/worker path needs, bundled as one unit rather
 * than scattered module-level globals -- there is still exactly one
 * (lazily-created) instance per process, but every consumer receives it
 * explicitly instead of reading it back out of module state, so there's no
 * "is it initialized yet" non-null assertion anywhere.
 */
interface WaiterRuntime {
  readonly table: WaiterTable;
  readonly wakeHandle: bigint;
  readonly pending: (PendingWait | undefined)[];
}

function handleWorkerMessage(runtime: WaiterRuntime, e: MessageEvent): void {
  const { slot, generation, outcome } = e.data as {
    slot: number;
    generation: number;
    outcome: WaitOutcome;
  };
  const entry = runtime.pending[slot];
  if (!entry || entry.generation !== generation) return; // stale report
  runtime.pending[slot] = undefined;

  // Only now -- having definitively claimed this exact report -- release the
  // slot for reuse. This has to be the ONLY place `occupied` transitions
  // 1->0: the worker used to do it immediately after evicting, but that let
  // a fast-enough `waitAsync` reallocate the slot (bumping its generation)
  // before this report was ever delivered, so the generation check above
  // would then correctly -- but permanently -- discard it as stale,
  // orphaning the original call's promise forever. Reproduced both on a
  // real Windows machine and, rarely, under Wine, in
  // tests/xffi/waiter-stress.test.ts's churn test.
  acquireWaiterLock(runtime.table.lock);
  runtime.table.occupied[slot] = 0;
  releaseWaiterLock(runtime.table.lock);

  entry.resolve(outcome);
}

let runtimePromise: Promise<WaiterRuntime> | undefined;

/**
 * Lazily creates the shared table and spawns the worker, resolving once the
 * worker has actually entered its wait loop.
 *
 * The wake event is `SetEvent`d *before* the worker is spawned, so its very
 * first `WaitForMultipleObjects` call returns immediately (Win32 events
 * retain their signaled state until a wait consumes it -- there's no window
 * where this signal could be "missed" by starting the worker slightly late).
 * The worker's very first loop iteration -- having thus been kicked
 * immediately -- reports readiness back over the same message channel used
 * for real signals, which doubles as proof its `dlopen`-bound
 * `WaitForMultipleObjects` binding actually works, not just that message
 * passing does.
 */
function ensureStarted(): Promise<WaiterRuntime> {
  if (runtimePromise) return runtimePromise;

  const sab = new SharedArrayBuffer(WAITER_SAB_BYTES);
  const table = createWaiterTable(sab);
  const pending: (PendingWait | undefined)[] = new Array(MAX_WAIT_SLOTS);

  const wakeHandle = BigInt(Kernel32Impl.CreateEventA(0, 0, 0, 0));
  table.handles[WAKE_SLOT] = wakeHandle;
  table.occupied[WAKE_SLOT] = 1;
  table.deadline[WAKE_SLOT] = NO_DEADLINE;
  Kernel32Impl.SetEvent(wakeHandle);

  // `waiter-worker.ts` is bundled as its own standalone entry point (see
  // scripts/build.ts), so it exists as a sibling `.js` file next to whatever
  // this module itself was loaded as when running from `dist/` -- and as a
  // sibling `.ts` file when running live from `src/` (tests). Match whichever
  // extension this module was loaded with.
  const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const w = new Worker(new URL(`./waiter-worker${ext}`, import.meta.url).href);
  (w as any).unref?.();

  const runtime: WaiterRuntime = { table, wakeHandle, pending };

  runtimePromise = new Promise<WaiterRuntime>((resolveReady) => {
    w.onmessage = (e: MessageEvent) => {
      if ((e.data as { type?: string }).type === 'ready') {
        w.onmessage = (msg: MessageEvent) => handleWorkerMessage(runtime, msg);
        resolveReady(runtime);
        return;
      }
    };
  });
  w.postMessage({ sab });

  return runtimePromise;
}

function findFreeSlot(t: WaiterTable): number {
  for (let i = WAKE_SLOT + 1; i < MAX_WAIT_SLOTS; i++) {
    if (t.occupied[i] === 0) return i;
  }
  return -1;
}

/**
 * Waits for `handle` to signal, or `timeoutMs` to elapse (pass a negative
 * number for an infinite wait), without blocking this thread.
 *
 * Backed by a dedicated worker that runs a single `WaitForMultipleObjects`
 * loop (a real OS wait, not a poll) over a table of handles shared with this
 * thread via a `SharedArrayBuffer`. Registering a new wait writes the handle
 * *and its absolute deadline* into a free slot and `SetEvent`s a reserved
 * wake handle (slot 0), which kicks the worker's blocking call so it picks
 * up the updated table. The worker itself derives its `WaitForMultipleObjects`
 * timeout from the nearest deadline across all occupied slots and reports
 * back one of three outcomes per slot -- `'signaled'`, `'timeout'`, or
 * `'error'` (the handle became invalid, isolated via bisecting repeated
 * `WaitForMultipleObjects` calls -- see `waiter-worker.ts`) -- which this
 * resolves that slot's promise with. Because the kernel enforces the
 * timeout, not a JS timer on either thread, it can't be delayed by either
 * thread being busy. A per-slot generation counter guards against a stale
 * report (e.g. for a slot since reallocated) resolving the wrong caller.
 *
 * Falls back to the old non-blocking `WaitForSingleObject(handle, 0)` poll
 * loop when the shared table is full (`WaitForMultipleObjects` itself caps
 * out at 64 handles) -- see `waitAsyncPolling`.
 */
export async function waitAsync(
  handle: bigint,
  timeoutMs: number,
): Promise<WaitOutcome> {
  const { table, wakeHandle, pending } = await ensureStarted();

  acquireWaiterLock(table.lock);
  const slot = findFreeSlot(table);
  if (slot === -1) {
    releaseWaiterLock(table.lock);
    return waitAsyncPolling(handle, timeoutMs);
  }
  table.occupied[slot] = 1;
  table.handles[slot] = handle;
  table.deadline[slot] = timeoutMs >= 0 ? Date.now() + timeoutMs : NO_DEADLINE;
  const generation = (table.generation[slot] =
    (table.generation[slot]! + 1) >>> 0);
  releaseWaiterLock(table.lock);

  Kernel32Impl.SetEvent(wakeHandle);

  return new Promise<WaitOutcome>((resolve) => {
    pending[slot] = { resolve, generation };
  });
}
