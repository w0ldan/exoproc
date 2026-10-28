import { expect, test, describe } from 'bun:test';
import { Kernel32Impl } from 'bun-xffi';
import { createAccessor, createAccessorWithoutInit } from 'exoproc-accessors';
import { getGlobalDummyProcess } from 'exoproc-dummy';

// Proves the full handle-relay flow: this (Bun) process never OpenProcess's
// the target directly -- only the dummy process it spawns itself. NShm.alloc()
// gives back a genuine target-side address; reads/writes against that address
// are transparently redirected to this process's own mapped view of the same
// section instead of the wrapped backend's normal remote path. Both tests
// target the shared exoproc-dummy process (getGlobalDummyProcess, torn down
// once for the whole suite in tests/setup.ts, not here) -- neither assertion
// is about the target being a *distinct* process, only about NShm's own
// relay/isolation behavior, so there's no reason to spawn and tear down a
// dedicated one. The dummy relay itself is a pure relay vessel (its own
// transit copy is closed automatically) and the target's own mapping
// *handle* is closed automatically too, as a side effect of the relay
// DuplicateHandle (DUPLICATE_CLOSE_SOURCE) -- only the mapped view (which
// stays valid without the handle) is the target's real deliverable, so
// there's no target-side CloseHandle call anywhere in this flow, not even
// for the OpenProcess handle used to reach the dummy (left open; see NShm's
// doc comment). Driven through IndirectNThreadHostAccessor (an already-live,
// hijacked thread in the target) per CLAUDE.md's guidance on real WinAPI/CRT
// calls (CreateFileMappingA/OpenProcess/DuplicateHandle) never running on a
// freshly-created thread under Wine/GHA.
describe('nshm > NShm (handle relay via a single shared dummy process)', () => {
  test('shares a genuinely usable mapping/view with both the target and this process', async () => {
    const target = getGlobalDummyProcess();

    const memory = createAccessorWithoutInit(target.pid, {
      idType: 'process',
      hostOptions: { timeoutMs: 20000 },
    });
    const shm = await createAccessor(target.pid, {
      backend: memory,
      sharedMemory: true,
    });

    const addr = await shm.alloc(4096);

    try {
      expect(Number(addr)).toBeGreaterThan(0);

      // Local -> target: shm.write() redirects to the local mapped view
      // (same physical section), so a raw target-side read sees it too.
      const marker1 = Buffer.from('nshm-local-to-target!\0');
      await shm.write(addr, marker1);
      const seenInTarget = await memory.read(addr, marker1.byteLength);
      expect(seenInTarget.toString()).toBe(marker1.toString());

      // Target -> local: a raw target-side write, read back via shm.read()
      // (redirected to the local view -- no cross-process call).
      const marker2 = Buffer.from('nshm-target-to-local!\0');
      await memory.write(addr, marker2);
      const seenLocally = await shm.read(addr, marker2.byteLength);
      expect(seenLocally.toString()).toBe(marker2.toString());
    } finally {
      // The target's own view is its real deliverable, not relay plumbing
      // -- alloc() leaves it mapped, so unmapping it (once the target no
      // longer needs the shared memory) is on us here. shm.free() only
      // releases the *local* side (there's no target-side handle left to
      // close -- alloc() already closed the target's mapping handle itself).
      await memory.call(Kernel32Impl.UnmapViewOfFile, addr);
      await shm.free(addr);
      await memory.deinit();
    }
  }, 60000);

  test('supports multiple independent shared memory regions on the same target', async () => {
    const target = getGlobalDummyProcess();

    const memory = createAccessorWithoutInit(target.pid, {
      idType: 'process',
      hostOptions: { timeoutMs: 20000 },
    });
    const shm = await createAccessor(target.pid, {
      backend: memory,
      sharedMemory: true,
    });

    const addr1 = await shm.alloc(4096);
    const addr2 = await shm.alloc(4096);

    try {
      expect(addr1).not.toBe(addr2);

      await shm.write(addr1, Buffer.from('region-one'));
      await shm.write(addr2, Buffer.from('region-two'));
      expect((await shm.read(addr1, 10)).toString()).toBe('region-one');
      expect((await shm.read(addr2, 10)).toString()).toBe('region-two');
    } finally {
      await memory.call(Kernel32Impl.UnmapViewOfFile, addr1);
      await memory.call(Kernel32Impl.UnmapViewOfFile, addr2);
      await shm.free(addr1);
      await shm.free(addr2);
      await memory.deinit();
    }
  }, 60000);
});
