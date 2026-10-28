import { expect, test, describe } from 'bun:test';
import { cmacro, cjitopen } from '../../packages/xffi/src/index.js';

describe('cmacro abstraction library', () => {
  test('should create a basic function macro like RGB', () => {
    const RGB = cmacro((r: number, g: number, b: number) => {
      return r | (g << 8) | (b << 16);
    }, '(($1) | (($2) << 8) | (($3) << 16))');

    expect(RGB(255, 0, 0)).toBe(0x000000ff);
    expect(RGB(0, 255, 0)).toBe(0x0000ff00);
    expect(RGB(0, 0, 255)).toBe(0x00ff0000);
    expect(RGB(255, 255, 255)).toBe(0x00ffffff);

    // We should be able to get the string representation for C generation
    expect(RGB.toC('r', 'g', 'b')).toBe('((r) | ((g) << 8) | ((b) << 16))');
    expect(RGB.toCDefinition('RGB')).toBe(
      '#define RGB(arg0, arg1, arg2) ((arg0) | ((arg1) << 8) | ((arg2) << 16))',
    );
  });

  test('should handle missing cStringTemplate gracefully', () => {
    const SimpleMacro = cmacro((a: number) => a * 2);
    expect(SimpleMacro(5)).toBe(10);
    expect(SimpleMacro.toC('a')).toBe(
      '/* CMacro translation not provided for this macro. */',
    );
    expect(SimpleMacro.toCDefinition('MY_MACRO')).toBe(
      '/* CMacro translation not provided for MY_MACRO */',
    );
  });

  test('should integrate seamlessly with cjitopen', () => {
    const MY_DOUBLE = cmacro((x: number) => x * 2, '($1 * 2)');

    const lib = cjitopen(
      {
        test_macro: {
          returns: 'i32',
          args: ['i32'],
          source: `
          // MY_DOUBLE macro should be available here
          return MY_DOUBLE(arg0);
        `,
        },
        test_rgb: {
          returns: 'i32',
          args: ['i32', 'i32', 'i32'],
          source: `
          // RGB macro is automatically included from winDefines 
          // because winDefines is merged by default
          return RGB(arg0, arg1, arg2);
        `,
        },
      },
      {
        defines: {
          MY_DOUBLE,
        },
      },
    );

    try {
      expect(lib.symbols.test_macro(5)).toBe(10);
      expect(lib.symbols.test_rgb(255, 0, 0)).toBe(0x000000ff);
      expect(lib.symbols.test_rgb(0, 255, 0)).toBe(0x0000ff00);
      expect(lib.symbols.test_rgb(0, 0, 255)).toBe(0x00ff0000);
    } finally {
      lib.close();
    }
  });
});
