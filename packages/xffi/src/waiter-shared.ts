/**
 * Shared-memory layout for the `waitAsync` handle table, used by both the
 * main thread (`waiter.ts`) and the dedicated wait worker (`waiter-worker.ts`).
 * Both sides construct independent typed-array views over the *same*
 * `SharedArrayBuffer`, so writes on one side are visible to the other without
 * any message round-trip.
 *
 * Slot 0 is permanently reserved for a wake event: the main thread `SetEvent`s
 * it whenever it changes the table, which kicks the worker's blocking
 * `WaitForMultipleObjects` call so it re-reads the table and re-waits on the
 * updated handle set.
 *
 * Capacity is capped at `MAX_WAIT_SLOTS` (64) because `WaitForMultipleObjects`
 * itself refuses more than `MAXIMUM_WAIT_OBJECTS` (64) handles in one call --
 * this is a hard Windows limit, not a design choice. Callers that would
 * exceed it (63 real waits already outstanding, since slot 0 is the wake
 * event) fall back to plain polling for that one call -- see `waiter.ts`.
 */

export const MAX_WAIT_SLOTS = 64;
export const WAKE_SLOT = 0;

const HEADER_BYTES = 8; // lock (4 bytes) + padding, so handles start 8-byte aligned
const HANDLES_BYTES = MAX_WAIT_SLOTS * 8;
const OCCUPIED_BYTES = MAX_WAIT_SLOTS * 4;
const GENERATION_BYTES = MAX_WAIT_SLOTS * 4;
const DEADLINE_BYTES = MAX_WAIT_SLOTS * 8;

export const WAITER_SAB_BYTES =
  HEADER_BYTES +
  HANDLES_BYTES +
  OCCUPIED_BYTES +
  GENERATION_BYTES +
  DEADLINE_BYTES;

/** Sentinel `deadline` value meaning "no timeout -- wait forever". */
export const NO_DEADLINE = Infinity;

export interface WaiterTable {
  /** 1-element spinlock guarding `handles`/`occupied`/`generation`/`deadline`. */
  readonly lock: Int32Array;
  /** HANDLE value per slot. */
  readonly handles: BigUint64Array;
  /** 1 if the slot currently holds a live wait, 0 if free. */
  readonly occupied: Int32Array;
  /**
   * Bumped every time a slot is (re)allocated or forcibly freed. Lets a
   * late/stale report from the worker for a since-reused slot be detected
   * and ignored instead of resolving the wrong caller's promise.
   */
  readonly generation: Uint32Array;
  /**
   * Absolute `Date.now()`-based deadline for the slot, or `NO_DEADLINE`.
   * The worker computes its `WaitForMultipleObjects` timeout from the
   * nearest deadline across all occupied slots -- a real kernel-enforced
   * timeout, not a JS timer on either thread, so it can't be delayed by the
   * main thread being busy (or, symmetrically, by the worker being busy).
   */
  readonly deadline: Float64Array;
}

export function createWaiterTable(sab: SharedArrayBuffer): WaiterTable {
  return {
    lock: new Int32Array(sab, 0, 1),
    handles: new BigUint64Array(sab, HEADER_BYTES, MAX_WAIT_SLOTS),
    occupied: new Int32Array(sab, HEADER_BYTES + HANDLES_BYTES, MAX_WAIT_SLOTS),
    generation: new Uint32Array(
      sab,
      HEADER_BYTES + HANDLES_BYTES + OCCUPIED_BYTES,
      MAX_WAIT_SLOTS,
    ),
    deadline: new Float64Array(
      sab,
      HEADER_BYTES + HANDLES_BYTES + OCCUPIED_BYTES + GENERATION_BYTES,
      MAX_WAIT_SLOTS,
    ),
  };
}

/**
 * Busy-spin CAS lock. Critical sections guarded by this are always a handful
 * of typed-array writes (never a syscall), so contention windows are on the
 * order of nanoseconds -- not worth the complexity of `Atomics.wait`, which
 * is also disallowed on a JS main thread in the first place.
 */
export function acquireWaiterLock(lock: Int32Array): void {
  while (Atomics.compareExchange(lock, 0, 0, 1) !== 0) {
    // spin
  }
}

export function releaseWaiterLock(lock: Int32Array): void {
  Atomics.store(lock, 0, 0);
}
