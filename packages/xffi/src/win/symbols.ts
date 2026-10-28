import { Kernel32Impl } from './kernel32.js';
import { NtdllImpl } from './ntdll.js';
import { User32Impl } from './user32.js';
import { Gdi32Impl } from './gdi32.js';
import { PsapiImpl } from './psapi.js';
import { Advapi32Impl } from './advapi32.js';
import { MsvcrtImpl } from './msvcrt.js';
import { ALL_WIN32_DEFINES } from './defines.js';
import { ALL_WIN32_STRUCTS } from './structs.js';
import {
  NativePointer,
  SyncNativePointer,
  NativeMemory,
  SyncNativeMemory,
} from '../pointer.js';
import { struct, union, Struct, SyncStruct } from '../struct.js';
import {
  ffi,
  sizeof,
  alignmentof,
  compileStruct,
  resolveAddress,
  readString,
  readStringSync,
} from '../ffi.js';
import { CType } from '../types.js';
import { cdefines } from '../cdefine.js';
import { cmacro } from '../cmacro.js';
import { cimport } from '../cimport.js';
import { cjitopen } from '../cjit.js';
import { ccallback } from '../ccallback.js';
import { cmachinecode, createMachineCode } from '../cmachinecode.js';
import type { CFunction } from '../cfunction.js';
import type { IMemoryAccessor } from '../iaccessor.js';
import { getActiveContext, registerScopeFactory } from '../runner-context.js';
import {
  WCHAR,
  CHAR,
  STRING,
  StringBuffer,
  CStringBuffer,
  CScalarBuffer,
  createScalarTypeHelper,
} from './cbuffer.js';

export {
  WCHAR,
  CHAR,
  STRING,
  StringBuffer,
  CStringBuffer,
  CScalarBuffer,
  createScalarTypeHelper,
};

export const WIN32_LIBRARIES = {
  Kernel32: Kernel32Impl,
  Ntdll: NtdllImpl,
  User32: User32Impl,
  Gdi32: Gdi32Impl,
  Psapi: PsapiImpl,
  Advapi32: Advapi32Impl,
  msvcrt: MsvcrtImpl,
  Msvcrt: MsvcrtImpl,
} as const;

export type Win32LibraryName = keyof typeof WIN32_LIBRARIES;

export interface DualFunctionPair {
  a?: CFunction;
  w?: CFunction;
}

/**
 * Registry of all flat Win32 function symbols collected from all Impl libraries.
 */
export const win32Symbols: Record<string, CFunction> = {};

/**
 * Registry of dual functions that have A (ANSI) and/or W (Unicode) variants.
 * Key is the base name without suffix (e.g. "MessageBox", "GetModuleHandle", "CreateFile").
 */
export const dualFunctions: Map<string, DualFunctionPair> = new Map();

// Populate flat win32Symbols from all libraries
for (const lib of Object.values(WIN32_LIBRARIES)) {
  for (const [name, sym] of Object.entries(lib)) {
    if (typeof sym === 'function') {
      win32Symbols[name] = sym as CFunction;
    }
  }
}

// Discover and index all A/W pairs
for (const name of Object.keys(win32Symbols)) {
  if (name.length > 1 && (name.endsWith('A') || name.endsWith('W'))) {
    const base = name.slice(0, -1);
    const isA = name.endsWith('A');
    const pair = dualFunctions.get(base) ?? {};
    if (isA) {
      pair.a = win32Symbols[name];
    } else {
      pair.w = win32Symbols[name];
    }
    dualFunctions.set(base, pair);
  }
}

/**
 * Resolves a Win32 symbol by name with automatic Unicode/ANSI redirection.
 *
 * If `name` matches a dual function (e.g. `MessageBox` or `GetModuleHandle`):
 * - If `preferUnicode` is true (default): returns the `W` variant (falling back to `A`).
 * - If `preferUnicode` is false: returns the `A` variant (falling back to `W`).
 *
 * If `name` is an exact symbol (e.g. `GetModuleHandleA` or `VirtualAlloc`):
 * - Returns that exact CFunction.
 */
