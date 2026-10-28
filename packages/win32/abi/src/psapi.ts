import { CType, type Win32Dll } from './types.js';

/**
 * Native Psapi Definitions
 */
export const PsapiDefinitions = {
  GetModuleInformation: {
    args: [CType.ptr, CType.ptr, CType.ptr, CType.DWORD],
    returns: CType.BOOL,
  },
};

export const PsapiDll = {
  name: 'psapi',
  knownToLinker: false,
  definitions: PsapiDefinitions,
} as const satisfies Win32Dll;
