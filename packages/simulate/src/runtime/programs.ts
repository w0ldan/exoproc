import type {
  Win32MainArguments,
  Win32StandardHandles,
  Win64Handle,
  Win64Import,
  Win64Module,
} from './types.js';
import type { Win32Console } from './console.js';
import type { Win32Environment } from './environment.js';
import type { Win32FileSystem } from './file-system.js';
import type {
  Win32ProcessSession,
  Win32ProcessStdio,
  Win64Machine,
  Win64Process,
  Win64Thread,
} from './win64-machine.js';

const TEXT_OFFSET = 0x1000n;
const IAT_OFFSET = 0x2000n;
const DATA_OFFSET = 0x3000n;
const IMAGE_SECTION_PAGE_SIZE = 0x1000;

export type Win32ProgramRelocationTarget =
  | {
      readonly kind: 'data';
      readonly symbol: string;
    }
  | {
      readonly kind: 'export';
      readonly dllName: string;
      readonly functionName: string;
    }
  | {
      /** Absolute address of a DLL's private globals page (see win32-dlls.ts). */
      readonly kind: 'module-globals';
      readonly dllName: string;
    };

export interface Win32ProgramRelocation {
  readonly offset: number;
  readonly encoding: 'absolute64' | 'iat-relative32';
  readonly target: Win32ProgramRelocationTarget;
}

export type Win32ProgramDataSection = '.rdata' | '.data' | '.bss';

export interface Win32ProgramDataSymbol {
  readonly name: string;
  readonly section: Win32ProgramDataSection;
  readonly offset: number;
  readonly length: number;
}

/**
 * A named entry point inside a compiled program's `.text`, at a fixed byte
 * offset from wherever that code ends up mapped. Only programs meant to be
 * loaded as a synthetic DLL module (see `Win32ProgramRegistry.loadIntoProcess`)
 * populate this -- an ordinary EXE only has the single `entryOffset`.
 */
export interface Win32ProgramCodeExport {
  readonly name: string;
  readonly offset: number;
}

export interface Win32CompiledProgram {
  readonly name: string;
  readonly code: Uint8Array;
  readonly data: Uint8Array;
  readonly dataSymbols: readonly Win32ProgramDataSymbol[];
  readonly entryOffset: number;
  readonly relocations: readonly Win32ProgramRelocation[];
  /** Named `.text` entry points for a `loadIntoProcess`-style DLL module. */
  readonly codeExports?: readonly Win32ProgramCodeExport[];
}

export interface Win32LoadedProgram {
  readonly program: Win32CompiledProgram;
  readonly entryPoint: bigint;
  readonly iatBase: bigint;
  readonly iatSize: number;
  readonly imports: readonly Win64Import[];
  readonly dataBase: bigint;
  readonly mainArguments: Win32MainArguments;
}

export interface Win32ProgramSpawn {
  readonly process: Win64Process;
  readonly thread: Win64Thread;
}

/**
 * Everything `spawn` needs from whoever is launching a program.
 *
 * A `Win64Process` satisfies this structurally, so the `CreateProcessA` path
 * keeps passing its parent process unchanged. The host (`Win64Machine.
 * spawnProgram`) has no parent process to speak of and supplies the same four
 * pieces directly instead of inventing a synthetic launcher process.
 */
export interface Win32ProgramSpawnContext {
  readonly machine: Win64Machine;
  readonly console: Win32Console;
  readonly environment: Win32Environment;
  readonly session: Win32ProcessSession;
}

export interface Win32ProgramLaunchOptions {
  readonly initializeStandardHandles?: boolean;
  readonly inheritedHandles?: readonly Win64Handle[];
  readonly standardHandles?: Partial<Win32StandardHandles>;
  /** Host stdio capabilities, when the launcher is not inheriting handles. */
  readonly stdio?: Win32ProcessStdio;
}

export interface Win32InstalledProgram {
  readonly path: string;
  readonly program: Win32CompiledProgram;
}

function qwordInto(bytes: Uint8Array, offset: number, value: bigint): void {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setBigUint64(
    offset,
    BigInt.asUintN(64, value),
    true,
  );
}

