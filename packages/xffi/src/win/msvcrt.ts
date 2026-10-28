import { createCFunction } from '../cfunction.js';
import { cimport } from '../cimport.js';
import { CrtDefinitions } from 'win32-abi';
import { Kernel32Impl } from './kernel32.js';
import { resolveAddress } from '../ffi.js';
import { NativePointer, type IPointer } from '../pointer.js';

export { CrtDefinitions };

/**
 * Native CRT Bindings (wrapped around Bun's process/executable space where overridden)
 */
export const CrtLibrary = cimport<typeof CrtDefinitions>(
  CrtDefinitions as any,
  {
    library: ['msvcrt'],
    knownToLinker: true,
  },
);

export const CrtImpl = CrtLibrary.symbols;

const resolvedSymbols: any = {};
let hasResolved = false;
try {
  const hMsvcrt =
    Kernel32Impl.GetModuleHandleA('msvcrt.dll') ||
    Kernel32Impl.LoadLibraryA('msvcrt.dll');
  if (hMsvcrt && Number(hMsvcrt) !== 0) {
    for (const [name, def] of Object.entries(CrtDefinitions)) {
      const pProc = Kernel32Impl.GetProcAddress(hMsvcrt, name);
      if (pProc && Number(pProc) !== 0) {
        resolvedSymbols[name] = createCFunction(
          resolveAddress(pProc),
          [def.returns as any, def.args as any],
          (CrtImpl as any)[name],
          name,
        );
      } else {
        resolvedSymbols[name] = (CrtImpl as any)[name];
      }
    }
    hasResolved = true;
  }
} catch {}
if (!hasResolved) {
  for (const name of Object.keys(CrtDefinitions)) {
    resolvedSymbols[name] = (CrtImpl as any)[name];
  }
}

export const MsvcrtImpl = resolvedSymbols as typeof CrtImpl;

export const MsvcrtLibrary = {
  symbols: MsvcrtImpl,
  library: ['msvcrt'],
  get baseAddress(): IPointer {
    try {
      return new NativePointer(
        Kernel32Impl.GetModuleHandleA('msvcrt.dll') ||
          Kernel32Impl.LoadLibraryA('msvcrt.dll'),
      );
    } catch {
      return new NativePointer(0n);
    }
  },
  close() {},
};
