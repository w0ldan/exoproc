import {
  getWin32DllFileName,
  type Win32Dll,
  type Win32FunctionDefinition,
  type Win32FunctionReference,
} from 'win32-abi';
import type { Win32ProgramRelocation } from './programs.js';

export const WIN32_DLL_IMAGE_BASE = 0x00007fe000000000n;
export const WIN32_DLL_IMAGE_STRIDE = 0x01000000n;
export const WIN32_SYSCALL_BASE = 0x1000;
export const WIN32_SYSCALL_STRIDE = 0x1000;
export const WIN32_SYSCALL_THUNK_SIZE = 16;
export const WIN32_EXPORT_SLOT_SIZE = 1024;
/**
 * Size of a DLL's private "globals" data page and its `DllMain` code page.
 * Both are carved out of the very end of the DLL's image stride so their
 * addresses are stable, fixed constants relative to `imageBase` -- well
 * clear of the export/IAT region, which is always a small fraction of
 * `WIN32_DLL_IMAGE_STRIDE`.
 */
export const WIN32_DLL_GLOBALS_PAGE_SIZE = 0x1000;

export interface Win32GuestWrapperContext {
  readonly entry: GeneratedWin32Export;
}

export interface Win32RelocatableExportThunk {
  readonly code: Uint8Array;
  readonly relocations: readonly Win32ProgramRelocation[];
}

export type Win32GuestWrapperCompiler = (
  context: Win32GuestWrapperContext,
) => Uint8Array | Win32RelocatableExportThunk;

/**
 * Compiles a DLL's `DllMain(HINSTANCE hinstDLL, DWORD fdwReason, LPVOID
 * lpvReserved)` entry point. Unlike an export, `DllMain` isn't reachable
 * through the IAT/syscall surface -- it's invoked once per process, directly
 * by address, right after its module is mapped.
 */
export type Win32DllMainCompiler = () =>
  Uint8Array | Win32RelocatableExportThunk;

export type Win32ExportBinding =
  | { readonly kind: 'syscall' }
  | {
      readonly kind: 'forwarder';
      readonly dllName: `${string}.dll`;
      readonly functionName: string;
    }
  | {
      readonly kind: 'guest-wrapper';
      readonly compile: Win32GuestWrapperCompiler;
    }
  | {
      readonly kind: 'return';
      readonly value: number;
    };

function normalizeDllName(dllName: string): `${string}.dll` {
  const normalized = dllName.toLowerCase();
  return (
    normalized.endsWith('.dll') ? normalized : `${normalized}.dll`
  ) as `${string}.dll`;
}

function exportKey(dllName: string, functionName: string): string {
  return `${normalizeDllName(dllName)}!${functionName}`;
}

/**
 * Overrides selected ABI exports without assigning numeric syscall ids by
 * hand. Exports without an override receive an automatic syscall binding.
 */
export class Win32ExportBindingRegistry {
  private readonly bindings = new Map<string, Win32ExportBinding>();

  public syscall(dllName: string, functionName: string): this {
    return this.bind(dllName, functionName, { kind: 'syscall' });
  }

  public syscallFunction(reference: Win32FunctionReference): this {
    return this.syscall(reference.dll.name, reference.name);
  }

  public forward(
    dllName: string,
    functionName: string,
    targetDllName: string,
    targetFunctionName: string,
  ): this {
    return this.bind(dllName, functionName, {
      kind: 'forwarder',
      dllName: normalizeDllName(targetDllName),
      functionName: targetFunctionName,
    });
  }

  public forwardFunction(
    source: Win32FunctionReference,
    target: Win32FunctionReference,
  ): this {
    return this.forward(
      source.dll.name,
      source.name,
      target.dll.name,
      target.name,
    );
  }

  public guest(
    dllName: string,
    functionName: string,
    compile: Win32GuestWrapperCompiler,
  ): this {
    return this.bind(dllName, functionName, {
      kind: 'guest-wrapper',
      compile,
    });
  }

  public guestFunction(
    reference: Win32FunctionReference,
    compile: Win32GuestWrapperCompiler,
  ): this {
    return this.guest(reference.dll.name, reference.name, compile);
  }