function relativeDwordInto(
  bytes: Uint8Array,
  offset: number,
  sourceBase: bigint,
  target: bigint,
): void {
  const nextInstruction = sourceBase + BigInt(offset + 4);
  const displacement = target - nextInstruction;
  if (BigInt.asIntN(32, displacement) !== displacement) {
    throw new RangeError(
      `RIP-relative relocation is out of range: ${displacement}`,
    );
  }
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setInt32(
    offset,
    Number(displacement),
    true,
  );
}

function importKey(dllName: string, functionName: string): string {
  return `${dllName.toLowerCase()}!${functionName}`;
}

function serializeProgramImage(program: Win32CompiledProgram): Uint8Array {
  const headerSize = 64;
  const image = new Uint8Array(
    headerSize + program.code.length + program.data.length,
  );
  image.set([0x4d, 0x5a], 0);
  image.set(new TextEncoder().encode('EXOPROC64'), 8);
  const view = new DataView(image.buffer);
  view.setUint32(20, headerSize, true);
  view.setUint32(24, program.code.length, true);
  view.setUint32(28, headerSize + program.code.length, true);
  view.setUint32(32, program.data.length, true);
  view.setUint32(36, program.entryOffset, true);
  view.setUint32(40, program.relocations.length, true);
  image.set(program.code, headerSize);
  image.set(program.data, headerSize + program.code.length);
  return image;
}

/**
 * Registry and loader for compiler-produced guest executables.
 *
 * Program definitions are compiled before reaching this runtime layer, which
 * installs images, resolves relocations, and executes their Win64 threads.
 */
export class Win32ProgramRegistry {
  private readonly programs = new Map<string, Win32InstalledProgram>();

  constructor(private readonly fileSystem: Win32FileSystem) {}

  public install(path: string, program: Win32CompiledProgram): void {
    const normalized = this.fileSystem.normalize(path);
    const image = serializeProgramImage(program);
    this.fileSystem.writeFile(normalized, image);
    this.programs.set(normalized.toLowerCase(), {
      path: normalized,
      program,
    });
  }

  /**
   * Installs another executable name for an existing compiled image.
   *
   * Code, data and relocation tables are shared in the registry. The VFS gets
   * a normal executable image at the alias path, so PATH/PATHEXT resolution
   * and CreateProcess do not need a command-name special case.
   */
  public installAlias(aliasPath: string, targetPath: string): void {
    const target = this.get(targetPath);
    if (!target) {
      throw new Error(
        `Executable alias target is not installed: ${this.fileSystem.normalize(
          targetPath,
        )}`,
      );
    }
    const normalizedAlias = this.fileSystem.normalize(aliasPath);
    const separator = normalizedAlias.lastIndexOf('\\');
    const name = normalizedAlias.slice(separator + 1);
    this.install(normalizedAlias, {
      ...target,
      name,
    });
  }

  public get(path: string): Win32CompiledProgram | undefined {
    return this.programs.get(this.fileSystem.normalize(path).toLowerCase())
      ?.program;
  }

  public entries(): readonly Win32InstalledProgram[] {
    return [...this.programs.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    );
  }

  /**
   * Creates a process, loads `path` into it and creates its main thread.
   *
   * This only sets the process up -- it does not run a single instruction.
   * The caller is responsible for handing the returned thread to the
   * `Scheduler` (see `Win64Machine.createProcessFromKernel`) so it actually
   * runs, the same way every other runnable thread does.
   */
  public spawn(
    parent: Win32ProgramSpawnContext,
    path: string,
    arguments_: readonly string[] = [],
    options: Win32ProgramLaunchOptions = {},
  ): Win32ProgramSpawn | undefined {
    const program = this.get(path);
    if (!program) return undefined;
    const normalizedPath = this.fileSystem.normalize(path);

    const process = parent.machine.createProcess(
      {
        image: program.name,
        path: normalizedPath,
      },
      {
        console: parent.console,
        environment: parent.environment,
        session: parent.session,
        initializeStandardHandles: options.initializeStandardHandles ?? true,
        inheritedHandles: options.inheritedHandles,
        standardHandles: options.standardHandles,
        stdio: options.stdio,
      },
    );
    process.arguments = [...arguments_];
    const loaded = this.load(process, program);
    const thread = process.createThread(
      `${program.name} main thread`,
      loaded.entryPoint,
      [
        loaded.mainArguments.argc,
        loaded.mainArguments.argv,
        loaded.mainArguments.envp,
      ],
    );
    return { process, thread };
  }

