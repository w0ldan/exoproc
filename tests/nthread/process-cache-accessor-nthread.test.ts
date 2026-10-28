import { expect, test, describe } from 'bun:test';
import {
  ProcessCacheAccessor,
  HostAccessor,
  createAccessor,
} from 'exoproc-accessors';
import { getGlobalDummyProcess } from 'exoproc-dummy';

// Moved from tests/xffi/process-cache-accessor.test.ts -- ProcessCacheAccessor.
// getCoreModules() -> verifyCoreModules() -> isModuleLoadedInProcess() calls
// GetModuleHandleExA(FROM_ADDRESS) with 3 arguments, but a bare
// RemoteCallableMemoryAccessor's call()/callSync() only delivers the first
// argument through CreateRemoteThread's single lpParameter slot (see
// callable-accessor.ts) -- the output pointer (phModule) arg was silently
// dropped, landing as leftover register garbage, which intermittently
// crashed Wine ("Unhandled page fault... starting debugger") when that
// garbage wasn't a writable address. Same root cause as
// module-helpers-nthread.test.ts's move, just reached through
// ProcessCacheAccessor's caching layer instead of isModuleLoadedInProcess
// directly. Driven through IndirectNThreadHostAccessor (an already-live,
// hijacked thread) instead, whose call() properly marshals every argument.
describe('nthread > ProcessCacheAccessor', () => {
  test('should resolve metadata and cache status using a real target process', async () => {
    const tp = getGlobalDummyProcess();

    const nthreadAccessor = await createAccessor(tp.pid, {
      hostOptions: { timeoutMs: 20000 },
    });

    try {
      const host = new HostAccessor(nthreadAccessor);
      const cacheAccessor = new ProcessCacheAccessor(nthreadAccessor, host);
      host.backend = cacheAccessor;

      // Verify lazy metadata getters
      const is64 = await cacheAccessor.getIs64Bit();
      expect(typeof is64).toBe('boolean');

      const processName = await cacheAccessor.getProcessName();
      expect(processName.toLowerCase()).toContain('ping');

      const coreModules = await cacheAccessor.getCoreModules();
      expect(coreModules.ntdll).toBe(true);
      expect(coreModules.kernel32).toBe(true);
      expect(coreModules.msvcrt).toBe(true);

      // Repeated calls should return immediately from cache
      const is64Cached = await cacheAccessor.getIs64Bit();
      expect(is64Cached).toBe(is64);

      const processNameCached = await cacheAccessor.getProcessName();
      expect(processNameCached).toBe(processName);

      const coreModulesCached = await cacheAccessor.getCoreModules();
      expect(coreModulesCached).toEqual(coreModules);
    } finally {
      await nthreadAccessor.deinit();
    }
  }, 60000);
});
