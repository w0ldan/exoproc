import { type CFunction } from './cfunction.js';
import { type CImportLibrary } from './cimport.js';
import { mapFFITypeToC } from './types.js';
import { resolveAddress } from './ffi.js';
import * as winDefines from './win/defines.js';

export interface CGeneratorOptions {
  defines?: any[];
  structs?: any[];
  preamble?: string;
  imports?: (CImportLibrary<any> | Record<string, any>)[];
  mode: 'jit' | 'machineCode';
  source?: string;
  definedSymbols?: Set<string>;
}

export function getCTypedef(fn: {
  returns?: any;
  args?: readonly any[];
}): string {
  const retType = mapFFITypeToC(fn.returns || 'void');
  const paramTypes = (fn.args || [])
    .map((arg) => mapFFITypeToC(arg))
    .join(', ');
  return `${retType} (*)(${paramTypes})`;
}

export function generateCStructs(structsOpt?: any): string {
  if (!structsOpt) return '';

  const classToName = new Map<any, string>();
  const allRegisteredClasses: any[] = [];

  function register(clazz: any, name: string) {
    if (clazz && typeof clazz === 'function' && clazz.isStructClass) {
      if (!allRegisteredClasses.includes(clazz)) {
        allRegisteredClasses.push(clazz);
      }
      classToName.set(clazz, name);
    }
  }

  if (typeof structsOpt === 'object' && !Array.isArray(structsOpt)) {
    for (const [key, val] of Object.entries(structsOpt)) {
      if (val && typeof val === 'function' && (val as any).isStructClass) {
        const name = (val as any).structName ?? key;
        register(val, name);
      }
    }
  } else if (Array.isArray(structsOpt)) {
    for (const item of structsOpt) {
      if (item && typeof item === 'object') {
        for (const [key, val] of Object.entries(item)) {
          if (val && typeof val === 'function' && (val as any).isStructClass) {
            const name = (val as any).structName ?? key;
            register(val, name);
          }
        }
      } else if (
        item &&
        typeof item === 'function' &&
        (item as any).isStructClass
      ) {
        const name = (item as any).structName ?? item.name ?? 'Struct';
        register(item, name);
      }
    }
  }

  for (const clazz of allRegisteredClasses) {
    const name = classToName.get(clazz)!;
    if (typeof (clazz as any).toCDefinition === 'function') {
      (clazz as any).toCDefinition(name, classToName);
    }
  }

  const visited = new Set<any>();
  const tempVisited = new Set<any>();
  const sortedClasses: any[] = [];

  function getStructDependencies(schema: any): Set<any> {
    const deps = new Set<any>();
    function walk(val: any) {
      if (!val) return;
      if (typeof val === 'function' && val.isStructClass) {
        deps.add(val);
      } else if (Array.isArray(val)) {
        walk(val[0]);
      } else if (typeof val === 'object') {
        for (const v of Object.values(val)) {
          walk(v);
        }
      }
    }
    walk(schema);
    return deps;
  }

  function visit(clazz: any) {
    if (visited.has(clazz)) return;
    if (tempVisited.has(clazz)) {
      throw new Error(`Circular dependency detected in structs!`);
    }
    tempVisited.add(clazz);

    const deps = getStructDependencies(clazz.schema);
    for (const dep of deps) {
      const registeredDep = allRegisteredClasses.find(
        (c) => c.schema === dep.schema,
      );
      if (registeredDep) {
        visit(registeredDep);
      }
    }

    tempVisited.delete(clazz);
    visited.add(clazz);
    sortedClasses.push(clazz);
  }

  for (const clazz of allRegisteredClasses) {
    visit(clazz);
  }

  const defs: string[] = [];
  for (const clazz of sortedClasses) {
    const name = classToName.get(clazz)!;
    if (typeof (clazz as any).toCDefinition === 'function') {
      defs.push((clazz as any).toCDefinition(name, classToName));
    }
  }

  return defs.join('\n\n');
}

export function generateCDefines(definesOpt?: any[]): string {
  if (!definesOpt || definesOpt.length === 0) return '';
  const defineLines: string[] = [];

  const gatherCDefines = (group: any) => {
    if (group._cDefines) {
      for (const [cKey, cVal] of Object.entries(group._cDefines)) {
        if (cVal && typeof cVal === 'function' && (cVal as any)._isCMacro) {
          defineLines.push((cVal as any).toCDefinition(cKey));
        } else {
          defineLines.push(`#define ${cKey} ${cVal}`);
        }
      }
    }
    for (const val of Object.values(group)) {
      if (val && typeof val === 'object' && (val as any)._isCDefineGroup) {
        gatherCDefines(val);
      }
    }
  };

  for (const item of definesOpt) {
    if (typeof item === 'string') {
      const val = (winDefines as any)[item];
      if (val !== undefined) {
        if (val && typeof val === 'function' && val._isCMacro) {
          defineLines.push(val.toCDefinition(item));
        } else {
          defineLines.push(`#define ${item} ${val}`);
        }
      }
    } else if (item && typeof item === 'object') {
      if ((item as any)._isCDefineGroup) {
        gatherCDefines(item);
      } else {
        for (const [key, val] of Object.entries(item)) {
          if (val && typeof val === 'object' && (val as any)._isCDefineGroup) {
            gatherCDefines(val);
          } else if (
            val &&
            typeof val === 'function' &&
            (val as any)._isCMacro
          ) {
            defineLines.push((val as any).toCDefinition(key));
          } else {
            defineLines.push(`#define ${key} ${val}`);
          }
        }
      }
    } else if (typeof item === 'function' && (item as any)._isCMacro) {
      if (item.name) {
        defineLines.push((item as any).toCDefinition(item.name));
      }
    }
  }

  return defineLines.join('\n');
}

