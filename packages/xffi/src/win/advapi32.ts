import { cimport } from '../cimport.js';
import { Advapi32Definitions } from 'win32-abi';
import { Kernel32Impl } from './kernel32.js';
import { NativePointer, type IPointer } from '../pointer.js';

/**
 * Native Advapi32 Bindings
 */
const lib = cimport<typeof Advapi32Definitions>(Advapi32Definitions as any, {
  library: ['advapi32'],
  knownToLinker: true,
});

export const Advapi32Impl = lib.symbols;

export const Advapi32Library = Object.assign(lib, {
  get baseAddress(): IPointer {
    try {
      return new NativePointer(Kernel32Impl.GetModuleHandleA('advapi32.dll'));
    } catch {
      return new NativePointer(0n);
    }
  },
}) as typeof lib & { baseAddress: IPointer };
