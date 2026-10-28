import { cimport } from '../cimport.js';
import { Gdi32Definitions } from 'win32-abi';

/**
 * Native Gdi32 Bindings
 */
export const Gdi32Library = cimport<typeof Gdi32Definitions>(
  Gdi32Definitions as any,
  {
    library: ['gdi32'],
    knownToLinker: true,
  },
);

export const Gdi32Impl = Gdi32Library.symbols;
