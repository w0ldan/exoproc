import { cimport } from '../cimport.js';
import { NtdllDefinitions } from 'win32-abi';
import { Kernel32Impl } from './kernel32.js';
import { NativePointer, type IPointer } from '../pointer.js';

/**
 * Ntdll Native Bindings
 */
const lib = cimport<typeof NtdllDefinitions>(NtdllDefinitions as any, {
  library: ['ntdll'],
});

export const NtdllImpl = lib.symbols;

export const NtdllLibrary = Object.assign(lib, {
  get baseAddress(): IPointer {
    try {
      return new NativePointer(Kernel32Impl.GetModuleHandleA('ntdll.dll'));
    } catch {
      return new NativePointer(0n);
    }
  },
}) as typeof lib & { baseAddress: IPointer };
