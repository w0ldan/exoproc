import { expect, test, describe } from 'bun:test';
import * as Native from 'bun-winapi';
import {
  RemoteCallableMemoryAccessor,
  Kernel32Impl,
  CrtImpl,
  cmachinecode,
} from 'bun-xffi';
import {
  RedirectorHostAccessor,
  IndirectNThreadHostAccessor,
} from 'exoproc-accessors';

// Compiled once at module load; reused across tests.
const sum8f = cmachinecode({
  returns: 'f32',
  args: ['f32', 'f32', 'f32', 'f32', 'f32', 'f32', 'f32', 'f32'],
  source: `return arg0 + arg1 + arg2 + arg3 + arg4 + arg5 + arg6 + arg7;`,
});
import {
  NThread,
  getRandomSpinStub,
  getRandomPushretStub,
  getRandomJumpStub,
  getRandomRetStub,
  getRandomAddRsp28RetStub,
} from 'bun-nthread';
import { getGlobalDummyProcess } from 'exoproc-dummy';

describe('NThread Integration with Indirect Accessor', () => {
  test('inject and perform indirect operations', async () => {
    const proc = getGlobalDummyProcess();
    const thread = Native.Thread.getThreads(proc.pid)[0]; // Get the first thread of the spawned process
    if (!thread) {
      throw new Error('No thread found in the spawned process');
    }

    const pid = proc.pid;
    const tid = thread.tid;

    console.log(`Spawned process PID: ${pid}, Thread TID: ${tid}`);

    const redirector = new RedirectorHostAccessor(pid);
    const nthread = new NThread(
      new RemoteCallableMemoryAccessor(pid),
      tid,
      { timeoutMs: 20000 },
      redirector,
    );
    const indirect = new IndirectNThreadHostAccessor(nthread);
    expect(indirect).toBeDefined();
    redirector.target = indirect;

    indirect.enableDebug();

    // Test a simple direct call on the hijacked thread
    const remoteTid = await indirect.call(Kernel32Impl.GetCurrentThreadId);
    expect(Number(remoteTid)).toBe(tid);

    // Test float (f32) arg and return: sinf(0) === 0, sinf(π/2) ≈ 1
    const sinf0 = await indirect.call(CrtImpl.sinf, 0.0);
    expect(sinf0).toBeCloseTo(0.0, 5);

    const halfPiF = Math.fround(Math.PI / 2);
    const sinf90 = await indirect.call(CrtImpl.sinf, halfPiF);
    expect(sinf90 as number).toBeCloseTo(1.0, 5);

    // Test double (f64) arg and return: sin(0) === 0, sqrt(4.0) === 2.0
    const sin0 = await indirect.call(CrtImpl.sin, 0.0);
    expect(sin0 as number).toBeCloseTo(0.0, 10);

    const sqrt4 = await indirect.call(CrtImpl.sqrt, 4.0);
    expect(sqrt4 as number).toBeCloseTo(2.0, 10);

    // Test 8 float args: 4 via XMM registers (args 1-4) + 4 via stack (args 5-8)
    // Non-integer values catch bit-cast bugs that integers would mask.
    // All values are exact float32 (multiples of 0.5), so sum = 40.0 exactly.
    const sum = await indirect.call(
      sum8f,
      1.5,
      2.5,
      3.5,
      4.5,
      5.5,
      6.5,
      7.5,
      8.0,
    );
    expect(sum as number).toBeCloseTo(39.5, 4);

    await indirect.close();
  });

  test('callSync performs the same redirection synchronously, no await', async () => {
    const proc = getGlobalDummyProcess();
    const thread = Native.Thread.getThreads(proc.pid)[0];
    if (!thread) {
      throw new Error('No thread found in the spawned process');
    }

    const pid = proc.pid;
    const tid = thread.tid;

    const redirector = new RedirectorHostAccessor(pid);
    const nthread = new NThread(
      new RemoteCallableMemoryAccessor(pid),
      tid,
      { timeoutMs: 20000 },
      redirector,
    );
    const indirect = new IndirectNThreadHostAccessor(nthread);
    redirector.target = indirect;

    // Force the chain to finish initializing via one async call first --
    // callSync (like the underlying NThread.callSync) has no init guard of
    // its own, so the redirected thread/stubs must already be ready.
    await indirect.call(Kernel32Impl.GetCurrentThreadId);

    // Simple no-arg call, purely via the synchronous busy-spin path.
    const remoteTidSync = indirect.callSync(Kernel32Impl.GetCurrentThreadId);
    expect(Number(remoteTidSync)).toBe(tid);

    // f32 arg/return through callSync.
    const halfPiF = Math.fround(Math.PI / 2);
    const sinf90Sync = indirect.callSync(CrtImpl.sinf, halfPiF);
    expect(sinf90Sync as number).toBeCloseTo(1.0, 5);

    // f64 arg/return through callSync.
    const sqrt4Sync = indirect.callSync(CrtImpl.sqrt, 4.0);
    expect(sqrt4Sync as number).toBeCloseTo(2.0, 10);

    // 8 float args (4 via XMM, 4 via stack) through callSync -- exercises
    // callSync's own stack-arg-stub setup path (writeSync/allocSync).
    const sumSync = indirect.callSync(
      sum8f,
      1.5,
      2.5,
      3.5,
      4.5,
      5.5,
      6.5,
      7.5,
      8.0,
    );
    expect(sumSync as number).toBeCloseTo(39.5, 4);

    await indirect.close();
  });

  test('verify all local global stubs are discovered and present', async () => {
    const sleep = getRandomSpinStub();
    const pushret = getRandomPushretStub();
    const jump = getRandomJumpStub();
    const ret = getRandomRetStub();
    const addRsp = getRandomAddRsp28RetStub();

    expect(sleep).toBeDefined();
    expect(sleep!.address).not.toBe(0);

    expect(pushret).toBeDefined();
    expect(pushret!.stub.address).not.toBe(0);
    expect(pushret!.regKey).toBeDefined();

    expect(jump).toBeDefined();
    expect(jump!.stub.address).not.toBe(0);
    expect(jump!.regKey).toBeDefined();

    expect(ret).toBeDefined();
    expect(ret!.address).not.toBe(0);

    expect(addRsp).toBeDefined();
    expect(addRsp!.address).not.toBe(0);
  });
});
