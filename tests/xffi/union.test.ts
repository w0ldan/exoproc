import { expect, test, describe } from 'bun:test';
import { union, sizeof, cjitopen } from '../../packages/xffi/src/index';

describe('C-Style Unions', () => {
  test('should calculate correct size for simple unions', () => {
    const MyUnion = union({
      asInt: 'i32',
      asChar: 'u8',
      asLong: 'i64',
    });

    // Size should be the max of all fields (8 bytes for i64)
    expect(sizeof(MyUnion)).toBe(8);
  });

  test('should allow accessing same memory via different fields', () => {
    const MyUnion = union({
      asInt: 'i32',
      asShorts: 'u16[2]',
      asBytes: 'u8[4]',
    });

    const instance = MyUnion.allocSync();

    // Set as int
    instance.asInt = 0x12345678;

    // Read as bytes (Little Endian)
    expect(instance.asBytes[0]).toBe(0x78);
    expect(instance.asBytes[1]).toBe(0x56);
    expect(instance.asBytes[2]).toBe(0x34);
    expect(instance.asBytes[3]).toBe(0x12);

    // Read as shorts
    expect(instance.asShorts[0]).toBe(0x5678);
    expect(instance.asShorts[1]).toBe(0x1234);
  });

  test('should integrate unions with cjitopen', () => {
    const ColorUnion = union({
      rgba: 'u32',
      components: {
        r: 'u8',
        g: 'u8',
        b: 'u8',
        a: 'u8',
      },
    });
    (ColorUnion as any).structName = 'ColorUnion';

    const lib = cjitopen(
      {
        get_red: {
          returns: 'u8',
          args: ['ptr'],
          source: `
                ColorUnion* c = (ColorUnion*)arg0;
                return c->components.r;
            `,
        },
        set_rgba: {
          returns: 'void',
          args: ['ptr', 'u32'],
          source: `
                ColorUnion* c = (ColorUnion*)arg0;
                c->rgba = arg1;
            `,
        },
      },
      {
        structs: { ColorUnion },
      },
    );

    const c = ColorUnion.allocSync();
    c.rgba = 0xaaffcc11; // A=AA, B=FF, G=CC, R=11

    expect(lib.symbols.get_red(c)).toBe(0x11);

    lib.symbols.set_rgba(c, 0x11223344);
    expect(c.rgba).toBe(0x11223344);
    expect(c.components.r).toBe(0x44);

    lib.close();
  });
});
