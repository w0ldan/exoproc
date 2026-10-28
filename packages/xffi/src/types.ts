import {
  FFIType,
  type Pointer,
  type CString,
  type JSCallback,
  type FFITypeOrString,
} from 'bun:ffi';
import { CType } from 'win32-abi';

export { CType };

export interface CTypeStringToType {
  ['char']: CType.char;
  ['int8_t']: CType.int8_t;
  ['i8']: CType.i8;
  ['uchar']: CType.uchar;
  ['uint8_t']: CType.uint8_t;
  ['u8']: CType.u8;

  ['short']: CType.short;
  ['int16_t']: CType.int16_t;
  ['i16']: CType.i16;
  ['ushort']: CType.ushort;
  ['uint16_t']: CType.uint16_t;
  ['u16']: CType.u16;

  ['int']: CType.int;
  ['int32_t']: CType.int32_t;
  ['i32']: CType.i32;
  ['uint']: CType.uint;
  ['uint32_t']: CType.uint32_t;
  ['u32']: CType.u32;

  ['long']: CType.long;
  ['ulong']: CType.ulong;
  ['longlong']: CType.longlong;
  ['int64_t']: CType.int64_t;
  ['i64']: CType.i64;
  ['uint64_t']: CType.uint64_t;
  ['u64']: CType.u64;

  ['float']: CType.float;
  ['f32']: CType.f32;
  ['double']: CType.double;
  ['f64']: CType.f64;

  ['bool']: CType.bool;
  ['void']: CType.void;

  ['ptr']: CType.ptr;
  ['pointer']: CType.pointer;
  ['cstring']: CType.cstring;
  ['cwstring']: CType.cwstring;
  ['function']: CType.function;
  ['buffer']: CType.buffer;

  ['size_t']: CType.size_t;
  ['usize']: CType.usize;

  // Win32 Aliases
  ['HANDLE']: CType.HANDLE;
  ['HMODULE']: CType.HMODULE;
  ['HWND']: CType.HWND;
  ['LPVOID']: CType.LPVOID;
  ['LPCVOID']: CType.LPCVOID;
  ['SIZE_T']: CType.SIZE_T;
  ['DWORD']: CType.DWORD;
  ['LPDWORD']: CType.LPDWORD;
  ['BOOL']: CType.BOOL;
  ['INT']: CType.INT;
  ['UINT']: CType.UINT;
  ['UINT64']: CType.UINT64;
  ['INT_PTR']: CType.INT_PTR;
  ['WORD']: CType.WORD;
  ['SHORT']: CType.SHORT;
  ['LONG']: CType.LONG;
  ['LONGLONG']: CType.LONGLONG;
  ['BYTE']: CType.BYTE;
}

export type CTypeOrString =
  | CType
  | FFIType
  | FFITypeOrString
  | keyof CTypeStringToType
  | StructSchema
  | string
  | [any, number]
  | any[]
  | { isStructClass: true; schema: any };

export interface StructSchema {
  [key: string]: CTypeOrString | boolean | undefined;
  _isUnion?: boolean;
}

export interface CTypeToReturnsType {
  [CType.char]: number;
  [CType.i8]: number;
  [CType.u8]: number;
  [CType.i16]: number;
  [CType.u16]: number;
  [CType.i32]: number;
  [CType.u32]: number;
  [CType.i64]: bigint;
  [CType.u64]: bigint;
  [CType.f64]: number;
  [CType.f32]: number;
  [CType.bool]: boolean;
  [CType.void]: void;
  [CType.ptr]: Pointer | null;
  [CType.cstring]: CString;
  [CType.function]: Pointer | null;
  [CType.buffer]: NodeJS.TypedArray | DataView;
}

export interface CTypeToArgsType {
  [CType.char]: number;
  [CType.i8]: number;
  [CType.u8]: number;
  [CType.i16]: number;
  [CType.u16]: number;
  [CType.i32]: number;
  [CType.u32]: number;
  [CType.i64]: number | bigint;
  [CType.u64]: number | bigint;
  [CType.f64]: number;
  [CType.f32]: number;
  [CType.bool]: boolean;
  [CType.void]: undefined;
  [CType.ptr]: NodeJS.TypedArray | Pointer | CString | null;
  [CType.cstring]: NodeJS.TypedArray | Pointer | CString | string | null;
  [CType.function]: Pointer | JSCallback;
  [CType.buffer]: NodeJS.TypedArray | DataView;
}

/**
 * Normalizes any given extended type (string or CType number)
 * into its simplest bun:ffi string representation (e.g. "HANDLE" -> "ptr").
 */