export function resolveWin32Symbol(
  name: string,
  preferUnicode = true,
): CFunction | undefined {
  // 1. Check if it's a dual function base name (e.g. MessageBox, GetModuleHandle)
  const pair = dualFunctions.get(name);
  if (pair) {
    return preferUnicode ? (pair.w ?? pair.a) : (pair.a ?? pair.w);
  }

  // 2. Check exact symbol in flat registry
  if (name in win32Symbols) {
    return win32Symbols[name];
  }

  return undefined;
}

/**
 * Checks whether a given symbol name exists in the Win32 registry
 * (either as an exact function or as a dual A/W base name).
 */
export function hasWin32Symbol(name: string): boolean {
  return dualFunctions.has(name) || name in win32Symbols;
}

/**
 * Creates a dispatch CFunction for a dual base function (e.g. MessageBox) that dynamically
 * selects and executes the Unicode (W) or ANSI (A) variant based on the active execution context.
 */
export function createUnicodeDispatchFunction(
  baseName: string,
  explicitPair?: DualFunctionPair,
): CFunction {
  const pair = explicitPair ?? dualFunctions.get(baseName) ?? {};

  const dispatch = function (...args: any[]) {
    const ctx = getActiveContext();
    const preferUnicode = ctx?.preferUnicode ?? true;
    const target = preferUnicode ? (pair.w ?? pair.a) : (pair.a ?? pair.w);
    if (!target) {
      throw new Error(
        `Win32 symbol '${baseName}' is not available in either ANSI or Unicode variant`,
      );
    }
    return target(...args);
  };

  Object.setPrototypeOf(dispatch, SyncNativePointer.prototype);

  Object.defineProperty(dispatch, 'address', {
    get() {
      const ctx = getActiveContext();
      const preferUnicode = ctx?.preferUnicode ?? true;
      const target = preferUnicode ? (pair.w ?? pair.a) : (pair.a ?? pair.w);
      return (target as any)?.address;
    },
    configurable: true,
  });

  Object.defineProperty(dispatch, 'ptr', {
    get() {
      const ctx = getActiveContext();
      const preferUnicode = ctx?.preferUnicode ?? true;
      const target = preferUnicode ? (pair.w ?? pair.a) : (pair.a ?? pair.w);
      return (target as any)?.ptr;
    },
    configurable: true,
  });

  Object.defineProperty(dispatch, 'args', {
    get() {
      const ctx = getActiveContext();
      const preferUnicode = ctx?.preferUnicode ?? true;
      const target = preferUnicode ? (pair.w ?? pair.a) : (pair.a ?? pair.w);
      return target?.args ?? [];
    },
    configurable: true,
  });

  Object.defineProperty(dispatch, 'returns', {
    get() {
      const ctx = getActiveContext();
      const preferUnicode = ctx?.preferUnicode ?? true;
      const target = preferUnicode ? (pair.w ?? pair.a) : (pair.a ?? pair.w);
      return target?.returns ?? 'void';
    },
    configurable: true,
  });

  Object.defineProperty(dispatch, 'name', {
    value: baseName,
    configurable: true,
  });

  return dispatch as any as CFunction;
}

/**
 * Global dynamic Win32 namespace.
 * Accessing any Win32 function name on this object (e.g. `Win32.GetModuleHandle` or `Win32.MessageBox`)
 * automatically resolves to the proper Unicode/ANSI variant and executes on the active accessor.
 */
export const Win32: Record<string, any> = new Proxy(win32Symbols, {
  get(target, prop, receiver) {
    if (typeof prop !== 'string') {
      return Reflect.get(target, prop, receiver);
    }
    if (prop in WIN32_LIBRARIES) {
      return WIN32_LIBRARIES[prop as Win32LibraryName];
    }
    const ctx = getActiveContext();
    const preferUnicode = ctx?.preferUnicode ?? true;
    const sym = resolveWin32Symbol(prop, preferUnicode);
    if (sym) return sym;
    return Reflect.get(target, prop, receiver);
  },
  has(target, prop) {
    if (typeof prop !== 'string') return Reflect.has(target, prop);
    return prop in WIN32_LIBRARIES || hasWin32Symbol(prop);
  },
});

// Top-level dual functions with automatic Unicode preference
export const GetModuleHandle = createUnicodeDispatchFunction('GetModuleHandle');
export const GetModuleHandleEx =
  createUnicodeDispatchFunction('GetModuleHandleEx');
