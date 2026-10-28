import { expect, test, describe } from 'bun:test';
import { MemoryProtection } from 'bun-xffi';
import { createAccessor } from 'exoproc-accessors';
import { getGlobalDummyProcess } from 'exoproc-dummy';

// Moved from tests/xffi/call-redirector.test.ts -- CallRedirectorAccessor/
// IndirectCallRedirectorAccessor redirect protect() through `this.root.call
// (VirtualProtect)` for real (non-malloc'd) memory, and through local
// bookkeeping (throw/no-op) for malloc'd blocks. Real WinAPI calls need to run
// on an already-live thread rather than a freshly-created CreateRemoteThread
// thread (see the GHA thread-freshness bug in CLAUDE.md), so this drives
// everything through IndirectNThreadHostAccessor.
//
// alloc/write/read/free/query roundtrips are already covered by
// tests/nthread/indirect-nthread-host-accessor.test.ts (malloc'd memory) and
// its allocNear test (real VirtualAlloc/VirtualQuery on exec memory) -- this
// file only adds what those don't touch: protect()'s branching behavior.
describe('nthread > IndirectCallRedirectorAccessor.protect() over IndirectNThreadHostAccessor', () => {
  test('mocks protect() for malloc blocks (throw on non-READWRITE, no-op on READWRITE) and calls real VirtualProtect otherwise', async () => {
    const tp = getGlobalDummyProcess();

    const accessor = await createAccessor(tp.pid, {
      hostOptions: { timeoutMs: 20000 },
    });

    try {
      // Malloc'd (default READWRITE) block: protect() is purely local bookkeeping.
      const size = 512;
      const remoteAddr = await accessor.alloc(size);

      await expect(
        accessor.protect(remoteAddr, size, MemoryProtection.READONLY),
      ).rejects.toThrow();

      const selfProtect = await accessor.protect(
        remoteAddr,
        size,
        MemoryProtection.READWRITE,
      );
      expect(selfProtect).toBe(MemoryProtection.READWRITE);
      await accessor.free(remoteAddr);

      // Non-READWRITE (e.g. EXECUTE_READWRITE) falls back to VirtualAlloc, so
      // protect() falls back too: a genuine VirtualProtect via `this.root.call`,
      // executed on the hijacked thread.
      const execAddr = await accessor.alloc(
        size,
        null,
        MemoryProtection.EXECUTE_READWRITE,
      );
      const oldProtect = await accessor.protect(
        execAddr,
        size,
        MemoryProtection.READONLY,
      );
      expect(oldProtect).toBe(MemoryProtection.EXECUTE_READWRITE);
      await accessor.free(execAddr);
    } finally {
      await accessor.deinit();
    }
  }, 60000);
});
