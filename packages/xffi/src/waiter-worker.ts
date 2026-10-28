/**
 * Dedicated background worker for `waitAsync` (see `waiter.ts`). Runs a
 * single `WaitForMultipleObjects` loop over the shared handle table -- a
 * real OS wait, not a poll -- and reports back one of three outcomes per
 * slot: `'signaled'`, `'timeout'`, or `'error'`. See `waiter-shared.ts` for
 * the table layout and the wake-slot protocol.
 *
 * Timeouts are enforced by the kernel, not a JS timer: each occupied slot
 * carries an absolute deadline in the shared table, and every loop iteration
 * passes `WaitForMultipleObjects` the number of milliseconds until the
 * *nearest* one (or `INFINITE` if none have one). This is deliberately not a
 * JS `setTimeout` on the main thread -- a real Windows kernel wait timeout
 * can't be delayed by either thread being busy, whereas a JS timer can (see
 * the bisection comment below for exactly how that bit us).
 *
 * Deliberately self-contained: no imports from the rest of the package, just
 * `bun:ffi`'s own `dlopen` against `kernel32.dll` directly for the one
 * symbol this needs (`kernel32.dll` is always loaded in every Windows
 * process, so a plain `dlopen` resolves it with no compile step at all --
 * faster to start than routing through the rest of the package's
 * `cimport`/TCC machinery, which exists to solve linker issues for arbitrary
 * DLLs that don't apply here). This file is bundled as its own `bun build`
 * entry point (see `scripts/build.ts`) so it can be loaded standalone via
 * `new Worker(...)`, independent of whether the rest of the package is
 * running from `dist/` (bundled) or live `src/` (tests).
 */
declare const self: Worker;

import { dlopen, FFIType } from 'bun:ffi';
import {
  MAX_WAIT_SLOTS,
  NO_DEADLINE,
  WAKE_SLOT,
  createWaiterTable,
  acquireWaiterLock,
  releaseWaiterLock,
  type WaiterTable,
} from './waiter-shared.js';

const { symbols } = dlopen('kernel32.dll', {
  WaitForMultipleObjects: {
    args: [FFIType.u32, FFIType.ptr, FFIType.i32, FFIType.u32],
    returns: FFIType.u32,
  },
});

function waitForMultipleObjects(
  handles: BigUint64Array,
  timeoutMs: number,
): number {
  return Number(
    symbols.WaitForMultipleObjects(handles.length, handles, 0, timeoutMs),
  );
}

const WAIT_OBJECT_0 = 0;
const WAIT_TIMEOUT = 258;
const WAIT_FAILED = 0xffffffff;
/** DWORD max minus one -- reserve the literal `INFINITE` bit pattern for "no timeout". */
const MAX_FINITE_TIMEOUT_MS = 0xfffffffe;
/**
 * Upper bound on any single `WaitForMultipleObjects` call this worker makes.
 * Deliberately never passes literal `INFINITE`, and never waits past this
 * even for a real, farther-out deadline -- see the timeoutMs comment below.
 */
const SELF_HEAL_INTERVAL_MS = 2000;

type Outcome = 'signaled' | 'timeout' | 'error';

/**
 * Tracks, per slot, the generation this worker has already sent a report
 * for but the main thread hasn't yet acknowledged (by clearing `occupied`).
 * -1 means "nothing outstanding". Purely local to this worker -- not part
 * of the shared table.
 *
 * This worker does NOT clear `table.occupied` itself (see `reportOutcome`
 * for why); until the main thread does, the same fired/expired/invalid slot
 * would otherwise be rediscovered and re-reported on every subsequent loop
 * iteration. Safe either way (the main thread's generation check drops
 * duplicates), but wasteful -- this skips re-sending a report for a
 * generation already sent, without needing to touch the shared table to do
 * it.
 */
const lastReportedGeneration = new Int32Array(MAX_WAIT_SLOTS).fill(-1);

