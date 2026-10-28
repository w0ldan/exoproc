import { expect, test, describe } from 'bun:test';
import {
  isModuleLoadedInProcess,
  verifyCoreModules,
  Kernel32Impl,
} from 'bun-xffi';
import { createAccessor } from 'exoproc-accessors';
import { getGlobalDummyProcess } from 'exoproc-dummy';

// Moved from tests/xffi/module-helpers.test.ts -- GetModuleHandleExA(FROM_ADDRESS)
// with a deliberately bogus address crashed ("Unhandled page fault... starting
// debugger" under Wine, the same underlying fault on real windows-latest CI
// runners too -- see CLAUDE.md, not Wine-specific) when dispatched via a bare
// RemoteCallableMemoryAccessor (a fresh CreateRemoteThread thread); driven
// through IndirectNThreadHostAccessor (an already-live, hijacked thread) instead.
describe('nthread > Module Loading Helpers', () => {
  test('should check loaded modules in the current process', async () => {
    const tp = getGlobalDummyProcess();

    const accessor = await createAccessor(tp.pid, {
      hostOptions: { timeoutMs: 20000 },
    });

    try {
      // kernel32.dll and ntdll.dll must always be loaded in a valid process!
      const hKernel32 = BigInt(
        Kernel32Impl.GetModuleHandleA(Buffer.from('kernel32.dll\0')),
      );
      const hNtdll = BigInt(
        Kernel32Impl.GetModuleHandleA(Buffer.from('ntdll.dll\0')),
      );

      const isKernel32Loaded = await isModuleLoadedInProcess(
        accessor,
        hKernel32,
      );
      const isNtdllLoaded = await isModuleLoadedInProcess(accessor, hNtdll);
      const isFakeLoaded = await isModuleLoadedInProcess(
        accessor,
        0x123456780000n,
      );

      expect(isKernel32Loaded).toBe(true);
      expect(isNtdllLoaded).toBe(true);
      expect(isFakeLoaded).toBe(false);

      // Verify core modules overview
      const coreStatus = await verifyCoreModules(accessor);
      expect(coreStatus.ntdll).toBe(true);
      expect(coreStatus.kernel32).toBe(true);
      expect(coreStatus.kernelbase).toBe(true);
      expect(coreStatus.msvcrt).toBe(true);
    } finally {
      await accessor.deinit();
    }
  }, 60000);
});
