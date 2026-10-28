import type { CpuStepResult } from './types.js';
import type { Win64Thread } from './win64-machine.js';

/**
 * Runaway protection for a single pump.
 *
 * Not a simulated clock or CPU frequency -- instructions still execute as
 * fast as the host can step them. This only keeps a pump from spinning
 * forever across a set of guest threads that never exit or enter a wait.
 */
const MAX_PUMP_STEPS = 1_000_000;

interface TimerWaiter {
  readonly thread: Win64Thread;
  readonly fireAtTick: number;
}

/**
 * Cooperative run-to-block scheduler shared by every kernel wait primitive
 * (WaitForSingleObject, blocking pipe/console reads, Sleep, process/thread
 * completion). A thread runs at full speed until it blocks, faults or
 * terminates; the scheduler then picks the next runnable thread. Threads
 * never share a JS call stack frame the way nested CreateProcessA execution
 * used to -- each gets its own turn through the ready queue.
 */
export class Scheduler {
  private readonly ready: Win64Thread[] = [];
  private readonly objectWaiters = new Map<number, Set<Win64Thread>>();
  private readonly timerWaiters: TimerWaiter[] = [];
  private clockTicks = 0;

  /**
   * Marks a thread runnable, removing it from any wait set it was parked in.
   * A no-op while the thread's suspend count is nonzero (`CREATE_SUSPENDED`,
   * `SuspendThread`) -- it stays out of the ready queue until `ResumeThread`
   * brings the count back to zero and enqueues it itself.
   */
  public enqueue(thread: Win64Thread): void {
    if (thread.state === 'terminated' || thread.suspendCount > 0) return;
    this.removeFromWaitSets(thread);
    if (!this.ready.includes(thread)) this.ready.push(thread);
  }

  /** Parks a thread until `signalObject` is called for this object id. */
  public blockOnObject(thread: Win64Thread, objectId: number): void {
    this.removeFromReady(thread);
    let waiters = this.objectWaiters.get(objectId);
    if (!waiters) {
      waiters = new Set();
      this.objectWaiters.set(objectId, waiters);
    }
    waiters.add(thread);
  }

  /** Parks a thread on the virtual clock; woken once `delayMs` has elapsed. */
  public blockOnTimer(thread: Win64Thread, delayMs: number): void {
    this.removeFromReady(thread);
    this.timerWaiters.push({
      thread,
      fireAtTick: this.clockTicks + Math.max(0, delayMs),
    });
  }

  /** Wakes every thread parked on this object id. */
  public signalObject(objectId: number): void {
    const waiters = this.objectWaiters.get(objectId);
    if (!waiters || waiters.size === 0) return;
    const woken = [...waiters];
    waiters.clear();
    for (const thread of woken) {
      thread.state = 'stopped';
      this.enqueue(thread);
    }
  }

  /** Removes a thread from every queue -- used once it has terminated. */
  public retire(thread: Win64Thread): void {
    this.removeFromReady(thread);
    this.removeFromWaitSets(thread);
  }

  /**
   * Runs every ready thread to its next block/fault/terminate point,
   * fast-forwarding the virtual clock across idle stretches so `Sleep`
   * doesn't cost real wall-clock time, until nothing is runnable and no
   * timer remains pending.
   *
   * `onThreadSettled` fires once per thread right after it stops running
   * (blocked, faulted or terminated) so the caller can finalize kernel-level
   * bookkeeping (exit codes, signaling waiters) before the next thread runs.
   * `onStep`, if given, fires after every single instruction across every
   * thread stepped during this pump -- e.g. so a caller can collect a trace
   * across however many processes this pump ends up touching.
   */
  public pumpToQuiescence(
    onThreadSettled: (thread: Win64Thread) => void,
    onStep?: (thread: Win64Thread, result: CpuStepResult) => void,
  ): void {
    let totalSteps = 0;
    for (;;) {
      const thread = this.ready.shift();
      if (thread) {
        while (thread.state === 'stopped') {
          const result = thread.step();
          onStep?.(thread, result);
          totalSteps += 1;
          if (result.reason === 'fault') {
            throw result.error ?? new Error(`Thread ${thread.tid} faulted`);
          }
          if (totalSteps > MAX_PUMP_STEPS) {
            throw new Error(
              `Scheduler exceeded ${MAX_PUMP_STEPS} instructions without settling`,
            );
          }
        }
        onThreadSettled(thread);
        continue;
      }

      const next = this.earliestTimer();
      if (!next) return;
      this.clockTicks = next.fireAtTick;
      this.wakeDueTimers();
    }
  }

