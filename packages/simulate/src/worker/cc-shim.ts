import { Win32ProgramBuilder } from '../bin/compiler.js';
import type { Win32ProgramCodeExport } from '../runtime/programs.js';
import { getBoundWin64Process } from '../runtime/bun-ffi.js';
import { readFileSync } from './node-fs-shim.js';
import { classifyResolverTargets } from './resolver-source.js';
import {
  extractDefines,
  expandMacros,
  extractTypedefs,
  extractExternDeclarations,
  ffiTypeToCType,
  TypeTable,
  type CType,
} from './c-subset-compiler.js';
import {
  compileFunctionBody,
  type CExternFunction,
} from './c-subset-codegen.js';

export interface WorkerCCFunctionDefinition {
  readonly args?: readonly (string | number)[];
  readonly returns?: string | number;
}

export interface WorkerCCOptions {
  /** Real `cc()` accepts `.c` and generated `.def` source paths together;
   * only the `.c` file matters here -- `.def` files exist purely to steer
   * TCC's linker, which this shim never invokes. */
  readonly source: readonly string[];
  readonly symbols: Record<string, WorkerCCFunctionDefinition>;
  readonly library?: readonly string[];
}

export interface WorkerCCLibrary {
  readonly symbols: Record<string, (...args: unknown[]) => unknown>;
  close(): void;
}

let sequence = 0;

