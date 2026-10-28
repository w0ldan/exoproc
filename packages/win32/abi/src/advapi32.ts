import { CType, type Win32Dll } from './types.js';

/**
 * Native Advapi32 Definitions
 */
export const Advapi32Definitions = {
  OpenProcessToken: {
    args: [CType.HANDLE, CType.DWORD, CType.ptr],
    returns: CType.BOOL,
  },
  CreateRestrictedToken: {
    args: [
      CType.HANDLE,
      CType.DWORD,
      CType.DWORD,
      CType.ptr,
      CType.DWORD,
      CType.ptr,
      CType.DWORD,
      CType.ptr,
      CType.ptr,
    ],
    returns: CType.BOOL,
  },
  CreateProcessAsUserA: {
    args: [
      CType.HANDLE,
      CType.ptr,
      CType.ptr,
      CType.ptr,
      CType.ptr,
      CType.BOOL,
      CType.DWORD,
      CType.LPVOID,
      CType.ptr,
      CType.ptr,
      CType.ptr,
    ],
    returns: CType.BOOL,
  },
};

export const Advapi32Dll = {
  name: 'advapi32',
  knownToLinker: true,
  definitions: Advapi32Definitions,
} as const satisfies Win32Dll;