  private earliestTimer(): TimerWaiter | undefined {
    let earliest: TimerWaiter | undefined;
    for (const waiter of this.timerWaiters) {
      if (!earliest || waiter.fireAtTick < earliest.fireAtTick) {
        earliest = waiter;
      }
    }
    return earliest;
  }

  private wakeDueTimers(): void {
    for (let index = this.timerWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.timerWaiters[index]!;
      if (waiter.fireAtTick > this.clockTicks) continue;
      this.timerWaiters.splice(index, 1);
      waiter.thread.state = 'stopped';
      this.enqueue(waiter.thread);
    }
  }

  private removeFromReady(thread: Win64Thread): void {
    const index = this.ready.indexOf(thread);
    if (index !== -1) this.ready.splice(index, 1);
  }

  private removeFromWaitSets(thread: Win64Thread): void {
    for (const waiters of this.objectWaiters.values()) waiters.delete(thread);
    for (let index = this.timerWaiters.length - 1; index >= 0; index -= 1) {
      if (this.timerWaiters[index]!.thread === thread) {
        this.timerWaiters.splice(index, 1);
      }
    }
  }

  /** The kernel object id `thread` is currently parked on via `blockOnObject`, if any -- used by `Win64Machine.getSnapshotWarnings()` to flag in-flight background operations. */
  public findWaitedObjectId(thread: Win64Thread): number | undefined {
    for (const [objectId, waiters] of this.objectWaiters) {
      if (waiters.has(thread)) return objectId;
    }
    return undefined;
  }

  public snapshotState(): SchedulerSnapshot {
    const ref = (thread: Win64Thread): readonly [pid: number, tid: number] => [
      thread.process.pid,
      thread.tid,
    ];
    return {
      ready: this.ready.map(ref),
      objectWaiters: [...this.objectWaiters.entries()].map(
        ([objectId, waiters]) => [objectId, [...waiters].map(ref)],
      ),
      timerWaiters: this.timerWaiters.map((waiter) => ({
        pid: waiter.thread.process.pid,
        tid: waiter.thread.tid,
        fireAtTick: waiter.fireAtTick,
      })),
      clockTicks: this.clockTicks,
    };
  }

  /** Re-links every `(pid,tid)` reference back to a live `Win64Thread` via `resolve`; a dangling reference (thread missing from the restored process graph) is dropped with a warning rather than throwing. */
  public restoreState(
    snapshot: SchedulerSnapshot,
    resolve: (pid: number, tid: number) => Win64Thread | undefined,
  ): void {
    this.ready.length = 0;
    this.objectWaiters.clear();
    this.timerWaiters.length = 0;

    const link = (pid: number, tid: number): Win64Thread | undefined => {
      const thread = resolve(pid, tid);
      if (!thread)
        console.warn(
          `vm-snapshot: dangling scheduler thread reference (${pid}:${tid}).`,
        );
      return thread;
    };

    for (const [pid, tid] of snapshot.ready) {
      const thread = link(pid, tid);
      if (thread) this.ready.push(thread);
    }
    for (const [objectId, waiters] of snapshot.objectWaiters) {
      const set = new Set<Win64Thread>();
      for (const [pid, tid] of waiters) {
        const thread = link(pid, tid);
        if (thread) set.add(thread);
      }
      this.objectWaiters.set(objectId, set);
    }
    for (const waiter of snapshot.timerWaiters) {
      const thread = link(waiter.pid, waiter.tid);
      if (thread)
        this.timerWaiters.push({ thread, fireAtTick: waiter.fireAtTick });
    }
    this.clockTicks = snapshot.clockTicks;
  }
}

export interface SchedulerSnapshot {
  readonly ready: readonly (readonly [pid: number, tid: number])[];
  readonly objectWaiters: readonly (readonly [
    objectId: number,
    waiters: readonly (readonly [pid: number, tid: number])[],
  ])[];
  readonly timerWaiters: readonly {
    readonly pid: number;
    readonly tid: number;
    readonly fireAtTick: number;
  }[];
  readonly clockTicks: number;
}
