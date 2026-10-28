import { expect, test, describe } from 'bun:test';
import {
  registerStub,
  isStub,
  RemoteCallableMemoryAccessor,
  currentProcessId,
  createRemoteMachineCode,
  cmachinecode,
  type Stub,
} from '../../packages/xffi/src/index.js';

describe('xffi > Stub System', () => {
  test('should register and discover stubs', async () => {
    // 1. Register a common instruction: C3 (ret)
    const retDescriptor = registerStub('C3', { limit: 5 });

    // 2. Wait until ready
    await retDescriptor.whenReady();
    expect(retDescriptor.ready).toBe(true);

    // 3. Get stub
    const stub: Stub = retDescriptor.getStub();
    expect(stub).toBeDefined();
    expect(stub.address).toBeGreaterThan(0);
    expect(stub.bytes).toEqual([0xc3]);
    expect(stub.isStub).toBe(true);

    // 4. Test type guard
    expect(isStub(stub)).toBe(true);
    expect(isStub({})).toBe(false);
    expect(isStub(null)).toBe(false);
  });

  test('should return the same object when cloneForAddress or createRemoteMachineCode is called on a Stub', async () => {
    const retDescriptor = registerStub('C3', { limit: 1 });
    await retDescriptor.whenReady();
    const stub = retDescriptor.getStub();

    // cloneForAddress of a Stub returns a new Stub wrapping that address
    const clone = stub.cloneForAddress(0x123456);
    expect(clone.address).toBe(0x123456 as any);
    expect(isStub(clone)).toBe(true);

    // createRemoteMachineCode called on a Stub should return the stub itself
    const remoteMachineCode = createRemoteMachineCode(0x123456, stub);
    expect(remoteMachineCode).toBe(stub);
  });

  test('accessor machineCode() should not allocate or write when passed a Stub', async () => {
    const accessor = new RemoteCallableMemoryAccessor(currentProcessId);

    // Track alloc / write calls or mock them to verify no calls are made
    let allocCalled = false;
    let writeCalled = false;

    // Save original methods
    const origAlloc = accessor.alloc;
    const origWrite = accessor.write;
    const origAllocSync = accessor.allocSync;
    const origWriteSync = accessor.writeSync;

    accessor.alloc = async (...args) => {
      allocCalled = true;
      return origAlloc.apply(accessor, args);
    };
    accessor.write = async (...args) => {
      writeCalled = true;
      return origWrite.apply(accessor, args);
    };
    accessor.allocSync = (...args) => {
      allocCalled = true;
      return origAllocSync.apply(accessor, args);
    };
    accessor.writeSync = (...args) => {
      writeCalled = true;
      return origWriteSync.apply(accessor, args);
    };

    const retDescriptor = registerStub('C3', { limit: 1 });
    await retDescriptor.whenReady();
    const stub = retDescriptor.getStub();

    // machineCode() on a Stub should return the existing address without alloc or write
    const result = await accessor.machineCode(stub);
    expect(result).toBe(stub.address);
    expect(allocCalled).toBe(false);
    expect(writeCalled).toBe(false);

    // machineCodeSync() likewise
    const resultSync = accessor.machineCodeSync(stub);
    expect(resultSync).toBe(stub.address);
    expect(allocCalled).toBe(false);
    expect(writeCalled).toBe(false);
  });

  test('shouldCloneForAccessor should return correct boolean values', async () => {
    const retDescriptor = registerStub('C3', { limit: 1 });
    await retDescriptor.whenReady();
    const stub = retDescriptor.getStub();

    // Stubs should always return false
    expect(stub.shouldCloneForAccessor(null)).toBe(false);

    // Local machineCode should return true
    const localShell = cmachinecode({
      source: 'void machineCode() {}',
    });
    expect(localShell.shouldCloneForAccessor(null)).toBe(true);

    // Remote machineCode should return false
    const remoteShell = createRemoteMachineCode(0x123456, localShell);
    expect(remoteShell.shouldCloneForAccessor(null)).toBe(false);
  });
});