export const LoadLibrary = createUnicodeDispatchFunction('LoadLibrary');
export const LoadLibraryEx = createUnicodeDispatchFunction('LoadLibraryEx');
export const CreateFile = createUnicodeDispatchFunction('CreateFile');
export const CreateFileMapping =
  createUnicodeDispatchFunction('CreateFileMapping');
export const CreateProcess = createUnicodeDispatchFunction('CreateProcess');
export const MessageBox = createUnicodeDispatchFunction('MessageBox');
export const CreateWindowEx = createUnicodeDispatchFunction('CreateWindowEx');
export const RegisterClassEx = createUnicodeDispatchFunction('RegisterClassEx');
export const GetMessage = createUnicodeDispatchFunction('GetMessage');
export const PeekMessage = createUnicodeDispatchFunction('PeekMessage');
export const DispatchMessage = createUnicodeDispatchFunction('DispatchMessage');
export const DefWindowProc = createUnicodeDispatchFunction('DefWindowProc');
export const DrawText = createUnicodeDispatchFunction('DrawText');
export const LoadCursor = createUnicodeDispatchFunction('LoadCursor');
export const LoadIcon = createUnicodeDispatchFunction('LoadIcon');
export const GetWindowText = createUnicodeDispatchFunction('GetWindowText');
export const GetWindowTextLength = createUnicodeDispatchFunction(
  'GetWindowTextLength',
);
export const SetWindowText = createUnicodeDispatchFunction('SetWindowText');
export const GetClassName = createUnicodeDispatchFunction('GetClassName');
export const FindWindow = createUnicodeDispatchFunction('FindWindow');
export const FindWindowEx = createUnicodeDispatchFunction('FindWindowEx');
export const PostMessage = createUnicodeDispatchFunction('PostMessage');
export const SendMessage = createUnicodeDispatchFunction('SendMessage');
export const SendDlgItemMessage =
  createUnicodeDispatchFunction('SendDlgItemMessage');
export const GetWindowLong = createUnicodeDispatchFunction('GetWindowLong');
export const SetWindowLong = createUnicodeDispatchFunction('SetWindowLong');
export const GetWindowLongPtr =
  createUnicodeDispatchFunction('GetWindowLongPtr');
export const SetWindowLongPtr =
  createUnicodeDispatchFunction('SetWindowLongPtr');
export const MapVirtualKey = createUnicodeDispatchFunction('MapVirtualKey');
export const Process32First = createUnicodeDispatchFunction('Process32First');
export const Process32Next = createUnicodeDispatchFunction('Process32Next');
export const Module32First = createUnicodeDispatchFunction('Module32First');
export const Module32Next = createUnicodeDispatchFunction('Module32Next');

// Standard non-dual functions for convenient top-level access
export const VirtualAlloc = Kernel32Impl.VirtualAlloc;
export const VirtualAllocEx = Kernel32Impl.VirtualAllocEx;
export const VirtualFree = Kernel32Impl.VirtualFree;
export const VirtualFreeEx = Kernel32Impl.VirtualFreeEx;
export const VirtualProtect = Kernel32Impl.VirtualProtect;
export const VirtualProtectEx = Kernel32Impl.VirtualProtectEx;
export const VirtualQuery = Kernel32Impl.VirtualQuery;
export const VirtualQueryEx = Kernel32Impl.VirtualQueryEx;
export const GetLastError = Kernel32Impl.GetLastError;
export const GetCurrentProcess = Kernel32Impl.GetCurrentProcess;
export const GetCurrentProcessId = Kernel32Impl.GetCurrentProcessId;
export const GetCurrentThread = Kernel32Impl.GetCurrentThread;
export const GetCurrentThreadId = Kernel32Impl.GetCurrentThreadId;
export const CloseHandle = Kernel32Impl.CloseHandle;
export const ReadFile = Kernel32Impl.ReadFile;
export const WriteFile = Kernel32Impl.WriteFile;
export const ReadProcessMemory = Kernel32Impl.ReadProcessMemory;
export const WriteProcessMemory = Kernel32Impl.WriteProcessMemory;
export const OpenProcess = Kernel32Impl.OpenProcess;
export const TerminateProcess = Kernel32Impl.TerminateProcess;
export const WaitForSingleObject = Kernel32Impl.WaitForSingleObject;
export const GetProcAddress = Kernel32Impl.GetProcAddress;