  public constant(dllName: string, functionName: string, value: number): this {
    return this.bind(dllName, functionName, {
      kind: 'return',
      value,
    });
  }

  public constantFunction(
    reference: Win32FunctionReference,
    value: number,
  ): this {
    return this.constant(reference.dll.name, reference.name, value);
  }

  public resolve(dllName: string, functionName: string): Win32ExportBinding {
    return (
      this.bindings.get(exportKey(dllName, functionName)) ?? {
        kind: 'syscall',
      }
    );
  }

  private bind(
    dllName: string,
    functionName: string,
    binding: Win32ExportBinding,
  ): this {
    this.bindings.set(exportKey(dllName, functionName), binding);
    return this;
  }
}

export interface GeneratedWin32Export extends Win32FunctionDefinition {
  readonly name: string;
  readonly dllName: `${string}.dll`;
  readonly dllOrdinal: number;
  readonly functionOrdinal: number;
  readonly syscallId: number;
  readonly binding: Win32ExportBinding;
}

export interface GeneratedWin32Dll {
  readonly source: Win32Dll;
  readonly name: `${string}.dll`;
  readonly ordinal: number;
  readonly imageBase: bigint;
  readonly syscallBase: number;
  readonly functions: Readonly<Record<string, GeneratedWin32Export>>;
  /** Synthetic "export" describing this DLL's `DllMain`, if it has one. */
  readonly dllMain?: GeneratedWin32Export;
}

export interface Win32ExportCatalogOptions {
  readonly imageBase?: bigint;
  readonly imageStride?: bigint;
  readonly syscallBase?: number;
  readonly syscallStride?: number;
  readonly bindings?: Win32ExportBindingRegistry;
  /** `DllMain` compilers keyed by normalized DLL file name (e.g. `msvcrt.dll`). */
  readonly dllMains?: ReadonlyMap<string, Win32DllMainCompiler>;
}

export function createWin32SyscallThunk(syscallId: number): Uint8Array {
  if (!Number.isSafeInteger(syscallId) || syscallId < 0) {
    throw new RangeError(`Invalid syscall id: ${syscallId}`);
  }
  const bytes = new Uint8Array(WIN32_SYSCALL_THUNK_SIZE);
  bytes.fill(0x90);
  bytes[0] = 0xb8; // mov eax, imm32
  new DataView(bytes.buffer).setUint32(1, syscallId, true);
  bytes[5] = 0x0f;
  bytes[6] = 0x05; // syscall
  bytes[7] = 0xc3; // ret
  return bytes;
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
      `RIP-relative DLL relocation is out of range: ${displacement}`,
    );
  }
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setInt32(
    offset,
    Number(displacement),
    true,
  );
}

/**
 * Generates the complete browser-side DLL and syscall surface from the
 * runtime-neutral descriptors in @exoproc/win32-abi.
 */
export class Win32ExportCatalog {
  public readonly dlls: readonly GeneratedWin32Dll[];
  public readonly exports: readonly GeneratedWin32Export[];
  public readonly syscalls: readonly GeneratedWin32Export[];
  public readonly dllByName: ReadonlyMap<string, GeneratedWin32Dll>;
  public readonly exportByName: ReadonlyMap<string, GeneratedWin32Export>;
  public readonly syscallById: ReadonlyMap<number, GeneratedWin32Export>;
  public readonly imageStride: bigint;

