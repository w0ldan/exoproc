import { expect, test, describe } from 'bun:test';
import { resolveAddress } from 'bun-xffi';
import { createAccessor } from 'exoproc-accessors';
import { getGlobalDummyProcess } from 'exoproc-dummy';

// Moved from tests/xffi/scanner.test.ts ("should support remote process JIT
// pattern scan using IndirectCallableAccessor template") -- the indirect chain's
// malloc-backed alloc() needs to run on an already-live thread rather than a
// freshly-created CreateRemoteThread thread (see the GHA thread-freshness bug
// in CLAUDE.md), so this uses IndirectNThreadHostAccessor instead of the bare
// pid-based IndirectCallableAccessor.
describe('nthread > Scanner over IndirectNThreadHostAccessor', () => {
  test('should support remote process JIT pattern scan', async () => {
    if (process.platform !== 'win32') return;

    const tp = getGlobalDummyProcess();

    const accessor = await createAccessor(tp.pid, {
      hostOptions: { timeoutMs: 20000 },
    });

    try {
      const size = 100;
      const addr = await accessor.alloc(size);
      expect(addr).toBeGreaterThan(0);

      const patternBytes = Buffer.from([
        0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11,
      ]);
      await accessor.write(resolveAddress(addr) + 20, patternBytes);

      // 1. Test 3-byte pattern scan (uses memmemWithoutBuffer)
      const res3: bigint[] = [];
      for await (const val of accessor.scan(addr, size, '12 34 56')) {
        res3.push(BigInt(resolveAddress(val)));
      }
      expect(res3).toHaveLength(1);
      expect(res3[0]).toBe(BigInt(resolveAddress(addr)) + 20n);

      // 2. Test 5-byte pattern scan (uses memmemWithoutBuffer)
      const res5: bigint[] = [];
      for await (const val of accessor.scan(addr, size, '12 34 56 78 9A')) {
        res5.push(BigInt(resolveAddress(val)));
      }
      expect(res5).toHaveLength(1);
      expect(res5[0]).toBe(BigInt(resolveAddress(addr)) + 20n);

      // 3. Test 9-byte pattern scan (uses memmem fallback with remote buffer allocation)
      const res9: bigint[] = [];
      for await (const val of accessor.scan(
        addr,
        size,
        '12 34 56 78 9A BC DE F0 11',
      )) {
        res9.push(BigInt(resolveAddress(val)));
      }
      expect(res9).toHaveLength(1);
      expect(res9[0]).toBe(BigInt(resolveAddress(addr)) + 20n);

      await accessor.free(addr);
    } finally {
      await accessor.deinit();
    }
  }, 60000);
});
