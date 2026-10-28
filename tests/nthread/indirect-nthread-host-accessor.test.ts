import { expect, test, describe } from 'bun:test';
import * as Native from 'bun-winapi';
import {
  Kernel32Impl,
  MemoryProtection,
  MemoryState,
  resolveAddress,
} from 'bun-xffi';
import { createAccessor } from 'exoproc-accessors';
import { getGlobalDummyProcess } from 'exoproc-dummy';

// Pre-wired form of the manual chain in nthread.test.ts: a full indirect host
// (IndirectCallRedirector + memset/memcmp/file-transfer/marshalling) sitting on
// an NThread backend, so every remote call is executed by hijacking a live
// thread in the target -- no CreateRemoteThread, no injected pipe-loop.
describe('IndirectNThreadHostAccessor (indirect chain over NThread hijacking)', () => {
  test('runs remote calls on the hijacked thread and does indirect alloc/write/read', async () => {
    const proc = getGlobalDummyProcess();

    const memory = await createAccessor(proc.pid, {
      hostOptions: { timeoutMs: 20000 },
    });

    try {
      // A call executes *on the hijacked thread itself*: GetCurrentThreadId
      // returns exactly the (winning) thread createAccessor parked at the
      // jmp$ stub.
      const remoteTid = await memory.call(Kernel32Impl.GetCurrentThreadId);
      expect(
        Native.Thread.getThreads(proc.pid).some((t) => t.tid === remoteTid),
      ).toBe(true);

      // Indirect alloc/write/read round-trip inside the target process.
      const addr = await memory.alloc(64);
      expect(Number(resolveAddress(addr))).toBeGreaterThan(0);

      const data = Buffer.from('nthread-backed indirect chain!');
      await memory.write(addr, data);
      const back = await memory.read(addr, data.byteLength);
      expect(back.toString()).toBe(data.toString());
      await memory.free(addr);
    } finally {
      await memory.deinit();
    }
  }, 30000);

  // allocNear over the full indirect chain + NThread is correct but heavy: each
  // probe (malloc + VirtualQuery + read + free) is amplified by the indirect
  // middlewares into several hijack calls, so this needs a long-lived target
  // and a generous timeout. It's the operation minhook leans on for trampoline
  // space, so proving it works here is what makes minhook-over-indirect viable.
  test('allocNear finds executable space near an anchor entirely via the hijacked thread', async () => {
    const proc = getGlobalDummyProcess();

    const memory = await createAccessor(proc.pid, {
      hostOptions: { timeoutMs: 20000 },
    });

    try {
      const anchor = await memory.alloc(
        0x1000,
        null,
        MemoryProtection.EXECUTE_READWRITE,
      );
      const anchorAddr = BigInt(resolveAddress(anchor));

      const near = await memory.allocNear(anchor, 64, {
        protection: MemoryProtection.EXECUTE_READWRITE,
      });
      const nearAddr = BigInt(resolveAddress(near));
      const dist =
        nearAddr > anchorAddr ? nearAddr - anchorAddr : anchorAddr - nearAddr;
      expect(dist <= 0x7fff0000n).toBe(true);

      const info = await memory.query(near);
      expect(info.State).toBe(MemoryState.COMMIT);

      await memory.free(near);
      await memory.free(anchor);
    } finally {
      await memory.deinit();
    }
  }, 120000);

  test('deinit restores hijacked thread and avoids re-hijack during middleware teardown', async () => {
    const proc = getGlobalDummyProcess();

    const memory = await createAccessor(proc.pid, {
      hostOptions: { timeoutMs: 20000 },
    });

    const nt = (memory as any).nthread;
    const tid = nt.tid;
    const spinStubAddr = BigInt(nt.stubs.spinStub!.address);

    // Perform an allocation and write so middlewares are active
    const addr = await memory.alloc(32);
    await memory.write(addr, Buffer.from('deinit teardown test'));
    await memory.free(addr);

    // Deinit top-down
    await memory.deinit();

    // Verify the thread is restored and not parked at spinStub
    const thread = Native.Thread.open(tid);
    thread.suspend();
    thread.context.fetch();
    const finalRip = thread.context.Rip;
    thread.resume();
    thread.close();

    expect(finalRip !== spinStubAddr).toBe(true);
  }, 30000);
});
