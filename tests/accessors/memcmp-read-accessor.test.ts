import { expect, test, describe } from 'bun:test';
import {
  localCallableMemoryAccessor,
  type ISyncCallableMemoryAccessor,
  type CFunction,
  type CCallResult,
} from '../../packages/xffi/src/index.js';
import { resolveAddress } from '../../packages/xffi/src/ffi.js';
import {
  MemcmpReadAccessor,
  HostAccessor,
} from '../../packages/accessors/src/index.js';

describe('accessors > MemcmpReadAccessor', () => {
  test('should resolve memory correctly byte-by-byte using memcmp binary search', async () => {
    let callCount = 0;
    const spyBackend: ISyncCallableMemoryAccessor = {
      isLocal: localCallableMemoryAccessor.isLocal,
      processId: localCallableMemoryAccessor.processId,
      enableDebug: () => {},
      disableDebug: () => {},

      read: (addr, size, offset) =>
        localCallableMemoryAccessor.read(addr, size, offset),
      readSync: (addr, size, offset) =>
        localCallableMemoryAccessor.readSync(addr, size, offset),
      write: (addr, data, offset) =>
        localCallableMemoryAccessor.write(addr, data, offset),
      writeSync: (addr, data, offset) =>
        localCallableMemoryAccessor.writeSync(addr, data, offset),
      alloc: (size, addr, prot, type) =>
        localCallableMemoryAccessor.alloc(size, addr, prot, type),
      allocSync: (size, addr, prot, type) =>
        localCallableMemoryAccessor.allocSync(size, addr, prot, type),
      allocNear: (target, size, options) =>
        localCallableMemoryAccessor.allocNear(target, size, options),
      allocNearSync: (target, size, options) =>
        localCallableMemoryAccessor.allocNearSync(target, size, options),
      free: (addr, size, type) =>
        localCallableMemoryAccessor.free(addr, size, type),
      freeSync: (addr, size, type) =>
        localCallableMemoryAccessor.freeSync(addr, size, type),
      protect: (addr, size, prot) =>
        localCallableMemoryAccessor.protect(addr, size, prot),
      protectSync: (addr, size, prot) =>
        localCallableMemoryAccessor.protectSync(addr, size, prot),
      query: (addr) => localCallableMemoryAccessor.query(addr),
      querySync: (addr) => localCallableMemoryAccessor.querySync(addr),
      scan: (addr, size, pat) =>
        localCallableMemoryAccessor.scan(addr, size, pat),
      scanSync: (addr, size, pat) =>
        localCallableMemoryAccessor.scanSync(addr, size, pat),
      machineCode: (sc) => localCallableMemoryAccessor.machineCode(sc),
      machineCodeSync: (sc) => localCallableMemoryAccessor.machineCodeSync(sc),

      call: async (func: CFunction, ...args: any[]): Promise<CCallResult> => {
        callCount++;
        return localCallableMemoryAccessor.call(func, ...args);
      },
      callSync: (func: CFunction, ...args: any[]): CCallResult => {
        callCount++;
        return localCallableMemoryAccessor.callSync(func, ...args);
      },

      readInt8: (addr, offset) =>
        localCallableMemoryAccessor.readInt8(addr, offset),
      readInt8Sync: (addr, offset) =>
        localCallableMemoryAccessor.readInt8Sync(addr, offset),
      readUInt8: (addr, offset) =>
        localCallableMemoryAccessor.readUInt8(addr, offset),
      readUInt8Sync: (addr, offset) =>
        localCallableMemoryAccessor.readUInt8Sync(addr, offset),
      readInt16: (addr, offset) =>
        localCallableMemoryAccessor.readInt16(addr, offset),
      readInt16Sync: (addr, offset) =>
        localCallableMemoryAccessor.readInt16Sync(addr, offset),
      readUInt16: (addr, offset) =>
        localCallableMemoryAccessor.readUInt16(addr, offset),
      readUInt16Sync: (addr, offset) =>
        localCallableMemoryAccessor.readUInt16Sync(addr, offset),
      readInt32: (addr, offset) =>
        localCallableMemoryAccessor.readInt32(addr, offset),
      readInt32Sync: (addr, offset) =>
        localCallableMemoryAccessor.readInt32Sync(addr, offset),
      readUInt32: (addr, offset) =>
        localCallableMemoryAccessor.readUInt32(addr, offset),
      readUInt32Sync: (addr, offset) =>
        localCallableMemoryAccessor.readUInt32Sync(addr, offset),
      readInt64: (addr, offset) =>
        localCallableMemoryAccessor.readInt64(addr, offset),
      readInt64Sync: (addr, offset) =>
        localCallableMemoryAccessor.readInt64Sync(addr, offset),
      readUInt64: (addr, offset) =>
        localCallableMemoryAccessor.readUInt64(addr, offset),
      readUInt64Sync: (addr, offset) =>
        localCallableMemoryAccessor.readUInt64Sync(addr, offset),
      readFloat: (addr, offset) =>
        localCallableMemoryAccessor.readFloat(addr, offset),
      readFloatSync: (addr, offset) =>
        localCallableMemoryAccessor.readFloatSync(addr, offset),
      readDouble: (addr, offset) =>
        localCallableMemoryAccessor.readDouble(addr, offset),
      readDoubleSync: (addr, offset) =>
        localCallableMemoryAccessor.readDoubleSync(addr, offset),
      readPointer: (addr, offset) =>
        localCallableMemoryAccessor.readPointer(addr, offset),
      readPointerSync: (addr, offset) =>
        localCallableMemoryAccessor.readPointerSync(addr, offset),

      writeInt8: (addr, val, offset) =>
        localCallableMemoryAccessor.writeInt8(addr, val, offset),
      writeInt8Sync: (addr, val, offset) =>
        localCallableMemoryAccessor.writeInt8Sync(addr, val, offset),
      writeUInt8: (addr, val, offset) =>
        localCallableMemoryAccessor.writeUInt8(addr, val, offset),
      writeUInt8Sync: (addr, val, offset) =>
        localCallableMemoryAccessor.writeUInt8Sync(addr, val, offset),
      writeInt16: (addr, val, offset) =>
        localCallableMemoryAccessor.writeInt16(addr, val, offset),
      writeInt16Sync: (addr, val, offset) =>
        localCallableMemoryAccessor.writeInt16Sync(addr, val, offset),
      writeUInt16: (addr, val, offset) =>
        localCallableMemoryAccessor.writeUInt16(addr, val, offset),
      writeUInt16Sync: (addr, val, offset) =>
        localCallableMemoryAccessor.writeUInt16Sync(addr, val, offset),
      writeInt32: (addr, val, offset) =>
        localCallableMemoryAccessor.writeInt32(addr, val, offset),
      writeInt32Sync: (addr, val, offset) =>
        localCallableMemoryAccessor.writeInt32Sync(addr, val, offset),
      writeUInt32: (addr, val, offset) =>
        localCallableMemoryAccessor.writeUInt32(addr, val, offset),
      writeUInt32Sync: (addr, val, offset) =>
        localCallableMemoryAccessor.writeUInt32Sync(addr, val, offset),
      writeInt64: (addr, val, offset) =>
        localCallableMemoryAccessor.writeInt64(addr, val, offset),
      writeInt64Sync: (addr, val, offset) =>
        localCallableMemoryAccessor.writeInt64Sync(addr, val, offset),
      writeUInt64: (addr, val, offset) =>
        localCallableMemoryAccessor.writeUInt64(addr, val, offset),
      writeUInt64Sync: (addr, val, offset) =>
        localCallableMemoryAccessor.writeUInt64Sync(addr, val, offset),
      writeFloat: (addr, val, offset) =>
        localCallableMemoryAccessor.writeFloat(addr, val, offset),
      writeFloatSync: (addr, val, offset) =>
        localCallableMemoryAccessor.writeFloatSync(addr, val, offset),
      writeDouble: (addr, val, offset) =>
        localCallableMemoryAccessor.writeDouble(addr, val, offset),
      writeDoubleSync: (addr, val, offset) =>
        localCallableMemoryAccessor.writeDoubleSync(addr, val, offset),
      writePointer: (addr, val, offset) =>
        localCallableMemoryAccessor.writePointer(addr, val, offset),
      writePointerSync: (addr, val, offset) =>
        localCallableMemoryAccessor.writePointerSync(addr, val, offset),
    };

    const host = new HostAccessor(spyBackend);
    const accessor = new MemcmpReadAccessor(spyBackend, host);
    host.backend = accessor;

    await host.init();

    const testStr = 'Memcmp!';
    const testBuf = Buffer.from(testStr);
    const testAddr = resolveAddress(testBuf);

    const readResult = await accessor.read(testAddr, testBuf.length);
    // Compare against `testBuf` itself (not just re-deriving the string) so
    // the buffer stays referenced across the many async memcmp round-trips
    // above -- `resolveAddress` resolves to a raw address via bun:ffi's
    // `ptr()`, which does not pin the buffer, so nothing else keeps it alive
    // during the read and the GC is otherwise free to reclaim/move it,
    // corrupting the blind byte-by-byte comparison mid-flight.
    expect(readResult.equals(testBuf)).toBe(true);
    expect(readResult.toString()).toBe(testStr);

    // We resolved 7 bytes. Each byte search takes ~8 comparisons.
    expect(callCount).toBeGreaterThan(0);

    host.close();
  });
});
