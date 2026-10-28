import { expect, test, describe } from 'bun:test';
import { ptr as bunPtr } from 'bun:ffi';
import {
  localMemoryAccessor,
  RemoteProcessMemoryAccessor,
  resolveAddress,
  NativeMemory,
  Pattern,
  Scanner,
  ScanResult,
  InvalidPatternError,
  MemoryProtection,
} from '../../packages/xffi/src/index';
import { getGlobalDummyProcess } from 'exoproc-dummy';

describe('xffi > Scanner & Pattern Scanning API', () => {
  describe('Pattern Parsing', () => {
    test('should parse signatures with spaces', () => {
      const p = new Pattern('12 34 56 78 9A');
      expect(p.length).toBe(5);
      expect(p.bytes).toEqual(Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a]));
    });

    test('should parse signatures without spaces', () => {
      const p = new Pattern('DEADBEEF');
      expect(p.length).toBe(4);
      expect(p.bytes).toEqual(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    });

    test('should clean prefixes (0x and \\x)', () => {
      const p1 = new Pattern('0x12 0x34 0x56');
      expect(p1.bytes).toEqual(Buffer.from([0x12, 0x34, 0x56]));

      const p2 = new Pattern('\\xAA\\xBB\\xCC');
      expect(p2.bytes).toEqual(Buffer.from([0xaa, 0xbb, 0xcc]));
    });

    test('should accept numeric array input', () => {
      const p = new Pattern([0x11, 0x22, 0x33]);
      expect(p.length).toBe(3);
      expect(p.bytes).toEqual(Buffer.from([0x11, 0x22, 0x33]));
    });

    test('should throw InvalidPatternError for invalid inputs', () => {
      expect(() => new Pattern('12 GG 34')).toThrow(InvalidPatternError);
      expect(() => new Pattern([256])).toThrow(InvalidPatternError);
      expect(() => new Pattern(null as any)).toThrow(InvalidPatternError);
    });

    test('should manage scan limits', () => {
      const p = new Pattern('12 34');
      expect(p.maxResults).toBe(1);
      expect(p.hasLimit).toBe(true);

      p.limit(5);
      expect(p.maxResults).toBe(5);

      p.noLimit();
      expect(p.maxResults).toBe(0);
      expect(p.hasLimit).toBe(false);
    });

    test('should manage protection filters', () => {
      const p = new Pattern('12 34');
      const originalProtect = p.protect;

      p.setProtect(MemoryProtection.READONLY);
      expect(p.protect).toBe(MemoryProtection.READONLY);

      p.addProtect(MemoryProtection.READWRITE);
      expect(p.protect).toBe(
        MemoryProtection.READONLY | MemoryProtection.READWRITE,
      );

      p.defaultProtect();
      expect(p.protect).toBe(originalProtect);
    });
  });

  describe('Scanner Class (Direct memory scan)', () => {
    test('should scan local array memory synchronously and asynchronously', async () => {
      const buffer = Buffer.alloc(100);
      buffer.write('Hello Pattern World!', 0);

      const pat = new Pattern('50 61 74 74 65 72 6E'); // "Pattern"
      const memory = new NativeMemory(bunPtr(buffer), buffer.length);

      // 1. scanSync
      const matchesSync = Array.from(Scanner.scanSync(memory, pat));
      expect(matchesSync).toHaveLength(1);
      const expectedAddr = BigInt(bunPtr(buffer)) + 6n;
      expect(BigInt(resolveAddress(matchesSync[0]))).toBe(expectedAddr);

      // 2. scan (async)
      const matchesAsync: bigint[] = [];
      for await (const addr of Scanner.scan(memory, pat)) {
        matchesAsync.push(BigInt(resolveAddress(addr)));
      }
      expect(matchesAsync).toHaveLength(1);
      expect(matchesAsync[0]).toBe(expectedAddr);
    });

    test('should support chunked scanning logic for larger boundaries', () => {
      const buffer = Buffer.alloc(20);
      buffer[10] = 0xaa;
      buffer[11] = 0xbb;

      const pat = new Pattern('AA BB');
      const memory = new NativeMemory(bunPtr(buffer), buffer.length);

      // Set chunkSize small (e.g. 5 bytes) to force chunked loop
      const matches = Array.from(Scanner.scanSync(memory, pat, undefined, 5));
      expect(matches).toHaveLength(1);
      expect(BigInt(resolveAddress(matches[0]))).toBe(
        BigInt(bunPtr(buffer)) + 10n,
      );
    });
  });

  describe('ScanResult API wrapper', () => {
    test('should lazily evaluate matches and support ScanResult API', async () => {
      const buffer = Buffer.alloc(50);
      buffer[10] = 0x11;
      buffer[20] = 0x11;
      buffer[30] = 0x11;

      const pat = new Pattern('11').noLimit();
      const memory = new NativeMemory(bunPtr(buffer), buffer.length);

      const baseGenerator = async function* () {
        for (const addr of Scanner.scanSync(memory, pat)) {
          yield {
            address: BigInt(resolveAddress(addr)),
            size: pat.length,
            pointer: addr,
          } as any;
        }
      };

      const result = new ScanResult(baseGenerator(), pat);

      // Test first()
      const firstMatch = await result.first();
      expect(firstMatch).toBeDefined();
      expect(firstMatch!.address).toBe(BigInt(bunPtr(buffer)) + 10n);

      // Test take(2)
      const taken = await result.take(2);
      expect(taken).toHaveLength(2);
      expect(taken[1]!.address).toBe(BigInt(bunPtr(buffer)) + 20n);

      // Test all() / getAddresses()
      const addresses = await result.getAddresses();
      expect(addresses).toHaveLength(3);
      expect(addresses).toEqual([
        BigInt(bunPtr(buffer)) + 10n,
        BigInt(bunPtr(buffer)) + 20n,
        BigInt(bunPtr(buffer)) + 30n,
      ]);
    });
  });

  describe('LocalMemoryAccessor Scanning', () => {
    test('should support scanSync and scan on local memory using localMemoryAccessor', async () => {
      const size = 100;
      const addr = localMemoryAccessor.allocSync(size);
      expect(addr).toBeGreaterThan(0);

      const patternBytes = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a]);
      localMemoryAccessor.writeSync(resolveAddress(addr) + 20, patternBytes);

      // 1. Test scanSync
      const resultsSync = Array.from(
        localMemoryAccessor.scanSync(addr, size, '12 34 56 78 9A'),
      );
      expect(resultsSync).toHaveLength(1);
      expect(BigInt(resolveAddress(resultsSync[0]))).toBe(
        BigInt(resolveAddress(addr)) + 20n,
      );

      // 2. Test scan (async)
      const resultsAsync: bigint[] = [];
      for await (const val of localMemoryAccessor.scan(
        addr,
        size,
        '12 34 56 78 9A',
      )) {
        resultsAsync.push(BigInt(resolveAddress(val)));
      }
      expect(resultsAsync).toHaveLength(1);
      expect(resultsAsync[0]).toBe(BigInt(resolveAddress(addr)) + 20n);

      localMemoryAccessor.freeSync(addr);
    });
  });

  describe('RemoteProcessMemoryAccessor Scanning', () => {
    test('should support scanSync and scan on remote memory using RemoteProcessMemoryAccessor (JS-based)', async () => {
      if (process.platform !== 'win32') return;

      const tp = getGlobalDummyProcess();

      const remote = new RemoteProcessMemoryAccessor(tp.pid, {
        handle: tp.handle,
        closeHandle: false,
      });

      const size = 100;
      const addr = remote.allocSync(size);
      expect(addr).toBeGreaterThan(0);

      const patternBytes = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a]);
      remote.writeSync(resolveAddress(addr) + 20, patternBytes);

      // 1. Test scanSync
      const resultsSync = Array.from(
        remote.scanSync(addr, size, '12 34 56 78 9A'),
      );
      expect(resultsSync).toHaveLength(1);
      expect(BigInt(resolveAddress(resultsSync[0]))).toBe(
        BigInt(resolveAddress(addr)) + 20n,
      );

      // 2. Test scan (async)
      const resultsAsync: bigint[] = [];
      for await (const val of remote.scan(addr, size, '12 34 56 78 9A')) {
        resultsAsync.push(BigInt(resolveAddress(val)));
      }
      expect(resultsAsync).toHaveLength(1);
      expect(resultsAsync[0]).toBe(BigInt(resolveAddress(addr)) + 20n);

      remote.freeSync(addr);
      remote.close();
    });

    // The "remote process JIT pattern scan using IndirectCallableAccessor
    // template" case moved to
    // tests/nthread/scanner-indirect-nthread.test.ts -- the indirect chain's
    // malloc-backed alloc() needs to run on an already-live thread rather than
    // a freshly-created CreateRemoteThread thread (see the GHA thread-freshness
    // bug in CLAUDE.md), so it now uses IndirectNThreadHostAccessor.
  });
});
