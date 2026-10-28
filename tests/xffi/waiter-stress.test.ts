import { expect, test, describe } from 'bun:test';
import { Kernel32Impl, waitAsync } from '../../packages/xffi/src/index.js';

function createEvent(initiallySignaled: boolean): bigint {
  return BigInt(Kernel32Impl.CreateEventA(0, 0, initiallySignaled ? 1 : 0, 0));
}

describe('xffi > waitAsync stress', () => {
  test('exhausts all 63 real slots and still services the 64th via the polling fallback', async () => {
    // Slot 0 is the wake event, so 63 real slots are available before the
    // shared table is full.
    const FILL = 63;
    const fillers = Array.from({ length: FILL }, () => createEvent(false));
    const fillerPromises = fillers.map((h) => waitAsync(h, 10000));

    // Give the worker a moment to pick all of them up.
    await new Promise((r) => setTimeout(r, 100));

    // The table should now be completely full -- this one must go through
    // waitAsyncPolling instead.
    const overflowHandle = createEvent(false);
    const start = performance.now();
    const overflowPromise = waitAsync(overflowHandle, 10000);
    await new Promise((r) => setTimeout(r, 100));
    Kernel32Impl.SetEvent(overflowHandle);
    const overflowOutcome = await overflowPromise;
    const overflowElapsed = performance.now() - start;

    expect(overflowOutcome).toBe('signaled');
    // Sanity: it actually took a real amount of time (not instant), proving
    // it didn't spuriously resolve immediately or hang.
    expect(overflowElapsed).toBeGreaterThanOrEqual(80);

    // Now drain the 63 fillers and confirm every single one still resolves
    // correctly via the real shared-table path, unaffected by the overflow.
    for (const h of fillers) Kernel32Impl.SetEvent(h);
    const fillerOutcomes = await Promise.all(fillerPromises);
    for (const outcome of fillerOutcomes) {
      expect(outcome).toBe('signaled');
    }

    for (const h of [...fillers, overflowHandle]) Kernel32Impl.CloseHandle(h);
  }, 30000);

  test('survives rapid-fire overlapping add/timeout/signal churn across many waves', async () => {
    const WAVES = 15;
    const PER_WAVE = 25;

    for (let wave = 0; wave < WAVES; wave++) {
      const handles = Array.from({ length: PER_WAVE }, () =>
        createEvent(false),
      );
      // Half get a short timeout (should time out, nothing ever signals
      // them), half get signaled almost immediately, all fired in the same
      // tick to maximize registration/eviction churn on the shared table.
      const promises = handles.map((h, i) =>
        i % 2 === 0 ? waitAsync(h, 40) : waitAsync(h, 5000),
      );
      for (let i = 0; i < handles.length; i++) {
        if (i % 2 === 1) Kernel32Impl.SetEvent(handles[i]!);
      }

      const outcomes = await Promise.all(promises);
      for (let i = 0; i < outcomes.length; i++) {
        if (i % 2 === 0) {
          expect(outcomes[i]).toBe('timeout');
        } else {
          expect(outcomes[i]).toBe('signaled');
        }
      }
      for (const h of handles) Kernel32Impl.CloseHandle(h);
    }
  }, 30000);

  test('an invalidated handle under an INFINITE wait is detected and reported as "error" without any timeout, and does not wedge other concurrent waits', async () => {
    // Exercises what used to be the known gap: WaitForMultipleObjects fails
    // the *entire* call if any one handle is invalid. Earlier versions of
    // this worker had no way to tell which one from that alone, so they
    // either spun forever (the very first version: a true busy-spin, since a
    // bad handle makes the call fail near-instantly instead of blocking --
    // which pegged a CPU core hard enough to starve this *same process*'s
    // main JS thread and hung this exact test for 4+ minutes) or could only
    // recover once the bad registration's own timeout fired. The current
    // worker isolates the bad handle itself, by bisecting the failing set
    // with more `WaitForMultipleObjects` calls (never any other Win32
    // function), and reports it as `'error'` directly -- so this uses an
    // INFINITE wait (`-1`) specifically to prove detection doesn't depend on
    // a timeout firing at all.
    //
    // A closed *real* handle is unsafe to use here: Windows/Wine recycle
    // closed handle numbers for the next allocation, so creating `good`
    // right after closing a real handle can silently hand back the exact
    // same numeric value -- which is what happened on the first attempt at
    // this test (the "bad" slot resolved "signaled" because it was, by the
    // time the wait actually ran, secretly the same handle as `good`).
    // A large, never-issued-by-the-kernel numeric value avoids that: it's
    // guaranteed invalid and guaranteed not to collide with a real handle
    // minted later in this test.
    const bad = 0x7fffffffdeadbeefn;

    const start = performance.now();
    const badPromise = waitAsync(bad, -1); // infinite -- must be caught with no timeout at all
    const good = createEvent(false);
    const goodPromise = waitAsync(good, 3000);

    // The good handle must still resolve correctly even while the bad one
    // is (transiently) wedging WaitForMultipleObjects's return value.
    await new Promise((r) => setTimeout(r, 100));
    Kernel32Impl.SetEvent(good);

    const [badOutcome, goodOutcome] = await Promise.all([
      badPromise,
      goodPromise,
    ]);
    const elapsed = performance.now() - start;

    expect(badOutcome).toBe('error');
    expect(goodOutcome).toBe('signaled');
    // Detected via bisection, not a timeout -- should resolve quickly, not
    // linger for anywhere near as long as a real-world timeout would.
    expect(elapsed).toBeLessThan(2000);

    Kernel32Impl.CloseHandle(good);
  }, 15000);

  test('bisection isolates multiple simultaneously-bad handles in one failed cycle', async () => {
    const bad1 = 0x7fffffffdeadbeefn;
    const bad2 = 0x7ffffffffeedfacen;
    const bad3 = 0x7ffffffff00dca7en;

    const goodHandles = Array.from({ length: 10 }, () => createEvent(false));

    const badPromises = [bad1, bad2, bad3].map((h) => waitAsync(h, -1));
    const goodPromises = goodHandles.map((h) => waitAsync(h, 3000));

    await new Promise((r) => setTimeout(r, 100));
    for (const h of goodHandles) Kernel32Impl.SetEvent(h);

    const badOutcomes = await Promise.all(badPromises);
    const goodOutcomes = await Promise.all(goodPromises);

    for (const outcome of badOutcomes) expect(outcome).toBe('error');
    for (const outcome of goodOutcomes) expect(outcome).toBe('signaled');

    for (const h of goodHandles) Kernel32Impl.CloseHandle(h);
  }, 15000);

  test('a lone bad handle (only the wake slot besides it) is isolated correctly, not misattributed to wake', async () => {
    // Deliberately registers *nothing else*: this is the one path through
    // `isolateAndEvictBadHandles` that isn't reached via a recursive
    // bisection call already confirmed by its parent -- with exactly one
    // real handle in the table, the top-level WAIT_FAILED handler calls
    // straight into the size-1 base case. Caught during review that this
    // base case originally trusted "it must be this handle, wake is never
    // closed" without re-verifying in isolation from the wake slot -- fixed
    // to always re-probe before condemning. This test is what would have
    // failed (by hanging or misreporting) had that fix not been made.
    const bad = 0x7ffffffff00dfeedn;
    const start = performance.now();
    const outcome = await waitAsync(bad, -1); // infinite, and nothing else registered
    const elapsed = performance.now() - start;

    expect(outcome).toBe('error');
    expect(elapsed).toBeLessThan(2000);
  }, 15000);

  test('an already-signaled handle sharing a failed bisection round with a bad handle is not silently lost', async () => {
    // Regression test for a real bug caught in review: bisection isolates a
    // bad handle by zero-timeout-probing halves of the failing set, and a
    // probe of a half that's *entirely valid* can itself succeed -- which,
    // for an auto-reset event that's already signaled, actually consumes
    // that signal (any successful wait on an auto-reset event resets it,
    // including a throwaway isolation probe). The original code treated any
    // non-WAIT_FAILED probe result as "nothing to do here, move on", so that
    // consumed signal was never reported anywhere -- this exact promise
    // would then hang forever, since the real signal had already been used
    // up by the probe itself and nothing else would ever fire it again.
    //
    // With exactly one bad and one good handle, bisecting a 2-element
    // failing set produces two single-element probes -- `good` is
    // guaranteed to be probed in complete isolation from `bad`.
    const bad = 0x7ffffffff00dacedn;
    const good = createEvent(true); // already signaled before either is registered

    const [badOutcome, goodOutcome] = await Promise.all([
      waitAsync(bad, -1),
      waitAsync(good, 3000),
    ]);

    expect(badOutcome).toBe('error');
    expect(goodOutcome).toBe('signaled');

    Kernel32Impl.CloseHandle(good);
  }, 15000);
});
