export * from './types.js';
export * from './pointer.js';
export * from './win/defines.js';
export * from './iaccessor.js';
export * from './accessor.js';
export * from './near-alloc.js';
export * from './middleware-accessor.js';
export * from './callable-accessor.js';
export * from './win/utils.js';
export * from './waiter.js';
export * from './cfunction.js';
export * from './runner-context.js';
export * from './dummy-function.js';
export * from './cjit.js';
export { cjitopen } from './cjit.js';
export * from './ccallback.js';
export * from './cmachinecode.js';
export * from './stub.js';

export * from './cimport.js';
export * from './debug-helper.js';
import {
  struct,
  union,
  Struct,
  SyncStruct,
  toCStructDefinition,
} from './struct.js';
import {
  ffi,
  resolveAddress,
  sizeof,
  alignmentof,
  compileStruct,
  currentProcessId,
  currentProcessHandle,
  stackAlign16,
  alignUp,
  alignDown,
} from './ffi.js';

(ffi as any).struct = struct;
(ffi as any).union = union;

export {
  struct,
  union,
  Struct,
  SyncStruct,
  toCStructDefinition,
  ffi,
  resolveAddress,
  sizeof,
  alignmentof,
  compileStruct,
  currentProcessId,
  currentProcessHandle,
  stackAlign16,
  alignUp,
  alignDown,
};
export type { ComputedStruct, ComputedStructField } from './ffi.js';
export * from './win/kernel32.js';
export * from './win/ntdll.js';
export * from './win/msvcrt.js';
export * from './win/structs.js';
export * from './win/user32.js';
export * from './win/gdi32.js';
export * from './win/psapi.js';
export * from './win/advapi32.js';
export * from './cdefine.js';
export * from './cmacro.js';
export * from './win/memmem.js';
export * from './win/scanner.js';
export * from './win/load.js';
export * from './win/symbols.js';
export * from './win/cbuffer.js';

import { addCJitDefault } from './cjit.js';
import { Kernel32Library } from './win/kernel32.js';
import { NtdllLibrary } from './win/ntdll.js';
import { CrtLibrary } from './win/msvcrt.js';
import { User32Library } from './win/user32.js';
import { Gdi32Library } from './win/gdi32.js';
import { PsapiLibrary } from './win/psapi.js';
import { Advapi32Library } from './win/advapi32.js';
import {
  Rect,
  PaintStruct,
  Msg,
  WndClassExW,
  MemoryBasicInformation,
  Point,
  SecurityAttributes,
} from './win/structs.js';
import {
  WS,
  CS,
  BARE,
  DT,
  STOCK,
  WM,
  MACROS,
  INFINITE,
  MemoryState,
  MemoryProtection,
  MemoryFreeType,
  ProcessAccess,
  ThreadAccess,
  ThreadCreationFlags,
  ContextFlags,
  ToolhelpSnapshotFlag,
  GetModuleHandleExFlag,
  WaitReturn,
  TokenAccess,
  CreateRestrictedTokenFlags,
} from './win/defines.js';

// Register global Windows defaults for CJit
addCJitDefault({
  imports: [
    Kernel32Library,
    NtdllLibrary,
    CrtLibrary,
    User32Library,
    Gdi32Library,
    PsapiLibrary,
    Advapi32Library,
  ],
  structs: [
    Rect,
    PaintStruct,
    MemoryBasicInformation,
    Point,
    WndClassExW,
    Msg,
    SecurityAttributes,
  ],
  defines: [
    WS,
    CS,
    BARE,
    DT,
    STOCK,
    WM,
    MACROS,
    {
      INFINITE,
      MemoryState,
      MemoryProtection,
      MemoryFreeType,
      ProcessAccess,
      ThreadAccess,
      ThreadCreationFlags,
      ContextFlags,
      ToolhelpSnapshotFlag,
      GetModuleHandleExFlag,
      WaitReturn,
      TokenAccess,
      CreateRestrictedTokenFlags,
    },
  ],
});
