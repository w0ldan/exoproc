import {
  cc,
  toArrayBuffer,
  type FFIFunction,
  type FFITypeOrString,
  type Pointer,
} from 'bun:ffi';
import {
  createDynamicCFunction,
  type DynamicCFunction,
  type IFunction,
} from './cfunction.js';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { mapFFITypeToC, mapToBunFFIType } from './types.js';
import { type CImportLibrary } from './cimport.js';
import {
  generateSharedHeader,
  generateCImportsJit,
  generateCImportsMachineCode,
} from './cgenerator.js';

export type CJitSymbol = Omit<IFunction, 'ptr'> & { source: string };
export type CJitSymbols = Record<string, CJitSymbol>;
export type CJitLibrarySymbols<T extends Record<string, CJitSymbol>> = {
  [K in keyof T]: DynamicCFunction;
};

export interface CJitLibrary<T extends Record<string, CJitSymbol>> {
  readonly symbols: CJitLibrarySymbols<T>;
  close(): void;
}

export interface CJitOptions {
  library?: string[];
  imports?: (CImportLibrary<any> | Record<string, any>)[];
  structs?: (any | Record<string, any>)[] | Record<string, any>;
  defines?: Record<string, any> | string[];
  preamble?: string;
  singleCompile?: boolean;
  compileMode?: 'jit' | 'machineCode'; // New compileMode option to enable multi-machineCode compilations
}

export const cjitDefaults: {
  library: string[];
  imports: (CImportLibrary<any> | Record<string, any>)[];
  structs: any[];
  defines: any[];
  preamble: string;
} = {
  library: [],
  imports: [],
  structs: [],
  defines: [],
  preamble: '',
};

export function addCJitDefault(options: CJitOptions) {
  if (options.library) {
    for (const lib of options.library) {
      if (!cjitDefaults.library.includes(lib)) cjitDefaults.library.push(lib);
    }
  }
  if (options.imports) cjitDefaults.imports.push(...options.imports);
  if (options.structs) {
    if (Array.isArray(options.structs))
      cjitDefaults.structs.push(...options.structs);
    else cjitDefaults.structs.push(options.structs);
  }
  if (options.defines) {
    if (Array.isArray(options.defines))
      cjitDefaults.defines.push(...options.defines);
    else cjitDefaults.defines.push(options.defines);
  }
  if (options.preamble) {
    cjitDefaults.preamble +=
      (cjitDefaults.preamble ? '\n' : '') + options.preamble;
  }
}

/**
 * Compiles and loads multiple C functions synchronously using Bun's TinyCC integration.
 * Supports standard 'jit' mode with linking and externs, or 'machineCode' mode compiling
 * relocatable standalone machine code symbols utilizing direct macro address mapping.
 *
 * @param symbols Record of function definitions including their C source code.
 * @param options Optional configuration including external libraries or compileMode: 'machineCode'
 * @returns A CJitLibrary object containing the compiled DynamicCFunction instances.
 */
