import {
  cc,
  type FFIFunction,
  type FFITypeOrString,
  type Pointer,
} from 'bun:ffi';
import {
  createCFunction,
  type CFunction,
  type IFunction,
  functionRegistry,
} from './cfunction.js';
import { resolveAddress } from './ffi.js';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { mapFFITypeToC } from './types.js';

function formatCompilationError(
  prefix: string,
  error: unknown,
  symbols: string[],
): Error {
  const message = error instanceof Error ? error.message : String(error);
  const symbolList = symbols.length > 0 ? symbols.join(', ') : '<none>';
  return new Error(`${prefix}: ${message}\nSymbols: ${symbolList}`);
}

/**
 * Defines a native function signature without requiring a 'ptr'.
 */
export type CImportSymbol = Omit<IFunction, 'ptr'>;

export type CImportSymbols = Record<string, CImportSymbol>;

import { type IPointer, NativePointer } from './pointer.js';

export type CImportLibrarySymbol = CFunction;

export type CImportLibrarySymbols<T extends Record<string, CImportSymbol>> = {
  [K in keyof T]: CImportLibrarySymbol;
};

export interface CImportLibrary<T extends Record<string, CImportSymbol>> {
  readonly symbols: CImportLibrarySymbols<T>;
  readonly library: string[];
  readonly defFiles?: string[];
  readonly dummySymbols?: Set<string>;
  readonly knownToLinker?: boolean;
  baseAddress?: IPointer;
  close(): void;
}

export interface CImportOptions {
  library?: string[];
  suffix?: string;
  /**
   * Set when `library` names a DLL the target toolchain's linker already
   * has import knowledge of (e.g. TinyCC's bundled kernel32/msvcrt/user32/gdi32
   * stubs on Windows), so no synthetic .def file is needed to resolve its
   * exports — the library name can just be passed straight through to the
   * linker. Platform-specific libraries should set this where they define
   * their `cimport()` call (see `packages/xffi/src/win/*.ts`) rather than
   * having callers guess it from a hardcoded name list.
   */
  knownToLinker?: boolean;
}

/**
 * Dynamically imports globally available native functions by compiling a tiny C
 * file that resolves their addresses via 'extern' declarations, and then wrapping
 * them in CFunction instances.
 *
 * @param symbols Record of function definitions
 * @param options Optional configuration including external libraries to link against.
 * @returns A CImportLibrary object containing the callable CFunction instances.
 */
