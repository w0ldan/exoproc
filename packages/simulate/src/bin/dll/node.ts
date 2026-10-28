import { NodeDll } from 'win32-abi';
import type { Win32GuestDllSource } from './types.js';

export const NodeGuestDll = {
  source: NodeDll,
} as const satisfies Win32GuestDllSource;
