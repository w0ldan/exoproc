import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runOn,
  runOnSync,
  execute,
  createScope,
  Win32,
  win32Symbols,
  dualFunctions,
  resolveWin32Symbol,
  GetModuleHandle,
  MessageBox,
  type IMemoryAccessor,
  type ISyncMemoryAccessor,
  type ICallableMemoryAccessor,
  type ISyncCallableMemoryAccessor,
} from '../../packages/xffi/src/index.js';

describe('xffi runner and ambient Win32 symbols', () => {
  // Simple mock accessor that tracks calls
  const createMockAccessor = () => {
    const calls: { target: any; args: any[] }[] = [];
    const acc = {
      read: async () => Buffer.alloc(0),
      readSync: () => Buffer.alloc(0),
      write: async () => 0,
      writeSync: () => 0,
      alloc: async () => 0x1000n,
      allocSync: () => 0x1000n,
      allocNear: async () => 0x1000n,
      allocNearSync: () => 0x1000n,
      free: async () => true,
      freeSync: () => true,
      protect: async () => 0x40,
      protectSync: () => 0x40,
      query: async () => ({}) as any,
      querySync: () => ({}) as any,
      scan: async function* () {},
      scanSync: function* () {},
      call: async (fn: any, ...args: any[]) => {
        calls.push({ target: fn, args });
        return 0x1234n;
      },
      callSync: (fn: any, ...args: any[]) => {
        calls.push({ target: fn, args });
        return 0x5678;
      },
      machineCode: async () => 0x2000,
      machineCodeSync: () => 0x2000,
    };
    return {
      acc: acc as unknown as ICallableMemoryAccessor &
        ISyncCallableMemoryAccessor,
      calls,
    };
  };

  it('populates win32Symbols and dualFunctions registry correctly', () => {
    assert.ok(win32Symbols.GetModuleHandleA);
    assert.ok(win32Symbols.GetModuleHandleW);
    assert.ok(win32Symbols.VirtualAlloc);

    assert.ok(dualFunctions.has('GetModuleHandle'));
    assert.ok(dualFunctions.has('MessageBox'));
    assert.ok(dualFunctions.has('CreateFile'));
  });

  it('resolves dual A/W functions with Unicode preference by default', () => {
    const defaultMsgBox = resolveWin32Symbol('MessageBox', true);
    assert.equal(defaultMsgBox, win32Symbols.MessageBoxW);

    const ansiMsgBox = resolveWin32Symbol('MessageBox', false);
    assert.equal(ansiMsgBox, win32Symbols.MessageBoxA);

    const defaultMod = resolveWin32Symbol('GetModuleHandle', true);
    assert.equal(defaultMod, win32Symbols.GetModuleHandleW);

    const ansiMod = resolveWin32Symbol('GetModuleHandle', false);
    assert.equal(ansiMod, win32Symbols.GetModuleHandleA);
  });

  it('runs async callback with runOn and injects scope variables', async () => {
    const { acc } = createMockAccessor();

    const result = await runOn(acc, async (scope) => {
      assert.equal(scope.accessor, acc);
      assert.equal(scope.memory, acc);
      assert.ok(scope.Kernel32);
      assert.ok(scope.User32);
      assert.ok(typeof scope.GetModuleHandle === 'function');
      assert.ok(typeof scope.MessageBox === 'function');
      assert.ok(typeof scope.VirtualAlloc === 'function');
      return 100;
    });

    assert.equal(result, 100);
  });

  it('executes string code with bare identifiers in scope', async () => {
    const { acc } = createMockAccessor();

    const result = await runOn(
      acc,
      `
      if (typeof GetModuleHandle !== 'function') throw new Error('GetModuleHandle missing');
      if (typeof MessageBox !== 'function') throw new Error('MessageBox missing');
      if (typeof VirtualAlloc !== 'function') throw new Error('VirtualAlloc missing');
      return 42;
    `,
    );

    assert.equal(result, 42);
  });

  it('honors Unicode vs ANSI toggle in runOn options', async () => {
    const { acc } = createMockAccessor();

    // Default: Unicode
    await runOn(acc, async (scope) => {
      assert.equal(scope.MessageBox, win32Symbols.MessageBoxW);
      assert.equal(scope.GetModuleHandle, win32Symbols.GetModuleHandleW);
    });

    // ANSI mode
    await runOn(
      acc,
      async (scope) => {
        assert.equal(scope.MessageBox, win32Symbols.MessageBoxA);
        assert.equal(scope.GetModuleHandle, win32Symbols.GetModuleHandleA);
      },
      { preferUnicode: false },
    );
  });

  it('routes calls automatically through active accessor inside runOn', async () => {
    const { acc, calls } = createMockAccessor();

    await runOn(acc, async (scope) => {
      const res = await scope.VirtualAlloc(0, 0x1000, 0x3000, 0x40);
      assert.equal(res, 0x1234n);
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.args[0], 0);
    assert.equal(calls[0]?.args[1], 0x1000);
  });

  it('supports runOnSync for synchronous execution', () => {
    const { acc, calls } = createMockAccessor();

    const res = runOnSync(acc, (scope) => {
      assert.ok(typeof scope.GetLastError === 'function');
      const err = scope.GetLastError();
      return err;
    });

    assert.equal(res, 0x5678);
    assert.equal(calls.length, 1);
  });

  it('resolves functions via Win32 proxy dynamically', async () => {
    const { acc, calls } = createMockAccessor();

    await runOn(acc, async () => {
      const res = await Win32.VirtualAlloc(0, 0x1000, 0x3000, 0x40);
      assert.equal(res, 0x1234n);
    });

    assert.equal(calls.length, 1);
  });

  it('provides formatted print in scope and forwards logs via onLog', async () => {
    const { acc } = createMockAccessor();
    const logs: string[] = [];

    await runOn(
      acc,
      async (scope) => {
        scope.print('Hello', 123, 456n, { foo: 'bar' });
      },
      {
        onLog: (l) => logs.push(l),
      },
    );

    assert.equal(logs.length, 1);
    assert.equal(logs[0], 'Hello 123 456n {"foo":"bar"}');
  });

  it('exposes Java and java proxy when java option is provided', async () => {
    const { acc } = createMockAccessor();

    const mockJava = {
      type: (cls: string) => ({
        $className: cls,
        isMockClass: true,
      }),
    };

    const res = await execute(
      acc,
      `
        print("Resolving Java class...");
        const StringCls = Java.type("java.lang.String");
        const SystemCls = java.lang.System;
        return { StringCls, SystemCls };
      `,
      {
        java: mockJava,
      },
    );

    assert.deepEqual(res, {
      StringCls: { $className: 'java.lang.String', isMockClass: true },
      SystemCls: { $className: 'java.lang.System', isMockClass: true },
    });
  });

  it('allows hybrid execution combining Win32 API calls and Java in the same block', async () => {
    const { acc, calls } = createMockAccessor();
    const logs: string[] = [];

    const mockJava = {
      type: (cls: string) => ({
        $className: cls,
        currentTimeMillis: () => 1700000000n,
      }),
    };

    const res = await execute<{ time: bigint; hModule: bigint }>(
      acc,
      `
        const System = Java.type("java.lang.System");
        const time = System.currentTimeMillis();
        print("Java time:", time);

        // Win32 call in the same scope:
        const hModule = await GetModuleHandle("kernel32.dll");
        print("Kernel32:", hModule);

        return { time, hModule };
      `,
      {
        java: mockJava,
        onLog: (l) => logs.push(l),
      },
    );

    assert.equal(res.time, 1700000000n);
    assert.equal(res.hModule, 0x1234n);
    assert.equal(calls.length, 1); // GetModuleHandle was routed to acc.call
    assert.equal(logs.length, 2);
    assert.equal(logs[0], 'Java time: 1700000000n');
  });

  it('exposes all C-style Win32 #define constants, structs, macros, and type helpers globally in execute', async () => {
    const { acc } = createMockAccessor();

    const res = await execute<any>(
      acc,
      `
        const rc = new RECT({ left: 10, top: 20, right: 110, bottom: 220 });
        const pt = new POINT({ x: 5, y: 15 });
        const lparam = MAKELPARAM(300, 400);
        return {
          wmSetText: WM_SETTEXT,
          wmChar: WM_CHAR,
          wmKeyDown: WM_KEYDOWN,
          emSetSel: EM_SETSEL,
          emReplaceSel: EM_REPLACESEL,
          bmClick: BM_CLICK,
          vkReturn: VK_RETURN,
          memCommit: MEM_COMMIT,
          pageRW: PAGE_READWRITE,
          nullVal: NULL,
          trueVal: TRUE,
          falseVal: FALSE,
          rgbVal: RGB(255, 128, 0),
          lo: LOWORD(lparam),
          hi: HIWORD(lparam),
          rectWidth: rc.right - rc.left,
          ptY: pt.y,
          rectSize: sizeof(RECT),
          hasSendMessage: typeof SendMessage === 'function',
          hasFindWindowEx: typeof FindWindowEx === 'function',
          hasSetWindowText: typeof SetWindowText === 'function',
          hwndCast: HWND('0x10062'),
        };
      `,
    );

    assert.equal(res.wmSetText, 0x000c);
    assert.equal(res.wmChar, 0x0102);
    assert.equal(res.wmKeyDown, 0x0100);
    assert.equal(res.emSetSel, 0x00b1);
    assert.equal(res.emReplaceSel, 0x00c2);
    assert.equal(res.bmClick, 0x00f5);
    assert.equal(res.vkReturn, 0x0d);
    assert.equal(res.memCommit, 0x1000);
    assert.equal(res.pageRW, 0x04);
    assert.equal(res.nullVal, 0);
    assert.equal(res.trueVal, 1);
    assert.equal(res.falseVal, 0);
    assert.equal(res.rgbVal, 255 | (128 << 8));
    assert.equal(res.lo, 300);
    assert.equal(res.hi, 400);
    assert.equal(res.rectWidth, 100);
    assert.equal(res.ptY, 15);
    assert.equal(res.rectSize, 16);
    assert.equal(res.hasSendMessage, true);
    assert.equal(res.hasFindWindowEx, true);
    assert.equal(res.hasSetWindowText, true);
    assert.equal(res.hwndCast, 0x10062);
  });
});