export function cimport<T extends Record<string, CImportSymbol>>(
  symbols: T,
  options?: CImportOptions | string[],
): CImportLibrary<T> {
  const opts = Array.isArray(options) ? { library: options } : options || {};
  let libs = opts.library || [];
  if (typeof libs === 'string') {
    libs = [libs];
  }
  const suffix = opts.suffix ?? '.dll';

  const buildSource = (dummies: Set<string>) => {
    const fullSource: string[] = [
      `void* unwrap_thunk(void* ptr) {
        unsigned char* p = (unsigned char*)ptr;
        if (p == 0) return 0;
        // 1. jmp [rip + rel32] (FF 25) - Standard IAT thunk
        if (p[0] == 0xFF && p[1] == 0x25) {
            int rel32 = *(int*)(p + 2);
            unsigned char* target_addr = p + 6 + rel32;
            return *(void**)target_addr;
        }
        // 2. jmp rel32 (E9) - Standard jump thunk
        if (p[0] == 0xE9) {
            int rel32 = *(int*)(p + 1);
            return p + 5 + rel32;
        }
        return ptr;
      }`,
    ];

    for (const [name, sym] of Object.entries(symbols)) {
      const argsList = sym.args || [];
      const paramStr = argsList
        .map((type, i) => `${mapFFITypeToC(type)} arg${i}`)
        .join(', ');
      const retType = mapFFITypeToC(sym.returns || 'void');

      if (dummies.has(name)) {
        fullSource.push(`
static ${retType} dummy_${name}(${paramStr}) {
  ${retType === 'void' ? '' : 'return 0;'}
}
void* ${name}_ptr() { return (void*)dummy_${name}; }
`);
      } else {
        fullSource.push(`
extern ${retType} ${name}(${paramStr});
void* ${name}_ptr() { return unwrap_thunk((void*)${name}); }
`);
      }
    }
    return fullSource.join('\n\n');
  };

  const ccSymbols: Record<string, FFIFunction> = {};
  for (const [name] of Object.entries(symbols)) {
    ccSymbols[`${name}_ptr`] = { args: [], returns: 'ptr' };
  }

  // Detect non-default libraries on Windows/Wine and dynamically generate .def files
  const generatedDefFiles: string[] = [];
  const libsToLink: string[] = [];

  if (process.platform === 'win32') {
    for (const lib of libs) {
      if (opts.knownToLinker) {
        libsToLink.push(lib);
      } else {
        // Generate a temporary .def file
        const dllName = lib.toLowerCase().endsWith(suffix)
          ? lib
          : `${lib}${suffix}`;
        const dllBase = dllName.substring(
          Math.max(dllName.lastIndexOf('\\'), dllName.lastIndexOf('/')) + 1,
        );
        const defContent = [
          `LIBRARY ${dllBase}`,
          `EXPORTS`,
          ...Object.keys(symbols),
        ].join('\n');

        const safeLib = lib.replace(/[^a-zA-Z0-9_-]/g, '_');
        const defFile = join(
          tmpdir(),
          `xffi-def-${safeLib}-${randomBytes(4).toString('hex')}.def`,
        );
        writeFileSync(defFile, defContent);
        process.on('exit', () => {
          try {
            unlinkSync(defFile);
          } catch (e) {
            /* ignore */
          }
        });
        generatedDefFiles.push(defFile);
      }
    }
  } else {
    // On non-Windows platforms, we link standard way (or generate dummies)
    libsToLink.push(...libs);
  }

  const dummySymbols = new Set<string>();
  let compiledLibrary: any;
  let tmpFile = join(
    tmpdir(),
    `xffi-cimport-${randomBytes(8).toString('hex')}.c`,
  );

  try {
    writeFileSync(tmpFile, buildSource(dummySymbols));
    compiledLibrary = cc({
      source: [tmpFile, ...generatedDefFiles] as any,
      symbols: ccSymbols,
      ...(libsToLink.length > 0 ? { library: libsToLink } : {}),
    });
  } catch (e: any) {
    const message = e instanceof Error ? e.message : String(e);
    const undefinedMatches = [
      ...message.matchAll(/undefined symbol '([^']+)'/g),
    ];

    if (undefinedMatches.length > 0) {
      for (const match of undefinedMatches) {
        const symName = match[1];
        if (!symName) continue;
        const baseName = symName.endsWith('_ptr')
          ? symName.slice(0, -4)
          : symName;
        if (baseName in symbols) {
          dummySymbols.add(baseName);
        }
      }

      try {
        unlinkSync(tmpFile);
      } catch (e) {
        /* ignore */
      }
      tmpFile = join(
        tmpdir(),
        `xffi-cimport-${randomBytes(8).toString('hex')}.c`,
      );
      writeFileSync(tmpFile, buildSource(dummySymbols));

      try {
        compiledLibrary = cc({
          source: [tmpFile, ...generatedDefFiles] as any,
          symbols: ccSymbols,
          ...(libsToLink.length > 0 ? { library: libsToLink } : {}),
        });
      } catch (innerErr) {
        throw formatCompilationError(
          'cimport compilation failed',
          innerErr,
          Object.keys(symbols),
        );
      }
    } else if (libsToLink.length > 0 || process.platform !== 'win32') {
      // Fallback for missing platform libraries (e.g. Windows libraries on Linux/macOS)
      for (const k of Object.keys(symbols)) {
        dummySymbols.add(k);
      }
      libsToLink.length = 0;
      try {
        unlinkSync(tmpFile);
      } catch (e) {
        /* ignore */
      }
      tmpFile = join(
        tmpdir(),
        `xffi-cimport-${randomBytes(8).toString('hex')}.c`,
      );
      writeFileSync(tmpFile, buildSource(dummySymbols));

      try {
        compiledLibrary = cc({
          source: [tmpFile] as any,
          symbols: ccSymbols,
        });
      } catch (innerErr) {
        throw formatCompilationError(
          'cimport compilation failed',
          innerErr,
          Object.keys(symbols),
        );
      }
    } else {
      throw formatCompilationError(
        'cimport compilation failed',
        e,
        Object.keys(symbols),
      );
    }
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch (e) {
      /* ignore */
    }
  }

  // Keep compiledLibrary open — cc() callables reference its memory.
  const wrappedResult: any = {};
  for (const [name, sym] of Object.entries(symbols)) {
    const isDummy = dummySymbols.has(name);
    const realPtr = compiledLibrary.symbols[`${name}_ptr`]() as Pointer;

    wrappedResult[name] = createCFunction(
      realPtr,
      [sym.returns || 'void', (sym.args as FFITypeOrString[]) || []],
      isDummy
        ? () => {
            throw new Error(`${name} is not supported on this platform`);
          }
        : undefined,
      name,
    );
    const addrVal = BigInt(resolveAddress(realPtr));
    functionRegistry.set(addrVal, {
      name,
      library: libs.join(',') || 'unknown',
    });
  }

  Object.defineProperty(wrappedResult, 'library', {
    value: libs,
    enumerable: false,
    writable: false,
    configurable: true,
  });

  return {
    symbols: wrappedResult,
    library: libs,
    defFiles: generatedDefFiles,
    dummySymbols,
    knownToLinker: !!opts.knownToLinker,
    baseAddress: new NativePointer(0),
    close() {
      compiledLibrary.close();
      for (const defFile of generatedDefFiles) {
        try {
          unlinkSync(defFile);
        } catch (e) {
          /* ignore */
        }
      }
    },
  };
}
