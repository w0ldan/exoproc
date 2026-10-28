import { expect, test, describe } from 'bun:test';
import {
  cjitopen,
  cimport,
  SyncStruct,
  SyncNativePointer,
  CType,
} from '../../packages/xffi/src/index.js';
import { toArrayBuffer, type Pointer } from 'bun:ffi';

describe('xffi > cjitopen', () => {
  test('should compile and execute native C functions dynamically', () => {
    const lib = cjitopen({
      fast_multiply: {
        args: [CType.i32, CType.i32],
        returns: CType.i32,
        source: `return arg0 * arg1;`,
      },
      is_even: {
        args: [CType.i32],
        returns: CType.i32, // C evaluates boolean condition to 1 or 0
        source: `return (arg0 % 2) == 0;`,
      },
    });

    // Explicit callability
    expect(lib.symbols.fast_multiply(5, 4)).toBe(20);
    expect(lib.symbols.fast_multiply(-2, 3)).toBe(-6);

    expect(lib.symbols.is_even(4)).toBe(1);
    expect(lib.symbols.is_even(5)).toBe(0);

    // Metadata verification
    expect(lib.symbols.fast_multiply.size).toBeGreaterThan(0);
    expect(lib.symbols.fast_multiply.bytes.length).toBe(
      lib.symbols.fast_multiply.size,
    );
    expect(lib.symbols.fast_multiply.returns).toBe(CType.i32);

    lib.close();
  });

  test('should handle pointer arguments', () => {
    const lib = cjitopen({
      read_first_byte: {
        args: [CType.ptr],
        returns: CType.u8,
        source: `
          unsigned char* buf = (unsigned char*)arg0;
          return buf[0];
        `,
      },
    });

    const buffer = Buffer.from([0x42, 0x00, 0x00]);
    // Explicit call with buffer
    expect(lib.symbols.read_first_byte(buffer)).toBe(0x42);

    // Call with a Struct instance (allocated on stable native heap)
    const libMalloc = cimport({
      malloc: { args: ['size_t'], returns: 'ptr' },
      free: { args: ['ptr'], returns: 'void' },
    });
    const heapPtr = libMalloc.symbols.malloc(1);
    const myStruct = new SyncStruct({ val: 'u8' }, heapPtr as number);
    myStruct.val = 0x55;
    expect(lib.symbols.read_first_byte(myStruct)).toBe(0x55);

    // Call with a raw NativePointer instance
    const myPointer = new SyncNativePointer(myStruct.address);
    expect(lib.symbols.read_first_byte(myPointer)).toBe(0x55);

    libMalloc.symbols.free(heapPtr);
    libMalloc.close();
    lib.close();
  });

  test('performance: should execute function many times within 500ms', () => {
    const lib = cjitopen({
      return_one: {
        args: [],
        returns: 'i32',
        source: `return 1;`,
      },
    });

    let count = 0;
    const start = performance.now();

    while (performance.now() - start < 500) {
      count += lib.symbols.return_one();
    }

    console.log(
      `\n[Performance] cjitopen function called ${count.toLocaleString()} times in 500ms`,
    );

    expect(count).toBeGreaterThan(0);
    lib.close();
  });

  test('should support cjitopen with imports from CImportLibrary', () => {
    // 1. Create a cimport library (e.g., libc's abs or sqrt/pow/malloc/free depending on host OS)
    // We can use standard libc functions that we know exist everywhere.
    const libc = cimport({
      abs: { args: [CType.i32], returns: CType.i32 },
    });

    // 2. Pass libc directly inside the cjitopen options under 'imports'
    // This should automatically generate 'extern int abs(int arg0);' at the top of the C code.
    const jitLib = cjitopen(
      {
        jit_abs_plus_one: {
          args: [CType.i32],
          returns: CType.i32,
          source: `
          // We can call abs(arg0) directly because the extern was auto-generated!
          return abs(arg0) + 1;
        `,
        },
      },
      {
        imports: [libc],
      },
    );

    expect(jitLib.symbols.jit_abs_plus_one(-10)).toBe(11);
    expect(jitLib.symbols.jit_abs_plus_one(5)).toBe(6);

    jitLib.close();
    libc.close();
  });

  test("should support compileMode: 'machineCode' to compile multiple position-independent functions cleanly with direct-address macro resolution", () => {
    const jitLib = cjitopen(
      {
        alloc_and_fill: {
          args: [],
          returns: CType.ptr,
          source: `
          void* ptr = VirtualAlloc(0, 1024, 0x3000, 0x04);
          if (!ptr) return 0;
          char* msg = (char*)ptr;
          msg[0] = 'H';
          msg[1] = 'e';
          msg[2] = 'l';
          msg[3] = 'l';
          msg[4] = 'o';
          msg[5] = '\\0';
          return ptr;
        `,
        },
        cleanup: {
          args: [CType.ptr],
          returns: CType.i32,
          source: `
          return VirtualFree((void*)arg0, 0, 0x8000);
        `,
        },
      },
      {
        compileMode: 'machineCode',
      },
    );

    const allocatedPtr = jitLib.symbols.alloc_and_fill();
    expect(allocatedPtr).toBeGreaterThan(0);

    // Read to make sure the memory contains our greeting
    const buffer = Buffer.from(toArrayBuffer(allocatedPtr as Pointer, 0, 6));
    expect(buffer.toString()).toBe('Hello\0');

    const freeSuccess = jitLib.symbols.cleanup(allocatedPtr);
    expect(freeSuccess).toBe(1);

    jitLib.close();
  });
});
