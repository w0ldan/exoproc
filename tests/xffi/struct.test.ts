import { expect, test, describe } from 'bun:test';
import { toArrayBuffer } from 'bun:ffi';
import {
  cjitopen,
  cimport,
  sizeof,
  compileStruct,
  SyncStruct,
  Struct,
  struct,
  SyncNativeMemory,
  SyncNativePointer,
  MemoryBasicInformation,
  LocalMemoryAccessor,
} from '../../packages/xffi/src/index.js';

describe('xffi > Struct and Memory Management', () => {
  test('should calculate exact sizeof for Win64/C types', () => {
    // Primitives
    expect(sizeof('i8')).toBe(1);
    expect(sizeof('BYTE')).toBe(1);

    expect(sizeof('i16')).toBe(2);
    expect(sizeof('WORD')).toBe(2);

    expect(sizeof('i32')).toBe(4);
    expect(sizeof('DWORD')).toBe(4);
    expect(sizeof('INT')).toBe(4);

    expect(sizeof('i64')).toBe(8);
    expect(sizeof('SIZE_T')).toBe(8);

    // Pointers
    expect(sizeof('ptr')).toBe(8);
    expect(sizeof('HANDLE')).toBe(8);
    expect(sizeof('cstring')).toBe(8);
  });

  test('should calculate sizeof for StructSchema dynamically', () => {
    const MyStructSchema = {
      id: 'DWORD', // 4 bytes, offset 0
      handle: 'HANDLE', // 8 bytes, offset 8 (due to 8-byte alignment)
      isActive: 'BOOL', // 4 bytes, offset 16
      flags: 'BYTE', // 1 byte, offset 20. Total size: 24 (aligned to 8)
    };

    const size = sizeof(MyStructSchema);
    expect(size).toBe(24);
  });

  test('should calculate correct alignment and size for nested structs', () => {
    const STRUCT_A = {
      x: 'i32',
      y: 'i32',
    }; // size 8, alignment 4

    const STRUCT_B = {
      c: 'i8', // size 1, offset 0
      a: STRUCT_A, // size 8, aligns to STRUCT_A's max alignment (4). Offset 4, size 8.
    }; // Total size: 12 (aligned to 4)

    const sizeA = sizeof(STRUCT_A);
    const sizeB = sizeof(STRUCT_B);

    expect(sizeA).toBe(8);
    expect(sizeB).toBe(12);

    const computedB = compileStruct(STRUCT_B);
    expect(computedB.fields.a.offset).toBe(4);
  });

  test('should support inline fixed-size arrays (string syntax and tuple syntax)', () => {
    const ARRAY_STRUCT_SCHEMA = {
      id: 'i32', // 4 bytes, offset 0
      szExeFile: 'char[260]', // 260 bytes, offset 4
      myNumbers: ['i32', 5], // 20 bytes, offset 264
      flags: 'BYTE', // 1 byte, offset 284
    }; // Total size: 288 (aligned to 4)

    expect(sizeof(ARRAY_STRUCT_SCHEMA)).toBe(288);

    const computed = compileStruct(ARRAY_STRUCT_SCHEMA);
    expect(computed.fields.szExeFile.offset).toBe(4);
    expect(computed.fields.myNumbers.offset).toBe(264);
    expect(computed.fields.flags.offset).toBe(284);

    // Create instance (implicitly allocated)
    const process = new SyncStruct(ARRAY_STRUCT_SCHEMA);

    // Test String array (gets/sets as JS string, null-terminated)
    process.szExeFile = 'notepad.exe';
    expect(process.szExeFile).toBe('notepad.exe');

    // Verify the null termination inside the raw DataView memory
    expect(process._view.getUint8(4 + 11)).toBe(0); // 'notepad.exe' has length 11, so offset 4 + 11 must be 0

    // Test Numeric array (gets/sets zero-copy TypedArray)
    expect(process.myNumbers).toBeInstanceOf(Int32Array);
    expect(process.myNumbers.length).toBe(5);

    process.myNumbers[0] = 100;
    process.myNumbers[4] = 500;
    expect(process.myNumbers[0]).toBe(100);
    expect(process.myNumbers[4]).toBe(500);

    // Mutating TypedArray writes directly to underlying memory (zero-copy)
    expect(process._view.getInt32(264, true)).toBe(100);
    expect(process._view.getInt32(264 + 16, true)).toBe(500);

    // wholesale assignment is also supported
    process.myNumbers = [11, 22, 33, 44, 55];
    expect(process.myNumbers[0]).toBe(11);
    expect(process.myNumbers[4]).toBe(55);
  });

  test('should create and manipulate memory with Struct getters and setters', () => {
    const POINT_SCHEMA = {
      x: 'i32', // 4 bytes, offset 0
      y: 'i32', // 4 bytes, offset 4
    } as const;

    const size = sizeof(POINT_SCHEMA);

    // We will allocate a temporary memory buffer using Bun's FFI or libc
    const lib = cimport({
      malloc: { args: ['size_t'], returns: 'ptr' },
      free: { args: ['ptr'], returns: 'void' },
    });

    const ptr = lib.symbols.malloc(size);
    expect(ptr).not.toBe(0);

    // Create a struct view over the allocated memory
    const point = new SyncStruct(POINT_SCHEMA, ptr as number);

    // Test setting values (writes to native memory)
    point.x = 1337;
    point.y = 42;

    // Test getting values (reads from native memory)
    expect(point.x).toBe(1337);
    expect(point.y).toBe(42);

    // Verify the JS instance also behaves as a valid NativePointer
    expect(point.toNumber()).toBe(ptr as number);

    // Cleanup
    lib.symbols.free(ptr);
    lib.close();
  });

  test('should automatically allocate memory if pointer is not provided', () => {
    const POINT_SCHEMA = {
      x: 'i32',
      y: 'i32',
    } as const;

    // No pointer provided, it will allocate JS Buffer implicitly
    const point = new SyncStruct(POINT_SCHEMA);

    expect(point._view.byteLength).toBe(8);
    expect(point._view.buffer).toBeDefined();
    expect(point.address).not.toBe(BigInt(0));

    point.x = 55;
    point.y = 99;

    expect(point.x).toBe(55);
    expect(point.y).toBe(99);

    // Values should directly be accessible in the underlying JS buffer
    expect(point._view.getInt32(0, true)).toBe(55);
    expect(point._view.getInt32(4, true)).toBe(99);
  });

  test('should support NativeMemory hierarchy, expose size, and provide a beautiful toString representation', () => {
    const POINT_SCHEMA = {
      x: 'i32',
      y: 'i32',
    } as const;

    const point = new SyncStruct(POINT_SCHEMA);

    // 1. Check inheritance
    expect(point).toBeInstanceOf(SyncNativeMemory);

    // 2. Check size
    expect(point.size).toBe(8);

    // 3. Test NativeMemory class directly
    const rawMem = new SyncNativeMemory(point.address, 8);
    expect(rawMem.size).toBe(8);
    expect(rawMem.toNumber()).toBe(point.toNumber());

    // 4. Test beautiful custom toString output of the Struct!
    point.x = 123;
    point.y = 456;
    const str = point.toString();
    expect(str).toContain('Struct { x: 123, y: 456 } at 0x');
    expect(str).toContain('(8 bytes)');
  });

  test('should handle negative pseudo-handles like (HANDLE)-1 without breaking precision or sign', () => {
    const lib = cjitopen({
      get_pseudo_1_ptr: {
        args: [],
        returns: 'ptr',
        source: `return (void*)-1;`,
      },
      get_pseudo_1_u64: {
        args: [],
        returns: 'u64',
        source: `return (unsigned long long)-1;`,
      },
      get_pseudo_2_u64: {
        args: [],
        returns: 'u64',
        source: `return (unsigned long long)-2;`,
      },
      get_pseudo_3_u64: {
        args: [],
        returns: 'u64',
        source: `return (unsigned long long)-3;`,
      },
      get_pseudo_4_u64: {
        args: [],
        returns: 'u64',
        source: `return (unsigned long long)-4;`,
      },
      verify_pseudo_1: {
        args: ['u64'],
        returns: 'bool',
        source: `return (void*)arg0 == (void*)-1;`,
      },
      verify_pseudo_2: {
        args: ['u64'],
        returns: 'bool',
        source: `return (void*)arg0 == (void*)-2;`,
      },
      verify_pseudo_3: {
        args: ['u64'],
        returns: 'bool',
        source: `return (void*)arg0 == (void*)-3;`,
      },
      verify_pseudo_4: {
        args: ['u64'],
        returns: 'bool',
        source: `return (void*)arg0 == (void*)-4;`,
      },
    });

    // 1. Test standard 'ptr' return type (Float64 rounding)
    const h1Ptr = lib.symbols.get_pseudo_1_ptr();
    console.log(
      `\n[Pseudo-Handle] Received via 'ptr': ${h1Ptr} (type: ${typeof h1Ptr})`,
    );
    const ptrObj1 = new SyncNativePointer(h1Ptr);
    expect(ptrObj1.toNumber()).toBe(-1);
    expect(ptrObj1.toString()).toBe('0xFFFFFFFFFFFFFFFF');

    // 2. Test exact 'u64' return type (100% precise BigInt from C!)
    const u1 = lib.symbols.get_pseudo_1_u64();
    const u2 = lib.symbols.get_pseudo_2_u64();
    const u3 = lib.symbols.get_pseudo_3_u64();
    const u4 = lib.symbols.get_pseudo_4_u64();

    console.log(
      `[Pseudo-Handle] Received via 'u64' (precise BigInt): u1=${u1}, u2=${u2}, u3=${u3}, u4=${u4}`,
    );

    const ptr1 = new SyncNativePointer(u1);
    const ptr2 = new SyncNativePointer(u2);
    const ptr3 = new SyncNativePointer(u3);
    const ptr4 = new SyncNativePointer(u4);

    // Verify exact 100% precise recovery of -1, -2, -3, -4 directly from C functions!
    expect(ptr1.toNumber()).toBe(-1);
    expect(ptr1.toString()).toBe('0xFFFFFFFFFFFFFFFF');
    expect(lib.symbols.verify_pseudo_1(u1)).toBe(true);

    expect(ptr2.toNumber()).toBe(-2);
    expect(ptr2.toString()).toBe('0xFFFFFFFFFFFFFFFE');
    expect(lib.symbols.verify_pseudo_2(u2)).toBe(true);

    expect(ptr3.toNumber()).toBe(-3);
    expect(ptr3.toString()).toBe('0xFFFFFFFFFFFFFFFD');
    expect(lib.symbols.verify_pseudo_3(u3)).toBe(true);

    expect(ptr4.toNumber()).toBe(-4);
    expect(ptr4.toString()).toBe('0xFFFFFFFFFFFFFFFC');
    expect(lib.symbols.verify_pseudo_4(u4)).toBe(true);

    expect(ptr1.address).toBe(-1 as any);
    expect(ptr1.toNumber()).toBe(-1);
    expect(ptr1.toString()).toContain('0xFFFFFFFFFFFFFFFF');
    expect(lib.symbols.verify_pseudo_1(ptr1)).toBe(true);

    expect(ptr2.address).toBe(-2 as any);
    expect(ptr2.toNumber()).toBe(-2);
    expect(ptr2.toString()).toContain('0xFFFFFFFFFFFFFFFE');
    expect(lib.symbols.verify_pseudo_2(ptr2)).toBe(true);

    expect(ptr3.address).toBe(-3 as any);
    expect(ptr3.toNumber()).toBe(-3);
    expect(ptr3.toString()).toContain('0xFFFFFFFFFFFFFFFD');
    expect(lib.symbols.verify_pseudo_3(ptr3)).toBe(true);

    expect(ptr4.address).toBe(-4 as any);
    expect(ptr4.toNumber()).toBe(-4);
    expect(ptr4.toString()).toContain('0xFFFFFFFFFFFFFFFC');
    expect(lib.symbols.verify_pseudo_4(ptr4)).toBe(true);

    lib.close();
  });

  test('should support static alloc factory methods for Struct (async) and SyncStruct (sync)', async () => {
    const SCHEMA = {
      val1: 'i32',
      val2: 'i32',
    } as const;

    // 1. SyncStruct.alloc
    const syncPoint = SyncStruct.alloc(SCHEMA);
    expect(syncPoint).toBeInstanceOf(SyncNativeMemory);
    expect(syncPoint.size).toBe(8);
    syncPoint.val1 = 12345;
    syncPoint.val2 = 67890;
    expect(syncPoint.val1).toBe(12345);
    expect(syncPoint.val2).toBe(67890);

    // 2. Struct.alloc
    const asyncPoint = await Struct.alloc(SCHEMA);
    expect(asyncPoint.size).toBe(8);
    await asyncPoint.set('val1', 99999);
    await asyncPoint.set('val2', 88888);
    expect(await asyncPoint.val1).toBe(99999);
    expect(await asyncPoint.val2).toBe(88888);
  });

  test('should support consolidated MemoryBasicInformation (SyncStruct) alloc factories', async () => {
    // MemoryBasicInformation is defined using struct
    const asyncMbi = await MemoryBasicInformation.alloc();
    expect(asyncMbi.size).toBe(48);
    await asyncMbi.set('RegionSize', 16384n);
    expect(await asyncMbi.RegionSize).toBe(16384n);

    const syncMbi2 = MemoryBasicInformation.allocSync();
    expect(syncMbi2.size).toBe(48);
    syncMbi2.RegionSize = 32768n;
    expect(syncMbi2.RegionSize).toBe(32768n);
  });

  test('should support unified nested struct classes and mode inheritance', async () => {
    const DeepInner = struct({
      a: 'i32',
      b: 'i32',
    });
    const Inner = struct({
      x: 'i32',
      y: 'i32',
      deep: DeepInner,
    });
    const Outer = struct({
      flag: 'i8',
      inner: Inner,
    });

    // 1. Sync Allocation and Nested Read/Write
    const outerSync = Outer.allocSync();
    expect(outerSync.size).toBe(20); // aligned to 4
    outerSync.flag = 12;
    outerSync.inner = { x: 100, y: 200, deep: { a: 11, b: 22 } };

    expect(outerSync.flag).toBe(12);
    expect(outerSync.inner.x).toBe(100);
    expect(outerSync.inner.y).toBe(200);
    expect(outerSync.inner.deep.a).toBe(11);
    expect(outerSync.inner.deep.b).toBe(22);

    // Write to nested field directly
    outerSync.inner.x = 300;
    outerSync.inner.deep.a = 33;
    expect(outerSync.inner.x).toBe(300);
    expect(outerSync.inner.deep.a).toBe(33);

    // Direct bun:ffi memory address validation using toArrayBuffer
    const nativeBuf = toArrayBuffer(outerSync.address, 0, outerSync.size);
    const ffiView = new DataView(nativeBuf);

    // Assert physical memory matches perfectly with logical/struct fields
    expect(ffiView.getInt8(0)).toBe(12); // flag: i8 at offset 0
    expect(ffiView.getInt32(4, true)).toBe(300); // inner.x: i32 at offset 4
    expect(ffiView.getInt32(8, true)).toBe(200); // inner.y: i32 at offset 8
    expect(ffiView.getInt32(12, true)).toBe(33); // inner.deep.a: i32 at offset 12
    expect(ffiView.getInt32(16, true)).toBe(22); // inner.deep.b: i32 at offset 16

    // Assert that the bun:ffi direct memory buffer is 100% identical to the struct's internal _view DataView buffer
    for (let i = 0; i < outerSync.size; i++) {
      expect(ffiView.getUint8(i)).toBe(outerSync._view.getUint8(i));
    }

    // 2. Async Allocation and Nested Read/Write
    const outerAsync = await Outer.alloc();
    expect(outerAsync.size).toBe(20);
    await outerAsync.set('flag', 24);
    await outerAsync.set('inner', { x: 400, y: 500, deep: { a: 44, b: 55 } });

    expect(await outerAsync.flag).toBe(24);

    const innerAsync = await outerAsync.inner;
    expect(await innerAsync.x).toBe(400);
    expect(await innerAsync.y).toBe(500);

    const deepAsync = await innerAsync.deep;
    expect(await deepAsync.a).toBe(44);
    expect(await deepAsync.b).toBe(55);

    // Write to nested field directly in async mode
    await innerAsync.set('x', 600);
    await deepAsync.set('a', 66);
    expect(await innerAsync.x).toBe(600);
    expect(await deepAsync.a).toBe(66);

    // 3. Elegant Direct Instantiation allocation (allocSync routing)
    const elegantInst = new Outer();
    expect(elegantInst.size).toBe(20);
    elegantInst.flag = 42;
    elegantInst.inner = { x: 777, y: 888, deep: { a: 77, b: 88 } };

    expect(elegantInst.flag).toBe(42);
    expect(elegantInst.inner.x).toBe(777);
    expect(elegantInst.inner.y).toBe(888);
    expect(elegantInst.inner.deep.a).toBe(77);
    expect(elegantInst.inner.deep.b).toBe(88);

    elegantInst.inner.x = 999;
    elegantInst.inner.deep.a = 99;
    expect(elegantInst.inner.x).toBe(999);
    expect(elegantInst.inner.deep.a).toBe(99);

    // 4. Elegant Direct Instantiation with Custom Memory Accessor (LocalMemoryAccessor)
    const localAccessor = new LocalMemoryAccessor();
    const elegantWithAccessor = new Outer(localAccessor);
    expect(elegantWithAccessor.size).toBe(20);
    elegantWithAccessor.flag = 55;
    expect(elegantWithAccessor.flag).toBe(55);
  });

  test('should support quick constructor initialization and mass assignment (.assign)', async () => {
    const DeepInner = struct({
      a: 'i32',
      b: 'i32',
    });
    const Inner = struct({
      x: 'i32',
      y: 'i32',
      deep: DeepInner,
    });
    const Outer = struct({
      flag: 'i8',
      inner: Inner,
    });

    // 1. Quick constructor initialization (synchronous)
    const outerSync = new Outer({
      flag: 12,
      inner: { x: 100, y: 200, deep: { a: 11, b: 22 } },
    });

    expect(outerSync.flag).toBe(12);
    expect(outerSync.inner.x).toBe(100);
    expect(outerSync.inner.y).toBe(200);
    expect(outerSync.inner.deep.a).toBe(11);
    expect(outerSync.inner.deep.b).toBe(22);

    // 2. Synchronous mass assignment via .assign()
    outerSync.assign({
      flag: 24,
      inner: { x: 300, y: 400, deep: { a: 33, b: 44 } },
    });

    expect(outerSync.flag).toBe(24);
    expect(outerSync.inner.x).toBe(300);
    expect(outerSync.inner.y).toBe(400);
    expect(outerSync.inner.deep.a).toBe(33);
    expect(outerSync.inner.deep.b).toBe(44);

    // 3. Async mass assignment via .assign()
    const outerAsync = await Outer.alloc();
    await outerAsync.assign({
      flag: 42,
      inner: { x: 500, y: 600, deep: { a: 55, b: 66 } },
    });

    expect(await outerAsync.flag).toBe(42);
    const inner = await outerAsync.inner;
    expect(await inner.x).toBe(500);
    expect(await inner.y).toBe(600);
    const deep = await inner.deep;
    expect(await deep.a).toBe(55);
    expect(await deep.b).toBe(66);
  });

  test('should support quick value assignment during .alloc() and .allocSync()', async () => {
    const DeepInner = struct({
      a: 'i32',
      b: 'i32',
    });
    const Inner = struct({
      x: 'i32',
      y: 'i32',
      deep: DeepInner,
    });
    const Outer = struct({
      flag: 'i8',
      inner: Inner,
    });

    // 1. allocSync with initial values directly
    const outerSync = Outer.allocSync({
      flag: 99,
      inner: { x: 111, y: 222, deep: { a: 333, b: 444 } },
    });

    expect(outerSync.flag).toBe(99);
    expect(outerSync.inner.x).toBe(111);
    expect(outerSync.inner.y).toBe(222);
    expect(outerSync.inner.deep.a).toBe(333);
    expect(outerSync.inner.deep.b).toBe(444);

    // 2. alloc with initial values directly (async)
    const outerAsync = await Outer.alloc({
      flag: 88,
      inner: { x: 555, y: 666, deep: { a: 777, b: 888 } },
    });

    expect(await outerAsync.flag).toBe(88);
    const inner = await outerAsync.inner;
    expect(await inner.x).toBe(555);
    expect(await inner.y).toBe(666);
    const deep = await inner.deep;
    expect(await deep.a).toBe(777);
    expect(await deep.b).toBe(888);
  });

  test('should throw an error if an invalid field name is provided during value assignment', async () => {
    const Simple = struct({
      x: 'i32',
    });

    // 1. Constructor assignment
    expect(() => {
      new Simple({ y: 100 } as any);
    }).toThrow("Field 'y' does not exist in struct schema.");

    // 2. assign() method
    const inst = new Simple();
    expect(() => {
      inst.assign({ y: 200 } as any);
    }).toThrow("Field 'y' does not exist in struct schema.");

    // 3. allocSync() method
    expect(() => {
      Simple.allocSync({ y: 300 } as any);
    }).toThrow("Field 'y' does not exist in struct schema.");

    // 4. alloc() method (async)
    expect(async () => {
      await Simple.alloc({ y: 400 } as any);
    }).toThrow("Field 'y' does not exist in struct schema.");
  });
});
