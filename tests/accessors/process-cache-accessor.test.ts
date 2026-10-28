import { expect, test, describe } from 'bun:test';
import {
  AbstractSyncCallableMemoryAccessor,
  type CFunction,
  type CCallResult,
  type AddressLike,
  Kernel32Impl,
  GetModuleHandleExFlag,
  MemoryBasicInformation,
} from '../../packages/xffi/src/index.js';
import { resolveAddress } from '../../packages/xffi/src/ffi.js';
import {
  ProcessCacheAccessor,
  HostAccessor,
} from '../../packages/accessors/src/index.js';

describe('accessors > ProcessCacheAccessor', () => {
  test('should lazily cache process metadata and intercept/cache module handle lookups', async () => {
    let callCount = 0;
    const writeMemory = new Map<number, Buffer>();

    // Mock backend accessor -- only the truly abstract sync members need
    // overriding; AbstractSyncCallableMemoryAccessor supplies enableDebug/
    // disableDebug/allocNear(Sync)/the typed scalar read*/write* helpers/the
    // async read/write/alloc/.../call twins (each forwards to its Sync version).
    class MockBackend extends AbstractSyncCallableMemoryAccessor {
      readSync(addr: AddressLike, size: number, offset = 0): Buffer {
        const addrVal = resolveAddress(addr) + offset;
        return writeMemory.get(addrVal) || Buffer.alloc(size);
      }
      writeSync(
        addr: AddressLike,
        data: Buffer | Uint8Array,
        offset = 0,
      ): number {
        const addrVal = resolveAddress(addr) + offset;
        const buf = data instanceof Buffer ? data : Buffer.from(data);
        writeMemory.set(addrVal, buf);
        return buf.length;
      }
      allocSync(): AddressLike {
        // Return a dummy heap address
        return 0x900000;
      }
      freeSync(): boolean {
        return true;
      }
      protectSync(): number {
        return 0;
      }
      querySync(): MemoryBasicInformation {
        return new MemoryBasicInformation();
      }
      machineCodeSync(): never {
        throw new Error('machineCode not implemented in this mock');
      }
      // eslint-disable-next-line require-yield
      *scanSync(): Generator<never> {
        throw new Error('scan not implemented in this mock');
      }
      callSync(func: CFunction, args: any[]): CCallResult {
        callCount++;
        const funcAddr = resolveAddress(func.ptr);
        const getModuleHandleExAAddr = resolveAddress(
          Kernel32Impl.GetModuleHandleExA.ptr,
        );
        const getModuleHandleAAddr = resolveAddress(
          Kernel32Impl.GetModuleHandleA.ptr,
        );

        if (funcAddr === getModuleHandleExAAddr && args.length >= 3) {
          const outPtr = resolveAddress(args[2]);
          // Write a mock module handle (0x778899n)
          const handleBuf = Buffer.alloc(8);
          handleBuf.writeBigUInt64LE(0x778899n, 0);
          writeMemory.set(outPtr, handleBuf);
          return 1;
        }

        if (funcAddr === getModuleHandleAAddr && args.length >= 1) {
          // Return mock handle directly
          return 0x556677n;
        }

        return 0;
      }
    }

    const mockBackend = new MockBackend(1234); // Mock PID
    const host = new HostAccessor(mockBackend);
    const cacheAccessor = new ProcessCacheAccessor(mockBackend, host);
    host.backend = cacheAccessor;

    // 1. Verify GetModuleHandleExA caching logic
    const moduleName = 'msvcrt.dll';
    const nameBuf = Buffer.from(moduleName + '\0');
    const tempPtr = 0x10000; // Mock name pointer
    const outPtr = 0x20000; // Mock output pointer

    // First, register module name in writeMemoryCache by calling write on the cacheAccessor
    await cacheAccessor.write(tempPtr, nameBuf);

    // Initial call to GetModuleHandleExA should invoke the backend
    expect(callCount).toBe(0);
    const success1 = await cacheAccessor.call(
      Kernel32Impl.GetModuleHandleExA,
      GetModuleHandleExFlag.UNCHANGED_REFCOUNT,
      tempPtr,
      outPtr,
    );
    expect(success1).toBe(1);
    expect(callCount).toBe(1);

    // Verify outPtr got written with the mock handle
    const outBuf1 = writeMemory.get(outPtr);
    expect(outBuf1).not.toBeUndefined();
    expect(outBuf1!.readBigUInt64LE(0)).toBe(0x778899n);

    // Clear outPtr value in writeMemory to prove caching writes it directly
    writeMemory.set(outPtr, Buffer.alloc(8));

    // Second call to GetModuleHandleExA should NOT invoke the backend and hit cache
    const success2 = await cacheAccessor.call(
      Kernel32Impl.GetModuleHandleExA,
      GetModuleHandleExFlag.UNCHANGED_REFCOUNT,
      tempPtr,
      outPtr,
    );
    expect(success2).toBe(1);
    expect(callCount).toBe(1); // Call count remains 1!

    // Verify outPtr was written from cache
    const outBuf2 = writeMemory.get(outPtr);
    expect(outBuf2!.readBigUInt64LE(0)).toBe(0x778899n);

    // 2. Verify GetModuleHandleA caching logic
    const tempPtrA = 0x30000;
    await cacheAccessor.write(tempPtrA, Buffer.from('user32.dll\0'));

    // Initial call should go to backend
    const hMod1 = await cacheAccessor.call(
      Kernel32Impl.GetModuleHandleA,
      tempPtrA,
    );
    expect(hMod1).toBe(0x556677n);
    expect(callCount).toBe(2);

    // Subsequent call should hit cache
    const hMod2 = await cacheAccessor.call(
      Kernel32Impl.GetModuleHandleA,
      tempPtrA,
    );
    expect(hMod2).toBe(0x556677n);
    expect(callCount).toBe(2); // Call count remains 2!
  });

  test('should intercept GetCurrentProcess and GetCurrentProcessId', async () => {
    let callCount = 0;
    class MockBackend extends AbstractSyncCallableMemoryAccessor {
      readSync(): Buffer {
        return Buffer.alloc(0);
      }
      writeSync(): number {
        return 0;
      }
      allocSync(): AddressLike {
        return 0;
      }
      freeSync(): boolean {
        return true;
      }
      protectSync(): number {
        return 0;
      }
      querySync(): MemoryBasicInformation {
        return new MemoryBasicInformation();
      }
      machineCodeSync(): never {
        throw new Error('machineCode not implemented in this mock');
      }
      // eslint-disable-next-line require-yield
      *scanSync(): Generator<never> {
        throw new Error('scan not implemented in this mock');
      }
      callSync(): CCallResult {
        callCount++;
        return 0;
      }
    }

    const mockBackend = new MockBackend(9999);
    const host = new HostAccessor(mockBackend);
    const cacheAccessor = new ProcessCacheAccessor(mockBackend, host);
    host.backend = cacheAccessor;

    const hProc = await cacheAccessor.call(Kernel32Impl.GetCurrentProcess);

    expect(hProc).toBe(0xffffffffffffffffn);
    expect(callCount).toBe(0);

    const pid = await cacheAccessor.call(Kernel32Impl.GetCurrentProcessId);
    expect(pid).toBe(9999);
    expect(callCount).toBe(0);
  });
});
