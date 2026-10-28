import type { Win32Dll } from './types.js';

export const Win32DllSuffix = '.dll' as const;

export function getWin32DllFileName(
  dll: Win32Dll,
): `${string}${typeof Win32DllSuffix}` {
  return `${dll.name}${Win32DllSuffix}`;
}