export interface RunOnOptions {
  /**
   * Whether to prefer Unicode (W-suffix) over ANSI (A-suffix) for dual A/W functions (e.g. MessageBox -> MessageBoxW).
   * Defaults to `true`.
   */
  preferUnicode?: boolean;
  /** Alias for preferUnicode */
  unicode?: boolean;
  /**
   * When true, ambient CFunction calls inside `runOn`/`execute` route through `accessor.callSync(...)`
   * so C-style synchronous calls (`const h = FindWindow(...)`) and `await FindWindow(...)` both work.
   */
  sync?: boolean;
  /** Optional custom globals or variables to expose in the scope */
  globals?: Record<string, unknown>;
  /** Optional Java context or proxy instance */
  java?: any;
  /** Optional callback for logs emitted via print(...) */
  onLog?: (line: string) => void;
  /** Optional execution timeout in milliseconds */
  timeoutMs?: number;
}

export interface RunnerScope extends Record<string, any> {
  memory: IMemoryAccessor;
  accessor: IMemoryAccessor;
  Kernel32: typeof Kernel32Impl;
  Ntdll: typeof NtdllImpl;
  User32: typeof User32Impl;
  Gdi32: typeof Gdi32Impl;
  Psapi: typeof PsapiImpl;
  Advapi32: typeof Advapi32Impl;
  msvcrt: typeof MsvcrtImpl;
  Msvcrt: typeof MsvcrtImpl;
  Win32: typeof Win32;
  print: (...args: any[]) => void;
  Java?: any;
  java?: any;
  [key: string]: any;
}

/**
 * Formats an argument for `print(...)` logs, gracefully handling Java proxy identity,
 * BigInts, functions, JSON objects, and primitives.
 */
export function formatPrintArg(arg: any): string {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'bigint') return `${arg.toString()}n`;
  if (typeof arg === 'function')
    return `[Function: ${arg.name || 'anonymous'}]`;

  if (typeof arg === 'object') {
    try {
      if ('$ptr' in arg || '$classObj' in arg || '$raw' in arg) {
        const clsName =
          arg.$className ||
          arg.$class?.name ||
          (typeof arg.getClass === 'function'
            ? arg.getClass()?.getName?.()
            : undefined) ||
          'Object';
        const ptr = arg.$ptr ?? arg.$classObj ?? arg.$raw ?? '';
        return `[Java ${clsName} @ ${ptr}]`;
      }
      if (
        '_view' in arg &&
        'address' in arg &&
        typeof arg.toJSON === 'function'
      ) {
        return JSON.stringify(arg.toJSON());
      }
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }

  return String(arg);
}

/**
 * C-style type-cast and string literal helpers exposed globally in `createScope()`.
 * Enables writing C-like expressions such as `HWND(0x10062)`, `LPARAM("Hello")`, `DWORD(x)`, `L("wide")`, `TEXT("str")`.
 */
