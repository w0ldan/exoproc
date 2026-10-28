import { cimport } from '../cimport.js';
import { Kernel32Definitions } from 'win32-abi';
import { NativePointer, type IPointer } from '../pointer.js';

/**
 * Kernel32 Native Bindings
 */
const lib = cimport<typeof Kernel32Definitions>(Kernel32Definitions as any, {
  library: ['kernel32'],
  knownToLinker: true,
});

export const Kernel32Impl = lib.symbols;

export const Kernel32Library = Object.assign(lib, {
  get baseAddress(): IPointer {
    try {
      return new NativePointer(Kernel32Impl.GetModuleHandleA('kernel32.dll'));
    } catch {
      return new NativePointer(0n);
    }
  },
}) as typeof lib & { baseAddress: IPointer };
