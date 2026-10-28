import { expect, test, describe } from 'bun:test';
import { ccallback, cjitopen, CType } from '../../packages/xffi/src/index.js';

describe('xffi > ccallback', () => {
  test('should create a callback and expose a valid non-null ptr', () => {
    const cb = ccallback(() => {}, { args: [], returns: CType.void });
    expect(cb.ptr).toBeDefined();
    expect(Number(cb.ptr)).toBeGreaterThan(0);
    cb.close();
  });

  test('should be callable from native C code via cjitopen', () => {
    let called = false;
    let receivedValue = 0;

    // A callback that C will call with the number 42
    const cb = ccallback(
      (val: number) => {
        called = true;
        receivedValue = val;
      },
      { args: [CType.i32], returns: CType.void },
    );

    // JIT-compile a tiny C function that calls our JS callback
    const lib = cjitopen({
      invoke_callback: {
        args: [CType.ptr, CType.i32],
        returns: CType.void,
        source: `
          typedef void (*CallbackFn)(int);
          CallbackFn fn = (CallbackFn)(void*)arg0;
          fn(arg1);
        `,
      },
    });

    lib.symbols.invoke_callback(cb.ptr, 42);

    expect(called).toBe(true);
    expect(receivedValue).toBe(42);

    lib.close();
    cb.close();
  });

  test('should support returning a value from the callback to C', () => {
    let computedResult = 0;

    // Callback: multiplies two numbers and returns the product
    const multiplierCb = ccallback((a: number, b: number) => a * b, {
      args: [CType.i32, CType.i32],
      returns: CType.i32,
    });

    // C calls the callback and stores the result in a shared int
    const resultBuf = new Int32Array(1);

    const lib = cjitopen({
      call_multiplier: {
        args: [CType.ptr, CType.i32, CType.i32, CType.ptr],
        returns: CType.void,
        source: `
          typedef int (*MulFn)(int, int);
          MulFn fn = (MulFn)(void*)arg0;
          int result = fn(arg1, arg2);
          int* out = (int*)arg3;
          *out = result;
        `,
      },
    });

    lib.symbols.call_multiplier(multiplierCb.ptr, 7, 6, resultBuf);
    computedResult = resultBuf[0]!;

    expect(computedResult).toBe(42);

    lib.close();
    multiplierCb.close();
  });

  test('should support CTypeOrString string names in signature', () => {
    const cb = ccallback((x: number) => x + 1, {
      args: ['i32'],
      returns: 'i32',
    });
    expect(cb.ptr).toBeDefined();
    expect(Number(cb.ptr)).toBeGreaterThan(0);
    cb.close();
  });

  test('should release resources after close without throwing', () => {
    const cb = ccallback(() => 0, { args: [], returns: CType.i32 });
    expect(() => cb.close()).not.toThrow();
  });
});