export const C_TYPE_HELPERS: Record<string, any> = {
  // String buffer helpers & types
  WCHAR,
  CHAR,
  STRING,
  StringBuffer,
  CStringBuffer,
  CScalarBuffer,

  // Handles & Pointers
  HWND: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  HANDLE: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  HMODULE: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  HINSTANCE: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  HDC: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  HGDIOBJ: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  HMENU: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  HICON: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  HCURSOR: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  HBRUSH: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  HFONT: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  LPVOID: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  LPCVOID: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  PVOID: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  POINTER: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),
  PTR: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v),

  // Message & pointer-sized integer parameters
  LPARAM: (v?: unknown) =>
    v === undefined
      ? new CScalarBuffer(8, 'int64')
      : typeof v === 'string' && !/^-?0x[0-9a-fA-F]+$/.test(v.trim())
        ? v
        : BigInt(resolveAddress(v)),
  WPARAM: (v?: unknown) =>
    v === undefined
      ? new CScalarBuffer(8, 'uint64')
      : BigInt.asUintN(64, BigInt(resolveAddress(v))),
  LRESULT: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'int64') : BigInt(resolveAddress(v)),
  SIZE_T: (v?: unknown) =>
    v === undefined
      ? new CScalarBuffer(8, 'uint64')
      : BigInt.asUintN(64, BigInt(resolveAddress(v))),
  ULONG_PTR: (v?: unknown) =>
    v === undefined
      ? new CScalarBuffer(8, 'uint64')
      : BigInt.asUintN(64, BigInt(resolveAddress(v))),
  LONG_PTR: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'int64') : BigInt(resolveAddress(v)),
  INT_PTR: (v?: unknown) =>
    v === undefined ? new CScalarBuffer(8, 'int64') : BigInt(resolveAddress(v)),
  UINT_PTR: (v?: unknown) =>
    v === undefined
      ? new CScalarBuffer(8, 'uint64')
      : BigInt.asUintN(64, BigInt(resolveAddress(v))),

  // C scalar types (support both `DWORD(val)` cast and `DWORD()` / `new DWORD()` out-parameter buffer)
  DWORD: createScalarTypeHelper(
    4,
    'uint32',
    (v: unknown) => Number(BigInt(resolveAddress(v)) & 0xffffffffn) >>> 0,
  ),
  WORD: createScalarTypeHelper(2, 'uint16', (v: unknown) =>
    Number(BigInt(resolveAddress(v)) & 0xffffn),
  ),
  BYTE: createScalarTypeHelper(1, 'uint8', (v: unknown) =>
    Number(BigInt(resolveAddress(v)) & 0xffn),
  ),
  BOOL: createScalarTypeHelper(4, 'int32', (v: unknown) => (v ? 1 : 0)),
  INT: createScalarTypeHelper(4, 'int32', (v: unknown) =>
    Number(BigInt.asIntN(32, BigInt(resolveAddress(v)))),
  ),
  UINT: createScalarTypeHelper(
    4,
    'uint32',
    (v: unknown) => Number(BigInt(resolveAddress(v)) & 0xffffffffn) >>> 0,
  ),
  LONG: createScalarTypeHelper(4, 'int32', (v: unknown) =>
    Number(BigInt.asIntN(32, BigInt(resolveAddress(v)))),
  ),
  ULONG: createScalarTypeHelper(
    4,
    'uint32',
    (v: unknown) => Number(BigInt(resolveAddress(v)) & 0xffffffffn) >>> 0,
  ),
  SHORT: createScalarTypeHelper(2, 'int16', (v: unknown) =>
    Number(BigInt.asIntN(16, BigInt(resolveAddress(v)))),
  ),
  USHORT: createScalarTypeHelper(2, 'uint16', (v: unknown) =>
    Number(BigInt(resolveAddress(v)) & 0xffffn),
  ),
  LONGLONG: createScalarTypeHelper(8, 'int64', (v: unknown) =>
    BigInt(resolveAddress(v)),
  ),
  ULONGLONG: createScalarTypeHelper(8, 'uint64', (v: unknown) =>
    BigInt.asUintN(64, BigInt(resolveAddress(v))),
  ),
  INT64: createScalarTypeHelper(8, 'int64', (v: unknown) =>
    BigInt(resolveAddress(v)),
  ),
  UINT64: createScalarTypeHelper(8, 'uint64', (v: unknown) =>
    BigInt.asUintN(64, BigInt(resolveAddress(v))),
  ),
  QWORD: createScalarTypeHelper(8, 'uint64', (v: unknown) =>
    BigInt.asUintN(64, BigInt(resolveAddress(v))),
  ),
  FLOAT: createScalarTypeHelper(4, 'float', (v: unknown) => Number(v)),
  DOUBLE: createScalarTypeHelper(8, 'double', (v: unknown) => Number(v)),

  // String literals
  TEXT: (s: string) => String(s),
  _T: (s: string) => String(s),
  L: (s: string) => Buffer.from(String(s) + '\0', 'utf16le'),
  utf16: (s: string) => Buffer.from(String(s) + '\0', 'utf16le'),
  utf8: (s: string) => Buffer.from(String(s) + '\0', 'utf8'),
  ansi: (s: string) => Buffer.from(String(s) + '\0', 'latin1'),
};