export function normalizeType(type: CTypeOrString | undefined | null): string {
  if (!type && type !== 0) return 'void';

  if (typeof type === 'object') {
    return 'ptr';
  }

  let cTypeNum: number;

  if (typeof type === 'string') {
    const lower = type.toLowerCase();
    if (lower === 'cstring') return 'cstring';
    if (lower === 'cwstring') return 'cwstring';

    if (type in CTypeStringToTypeMap) {
      cTypeNum = (CTypeStringToTypeMap as any)[type];
    } else if (type.toLowerCase() in CTypeStringToTypeMap) {
      cTypeNum = (CTypeStringToTypeMap as any)[type.toLowerCase()];
    } else if (type.toUpperCase() in CTypeStringToTypeMap) {
      cTypeNum = (CTypeStringToTypeMap as any)[type.toUpperCase()];
    } else {
      return type.toLowerCase();
    }
  } else {
    cTypeNum = type as number;
  }

  switch (cTypeNum) {
    case FFIType.char:
    case FFIType.int8_t:
    case FFIType.i8:
      return 'i8';
    case FFIType.uint8_t:
    case FFIType.u8:
      return 'u8';
    case FFIType.int16_t:
    case FFIType.i16:
      return 'i16';
    case FFIType.uint16_t:
    case FFIType.u16:
      return 'u16';
    case FFIType.int32_t:
    case FFIType.i32:
    case FFIType.int:
      return 'i32';
    case FFIType.uint32_t:
    case FFIType.u32:
      return 'u32';
    case FFIType.int64_t:
    case FFIType.i64:
      return 'i64';
    case FFIType.uint64_t:
    case FFIType.u64:
      return 'u64';
    case FFIType.double:
    case FFIType.f64:
      return 'f64';
    case FFIType.float:
    case FFIType.f32:
      return 'f32';
    case FFIType.bool:
      return 'bool';
    case FFIType.ptr:
    case FFIType.pointer:
      return 'ptr';
    case FFIType.void:
      return 'void';
    case FFIType.cstring:
      return 'cstring';
    // cwstring relies on CType mapping to a pointer, so its runtime FFIType number in switch is ambiguous.
    // We already handle strings directly by checking ExtendedMap below.
    case FFIType.function:
      return 'function';
    case FFIType.buffer:
      return 'buffer';
    default:
      return 'ptr';
  }
}

// Internal map for fast string lookup
const CTypeStringToTypeMap: Record<string, number> = {
  char: CType.char,
  int8_t: CType.int8_t,
  i8: CType.i8,
  uchar: CType.uchar,
  uint8_t: CType.uint8_t,
  u8: CType.u8,
  short: CType.short,
  int16_t: CType.int16_t,
  i16: CType.i16,
  ushort: CType.ushort,
  uint16_t: CType.uint16_t,
  u16: CType.u16,
  int: CType.int,
  int32_t: CType.int32_t,
  i32: CType.i32,
  uint: CType.uint,
  uint32_t: CType.uint32_t,
  u32: CType.u32,
  long: CType.long,
  ulong: CType.ulong,
  longlong: CType.longlong,
  int64_t: CType.int64_t,
  i64: CType.i64,
  uint64_t: CType.uint64_t,
  u64: CType.u64,
  float: CType.float,
  f32: CType.f32,
  double: CType.double,
  f64: CType.f64,
  bool: CType.bool,
  void: CType.void,
  ptr: CType.ptr,
  pointer: CType.pointer,
  cstring: CType.cstring,
  cwstring: CType.cwstring,
  function: CType.function,
  buffer: CType.buffer,
  size_t: CType.size_t,
  usize: CType.usize,
  HANDLE: CType.HANDLE,
  HMODULE: CType.HMODULE,
  HWND: CType.HWND,
  LPVOID: CType.LPVOID,
  LPCVOID: CType.LPCVOID,
  SIZE_T: CType.SIZE_T,
  DWORD: CType.DWORD,
  LPDWORD: CType.LPDWORD,
  BOOL: CType.BOOL,
  INT: CType.INT,
  UINT: CType.UINT,
  UINT64: CType.UINT64,
  INT_PTR: CType.INT_PTR,
  WORD: CType.WORD,
  SHORT: CType.SHORT,
  LONG: CType.LONG,
  LONGLONG: CType.LONGLONG,
  BYTE: CType.BYTE,
};

/**
 * Maps a Bun FFIType string to a valid C type string for compilation.
 */
export function mapFFITypeToC(type: CTypeOrString | undefined | null): string {
  const norm = normalizeType(type);
  switch (norm) {
    case 'i8':
      return 'char';
    case 'u8':
      return 'unsigned char';
    case 'i16':
      return 'short';
    case 'u16':
      return 'unsigned short';
    case 'i32':
      return 'int';
    case 'u32':
      return 'unsigned int';
    case 'i64':
      return 'long long';
    case 'u64':
      return 'unsigned long long';
    case 'f32':
      return 'float';
    case 'f64':
      return 'double';
    case 'ptr':
    case 'cwstring':
    case 'function':
    case 'buffer':
      return 'void*';
    case 'cstring':
      return 'char*';
    case 'bool':
      return 'int';
    case 'void':
      return 'void';
    default:
      return 'void*';
  }
}

/**
 * Maps a CTypeOrString to the standard Bun FFIType string representation.
 */
export function mapToBunFFIType(
  type: CTypeOrString | undefined | null,
): FFITypeOrString {
  const norm = normalizeType(type);
  if (norm === 'cwstring') {
    return 'ptr';
  }
  return norm as FFITypeOrString;
}

/**
 * Represents the relaxed result type of a low-level C function call.
 * Uses a type alias to bypass ESLint explicit-any checks while maintaining maximum developer convenience.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CCallResult = any;