  constructor(
    sourceDlls: readonly Win32Dll[],
    options: Win32ExportCatalogOptions = {},
  ) {
    const imageBase = options.imageBase ?? WIN32_DLL_IMAGE_BASE;
    const imageStride = options.imageStride ?? WIN32_DLL_IMAGE_STRIDE;
    const syscallBase = options.syscallBase ?? WIN32_SYSCALL_BASE;
    const syscallStride = options.syscallStride ?? WIN32_SYSCALL_STRIDE;
    const bindings = options.bindings ?? new Win32ExportBindingRegistry();
    const dllMains = options.dllMains;
    this.imageStride = imageStride;

    if (imageStride <= 0n) {
      throw new RangeError('DLL image stride must be positive');
    }
    if (!Number.isSafeInteger(syscallStride) || syscallStride <= 0) {
      throw new RangeError(
        'DLL syscall stride must be a positive safe integer',
      );
    }

    this.dlls = sourceDlls.map((source, dllOrdinal) => {
      const name = getWin32DllFileName(source);
      const entries = Object.entries(source.definitions);
      if (entries.length > syscallStride) {
        throw new Error(
          `${name} has ${entries.length} exports but its generated syscall range only has ${syscallStride} slots`,
        );
      }
      const generatedBase = syscallBase + dllOrdinal * syscallStride;
      const functions = Object.fromEntries(
        entries.map(([functionName, definition], functionOrdinal) => [
          functionName,
          {
            ...definition,
            name: functionName,
            dllName: name,
            dllOrdinal,
            functionOrdinal,
            syscallId: generatedBase + functionOrdinal,
            binding: bindings.resolve(name, functionName),
          },
        ]),
      ) as Record<string, GeneratedWin32Export>;

      const dllMainCompile = dllMains?.get(name);
      const dllMain: GeneratedWin32Export | undefined = dllMainCompile
        ? {
            name: 'DllMain',
            dllName: name,
            dllOrdinal,
            functionOrdinal: -1,
            syscallId: -1,
            args: [],
            returns: 'void',
            binding: { kind: 'guest-wrapper', compile: dllMainCompile },
          }
        : undefined;

      return {
        source,
        name,
        ordinal: dllOrdinal,
        imageBase: imageBase + BigInt(dllOrdinal) * imageStride,
        syscallBase: generatedBase,
        functions,
        dllMain,
      };
    });

    this.exports = this.dlls.flatMap((dll) => Object.values(dll.functions));
    this.syscalls = this.exports.filter(
      (entry) => entry.binding.kind === 'syscall',
    );
    this.dllByName = new Map(this.dlls.map((dll) => [dll.name, dll]));
    this.exportByName = new Map(
      this.exports.map((entry) => [entry.name, entry]),
    );
    this.syscallById = new Map(
      this.syscalls.map((syscall) => [syscall.syscallId, syscall]),
    );

    if (this.dllByName.size !== this.dlls.length) {
      throw new Error('Generated Win32 DLL names are not unique');
    }
    if (this.exportByName.size !== this.exports.length) {
      const owners = new Map<string, string[]>();
      for (const entry of this.exports) {
        const dlls = owners.get(entry.name) ?? [];
        dlls.push(entry.dllName);
        owners.set(entry.name, dlls);
      }
      const duplicates = [...owners]
        .filter(([, dlls]) => dlls.length > 1)
        .map(([name, dlls]) => `${name} (${dlls.join(', ')})`)
        .join('; ');
      throw new Error(
        `Generated Win32 export names must be globally unique: ${duplicates}`,
      );
    }
    if (this.syscallById.size !== this.syscalls.length) {
      throw new Error('Generated Win32 syscall ids are not unique');
    }
  }

  public resolve(
    dllName: string,
    functionName: string,
  ): GeneratedWin32Export | undefined {
    return this.dllByName.get(dllName.toLowerCase())?.functions[functionName];
  }

  public getExportAddress(entry: GeneratedWin32Export): bigint {
    const dll = this.dllByName.get(entry.dllName);
    if (!dll) {
      throw new Error(`Generated DLL is missing: ${entry.dllName}`);
    }
    return (
      dll.imageBase + BigInt(entry.functionOrdinal * WIN32_EXPORT_SLOT_SIZE)
    );
  }

  /**
   * Absolute address of a DLL's private "globals" page -- the last page of
   * its image stride. Mapped CoW (see win64-machine.ts's `mapKernelGateway`)
   * so it starts out shared/zeroed across every process and privatizes only
   * once a `DllMain` actually writes to it.
   */
  public getModuleGlobalsAddress(dllName: string): bigint {
    return (
      this.requireGeneratedDll(dllName).imageBase +
      this.imageStride -
      BigInt(WIN32_DLL_GLOBALS_PAGE_SIZE)
    );
  }

