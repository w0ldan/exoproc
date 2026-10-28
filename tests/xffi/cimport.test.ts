import { expect, test, describe } from 'bun:test';
import { cimport, CType, Kernel32Impl } from '../../packages/xffi/src/index.js';

describe('xffi > cimport & Core Exposing', () => {
  test('should resolve global symbols without providing raw ptr', () => {
    // Testing with standard C library functions available everywhere
    const libc = cimport({
      malloc: {
        args: [CType.u64],
        returns: CType.ptr,
      },
      free: {
        args: [CType.ptr],
        returns: CType.void,
      },
    });

    const memPtr = libc.symbols.malloc(16);
    expect(memPtr).toBeDefined();
    expect(memPtr).not.toBe(0);

    // Cleanup
    libc.symbols.free(memPtr);
  });

  test('should explicitly provide Kernel32 API exports efficiently', async () => {
    const isWin = process.platform === 'win32';
    if (!isWin) return;

    const { Kernel32Impl: DynamicKernel32 } =
      await import('../../packages/xffi/src/win/kernel32.js');
    const threadId = DynamicKernel32.GetCurrentThreadId();
    expect(threadId).toBeGreaterThan(0);

    const hProcess = DynamicKernel32.GetCurrentProcess();
    expect(hProcess).not.toBeNull();
    expect(hProcess).not.toBe(0);

    const pHandle = DynamicKernel32.GetModuleHandleW('kernel32.dll');
    expect(pHandle).not.toBeNull();
    expect(pHandle).not.toBe(0);
  });

  test('should explicitly provide MSVCRT exports efficiently', async () => {
    const isWin = process.platform === 'win32';
    if (!isWin) return;

    const { MsvcrtImpl } =
      await import('../../packages/xffi/src/win/msvcrt.js');
    const memPtr = MsvcrtImpl.malloc(32);
    expect(memPtr).toBeDefined();
    expect(memPtr).not.toBe(0);

    // Free the pointer to avoid leaks
    MsvcrtImpl.free(memPtr);
  });

  test('should resolve OS-specific API symbol addresses (Win32 GetProcAddress / POSIX dlsym)', () => {
    const isWin = process.platform === 'win32';

    if (isWin) {
      const kernel32Str = Buffer.from('kernel32.dll\0', 'utf8');
      const hModule = Kernel32Impl.GetModuleHandleA(kernel32Str);
      expect(hModule).toBeDefined();
      expect(hModule).not.toBe(0);

      const procName = Buffer.from('GetProcAddress\0', 'utf8');
      const pGetProcAddress = Kernel32Impl.GetProcAddress(hModule, procName);
      expect(pGetProcAddress).toBeDefined();
      expect(pGetProcAddress).not.toBe(0);
    } else {
      const posixapi = cimport({
        dlopen: { args: [CType.cstring, CType.i32], returns: CType.ptr },
        dlsym: { args: [CType.ptr, CType.cstring], returns: CType.ptr },
      });

      const libcStr = Buffer.from('libc.so.6\0', 'utf8');
      // RTLD_LAZY is usually 1
      const hModule = posixapi.symbols.dlopen(libcStr, 1);
      expect(hModule).toBeDefined();
      expect(hModule).not.toBe(0);

      const procName = Buffer.from('dlsym\0', 'utf8');
      const pDlSym = posixapi.symbols.dlsym(hModule, procName);
      expect(pDlSym).toBeDefined();
      expect(pDlSym).not.toBe(0);
    }
  });

  test('should resolve libc symbols exactly (Win32 msvcrt.dll / POSIX libc.so.6)', () => {
    // Note: 'malloc' is intercepted by bun.exe's internal 'mimalloc' allocator,
    // so it points inside bun.exe module. We use 'strlen' to verify exact DLL matching.
    const stdlib = cimport({
      strlen: { args: [CType.ptr], returns: CType.u64 },
    });
    const isWin = process.platform === 'win32';

    if (isWin) {
      const hMsvcrt = Kernel32Impl.GetModuleHandleA(
        Buffer.from('msvcrt.dll\0', 'utf8'),
      );
      expect(hMsvcrt).not.toBe(0);

      const pStrlen = Kernel32Impl.GetProcAddress(
        hMsvcrt,
        Buffer.from('strlen\0', 'utf8'),
      );
      expect(pStrlen).not.toBe(0);

      // The dynamically imported global strlen should precisely equal msvcrt.dll's strlen
      expect(stdlib.symbols.strlen.ptr).toBe(pStrlen);
    } else {
      const posixapi = cimport({
        dlopen: { args: [CType.cstring, CType.i32], returns: CType.ptr },
        dlsym: { args: [CType.ptr, CType.cstring], returns: CType.ptr },
      });

      const libcStr = Buffer.from('libc.so.6\0', 'utf8');
      const hLibc = posixapi.symbols.dlopen(libcStr, 1);
      expect(hLibc).not.toBe(0);

      const strlenStr = Buffer.from('strlen\0', 'utf8');
      const pStrlen = posixapi.symbols.dlsym(hLibc, strlenStr);
      expect(pStrlen).not.toBe(0);

      // The dynamically imported global strlen should precisely equal libc's strlen
      expect(stdlib.symbols.strlen.ptr).toBe(pStrlen);
    }
  });
});
