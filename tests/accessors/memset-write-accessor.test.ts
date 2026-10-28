import { expect, test, describe } from 'bun:test';
import {
  localCallableMemoryAccessor,
  type ISyncCallableMemoryAccessor,
  type CFunction,
  type CCallResult,
} from '../../packages/xffi/src/index.js';
import { resolveAddress } from '../../packages/xffi/src/ffi.js';
import {
  MemsetWriteAccessor,
  HostAccessor,
} from '../../packages/accessors/src/index.js';

describe('accessors > MemsetWriteAccessor', () => {
  test('should decompose and optimize write operations using memset runs', async () => {
    const calls: { address: number; value: number; count: number }[] = [];

    // Create a spy accessor wrapping localCallableMemoryAccessor
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

      // Override call to spy on memset and then forward to the local accessor
      call: async (func: CFunction, ...args: any[]): Promise<CCallResult> => {
        // Record only the memset calls (3 arguments: targetAddr, runValue, runCount)
        if (
          args.length === 3 &&
          typeof args[1] === 'number' &&
          typeof args[2] === 'number'
        ) {
          calls.push({
            address: Number(args[0]),
            value: Number(args[1]),
            count: Number(args[2]),
          });
        }
        return localCallableMemoryAccessor.call(func, ...args);
      },
      callSync: (func: CFunction, ...args: any[]): CCallResult => {
        if (
          args.length === 3 &&
          typeof args[1] === 'number' &&
          typeof args[2] === 'number'
        ) {
          calls.push({
            address: Number(args[0]),
            value: Number(args[1]),
            count: Number(args[2]),
          });
        }
        return localCallableMemoryAccessor.callSync(func, ...args);
      },

      // Stub for missing helper methods to satisfy interface
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
    const accessor = new MemsetWriteAccessor(spyBackend, host);
    host.backend = accessor;

    const buf = Buffer.alloc(10);
    const bufAddress = Number(resolveAddress(buf));

    // Test pattern: 5 ones, 1 two, 4 threes
    const testData = Buffer.from([1, 1, 1, 1, 1, 2, 3, 3, 3, 3]);

    const written = await accessor.write(bufAddress, testData);
    expect(written).toBe(10);

    // Verify buffer content was written correctly via memset
    expect(Array.from(buf)).toEqual([1, 1, 1, 1, 1, 2, 3, 3, 3, 3]);

    // Verify that memset calls were optimized into exactly 3 calls with combined counts!
    expect(calls.length).toBe(3);

    expect(calls[0]).toEqual({
      address: bufAddress,
      value: 1,
      count: 5,
    });

    expect(calls[1]).toEqual({
      address: bufAddress + 5,
      value: 2,
      count: 1,
    });

    expect(calls[2]).toEqual({
      address: bufAddress + 6,
      value: 3,
      count: 4,
    });
  });
});
