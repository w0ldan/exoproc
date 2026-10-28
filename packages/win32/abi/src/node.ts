import { CType, type Win32Dll } from './types.js';

export const NodeDefinitions = {
  createJSProcess: {
    args: [],
    returns: CType.HANDLE,
  },
  enterJSProcess: {
    args: [CType.HANDLE, CType.DWORD, CType.pointer],
    returns: CType.DWORD,
  },
  terminateJSProcess: {
    args: [CType.HANDLE, CType.DWORD],
    returns: CType.BOOL,
  },
};

export const NodeDll = {
  name: 'node',
  knownToLinker: false,
  definitions: NodeDefinitions,
} as const satisfies Win32Dll;
