import { expect, test, describe } from 'bun:test';
import {
  SyncNativePointer,
  NativePointer,
  localMemoryAccessor,
} from '../../packages/xffi/src/index';

describe('Pointer Arithmetic', () => {
  test('should support add, sub, and derefSync on SyncNativePointer', () => {
    const baseAddr = 0x1000;
    const ptr = new SyncNativePointer(baseAddr);

    expect(ptr.add(0x40).toNumber()).toBe(0x1040);
    expect(ptr.add(5 * 4).toNumber()).toBe(0x1014); // 5 elements of size 4

    expect(ptr.sub(0x10).toNumber()).toBe(0x0ff0);
    expect(ptr.add(0x10).sub(0x10).toNumber()).toBe(0x1000);

    // Chaining
    expect(ptr.add(0x100).sub(0x50).add(0x10).toNumber()).toBe(0x10c0);
  });

  test('should support add, sub, and deref on NativePointer', async () => {
    const baseAddr = 0x1000;
    const ptr = new NativePointer(baseAddr);

    expect(ptr.add(0x40).toNumber()).toBe(0x1040);
    expect(ptr.add(5 * 4).toNumber()).toBe(0x1014);

    expect(ptr.sub(0x10).toNumber()).toBe(0x0ff0);
    expect(ptr.add(0x10).sub(0x10).toNumber()).toBe(0x1000);

    // Chaining
    expect(ptr.add(0x100).sub(0x50).add(0x10).toNumber()).toBe(0x10c0);
  });

  test('should handle pointer dereferencing math', () => {
    const accessor = localMemoryAccessor;
    const mem1 = accessor.allocSync(8);
    const mem2 = accessor.allocSync(8);

    const ptr1 = new SyncNativePointer(mem1);
    const ptr2 = new SyncNativePointer(mem2);

    // Write mem2 address into mem1 + offset 4
    ptr1.add(4).writePointerSync(ptr2.toNumber());

    // Dereference it back
    const targetPtr = ptr1.add(4).derefSync();
    expect(targetPtr.toNumber()).toBe(ptr2.toNumber());

    accessor.freeSync(mem1);
    accessor.freeSync(mem2);
  });
});