  /**
   * Loads a compiled program as a synthetic DLL module into an *already
   * running* process -- the `LoadLibrary`-shaped counterpart to `spawn`
   * (which creates a brand-new process for an EXE image). Among other uses,
   * this lets the simulator's C compiler install compiled FFI helper modules.
   * Each module is linked here and added to `process.modules` exactly like a
   * real `LoadLibrary` result, so `process.resolveSymbol` (the same lookup
   * `GetProcAddress` uses) can find its exports alongside catalog DLL exports.
   *
   * Unlike `load()` (which places the *one* EXE image at a fixed offset from
   * `process.imageBase`), this allocates fresh mappings wherever the process
   * has room, since an arbitrary number of modules may be loaded into a
   * process over its lifetime, each getting its own module table entry.
   *
   * Only `absolute64` relocations are understood here (an `iat-relative32`
   * `call` through a synthetic module's own IAT has no concrete use case
   * yet); a program built with one throws rather than silently mis-linking.
   */
  public loadIntoProcess(
    process: Win64Process,
    moduleName: string,
    program: Win32CompiledProgram,
  ): Win64Module {
    const codeSize = Math.max(1, program.code.length);
    const textBase = process.allocate(
      codeSize,
      'rx',
      0n,
      `${moduleName} / .text`,
    );
    const linkedCode = program.code.slice();

    let dataBase = 0n;
    if (program.data.length > 0) {
      dataBase = process.allocate(
        program.data.length,
        'rw',
        0n,
        `${moduleName} / .data`,
      );
      process.memory.write(dataBase, program.data);
    }

    for (const relocation of program.relocations) {
      if (relocation.encoding !== 'absolute64') {
        throw new Error(
          `Dynamically loaded module "${moduleName}" uses an unsupported relocation encoding: ${relocation.encoding}`,
        );
      }
      const target = relocation.target;
      if (target.kind === 'module-globals') {
        throw new Error(
          `Dynamically loaded module "${moduleName}" cannot reference a DLL module globals page`,
        );
      }
      const resolved =
        target.kind === 'data'
          ? dataBase +
            BigInt(this.requireDataSymbol(program, target.symbol).offset)
          : process.resolveSymbol(target.dllName, target.functionName);
      if (resolved === undefined) {
        throw new Error(
          target.kind === 'export'
            ? `Unresolved import ${target.dllName}!${target.functionName}`
            : 'Unresolved program data relocation',
        );
      }
      qwordInto(linkedCode, relocation.offset, resolved);
    }

    process.memory.load(textBase, linkedCode);

    const exports = new Map<string, bigint>(
      (program.codeExports ?? []).map((codeExport) => [
        codeExport.name,
        textBase + BigInt(codeExport.offset),
      ]),
    );
    const module: Win64Module = {
      name: moduleName,
      base: textBase,
      size: codeSize,
      exports,
      iatBase: 0n,
      iatSize: 0,
      imports: [],
    };
    process.modules.push(module);
    return module;
  }

