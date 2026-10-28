import { cimport } from '../cimport.js';
import { User32Definitions } from 'win32-abi';
import { Kernel32Impl } from './kernel32.js';
import { NativePointer, type IPointer } from '../pointer.js';

/**
 * Native User32 Bindings
 */
const lib = cimport<typeof User32Definitions>(User32Definitions as any, {
  library: ['user32'],
  knownToLinker: true,
});

export const User32Impl = lib.symbols;

export const User32Library = Object.assign(lib, {
  get baseAddress(): IPointer {
    try {
      return new NativePointer(Kernel32Impl.GetModuleHandleA('user32.dll'));
    } catch {
      return new NativePointer(0n);
    }
  },
}) as typeof lib & { baseAddress: IPointer };
