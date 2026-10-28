import { Gdi32Dll } from 'win32-abi';
import type { Win32GuestDllSource } from './types.js';

export const Gdi32GuestDll = {
  source: Gdi32Dll,
} as const satisfies Win32GuestDllSource;
