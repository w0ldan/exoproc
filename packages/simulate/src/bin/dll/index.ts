import { Advapi32GuestDll } from './advapi32.js';
import { CapstoneGuestDll } from './capstone.js';
import { Gdi32GuestDll } from './gdi32.js';
import { Kernel32GuestDll } from './kernel32.js';
import { MsvcrtGuestDll } from './msvcrt.js';
import { NodeGuestDll } from './node.js';
import { NtdllGuestDll } from './ntdll.js';
import { PsapiGuestDll } from './psapi.js';
import type { Win32GuestDllSource } from './types.js';
import { User32GuestDll } from './user32.js';
import { Ws2_32GuestDll } from './ws2_32.js';
import { getWin32DllFileName } from 'win32-abi';
import {
  Win32ExportBindingRegistry,
  Win32ExportCatalog,
  type Win32DllMainCompiler,
} from '../../runtime/win32-dlls.js';

export * from './types.js';
export * from './capstone.js';
export * from './kernel32.js';
export * from './ntdll.js';
export * from './msvcrt.js';
export * from './user32.js';
export * from './gdi32.js';
export * from './advapi32.js';
export * from './psapi.js';
export * from './ws2_32.js';
export * from './node.js';

export const DefaultWin32GuestDlls: readonly Win32GuestDllSource[] = [
  Kernel32GuestDll,
  NtdllGuestDll,
  MsvcrtGuestDll,
  User32GuestDll,
  Gdi32GuestDll,
  Advapi32GuestDll,
  PsapiGuestDll,
  CapstoneGuestDll,
  Ws2_32GuestDll,
  NodeGuestDll,
];

export const DefaultWin32ExportBindings = new Win32ExportBindingRegistry();
for (const dll of DefaultWin32GuestDlls) {
  dll.configure?.(DefaultWin32ExportBindings);
}

export const DefaultWin32DllMains = new Map<string, Win32DllMainCompiler>();
for (const dll of DefaultWin32GuestDlls) {
  if (dll.dllMain) {
    DefaultWin32DllMains.set(getWin32DllFileName(dll.source), dll.dllMain);
  }
}

export const DefaultWin32ExportCatalog = new Win32ExportCatalog(
  DefaultWin32GuestDlls.map((dll) => dll.source),
  { bindings: DefaultWin32ExportBindings, dllMains: DefaultWin32DllMains },
);

/** @deprecated Use DefaultWin32ExportCatalog. */
export const DefaultWin32SyscallCatalog = DefaultWin32ExportCatalog;
