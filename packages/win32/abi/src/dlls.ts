import { Advapi32Dll } from './advapi32.js';
import { CapstoneDll } from './capstone.js';
import { getWin32DllFileName } from './constants.js';
import { Gdi32Dll } from './gdi32.js';
import { Kernel32Dll } from './kernel32.js';
import { MsvcrtDll } from './msvcrt.js';
import { NodeDll } from './node.js';
import { NtdllDll } from './ntdll.js';
import { PsapiDll } from './psapi.js';
import { createWin32FunctionReferences } from './types.js';
import { User32Dll } from './user32.js';
import { Ws2_32Dll } from './ws2_32.js';

export const Win32Dlls = [
  Kernel32Dll,
  NtdllDll,
  MsvcrtDll,
  User32Dll,
  Gdi32Dll,
  Advapi32Dll,
  PsapiDll,
  CapstoneDll,
  Ws2_32Dll,
  NodeDll,
] as const;

export const Win32DllByName = new Map(
  Win32Dlls.map((dll) => [getWin32DllFileName(dll), dll]),
);

/**
 * Typed function references generated from the canonical DLL definitions.
 */
export const Win32Api = {
  kernel32: createWin32FunctionReferences(Kernel32Dll),
  ntdll: createWin32FunctionReferences(NtdllDll),
  msvcrt: createWin32FunctionReferences(MsvcrtDll),
  user32: createWin32FunctionReferences(User32Dll),
  gdi32: createWin32FunctionReferences(Gdi32Dll),
  advapi32: createWin32FunctionReferences(Advapi32Dll),
  psapi: createWin32FunctionReferences(PsapiDll),
  capstone: createWin32FunctionReferences(CapstoneDll),
  ws2_32: createWin32FunctionReferences(Ws2_32Dll),
  node: createWin32FunctionReferences(NodeDll),
} as const;