/**
 * Reports `outcome` for `slot` to the main thread, once per generation.
 *
 * Deliberately does NOT clear `table.occupied[slot]` -- only the main
 * thread does that, and only after it has actually claimed this exact
 * report (see `handleWorkerMessage` in `waiter.ts`). Freeing it here used to
 * be this worker's job, and it was a real, reproduced bug: the main thread
 * could reallocate a just-freed slot (a brand new `waitAsync` call bumping
 * its generation) *before* this report was delivered and processed, and the
 * generation check would then correctly -- but permanently -- discard the
 * report as stale, silently orphaning the original call's promise forever
 * (reproduced both on a real Windows machine and, rarely, under Wine, in
 * `tests/xffi/waiter-stress.test.ts`'s churn test -- a slot cycling through
 * 3 generations within a few milliseconds, two of whose reports arrived
 * only after the main thread had already moved on). Only the side that
 * *consumes* a report can safely be the one to free the slot for reuse.
 */
function reportOutcome(
  table: WaiterTable,
  slot: number,
  outcome: Outcome,
): void {
  acquireWaiterLock(table.lock);
  const generation = table.generation[slot]!;
  const stillOccupied = table.occupied[slot] === 1;
  releaseWaiterLock(table.lock);

  if (!stillOccupied || lastReportedGeneration[slot] === generation) return;
  lastReportedGeneration[slot] = generation;
  postMessage({ slot, generation, outcome });
}

/**
 * `WaitForMultipleObjects` fails the *entire* call if even one handle in the
 * array is invalid (e.g. its owning process/thread already exited) -- it
 * never blocks, and never says which one. There's no secondary Win32 call
 * used here to ask "which handle is bad" (this worker only ever calls
 * `WaitForMultipleObjects`) -- instead this bisects the failing set with
 * more calls to that same function: split it in half, zero-timeout-probe
 * each half, and recurse into whichever half also fails. A half that
 * *succeeds* (signals or times out) is provably all-valid, so the recursion
 * only ever descends into genuinely bad territory -- O(log n) calls to
 * fully isolate every bad handle in an n-entry set, using nothing but
 * `WaitForMultipleObjects` itself.
 *
 * This is what makes the WAIT_FAILED path self-terminating: every call to
 * this function evicts at least one bad slot (`slots.length >= 1` and
 * `WaitForMultipleObjects` just failed on it, so isolation always finds
 * something), which is what a naive "just retry" loop can't guarantee --
 * that version pegged a CPU core busy-spinning on a bad handle it could
 * never identify or remove.
 */
function isolateAndEvictBadHandles(
  table: WaiterTable,
  slots: number[],
  handles: BigUint64Array,
): void {
  if (slots.length === 1) {
    // Recursive callers only ever reach here after their own probe of this
    // exact single-element array already returned WAIT_FAILED, so this is
    // redundant for them -- but the *top-level* call from `loop()` can also
    // land here directly (exactly one real handle currently registered),
    // where it would NOT otherwise be re-verified in isolation from the wake
    // slot. Always confirm right before condemning a handle rather than
    // assuming "it must be this one, the wake slot is never closed" --
    // that assumption happens to hold given this file never closes the wake
    // handle, but a caller reporting a valid handle as `'error'` on an
    // unverified assumption is exactly the kind of bug that's cheap to just
    // not have.
    if (waitForMultipleObjects(handles, 0) === WAIT_FAILED) {
      reportOutcome(table, slots[0]!, 'error');
    }
    return;
  }
  const mid = slots.length >> 1;
  const halves: [number[], BigUint64Array][] = [
    [slots.slice(0, mid), handles.slice(0, mid)],
    [slots.slice(mid), handles.slice(mid)],
  ];
  for (const [halfSlots, halfHandles] of halves) {
    const probe = waitForMultipleObjects(halfHandles, 0);
    if (probe === WAIT_FAILED) {
      isolateAndEvictBadHandles(table, halfSlots, halfHandles);
      continue;
    }
    if (probe === WAIT_TIMEOUT) continue; // every handle in this half is valid, nothing signaled
    // A real signal: this half is all-valid, so no need to recurse -- but
    // this probe call itself just consumed it (auto-reset events reset on
    // any successful wait, including a throwaway 0ms probe like this one).
    // Silently moving on here was a real bug: the signal would never be
    // seen again, permanently orphaning that slot's promise. Report it
    // through the same path a normal full-array wait would have.
    const idx = probe - WAIT_OBJECT_0;
    if (idx >= 0 && idx < halfSlots.length) {
      reportOutcome(table, halfSlots[idx]!, 'signaled');
    }
  }
}

