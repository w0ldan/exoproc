import { describe, expect, test } from 'bun:test';
import {
  cdefines,
  type CDefineValueType,
} from '../../packages/xffi/src/cdefine.js';

describe('cdefine abstraction library', () => {
  test('should create cdefine group with standard prefix and separator', () => {
    const WS = cdefines(
      {
        OVERLAPPED: 0x00000000,
        POPUP: 0x80000000,
        VISIBLE: 0x10000000,
      },
      'WS',
    );

    expect(WS._isCDefineGroup).toBe(true);
    expect(WS.OVERLAPPED).toBe(0x00000000);
    expect(WS.POPUP).toBe(0x80000000);
    expect(WS.VISIBLE).toBe(0x10000000);

    // C defines generation keys
    expect(WS._cDefines['WS_OVERLAPPED']).toBe(0x00000000);
    expect(WS._cDefines['WS_POPUP']).toBe(0x80000000);
    expect(WS._cDefines['WS_VISIBLE']).toBe(0x10000000);
  });

  test('should create bare cdefine group with no prefix', () => {
    const BARE = cdefines({
      TRANSPARENT: 1,
      NULL_PEN: 8,
    });

    expect(BARE.TRANSPARENT).toBe(1);
    expect(BARE.NULL_PEN).toBe(8);

    expect(BARE._cDefines['TRANSPARENT']).toBe(1);
    expect(BARE._cDefines['NULL_PEN']).toBe(8);
  });

  test('should combine flags with bitwise OR', () => {
    const DT = cdefines(
      {
        LEFT: 0,
        CENTER: 1,
        VCENTER: 4,
        SINGLELINE: 32,
      },
      'DT',
    );

    const combined = DT.combine(DT.CENTER, DT.VCENTER, DT.SINGLELINE);
    expect(combined).toBe(37); // 1 | 4 | 32 = 37
  });

  test('should recursively propagate prefix to nested groups', () => {
    const WM = cdefines(
      {
        DESTROY: 2,
        LBUTTON: cdefines({
          DOWN: 513,
          UP: 514,
        }),
        KEY: cdefines({
          DOWN: 256,
        }),
      },
      'WM',
    );

    // JS access
    expect(WM.DESTROY).toBe(2);
    expect(WM.LBUTTON.DOWN).toBe(513);
    expect(WM.LBUTTON.UP).toBe(514);
    expect(WM.KEY.DOWN).toBe(256);

    // Recurse C defines prefix mapping (now separator-less by default for nested children)
    expect(WM._cDefines['WM_DESTROY']).toBe(2);
    expect(WM.LBUTTON._cDefines['WM_LBUTTONDOWN']).toBe(513);
    expect(WM.LBUTTON._cDefines['WM_LBUTTONUP']).toBe(514);
    expect(WM.KEY._cDefines['WM_KEYDOWN']).toBe(256);
  });

  test('should support CDefineOptions noSeparator and custom separator', () => {
    // Test noSeparator at top level
    const NO_SEP = cdefines(
      {
        CONST: 100,
      },
      'PREFIX',
      { noSeparator: true },
    );

    expect(NO_SEP._cDefines['PREFIXCONST']).toBe(100);

    // Test custom separator at top level
    const CUSTOM_SEP = cdefines(
      {
        VALUE: 200,
      },
      'GRP',
      { separator: '-' },
    );

    expect(CUSTOM_SEP._cDefines['GRP-VALUE']).toBe(200);

    // Test nested with noSeparator (default nested is already separator-less)
    const WM_DEFAULT = cdefines(
      {
        KEY: cdefines({
          DOWN: 256,
          UP: 257,
        }),
      },
      'WM',
    );

    expect(WM_DEFAULT.KEY._cDefines['WM_KEYDOWN']).toBe(256);
    expect(WM_DEFAULT.KEY._cDefines['WM_KEYUP']).toBe(257);

    // Test nested with explicit separator override
    const WM_SEP = cdefines(
      {
        KEY: cdefines(
          {
            DOWN: 256,
          },
          undefined,
          { separator: '_' },
        ),
      },
      'WM',
    );

    expect(WM_SEP.KEY._cDefines['WM_KEY_DOWN']).toBe(256);

    // Test nested with explicit separator shorthand (e.g. cdefines(mapping, '_'))
    const WM_SHORTHAND = cdefines(
      {
        KEY: cdefines(
          {
            DOWN: 256,
          },
          '_',
        ),
      },
      'WM',
    );

    expect(WM_SHORTHAND.KEY._cDefines['WM_KEY_DOWN']).toBe(256);
  });

  test('should support extracting values via CDefineValueType and its Strict parameter option', () => {
    const DT = cdefines({
      LEFT: 0,
      CENTER: 1,
      VCENTER: 4,
    });

    // CDefineValueType (default, Strict = false) mathematically allows valid bitwise combinations (0 | 1 | 4 | 5)
    type DTCombined = CDefineValueType<typeof DT>;

    // CDefineValueType with Strict = true strictly allows ONLY individual uncombined constant literals (0 | 1 | 4)
    type DTStrict = CDefineValueType<typeof DT, true>;

    // Verify type assignments work at compile time
    const val1: DTCombined = 0;
    const val2: DTCombined = 1;
    const val3: DTCombined = 5; // Valid combination of 4 | 1

    const strictVal: DTStrict = 4; // Valid strict literal

    expect(val1).toBe(0);
    expect(val2).toBe(1);
    expect(val3).toBe(5);
    expect(strictVal).toBe(4);
  });
});