export function generateCImportsJit(
  importsList: (CImportLibrary<any> | Record<string, any>)[],
  definedSymbols: Set<string>,
): string {
  const externs: string[] = [];
  const definedExterns = new Set<string>(definedSymbols);

  for (const imp of importsList) {
    if (imp && typeof imp === 'object') {
      const symbolsSource = 'symbols' in imp ? (imp as any).symbols : imp;
      const dummySymbols =
        'dummySymbols' in imp
          ? ((imp as any).dummySymbols as Set<string>)
          : null;
      if (symbolsSource && typeof symbolsSource === 'object') {
        for (const [name, cfn] of Object.entries(symbolsSource)) {
          if (definedExterns.has(name)) continue;

          const cfnObj = cfn as any;
          if (cfnObj && ('args' in cfnObj || 'returns' in cfnObj)) {
            definedExterns.add(name);
            const argsList = cfnObj.args || [];
            const paramStr = argsList
              .map((type: any, i: number) => `${mapFFITypeToC(type)} arg${i}`)
              .join(', ');
            const retType = mapFFITypeToC(cfnObj.returns || 'void');
            const isDummy = dummySymbols ? dummySymbols.has(name) : false;
            if (process.platform === 'win32' || !isDummy) {
              externs.push(`extern ${retType} ${name}(${paramStr});`);
            } else {
              externs.push(
                `${retType} ${name}(${paramStr}) { ${retType === 'void' ? '' : 'return 0;'} }`,
              );
            }
          }
        }
      }
    }
  }

  return externs.join('\n');
}

export function generateCImportsMachineCode(
  importsList: (CImportLibrary<any> | Record<string, any>)[],
  sourceCode: string,
): string {
  const registeredFunctions = new Map<string, CFunction>();
  for (const item of importsList) {
    if (item && typeof item === 'object') {
      const symbols = (item as any).symbols ?? item;
      for (const [name, fn] of Object.entries(symbols)) {
        if (fn && typeof fn === 'function' && 'ptr' in (fn as any)) {
          registeredFunctions.set(name, fn as CFunction);
        }
      }
    }
  }

  const macros: string[] = [];
  for (const [name, fn] of registeredFunctions.entries()) {
    const wordPattern = new RegExp(`\\b${name}\\b`);
    if (wordPattern.test(sourceCode)) {
      const address = resolveAddress(fn.ptr);
      const typedef = getCTypedef(fn);
      macros.push(`#define ${name} ((${typedef})${address}ULL)`);
    }
  }

  return macros.join('\n');
}

export function generateFullCSource(options: CGeneratorOptions): string {
  const fullSource: string[] = [];

  const definesStr = generateCDefines(options.defines);
  if (definesStr) {
    fullSource.push(definesStr);
  }

  if (options.mode === 'jit') {
    const externsStr = generateCImportsJit(
      options.imports || [],
      options.definedSymbols || new Set(),
    );
    if (externsStr) {
      fullSource.push(externsStr);
    }
  } else if (options.mode === 'machineCode' && options.source) {
    const macrosStr = generateCImportsMachineCode(
      options.imports || [],
      options.source,
    );
    if (macrosStr) {
      fullSource.push(macrosStr);
    }
  }

  const structsStr = generateCStructs(options.structs);
  if (structsStr) {
    fullSource.push(structsStr);
  }

  if (options.preamble) {
    fullSource.push(options.preamble);
  }

  if (options.mode === 'machineCode' && options.source) {
    fullSource.push(options.source);
  }

  return fullSource.join('\n\n');
}

export function generateSharedHeader(options: {
  defines?: any[];
  structs?: any[];
  preamble?: string;
}): string {
  const parts: string[] = [];
  const definesStr = generateCDefines(options.defines);
  if (definesStr) parts.push(definesStr);
  const structsStr = generateCStructs(options.structs);
  if (structsStr) parts.push(structsStr);
  if (options.preamble) parts.push(options.preamble);
  return parts.join('\n\n');
}
