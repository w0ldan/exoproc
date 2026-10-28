import { FFIType } from 'bun:ffi';

/**
 * Advanced Winx64 FFI Type System extending bun:ffi.
 */
export enum CType {
  // Standard C Types mapped to Bun's FFIType
  char = FFIType.char,
  int8_t = FFIType.int8_t,
  i8 = FFIType.i8,
  uchar = FFIType.u8,
  uint8_t = FFIType.uint8_t,
  u8 = FFIType.u8,

  short = FFIType.i16,
  int16_t = FFIType.int16_t,
  i16 = FFIType.i16,
  ushort = FFIType.u16,
  uint16_t = FFIType.uint16_t,
  u16 = FFIType.u16,

  int = FFIType.int,
  int32_t = FFIType.int32_t,
  i32 = FFIType.i32,
  uint = FFIType.u32,
  uint32_t = FFIType.uint32_t,
  u32 = FFIType.u32,

  // Win64 specific: long and unsigned long are 32-bit!
  long = FFIType.i32,
  ulong = FFIType.u32,

  longlong = FFIType.i64,
  int64_t = FFIType.int64_t,
  i64 = FFIType.i64,
  uint64_t = FFIType.uint64_t,
  u64 = FFIType.u64,

  float = FFIType.float,
  f32 = FFIType.f32,
  double = FFIType.double,
  f64 = FFIType.f64,

  bool = FFIType.bool,
  void = FFIType.void,

  ptr = FFIType.ptr,
  pointer = FFIType.pointer,
  cstring = FFIType.cstring,
  cwstring = FFIType.ptr,
  function = FFIType.function,
  buffer = FFIType.buffer,

  // Win64 size_t is 64-bit
  size_t = FFIType.u64,
  usize = FFIType.u64,

  // Win32/x64 Aliases
  HANDLE = FFIType.u64,
  SOCKET = FFIType.u64,
  HMODULE = FFIType.u64,
  HWND = FFIType.u64,
  LPVOID = FFIType.ptr,
  LPCVOID = FFIType.ptr,
  SIZE_T = FFIType.u64,
  DWORD = FFIType.u32,
  LPDWORD = FFIType.ptr,
  BOOL = FFIType.i32,
  INT = FFIType.i32,
  UINT = FFIType.u32,
  UINT64 = FFIType.u64,
  INT_PTR = FFIType.ptr,
  WORD = FFIType.u16,
  USHORT = FFIType.u16,
  ULONG = FFIType.u32,
  SHORT = FFIType.i16,
  LONG = FFIType.i32,
  LONGLONG = FFIType.i64,
  BYTE = FFIType.u8,
}

export interface Win32FunctionDefinition {
  args: readonly (CType | string)[];
  returns: CType | string;
}

export type Win32FunctionDefinitions = Readonly<
  Record<string, Win32FunctionDefinition>
>;

export interface Win32Dll {
  readonly name: string;
  readonly knownToLinker: boolean;
  readonly definitions: Win32FunctionDefinitions;
}

export interface Win32FunctionReference<
  TDll extends Win32Dll = Win32Dll,
  TName extends keyof TDll['definitions'] & string = keyof TDll['definitions'] &
    string,
> {
  readonly dll: TDll;
  readonly name: TName;
  readonly definition: TDll['definitions'][TName];
}

export type Win32FunctionReferences<TDll extends Win32Dll> = {
  readonly [
    TName in keyof TDll['definitions'] & string
  ]: Win32FunctionReference<TDll, TName>;
};

/**
 * Adds stable DLL/name information to the existing definition syntax.
 *
 * Consumers can select `api.CreateFileA` directly instead of repeating the
 * DLL and export names as unrelated strings.
 */
export function createWin32FunctionReferences<TDll extends Win32Dll>(
  dll: TDll,
): Win32FunctionReferences<TDll> {
  return Object.fromEntries(
    Object.entries(dll.definitions).map(([name, definition]) => [
      name,
      { dll, name, definition },
    ]),
  ) as Win32FunctionReferences<TDll>;
}