  /** Absolute address of a DLL's `DllMain` code, the page just before its globals page. */
  public getDllMainAddress(dllName: string): bigint {
    return (
      this.requireGeneratedDll(dllName).imageBase +
      this.imageStride -
      BigInt(2 * WIN32_DLL_GLOBALS_PAGE_SIZE)
    );
  }

  private requireGeneratedDll(dllName: string): GeneratedWin32Dll {
    const dll = this.dllByName.get(normalizeDllName(dllName));
    if (!dll) {
      throw new Error(`Generated DLL is missing: ${dllName}`);
    }
    return dll;
  }

  public compileExportThunk(
    entry: GeneratedWin32Export,
  ): Win32RelocatableExportThunk {
    const binding = entry.binding;
    if (binding.kind === 'syscall') {
      return {
        code: createWin32SyscallThunk(entry.syscallId),
        relocations: [],
      };
    }
    if (binding.kind === 'return') {
      return {
        code: Uint8Array.from([
          0xb8,
          binding.value & 0xff,
          (binding.value >>> 8) & 0xff,
          (binding.value >>> 16) & 0xff,
          (binding.value >>> 24) & 0xff,
          0xc3,
        ]),
        relocations: [],
      };
    }

    if (binding.kind === 'forwarder') {
      return {
        code: Uint8Array.from([
          0xff,
          0x25,
          0,
          0,
          0,
          0, // jmp qword [rip + IAT disp32]
        ]),
        relocations: [
          {
            offset: 2,
            encoding: 'iat-relative32',
            target: {
              kind: 'export',
              dllName: binding.dllName,
              functionName: binding.functionName,
            },
          },
        ],
      };
    }
    const compiled = binding.compile({ entry });
    return compiled instanceof Uint8Array
      ? { code: compiled, relocations: [] }
      : compiled;
  }

  public linkExportThunk(
    entry: GeneratedWin32Export,
    thunk: Win32RelocatableExportThunk,
    codeAddress: bigint,
    resolveImportSlot: (dllName: string, functionName: string) => bigint,
  ): Uint8Array {
    const linked = thunk.code.slice();
    for (const relocation of thunk.relocations) {
      const relocationBytes = relocation.encoding === 'absolute64' ? 8 : 4;
      if (
        relocation.offset < 0 ||
        relocation.offset + relocationBytes > linked.length
      ) {
        throw new RangeError(
          `Invalid relocation offset ${relocation.offset} for ${entry.dllName}!${entry.name}`,
        );
      }
      const target = relocation.target;
      if (relocation.encoding === 'iat-relative32') {
        if (target.kind !== 'export') {
          throw new Error(
            `${entry.dllName}!${entry.name} has a non-export IAT target`,
          );
        }
        relativeDwordInto(
          linked,
          relocation.offset,
          codeAddress,
          resolveImportSlot(target.dllName, target.functionName),
        );
        continue;
      }
      if (target.kind === 'module-globals') {
        qwordInto(
          linked,
          relocation.offset,
          this.getModuleGlobalsAddress(target.dllName),
        );
        continue;
      }
      if (target.kind === 'export') {
        qwordInto(
          linked,
          relocation.offset,
          this.getExportAddress(
            this.requireExport(target.dllName, target.functionName, entry),
          ),
        );
        continue;
      }
      throw new Error(
        `DLL export thunk cannot resolve data symbol ${target.symbol}`,
      );
    }
    return linked;
  }

  private requireExport(
    dllName: string,
    functionName: string,
    source: GeneratedWin32Export,
  ): GeneratedWin32Export {
    const target = this.resolve(normalizeDllName(dllName), functionName);
    if (!target) {
      throw new Error(
        `Cannot resolve ${dllName}!${functionName} for ${source.dllName}!${source.name}`,
      );
    }
    return target;
  }
}

/** @deprecated Use Win32ExportCatalog. */
export const Win32SyscallCatalog = Win32ExportCatalog;
/** @deprecated Use Win32ExportCatalog. */
export type Win32SyscallCatalog = Win32ExportCatalog;
/** @deprecated Use Win32ExportCatalogOptions. */
export type Win32SyscallCatalogOptions = Win32ExportCatalogOptions;
