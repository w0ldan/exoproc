import { PsapiDll } from 'win32-abi';
import type { Win32GuestDllSource } from './types.js';

export const PsapiGuestDll = {
  source: PsapiDll,
} as const satisfies Win32GuestDllSource;
