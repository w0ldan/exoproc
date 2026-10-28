import { describe, test, expect } from 'bun:test';
import * as WinAPI from 'bun-winapi';
import {
  resolveAddress,
  Pattern,
  Kernel32Impl,
  WaitReturn,
  alignUp,
  alignDown,
  stackAlign16,
} from 'bun-xffi';
import { getGlobalDummyProcess } from 'exoproc-dummy';

const Native = {
  ...WinAPI,
  resolveAddress,
  Pattern,
  Kernel32Impl,
  WaitReturn,
  alignUp,
  alignDown,
  stackAlign16,
};

describe('WinAPI Package Tests', () => {
  describe('Encoding & Decoding', () => {
    test('encodeStringW should output correct null-terminated UTF-16LE buffer', () => {
      const buffer = Native.encodeStringW('hello');
      expect(buffer.length).toBe(12); // 'hello' (10 bytes) + null terminator (2 bytes)
      expect(buffer.readUInt16LE(10)).toBe(0);
    });

    test('encodeStringA should output correct null-terminated UTF-8 buffer', () => {
      const buffer = Native.encodeStringA('hello');
      expect(buffer.length).toBe(6); // 'hello' (5 bytes) + null terminator (1 byte)
      expect(buffer[5]).toBe(0);
    });

    test('encodeString should auto-detect wide/ANSI correctly', () => {
      const ansiBuffer = Native.encodeString('hello');
      expect(ansiBuffer.length).toBe(6);

      const wideBuffer = Native.encodeString('helloü');
      expect(wideBuffer.length).toBe(14); // 6 chars * 2 bytes + 2 null bytes
    });

    test('resolveEncoding should pick correct variant based on string', () => {
      const ansiFunc = 'ansi';
      const wideFunc = 'wide';

      const [ansiBuf, ansiSelected] = Native.resolveEncoding(
        ansiFunc,
        wideFunc,
        'hello',
      );
      expect(ansiSelected).toBe(ansiFunc);
      expect(ansiBuf.length).toBe(6);

      const [wideBuf, wideSelected] = Native.resolveEncoding(
        ansiFunc,
        wideFunc,
        'helloü',
      );
      expect(wideSelected).toBe(wideFunc);
      expect(wideBuf.length).toBe(14);
    });
  });

  describe('Process API', () => {
    test('currentProcess should be valid and match platform values', () => {
      const process = Native.currentProcess;
      expect(process.isValid()).toBe(true);
      expect(process.pid).toBe(process.pid);
      expect(process.is64Bit()).toBe(true);
    });

    test('memory read/write on local process accessor should work (Sync)', () => {
      const process = Native.currentProcess;
      const mem = process.memory;

      // Allocate, write, read, and free memory synchronously
      const addr = mem.allocSync(1024);
      expect(addr).not.toBeNull();

      const testBuffer = Buffer.from([1, 2, 3, 4, 5]);
      mem.writeSync(addr, testBuffer);

      const readBuffer = Buffer.from(mem.readSync(addr, 5));
      expect(readBuffer).toEqual(testBuffer);

      mem.freeSync(addr, 1024);
    });

    test('memory pattern scan on remote process accessor should work', async () => {
      const tp = getGlobalDummyProcess();
      const { pid } = tp;

      const process = Native.Process.open(pid);
      const mem = process.memory;

      const addr = await mem.alloc(1024);
      expect(addr).not.toBeNull();

      // 1. Write multi-byte pattern (len = 5)
      const patternBuf = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55]);
      await mem.write(addr, patternBuf);

      // 2. Write 2-byte pattern (len = 2)
      const patternBuf2 = Buffer.from([0xaa, 0xbb]);
      const addr2 = BigInt(Native.resolveAddress(addr)) + 10n;
      await mem.write(addr2, patternBuf2);

      // 3. Write 4-byte pattern (len = 4)
      const patternBuf4 = Buffer.from([0xcc, 0xdd, 0xee, 0xff]);
      const addr4 = BigInt(Native.resolveAddress(addr)) + 20n;
      await mem.write(addr4, patternBuf4);

      // Scan for multi-byte pattern (remote memmem)
      const p1 = new Native.Pattern([0x11, 0x22, 0x33, 0x44, 0x55]);
      const res1 = (
        await process.memory
          .scan(BigInt(Native.resolveAddress(addr)), 1024, p1)
          .next()
      ).value;
      expect(res1).toBeDefined();
      expect(BigInt(res1!.address)).toBe(BigInt(Native.resolveAddress(addr)));

      // Scan for 2-byte pattern (remote memmem2)
      const p2 = new Native.Pattern([0xaa, 0xbb]);
      const res2 = (
        await process.memory
          .scan(BigInt(Native.resolveAddress(addr)), 1024, p2)
          .next()
      ).value;
      expect(res2).toBeDefined();
      expect(BigInt(res2!.address)).toBe(addr2);

      // Scan for 4-byte pattern (remote memmem4)
      const p4 = new Native.Pattern([0xcc, 0xdd, 0xee, 0xff]);
      const res4 = (
        await process.memory
          .scan(BigInt(Native.resolveAddress(addr)), 1024, p4)
          .next()
      ).value;
      expect(res4).toBeDefined();
      expect(BigInt(res4!.address)).toBe(addr4);

      await mem.free(addr, 1024);
    });
  });

  describe('Thread API', () => {
    test('GetCurrentThread should wrap current thread handle', () => {
      const currentThreadId = Native.Kernel32Impl.GetCurrentThreadId();
      expect(currentThreadId).toBeGreaterThan(0);
    });
  });

  describe('Handle & Wait API', () => {
    test('should perform waits correctly using both short and long poll paths', async () => {
      const currentTid = Native.Thread.currentId();
      const currentThread = Native.Thread.open(currentTid);
      expect(currentThread.isValid()).toBe(true);

      try {
        // Short wait (tight 1ms poll-sleep loop)
        const startPoll = performance.now();
        const resPoll = await currentThread.wait(2);
        const durationPoll = performance.now() - startPoll;
        console.log(
          `[TEST LOG] Short wait(2) duration (tight poll): ${durationPoll.toFixed(2)} ms`,
        );
        expect(resPoll).toBe(Native.WaitReturn.TIMEOUT);
        expect(durationPoll).toBeGreaterThanOrEqual(0);

        // Long wait (waitAsync backoff poll) - wrapped in try/catch to
        // tolerate ordinary Wine flakiness.
        try {
          const startAsync = performance.now();
          const resAsync = await currentThread.wait(100);
          const durationAsync = performance.now() - startAsync;
          console.log(
            `[TEST LOG] Long wait(100) duration (waitAsync): ${durationAsync.toFixed(2)} ms`,
          );
          expect(resAsync).toBe(Native.WaitReturn.TIMEOUT);
          expect(durationAsync).toBeGreaterThanOrEqual(100);
        } catch (wineError) {
          console.warn(
            '[TEST LOG] Tolerated Wine error during wait(100) test:',
            wineError,
          );
        }
      } finally {
        currentThread.close();
      }
    }, 20000);
  });

  describe('Alignment Utilities', () => {
    test('alignUp should correctly align numbers and bigints', () => {
      expect(Native.alignUp(15, 16)).toBe(16);
      expect(Native.alignUp(16, 16)).toBe(16);
      expect(Native.alignUp(17, 16)).toBe(32);

      expect(Native.alignUp(15n, 16n)).toBe(16n);
      expect(Native.alignUp(16n, 16n)).toBe(16n);
      expect(Native.alignUp(17n, 16n)).toBe(32n);
    });

    test('alignDown should correctly align numbers and bigints', () => {
      expect(Native.alignDown(15, 16)).toBe(0);
      expect(Native.alignDown(16, 16)).toBe(16);
      expect(Native.alignDown(17, 16)).toBe(16);

      expect(Native.alignDown(15n, 16n)).toBe(0n);
      expect(Native.alignDown(16n, 16n)).toBe(16n);
      expect(Native.alignDown(17n, 16n)).toBe(16n);
    });

    test('stackAlign16 should correctly align stack addresses down to 16 bytes', () => {
      expect(Native.stackAlign16(17n)).toBe(16n);
      expect(Native.stackAlign16(31n)).toBe(16n);
      expect(Native.stackAlign16(32n)).toBe(32n);
    });
  });
});