/**
 * Creates an execution scope object containing all Win32 `#define` constants,
 * structs (`RECT`, `MSG`, `POINT`, `WNDCLASSEXW`, etc.), macros (`RGB`, `LOWORD`, `HIWORD`, `MAKELPARAM`),
 * C type helpers (`HWND`, `LPARAM`, `WPARAM`, `DWORD`, `TEXT`, `L`), bound Win32 API symbols,
 * memory accessor helpers, Java & print helpers, and optional user-defined globals.
 */
export function createScope(
  accessor: IMemoryAccessor,
  options: RunOnOptions = {},
): RunnerScope {
  const preferUnicode = options.preferUnicode ?? options.unicode ?? true;
  const userGlobals = (options.globals || {}) as Record<string, any>;
  const isSync = Boolean(options.sync);

  // Formatted print function
  const printFn =
    userGlobals.print ||
    ((...args: any[]) => {
      const line = args.map(formatPrintArg).join(' ');
      if (typeof options.onLog === 'function') {
        options.onLog(line);
      } else {
        // eslint-disable-next-line no-console
        console.log(line);
      }
    });

  // Java context resolution: options.java -> userGlobals.Java -> accessor.getJavaSync() -> accessor.java
  const javaInstance =
    options.java ??
    userGlobals.Java ??
    (typeof (accessor as any)?.getJavaSync === 'function'
      ? (accessor as any).getJavaSync()
      : (accessor as any)?.java);

  function makePkgProxy(current: string): any {
    return new Proxy(
      {},
      {
        get(_t2, member) {
          if (typeof member !== 'string') return undefined;
          const fullName = current ? `${current}.${member}` : member;
          // In Java, class names start with an uppercase letter
          if (member[0] && member[0] === member[0].toUpperCase()) {
            try {
              const res = javaInstance.type(fullName);
              if (res) return res;
            } catch {}
          }
          return makePkgProxy(fullName);
        },
      },
    );
  }

  let javaPackageProxy = userGlobals.java;
  if (javaInstance && !javaPackageProxy) {
    javaPackageProxy = makePkgProxy('java');
  }

  const accAny = accessor as any;

  const baseScope: Record<string, any> = {
    // 1. All Win32 #define constants, groups, and C macros (WM_SETTEXT, VK_RETURN, MEM_COMMIT, RGB, LOWORD, HIWORD, MAKELPARAM, etc.)
    ...ALL_WIN32_DEFINES,
    // 2. All Win32 Struct classes (both C-style UPPERCASE like RECT, POINT, MSG, WNDCLASSEXW and PascalCase like Rect, Point, Msg)
    ...ALL_WIN32_STRUCTS,
    // 3. C type-cast & string helpers (HWND, HANDLE, DWORD, LPARAM, WPARAM, TEXT, L, utf16, utf8)
    ...C_TYPE_HELPERS,
    // 4. Core xffi primitives for defining custom structs, JIT C code, callbacks, pointers
    ffi,
    CType,
    sizeof,
    alignmentof,
    compileStruct,
    resolveAddress,
    struct,
    union,
    Struct,
    SyncStruct,
    NativePointer,
    SyncNativePointer,
    NativeMemory,
    SyncNativeMemory,
    cdefines,
    cmacro,
    cimport,
    cjitopen,
    ccallback,
    cmachinecode,
    createMachineCode,
    ptr: (addr: unknown) => new SyncNativePointer(resolveAddress(addr)),
    // 5. Memory accessor & direct memory helper functions
    memory: accessor,
    accessor,
    alloc: (size: number, protection?: number, address?: unknown) =>
      isSync && typeof accAny.allocSync === 'function'
        ? accAny.allocSync(size, protection, address)
        : accessor.alloc(size, protection as any, address as any),
    allocNear: (target: unknown, size: number, opts?: any) =>
      isSync && typeof accAny.allocNearSync === 'function'
        ? accAny.allocNearSync(target, size, opts)
        : accessor.allocNear(target as any, size, opts),
    free: (address: unknown, size?: number, freeType?: any) =>
      isSync && typeof accAny.freeSync === 'function'
        ? accAny.freeSync(address, size, freeType)
        : accessor.free(address as any, size, freeType),
    read: (address: unknown, size: number, offset?: number) =>
      isSync && typeof accAny.readSync === 'function'
        ? accAny.readSync(address, size, offset)
        : accessor.read(address as any, size, offset),
    write: (address: unknown, data: Buffer | Uint8Array, offset?: number) =>
      isSync && typeof accAny.writeSync === 'function'
        ? accAny.writeSync(address, data, offset)
        : accessor.write(address as any, data, offset),
    protect: (address: unknown, size: number, newProtect: number) =>
      isSync && typeof accAny.protectSync === 'function'
        ? accAny.protectSync(address, size, newProtect)
        : accessor.protect(address as any, size, newProtect as any),
    query: (address: unknown) =>
      isSync && typeof accAny.querySync === 'function'
        ? accAny.querySync(address)
        : accessor.query(address as any),
    scan: (...scanArgs: any[]) =>
      isSync && typeof accAny.scanSync === 'function'
        ? accAny.scanSync(...scanArgs)
        : (accessor.scan as any)(...scanArgs),
    readString: (
      address: unknown,
      opts?:
        { size?: number; encoding?: 'utf8' | 'utf16le' } | 'utf8' | 'utf16le',
    ) => {
      const normalizedOpts =
        typeof opts === 'string'
          ? { encoding: opts, accessor }
          : { ...opts, accessor };
      return isSync && typeof accAny.readSync === 'function'
        ? readStringSync(address as any, normalizedOpts as any)
        : readString(address as any, normalizedOpts);
    },
    writeString: (
      address: unknown,
      str: string,
      encoding: 'utf8' | 'utf16le' = preferUnicode ? 'utf16le' : 'utf8',
    ) => {
      const buf = Buffer.from(String(str) + '\0', encoding);
      return isSync && typeof accAny.writeSync === 'function'
        ? accAny.writeSync(address, buf)
        : accessor.write(address as any, buf);
    },
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
    // 6. Win32 libraries & namespace
    ...WIN32_LIBRARIES,
    Win32,
    print: printFn,
    console: {
      log: printFn,
      error: printFn,
      warn: printFn,
      info: printFn,
    },
    ...(javaInstance ? { Java: javaInstance, java: javaPackageProxy } : {}),
    call: (fn: any, ...args: any[]) =>
      isSync && typeof accAny.callSync === 'function'
        ? accAny.callSync(fn, ...args)
        : accAny.call?.(fn, ...args),
  };

  // 7. Populate baseScope with flat win32 symbols
  for (const [name, sym] of Object.entries(win32Symbols)) {
    if (!(name in baseScope)) {
      baseScope[name] = sym;
    }
  }

  // 8. Populate with dual functions resolved according to preferUnicode
  for (const [baseName, pair] of dualFunctions.entries()) {
    const resolved = preferUnicode ? (pair.w ?? pair.a) : (pair.a ?? pair.w);
    if (resolved) {
      baseScope[baseName] = resolved;
    }
  }

  // 9. Apply userGlobals last so caller-provided globals take precedence
  Object.assign(baseScope, userGlobals);

  // Wrap in a Proxy to dynamically resolve any accessed property
  return new Proxy(baseScope, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') {
        return Reflect.get(target, prop, receiver);
      }
      if (prop in target) {
        return target[prop];
      }
      const sym = resolveWin32Symbol(prop, preferUnicode);
      if (sym) {
        return sym;
      }
      if (prop in ALL_WIN32_DEFINES) {
        return ALL_WIN32_DEFINES[prop];
      }
      if (prop in ALL_WIN32_STRUCTS) {
        return ALL_WIN32_STRUCTS[prop];
      }
      if (typeof globalThis !== 'undefined' && prop in globalThis) {
        return (globalThis as any)[prop];
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      if (typeof prop !== 'string') return Reflect.has(target, prop);
      if (prop in target) return true;
      if (hasWin32Symbol(prop)) return true;
      if (prop in ALL_WIN32_DEFINES) return true;
      if (prop in ALL_WIN32_STRUCTS) return true;
      if (typeof globalThis !== 'undefined' && prop in globalThis) return true;
      return false;
    },
  }) as RunnerScope;
}

registerScopeFactory(createScope);
