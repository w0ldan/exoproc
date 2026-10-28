import { CType, type Win32Dll } from './types.js';

/**
 * Native CRT Definitions
 */
export const CrtDefinitions = {
  abs: { args: [CType.i32], returns: CType.i32 },
  malloc: { args: [CType.u64], returns: CType.ptr },
  free: { args: [CType.ptr], returns: CType.void },
  calloc: { args: [CType.u64, CType.u64], returns: CType.ptr },
  realloc: { args: [CType.ptr, CType.u64], returns: CType.ptr },
  memcpy: { args: [CType.ptr, CType.ptr, CType.u64], returns: CType.ptr },
  memset: { args: [CType.ptr, CType.i32, CType.u64], returns: CType.ptr },
  memcmp: { args: [CType.ptr, CType.ptr, CType.u64], returns: CType.i32 },
  strlen: { args: [CType.cstring], returns: CType.u64 },
  __getmainargs: {
    args: [CType.ptr, CType.ptr, CType.ptr, CType.INT, CType.ptr],
    returns: CType.INT,
  },
  _putenv: {
    args: [CType.cstring],
    returns: CType.INT,
  },
  wcslen: { args: [CType.cwstring], returns: CType.u64 },
  sinf: { args: [CType.float], returns: CType.float },
  cosf: { args: [CType.float], returns: CType.float },
  sqrtf: { args: [CType.float], returns: CType.float },
  sin: { args: [CType.f64], returns: CType.f64 },
  cos: { args: [CType.f64], returns: CType.f64 },
  sqrt: { args: [CType.f64], returns: CType.f64 },
  rand: { args: [], returns: CType.i32 },
  fopen: { args: [CType.ptr, CType.ptr], returns: CType.ptr },
  fclose: { args: [CType.ptr], returns: CType.i32 },
  fread: {
    args: [CType.ptr, CType.u64, CType.u64, CType.ptr],
    returns: CType.u64,
  },
  fwrite: {
    args: [CType.ptr, CType.u64, CType.u64, CType.ptr],
    returns: CType.u64,
  },
  fflush: { args: [CType.ptr], returns: CType.i32 },
  rewind: { args: [CType.ptr], returns: CType.void },
  /**
   * Variadic arguments follow the Win64 ABI after the format pointer:
   * RDX, R8, R9, then the stack.
   */
  printf: { args: [CType.cstring], returns: CType.i32 },
};

export const MsvcrtDll = {
  name: 'msvcrt',
  knownToLinker: true,
  definitions: CrtDefinitions,
} as const satisfies Win32Dll;
