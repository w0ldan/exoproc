import { cimport } from '../cimport.js';
import { PsapiDefinitions } from 'win32-abi';

/**
 * Native Psapi Bindings
 */
export const PsapiLibrary = cimport<typeof PsapiDefinitions>(
  PsapiDefinitions as any,
  {
    library: ['psapi'],
  },
);

export const PsapiImpl = PsapiLibrary.symbols;
