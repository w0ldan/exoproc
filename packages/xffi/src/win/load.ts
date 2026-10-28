import {
  cimport,
  type CImportSymbol,
  type CImportLibrarySymbols,
} from '../cimport.js';
import { createCFunction } from '../cfunction.js';
import { resolveAddress } from '../ffi.js';
import { type AddressLike } from '../pointer.js';
import { Kernel32Impl } from './kernel32.js';
import { LoadLibraryExFlag } from './defines.js';

/**
 * Loads a DLL from an explicit path and binds its exports. Unlike `cimport`,
 * which resolves non-system libraries by base name via the OS search order,
 * this always resolves `options.dll` as given — required for bundled,
 * repo-local DLLs (e.g. capstone.dll) that don't live on PATH.
 *
 * On Windows the path is passed as a wide string to LoadLibraryW, which is
 * always correct for JS strings (UTF-16). LoadLibraryA expects an ANSI byte
 * sequence and is not suitable for JS string inputs.
 */
export function load<F extends Record<string, CImportSymbol>>(options: {
  dll: string;
  dllFuncs: F;
}): CImportLibrarySymbols<F> {
  if (process.platform === 'win32') {
    const hModule = Kernel32Impl.LoadLibraryW(options.dll);
    if (!hModule || Number(hModule) === 0) {
      throw new Error(`LoadLibraryW failed for ${options.dll}`);
    }

    const symbols: any = {};
    for (const [name, sym] of Object.entries(options.dllFuncs)) {
      const procAddr = Kernel32Impl.GetProcAddress(hModule, name);
      if (!procAddr || Number(procAddr) === 0) {
        throw new Error(`GetProcAddress failed for symbol ${name}`);
      }
      symbols[name] = createCFunction(procAddr, [
        sym.returns ?? 'void',
        [...(sym.args ?? [])],
      ]);
    }
    return symbols as CImportLibrarySymbols<F>;
  } else {
    const lib = cimport(options.dllFuncs, { library: [options.dll] });
    return lib.symbols;
  }
}

/**
 * Resolves a named export's address in a **different** process, given the
 * exporting DLL's local file path and the remote base address that same DLL
 * is loaded at over there (e.g. from `Module.getModules(pid)` in
 * `bun-winapi`) — there's no cross-process `GetProcAddress`, so this
 * approximates one: loads the exact same DLL file **locally** with
 * `DONT_RESOLVE_DLL_REFERENCES` (mapped but never initialized — `DllMain`
 * never runs) purely to read its export table via a real, local
 * `GetProcAddress` call, converts that into an *offset* from the DLL's own
 * local base, and adds that offset onto the caller-supplied remote base.
 * Works because a given DLL file's internal layout (and therefore every
 * export's offset from its own base) is identical regardless of which
 * process loaded it or where ASLR put it — only the base itself varies.
 *
 * Purely an address resolver — it doesn't call anything or know about any
 * particular accessor; pass the resolved address to whatever accessor
 * you're actually going to call through.
 */
export function resolveRemoteExportAddress(
  dllPath: string,
  remoteBase: AddressLike,
  exportName: string,
): bigint {
  const handle = Kernel32Impl.LoadLibraryExW(
    dllPath,
    0,
    LoadLibraryExFlag.DONT_RESOLVE_DLL_REFERENCES,
  );
  if (!handle) {
    throw new Error(`LoadLibraryExW failed for ${dllPath}`);
  }
  try {
    const procAddr = Kernel32Impl.GetProcAddress(handle, exportName);
    if (!procAddr) {
      throw new Error(
        `GetProcAddress failed for symbol ${exportName} in ${dllPath}`,
      );
    }
    const offset = BigInt(procAddr) - BigInt(handle);
    return BigInt(resolveAddress(remoteBase)) + offset;
  } finally {
    Kernel32Impl.FreeLibrary(handle);
  }
}
