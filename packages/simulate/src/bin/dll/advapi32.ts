import { Advapi32Dll } from 'win32-abi';
import type { Win32GuestDllSource } from './types.js';

export const Advapi32GuestDll = {
  source: Advapi32Dll,
} as const satisfies Win32GuestDllSource;
