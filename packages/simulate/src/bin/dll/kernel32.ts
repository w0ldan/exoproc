import { Kernel32Dll } from 'win32-abi';
import type { Win32GuestDllSource } from './types.js';

export const Kernel32GuestDll = {
  source: Kernel32Dll,
} as const satisfies Win32GuestDllSource;