function normalizeLibraryName(name: string): string {
  const leaf = name.replace(/\//g, '\\').split('\\').pop() ?? name;
  return leaf.toLowerCase().endsWith('.dll')
    ? leaf.toLowerCase()
    : `${leaf.toLowerCase()}.dll`;
}

/**
 * Worker-runtime implementation of `bun:ffi`'s `cc()`. It supports pointer
 * resolver modules and ordinary function modules by inspecting requested
 * exports and C declarations; no package names or generator-specific helper
 * names participate in dispatch.
 */
export function cc(options: WorkerCCOptions): WorkerCCLibrary {
  const process = getBoundWin64Process();

  const sourcePath = options.source.find((candidate) =>
    candidate.toLowerCase().endsWith('.c'),
  );
  if (!sourcePath) {
    throw new Error('exoproc worker cc() shim requires a .c source path');
  }
  const source = readFileSync(sourcePath, 'utf8');
  if (typeof source !== 'string') {
    throw new Error(
      `exoproc worker cc() shim could not read ${sourcePath} as text`,
    );
  }

  const requestedNames = Object.keys(options.symbols);
  if (
    requestedNames.length > 0 &&
    requestedNames.every((name) => name.endsWith('_ptr'))
  ) {
    return compileResolverModule(process, options, source);
  }
  return compileFunctionModule(process, options, source);
}

function compileResolverModule(
  process: ReturnType<typeof getBoundWin64Process>,
  options: WorkerCCOptions,
  source: string,
): WorkerCCLibrary {
  const requestedNames = Object.keys(options.symbols);
  const kinds = classifyResolverTargets(source, requestedNames);
  const libraries = (options.library ?? []).map(normalizeLibraryName);

  const builder = new Win32ProgramBuilder();
  const { code } = builder;
  const codeExports: Win32ProgramCodeExport[] = [];
  const unresolved: string[] = [];

  for (const requestedName of requestedNames) {
    const baseName = requestedName.endsWith('_ptr')
      ? requestedName.slice(0, -4)
      : requestedName;
    const kind = kinds.get(baseName);
    const offset = code.length;

    if (kind === 'extern') {
      let address: bigint | undefined;
      if (libraries.length > 0) {
        for (const library of libraries) {
          address = process.resolveSymbol(library, baseName);
          if (address !== undefined) break;
        }
      } else {
        for (const module of process.modules) {
          address = process.resolveSymbol(module.name, baseName);
          if (address !== undefined) break;
        }
      }
      if (address === undefined) {
        unresolved.push(requestedName);
        continue;
      }
      code.mov('rax', address);
      code.ret();
    } else {
      code.mov('eax', 0);
      code.ret();
    }
    codeExports.push({ name: requestedName, offset });
  }

  if (unresolved.length > 0) {
    throw new Error(
      unresolved.map((name) => `undefined symbol '${name}'`).join('\n'),
    );
  }

  const moduleName = `exoproc-cc-resolvers-${sequence++}.dll`;
  const program = builder.finish(moduleName, codeExports);
  const loadedModule = process.machine.programs.loadIntoProcess(
    process,
    moduleName,
    program,
  );

  const symbols: Record<string, (...args: unknown[]) => unknown> = {};
  for (const requestedName of requestedNames) {
    const address = loadedModule.exports.get(requestedName);
    if (address === undefined) {
      throw new Error(
        `exoproc worker cc() shim failed to export ${requestedName} from ${moduleName}`,
      );
    }
    symbols[requestedName] = () => Number(process.invoke(address, []).value);
  }

  return {
    symbols,
    close: () => undefined,
  };
}

function extractFunctionParameterNames(text: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerPattern = new RegExp(`(^|[^\\w])${escaped}\\s*\\(`);
  const match = headerPattern.exec(text);
  if (!match) {
    throw new Error(
      `exoproc C subset compiler could not locate function "${name}" in the generated source`,
    );
  }

  const start = match.index + match[0].length;
  let cursor = start;
  let depth = 1;
  while (cursor < text.length && depth > 0) {
    if (text[cursor] === '(') depth += 1;
    else if (text[cursor] === ')') depth -= 1;
    cursor += 1;
  }
  if (depth !== 0) {
    throw new Error(
      `exoproc C subset compiler found an unterminated parameter list for "${name}"`,
    );
  }

  const parameterText = text.slice(start, cursor - 1).trim();
  if (!parameterText || parameterText === 'void') return [];

  const declarations: string[] = [];
  let declaration = '';
  depth = 0;
  for (const character of parameterText) {
    if (character === '(' || character === '[') depth += 1;
    else if (character === ')' || character === ']') depth -= 1;
    if (character === ',' && depth === 0) {
      declarations.push(declaration.trim());
      declaration = '';
    } else {
      declaration += character;
    }
  }
  if (declaration.trim()) declarations.push(declaration.trim());

  const typeKeywords = new Set([
    'void',
    'char',
    'short',
    'int',
    'long',
    'float',
    'double',
    'signed',
    'unsigned',
    'const',
    'volatile',
    'struct',
    'union',
    'enum',
  ]);

  return declarations.map((declarator, index) => {
    const functionPointerName = declarator.match(
      /\(\s*\*\s*([A-Za-z_]\w*)\s*\)/,
    )?.[1];
    if (functionPointerName) return functionPointerName;

    const identifiers = declarator.match(/[A-Za-z_]\w*/g) ?? [];
    const candidate = identifiers.at(-1);
    return candidate && !typeKeywords.has(candidate)
      ? candidate
      : `arg${index}`;
  });
}

function extractFunctionBody(text: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerPattern = new RegExp(`(^|[^\\w])${escaped}\\s*\\(`);
  const match = headerPattern.exec(text);
  if (!match) {
    throw new Error(
      `exoproc C subset compiler could not locate function "${name}" in the generated source`,
    );
  }
  let cursor = match.index + match[0].length;
  let parenDepth = 1;
  while (cursor < text.length && parenDepth > 0) {
    if (text[cursor] === '(') parenDepth += 1;
    else if (text[cursor] === ')') parenDepth -= 1;
    cursor += 1;
  }
  while (cursor < text.length && text[cursor] !== '{') cursor += 1;
  if (text[cursor] !== '{') {
    throw new Error(
      `exoproc C subset compiler expected "{" for function "${name}"`,
    );
  }
  cursor += 1;
  const start = cursor;
  let braceDepth = 1;
  while (cursor < text.length && braceDepth > 0) {
    if (text[cursor] === '{') braceDepth += 1;
    else if (text[cursor] === '}') {
      braceDepth -= 1;
      if (braceDepth === 0) break;
    }
    cursor += 1;
  }
  return text.slice(start, cursor);
}

function convertReturnValue(ffiType: string, raw: bigint): unknown {
  switch (ffiType) {
    case 'void':
      return undefined;
    case 'bool':
      return (raw & 1n) !== 0n;
    case 'i8':
      return Number(BigInt.asIntN(8, raw));
    case 'u8':
      return Number(BigInt.asUintN(8, raw));
    case 'i16':
      return Number(BigInt.asIntN(16, raw));
    case 'u16':
      return Number(BigInt.asUintN(16, raw));
    case 'i32':
      return Number(BigInt.asIntN(32, raw));
    case 'u32':
      return Number(BigInt.asUintN(32, raw));
    case 'i64':
      return BigInt.asIntN(64, raw);
    case 'u64':
    case 'usize':
    case 'size_t':
      return BigInt.asUintN(64, raw);
    case 'ptr':
    case 'cstring':
    case 'cwstring':
    case 'function':
    case 'buffer':
      return Number(BigInt.asIntN(64, raw));
    default:
      return Number(raw);
  }
}

/**
 * Recursively inlines quoted header files so declarations, structs, unions,
 * typedefs, and macros are visible while compiling a generated translation
 * unit. Include depth is bounded because this is a compact runtime compiler,
 * not a complete preprocessor.
 */
function resolveIncludesRecursively(text: string, depth: number): string {
  if (depth > 5) return '';
  const includeMatch = text.match(/^#include\s+"([^"]+)"/m);
  const includePath = includeMatch?.[1];
  if (!includePath) return '';
  let includedText = '';
  try {
    const contents = readFileSync(includePath, 'utf8');
    includedText = typeof contents === 'string' ? contents : '';
  } catch {
    return '';
  }
  const nested = resolveIncludesRecursively(includedText, depth + 1);
  return `${nested}\n${includedText}`;
}

function compileFunctionModule(
  process: ReturnType<typeof getBoundWin64Process>,
  options: WorkerCCOptions,
  source: string,
): WorkerCCLibrary {
  const requestedNames = Object.keys(options.symbols);
  // Generated function modules request each callable export together with
  // pointer and length metadata. Requiring both companions avoids mistaking a
  // real function whose name ends in `_ptr` or `_len` for metadata.
  const realNames = requestedNames.filter(
    (name) =>
      `${name}_ptr` in options.symbols && `${name}_len` in options.symbols,
  );

  const headerText = resolveIncludesRecursively(source, 0);
  const combined = `${headerText}\n${source}`;
  const types = new TypeTable();
  const { text: withoutDefines, macros } = extractDefines(combined);
  const expanded = expandMacros(withoutDefines, macros);
  const withoutTypedefs = extractTypedefs(expanded, types);

  const libraries = (options.library ?? []).map(normalizeLibraryName);
  const externs = new Map<string, CExternFunction>();
  for (const declaration of extractExternDeclarations(withoutTypedefs, types)) {
    let address: bigint | undefined;
    if (libraries.length > 0) {
      for (const library of libraries) {
        address = process.resolveSymbol(library, declaration.name);
        if (address !== undefined) break;
      }
    } else {
      for (const module of process.modules) {
        address = process.resolveSymbol(module.name, declaration.name);
        if (address !== undefined) break;
      }
    }
    if (address !== undefined) {
      externs.set(declaration.name, {
        address,
        returns: declaration.returnType,
      });
    }
  }

  const builder = new Win32ProgramBuilder();
  const { code } = builder;
  const codeExports: Win32ProgramCodeExport[] = [];
  const functionInfo = new Map<string, { offset: number; size: number }>();

  for (const name of realNames) {
    const definition = options.symbols[name];
    if (!definition) {
      throw new Error(`missing cc() definition for ${name}`);
    }
    const parameterNames = extractFunctionParameterNames(withoutTypedefs, name);
    const params = (definition.args ?? []).map((argType, index) => ({
      name: parameterNames[index] ?? `arg${index}`,
      type: ffiTypeToCType(String(argType)),
    }));
    const returns: CType = ffiTypeToCType(String(definition.returns ?? 'void'));
    const body = extractFunctionBody(withoutTypedefs, name);
    const offset = compileFunctionBody(code, {
      name,
      params,
      returns,
      body,
      types,
      externs,
    });
    functionInfo.set(name, { offset, size: code.length - offset });
    codeExports.push({ name, offset });
  }

  const moduleName = `exoproc-cc-${sequence++}.dll`;
  const program = builder.finish(moduleName, codeExports);
  const loadedModule = process.machine.programs.loadIntoProcess(
    process,
    moduleName,
    program,
  );

  const symbols: Record<string, (...args: unknown[]) => unknown> = {};
  for (const name of realNames) {
    const address = loadedModule.exports.get(name);
    if (address === undefined) {
      throw new Error(
        `exoproc worker cc() shim failed to export ${name} from ${moduleName}`,
      );
    }
    const definition = options.symbols[name];
    if (!definition) {
      throw new Error(`missing cc() definition for ${name}`);
    }
    const returnsFfiType = String(definition.returns ?? 'void');
    symbols[name] = (...argsList: unknown[]) => {
      const result = process.invoke(address, argsList);
      return convertReturnValue(returnsFfiType, result.value);
    };

    const info = functionInfo.get(name);
    if (!info) {
      throw new Error(`missing compiled function metadata for ${name}`);
    }
    if (`${name}_ptr` in options.symbols) {
      symbols[`${name}_ptr`] = () => Number(address);
    }
    if (`${name}_len` in options.symbols) {
      symbols[`${name}_len`] = () => info.size;
    }
    if (`${name}_end` in options.symbols) {
      symbols[`${name}_end`] = () => 0;
    }
  }

  for (const name of requestedNames) {
    if (name in symbols) continue;
    throw new Error(
      `exoproc worker cc() shim: "${name}" was requested but is neither a real function nor a ` +
        'recognized _ptr/_len/_end companion of one',
    );
  }

  return {
    symbols,
    close: () => undefined,
  };
}
