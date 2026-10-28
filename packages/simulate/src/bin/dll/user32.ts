import { User32Dll } from 'win32-abi';
import type { Win32GuestDllSource } from './types.js';

export const User32GuestDll = {
  source: User32Dll,
} as const satisfies Win32GuestDllSource;
