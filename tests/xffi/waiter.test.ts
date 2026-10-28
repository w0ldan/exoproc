import { expect, test, describe } from 'bun:test';
import { Kernel32Impl, waitAsync } from '../../packages/xffi/src/index.js';

function createEvent(initiallySignaled: boolean): bigint {
  return BigInt(Kernel32Impl.CreateEventA(0, 0, initiallySignaled ? 1 : 0, 0));
}

describe('xffi > waitAsync', () => {
  test('resolves "signaled" immediately for an already-signaled handle', async () => {
    const handle = createEvent(true);
    const outcome = await waitAsync(handle, 2000);
    expect(outcome).toBe('signaled');
    Kernel32Impl.CloseHandle(handle);
  });

  test('resolves "signaled" once the handle is signaled after a delay', async () => {
    const handle = createEvent(false);
    const promise = waitAsync(handle, 5000);
    await new Promise((r) => setTimeout(r, 150));
    Kernel32Impl.SetEvent(handle);
    const outcome = await promise;
    expect(outcome).toBe('signaled');
    Kernel32Impl.CloseHandle(handle);
  });

  test('resolves "timeout" when nothing signals within timeoutMs', async () => {
    const handle = createEvent(false);
    const start = performance.now();
    const outcome = await waitAsync(handle, 200);
    const elapsed = performance.now() - start;
    expect(outcome).toBe('timeout');
    expect(elapsed).toBeGreaterThanOrEqual(150);
    Kernel32Impl.CloseHandle(handle);
  });

  test('a handle that is never signaled does not block other concurrent waits from timing out', async () => {
    const stuck = createEvent(false);
    const other = createEvent(false);
    const stuckPromise = waitAsync(stuck, 5000);
    const otherPromise = waitAsync(other, 150);
    expect(await otherPromise).toBe('timeout');
    Kernel32Impl.SetEvent(stuck);
    expect(await stuckPromise).toBe('signaled');
    Kernel32Impl.CloseHandle(stuck);
    Kernel32Impl.CloseHandle(other);
  });

  test('supports many concurrent waits and resolves each against the right handle', async () => {
    const COUNT = 20;
    const handles = Array.from({ length: COUNT }, () => createEvent(false));
    const promises = handles.map((h) => waitAsync(h, 5000));

    // Signal them out of order to make sure reports aren't mixed up between
    // slots.
    const signalOrder = [...handles.keys()].sort(() => Math.random() - 0.5);
    for (const i of signalOrder) {
      Kernel32Impl.SetEvent(handles[i]!);
      await new Promise((r) => setTimeout(r, 5));
    }

    const outcomes = await Promise.all(promises);
    for (const outcome of outcomes) {
      expect(outcome).toBe('signaled');
    }
    for (const h of handles) Kernel32Impl.CloseHandle(h);
  });

  test('a timed-out slot can be immediately reused by a new wait without cross-talk', async () => {
    const first = createEvent(false);
    const outcome1 = await waitAsync(first, 100);
    expect(outcome1).toBe('timeout');

    const second = createEvent(false);
    const promise2 = waitAsync(second, 3000);
    await new Promise((r) => setTimeout(r, 50));
    Kernel32Impl.SetEvent(second);
    expect(await promise2).toBe('signaled');

    // The first handle must still be unsignaled -- if the worker's stale
    // report for it had been mis-delivered to slot 2's new occupant, this
    // wouldn't necessarily be caught, so also assert it directly.
    expect(Kernel32Impl.WaitForSingleObject(first, 0)).not.toBe(0);

    Kernel32Impl.CloseHandle(first);
    Kernel32Impl.CloseHandle(second);
  });
});