export function cjitopen<T extends Record<string, CJitSymbol>>(
  symbols: T,
  options?:
    CJitOptions | (CImportLibrary<any> | Record<string, any>)[] | string[],
): CJitLibrary<T> {
  let libs: string[] = [];
  let importsList: (CImportLibrary<any> | Record<string, any>)[] = [];
  let structsOpt: any = undefined;
  let definesOpt: Record<string, any> | undefined = undefined;
  let preambleOpt: string | undefined = undefined;
  let compileMode: 'jit' | 'machineCode' = 'jit';

  if (Array.isArray(options)) {
    if (
      options.length > 0 &&
      typeof options[0] === 'object' &&
      options[0] !== null
    ) {
      importsList = options as (CImportLibrary<any> | Record<string, any>)[];
    } else {
      libs = options as string[];
    }
  } else if (options) {
    libs = options.library ? [...options.library] : [];
    importsList = options.imports || [];
    structsOpt = options.structs;
    definesOpt = options.defines;
    preambleOpt = options.preamble;
    compileMode = options.compileMode || 'jit';
  }

  // Prepend default imports from cjitDefaults
  libs = [...cjitDefaults.library, ...libs];
  importsList = [...cjitDefaults.imports, ...importsList];

  const defFiles: string[] = [];
  const libsToLink: string[] = [];

  // Gather libraries and .def files only when in standard 'jit' linking mode.
  // Each import declares for itself (via `knownToLinker`, set where its
  // `cimport()` call lives under win/) whether the toolchain already knows
  // how to resolve it directly, or needs the .def file it generated.
  if (compileMode === 'jit') {
    for (const imp of importsList) {
      if (imp && typeof imp === 'object') {
        const library = 'library' in imp ? (imp as any).library : [];
        if (library && (imp as any).knownToLinker) {
          for (const lib of library) {
            if (!libsToLink.includes(lib)) {
              libsToLink.push(lib);
            }
          }
        }
        const impDefFiles = 'defFiles' in imp ? (imp as any).defFiles : [];
        if (impDefFiles) {
          for (const defFile of impDefFiles) {
            if (!defFiles.includes(defFile)) {
              defFiles.push(defFile);
            }
          }
        }
      }
    }

    for (const lib of libs) {
      if (!libsToLink.includes(lib)) {
        libsToLink.push(lib);
      }
    }
  }

  // 1. Generate the JIT-independent shared header content
  let mergedStructs: any;
  if (structsOpt) {
    if (Array.isArray(structsOpt)) {
      mergedStructs = [...cjitDefaults.structs, ...structsOpt];
    } else {
      mergedStructs = [...cjitDefaults.structs, structsOpt];
    }
  } else {
    mergedStructs = [...cjitDefaults.structs];
  }

  let mergedDefines: any[];
  if (definesOpt) {
    if (Array.isArray(definesOpt)) {
      mergedDefines = [...cjitDefaults.defines, ...definesOpt];
    } else {
      mergedDefines = [...cjitDefaults.defines, definesOpt];
    }
  } else {
    mergedDefines = [...cjitDefaults.defines];
  }

  if (cjitDefaults.preamble) {
    preambleOpt =
      cjitDefaults.preamble + (preambleOpt ? '\n' + preambleOpt : '');
  }

  const sharedHeaderContent = generateSharedHeader({
    defines: mergedDefines,
    structs: mergedStructs,
    preamble: preambleOpt,
  });

  const sharedHash = Bun.hash(sharedHeaderContent).toString(16);
  const sharedHeaderFile = join(tmpdir(), `xffi-shared-header-${sharedHash}.h`);
  if (!existsSync(sharedHeaderFile)) {
    try {
      writeFileSync(sharedHeaderFile, sharedHeaderContent, 'utf8');
    } catch {
      // ignore
    }
  }

  // 2. Generate JIT/MachineCode specific declarations
  let customDeclarations = '';
  if (compileMode === 'jit') {
    customDeclarations = generateCImportsJit(
      importsList,
      new Set(Object.keys(symbols)),
    );
  } else {
    // Collect all symbol sources to scan for referenced imports
    const completeSymbolsSource = Object.values(symbols)
      .map((s) => s.source)
      .join('\n');
    customDeclarations = generateCImportsMachineCode(
      importsList,
      completeSymbolsSource,
    );
  }

  // 3. Construct Compilation Header Source that includes the shared header
  const headerSource = [
    `#include "${sharedHeaderFile.replace(/\\/g, '/')}"`,
    customDeclarations,
  ]
    .filter(Boolean)
    .join('\n\n');

  const ccSymbols: Record<string, FFIFunction> = {};

  // Hash everything EXCEPT the function bodies to create a cached JIT header
  const hash = Bun.hash(headerSource).toString(16);
  const headerFile = join(tmpdir(), `xffi-jit-header-${hash}.h`);
  if (!existsSync(headerFile)) {
    try {
      writeFileSync(headerFile, headerSource, 'utf8');
    } catch {
      // ignore
    }
  }

  const fullSource: string[] = [];
  // Use a proper include that TCC will find
  fullSource.push(`#include "${headerFile.replace(/\\/g, '/')}"`);

  // 3. Build the complete C source and prepare the CC symbols definition
  for (const [name, sym] of Object.entries(symbols)) {
    const argsList = sym.args || [];
    const paramStr = argsList
      .map((type, i) => `${mapFFITypeToC(type)} arg${i}`)
      .join(', ');
    const retType = mapFFITypeToC(sym.returns || 'void');

    // Construct the full C function definition with helpers for metadata extraction
    if (sym.source.includes(`${name}(`) || sym.source.includes(`${name} (`)) {
      fullSource.push(`
${sym.source}
void ${name}_end() {}
unsigned long long ${name}_ptr() { return (unsigned long long)${name}; }
int ${name}_len() { return (int)((char*)${name}_end - (char*)${name}); }
`);
    } else {
      fullSource.push(`
${retType} ${name}(${paramStr}) {
${sym.source}
}
void ${name}_end() {}
unsigned long long ${name}_ptr() { return (unsigned long long)${name}; }
int ${name}_len() { return (int)((char*)${name}_end - (char*)${name}); }
`);
    }

    // Prepare the symbol definition for bun:ffi cc()
    ccSymbols[name] = {
      args: argsList.map(mapToBunFFIType) as FFITypeOrString[],
      returns: mapToBunFFIType(sym.returns || 'void'),
    } as FFIFunction;

    ccSymbols[`${name}_ptr`] = { args: [], returns: 'ptr' };
    ccSymbols[`${name}_len`] = { args: [], returns: 'i32' };
  }

  // 2. Compile all functions at once using a temporary file
  const tmpFile = join(
    tmpdir(),
    `xffi-jit-${randomBytes(8).toString('hex')}.c`,
  );
  writeFileSync(tmpFile, fullSource.join('\n\n'));

  try {
    const compiledLibrary = cc({
      source: [tmpFile, ...defFiles] as any,
      symbols: ccSymbols,
      ...(libsToLink.length > 0 ? { library: libsToLink } : {}),
    });

    const resultSymbols: any = {};
    for (const [name, sym] of Object.entries(symbols)) {
      // Extract metadata using the injected helper functions
      const addr = (compiledLibrary.symbols as any)[`${name}_ptr`]() as Pointer;
      const size = (compiledLibrary.symbols as any)[`${name}_len`]() as number;

      // Extract the natively generated callable function from Bun's FFI directly
      const callable = (compiledLibrary.symbols as any)[
        name
      ] as CallableFunction;

      // Read bytes directly from memory using toArrayBuffer
      const bytesArray = new Uint8Array(toArrayBuffer(addr, 0, size));

      // Construct the DynamicCFunction
      resultSymbols[name] = createDynamicCFunction(
        addr,
        [sym.returns || 'void', (sym.args as FFITypeOrString[]) || []],
        size,
        bytesArray,
        callable,
      );
    }

    return {
      symbols: resultSymbols,
      close: () => {
        compiledLibrary.close();
      },
    };
  } catch (e) {
    const content = readFileSync(tmpFile, 'utf8');
    throw new Error(
      `JIT Compilation failed: ${e}\n\nGenerated Source:\n${content}`,
    );
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch (e) {
      /* ignore */
    }
  }
}
