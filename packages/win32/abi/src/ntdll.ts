import { CType, type Win32Dll } from './types.js';

/**
 * Ntdll Native Definitions
 */
export const NtdllDefinitions = {
  RtlImageNtHeader: {
    args: [CType.ptr],
    returns: CType.ptr,
  },
};

export const NtdllDll = {
  name: 'ntdll',
  knownToLinker: false,
  definitions: NtdllDefinitions,
} as const satisfies Win32Dll;
