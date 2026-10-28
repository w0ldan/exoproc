import { Ws2_32Dll } from 'win32-abi';
import type { Win32GuestDllSource } from './types.js';

export const Ws2_32GuestDll = {
  source: Ws2_32Dll,
} as const satisfies Win32GuestDllSource;