function loop(table: WaiterTable): void {
  // The caller pre-signals the wake slot (slot 0) before spawning this
  // worker, so the very first `WaitForMultipleObjects` below returns
  // immediately -- that's our cue to report readiness. This piggybacks on
  // the exact same wake mechanism used for every later table update rather
  // than needing a separate handshake message, and it proves more than "the
  // worker received a message" would: that the `dlopen`-bound
  // `WaitForMultipleObjects` actually works in this worker.
  let reportedReady = false;

  for (;;) {
    const waitSlots: number[] = [];
    let nearestDeadline = NO_DEADLINE;
    acquireWaiterLock(table.lock);
    for (let i = 0; i < MAX_WAIT_SLOTS; i++) {
      if (i === WAKE_SLOT || table.occupied[i] === 1) {
        waitSlots.push(i);
        if (i !== WAKE_SLOT && table.deadline[i]! < nearestDeadline) {
          nearestDeadline = table.deadline[i]!;
        }
      }
    }
    const handles = new BigUint64Array(waitSlots.length);
    for (let i = 0; i < waitSlots.length; i++) {
      handles[i] = table.handles[waitSlots[i]!]!;
    }
    releaseWaiterLock(table.lock);

    // Never actually pass literal INFINITE, and never wait longer than
    // SELF_HEAL_INTERVAL_MS even when a real deadline is further out --
    // this is a deliberate safety net, not just an optimization. This
    // worker has to be right about picking up every table change via the
    // wake slot; a periodic self-heal re-scan bounds the damage of any
    // as-yet-unidentified missed-wake race (one was empirically caught,
    // rarely, under Wine -- see the WAIT_TIMEOUT comment two lines below and
    // `tests/xffi/waiter-stress.test.ts`) to a bounded delay instead of a
    // permanent hang, without needing to first prove the exact mechanism.
    const timeoutMs =
      nearestDeadline === NO_DEADLINE
        ? SELF_HEAL_INTERVAL_MS
        : Math.min(
            Math.max(0, Math.ceil(nearestDeadline - Date.now())),
            MAX_FINITE_TIMEOUT_MS,
            SELF_HEAL_INTERVAL_MS,
          );

    const result = waitForMultipleObjects(handles, timeoutMs);

    if (!reportedReady) {
      reportedReady = true;
      postMessage({ type: 'ready' });
    }

    if (result === WAIT_FAILED) {
      // Wake (slot 0) is only ever touched by the main thread via `SetEvent`
      // and is never closed, so it's never the culprit -- exclude it from
      // isolation. Filtered from the snapshot already taken above (not a
      // fresh, lock-free read of the live table).
      const realSlots: number[] = [];
      const realHandleValues: bigint[] = [];
      for (let i = 0; i < waitSlots.length; i++) {
        if (waitSlots[i] === WAKE_SLOT) continue;
        realSlots.push(waitSlots[i]!);
        realHandleValues.push(handles[i]!);
      }
      if (realSlots.length > 0) {
        isolateAndEvictBadHandles(
          table,
          realSlots,
          BigUint64Array.from(realHandleValues),
        );
      }
      continue;
    }

    if (result === WAIT_TIMEOUT) {
      // Our computed timeout was tied to whichever slot's deadline was
      // nearest; re-check all occupied slots (not just that one -- more than
      // one can share a deadline) against the current time and evict every
      // one that's actually due. It's possible none technically are yet
      // (rounding) -- the next loop iteration just recomputes and waits the
      // remainder.
      const now = Date.now();
      acquireWaiterLock(table.lock);
      const due: number[] = [];
      for (const slot of waitSlots) {
        if (slot === WAKE_SLOT) continue;
        if (table.occupied[slot] === 1 && table.deadline[slot]! <= now) {
          due.push(slot);
        }
      }
      releaseWaiterLock(table.lock);
      for (const slot of due) reportOutcome(table, slot, 'timeout');
      continue;
    }

    const idx = result - WAIT_OBJECT_0;
    if (idx < 0 || idx >= waitSlots.length) continue; // shouldn't happen, defensive
    const slot = waitSlots[idx]!;
    if (slot === WAKE_SLOT) continue; // table changed -- re-snapshot and re-wait

    reportOutcome(table, slot, 'signaled');
  }
}

self.onmessage = (e: MessageEvent<{ sab: SharedArrayBuffer }>) => {
  loop(createWaiterTable(e.data.sab));
};