  public load(
    process: Win64Process,
    program: Win32CompiledProgram,
  ): Win32LoadedProgram {
    const textBase = process.imageBase + TEXT_OFFSET;
    const iatBase = process.imageBase + IAT_OFFSET;
    const dataBase = process.imageBase + DATA_OFFSET;
    const linkedCode = program.code.slice();
    if (linkedCode.length > IMAGE_SECTION_PAGE_SIZE) {
      throw new RangeError(
        `${program.name} .text exceeds its ${IMAGE_SECTION_PAGE_SIZE}-byte image page`,
      );
    }
    const imports: Win64Import[] = [];
    const importSlots = new Map<string, bigint>();

    for (const relocation of program.relocations) {
      if (relocation.encoding !== 'iat-relative32') continue;
      const target = relocation.target;
      if (target.kind !== 'export') {
        throw new Error('IAT relocation target must be a DLL export');
      }
      const key = importKey(target.dllName, target.functionName);
      if (importSlots.has(key)) continue;
      const targetAddress = process.resolveSymbol(
        target.dllName,
        target.functionName,
      );
      if (targetAddress === undefined) {
        throw new Error(
          `Unresolved import ${target.dllName}!${target.functionName}`,
        );
      }
      const slotAddress = iatBase + BigInt(imports.length * 8);
      importSlots.set(key, slotAddress);
      imports.push({
        symbol: target.functionName,
        dllName: target.dllName,
        functionName: target.functionName,
        slotAddress,
        targetAddress,
      });
    }

    if (imports.length > 0) {
      const iat = new Uint8Array(imports.length * 8);
      if (iat.length > IMAGE_SECTION_PAGE_SIZE) {
        throw new RangeError(
          `${program.name} IAT exceeds its ${IMAGE_SECTION_PAGE_SIZE}-byte image page`,
        );
      }
      imports.forEach((entry, index) => {
        qwordInto(iat, index * 8, entry.targetAddress);
      });
      process.memory.map(
        'image:.idata',
        `${program.name} / import address table`,
        iatBase,
        iat.length,
        'r',
        iat,
      );
    }

    for (const relocation of program.relocations) {
      if (relocation.encoding === 'iat-relative32') {
        const source = relocation.target;
        if (source.kind !== 'export') {
          throw new Error('IAT relocation target must be a DLL export');
        }
        const slot = importSlots.get(
          importKey(source.dllName, source.functionName),
        );
        if (slot === undefined) {
          throw new Error(
            `Unresolved IAT slot ${source.dllName}!${source.functionName}`,
          );
        }
        relativeDwordInto(linkedCode, relocation.offset, textBase, slot);
        continue;
      }

      if (relocation.target.kind === 'module-globals') {
        throw new Error(
          'EXE programs cannot reference a DLL module globals page',
        );
      }
      const target =
        relocation.target.kind === 'data'
          ? dataBase +
            BigInt(
              this.requireDataSymbol(program, relocation.target.symbol).offset,
            )
          : process.resolveSymbol(
              relocation.target.dllName,
              relocation.target.functionName,
            );
      if (target === undefined) {
        const source = relocation.target;
        throw new Error(
          source.kind === 'export'
            ? `Unresolved import ${source.dllName}!${source.functionName}`
            : 'Unresolved program data relocation',
        );
      }
      qwordInto(linkedCode, relocation.offset, target);
    }

    process.memory.load(textBase, linkedCode);
    process.memory.mapCoW(
      'image:.data',
      `${program.name} / .data`,
      dataBase,
      Math.max(1, program.data.length),
      'rw',
      process.machine.physicalPagePool,
      program.data,
      true, // shared=true: CoW semantics for cross-process .data/.bss sharing
    );
    const mainArguments = this.prepareMainArguments(process);
    process.mainArguments = mainArguments;
    return {
      program,
      entryPoint: textBase + BigInt(program.entryOffset),
      iatBase,
      iatSize: imports.length * 8,
      imports,
      dataBase,
      mainArguments,
    };
  }

  private requireDataSymbol(
    program: Win32CompiledProgram,
    name: string,
  ): Win32ProgramDataSymbol {
    const symbol = program.dataSymbols.find((entry) => entry.name === name);
    if (!symbol) {
      throw new Error(`Unresolved program data symbol: ${name}`);
    }
    return symbol;
  }

  private prepareMainArguments(process: Win64Process): Win32MainArguments {
    const allocateString = (value: string, label: string) => {
      const bytes = new TextEncoder().encode(`${value}\0`);
      const address = process.allocate(bytes.length, 'rw', 0n, label);
      process.memory.write(address, bytes);
      return address;
    };
    const allocateVector = (
      values: readonly string[],
      stringLabel: string,
      vectorLabel: string,
    ) => {
      const addresses = values.map((value) =>
        allocateString(value, stringLabel),
      );
      const vector = process.allocate(
        (addresses.length + 1) * 8,
        'rw',
        0n,
        vectorLabel,
      );
      addresses.forEach((address, index) => {
        process.memory.writeU64(vector + BigInt(index * 8), address);
      });
      process.memory.writeU64(vector + BigInt(addresses.length * 8), 0n);
      return vector;
    };

    const argv = [process.path, ...process.arguments];
    const environment = process.environment
      .entries()
      .map(([name, value]) => `${name}=${value}`);
    return {
      argc: BigInt(argv.length),
      argv: allocateVector(argv, 'main argv string', 'main argv vector'),
      envp: allocateVector(
        environment,
        'main environment string',
        'main environment vector',
      ),
    };
  }
}
