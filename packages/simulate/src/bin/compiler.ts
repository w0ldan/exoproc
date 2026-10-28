import {
  getWin32DllFileName,
  Win32Api,
  type Win32FunctionReference,
} from 'win32-abi';
import {
  X64Assembler as SharedX64Assembler,
  type X64ExternalRelocation,
  type X64Label,
  type X64Register64,
} from 'exoproc-asm';
import type {
  Win32CompiledProgram,
  Win32ProgramCodeExport,
  Win32ProgramDataSection,
  Win32ProgramDataSymbol,
  Win32ProgramRelocation,
  Win32ProgramRelocationTarget,
} from '../runtime/programs.js';

export { byte, dword, qword, word } from 'exoproc-asm';
export type {
  X64ByteMemoryOperand,
  X64ExternalRelocation,
  X64ExternalRelocationEncoding,
  X64Immediate,
  X64Label,
  X64MemoryAddress,
  X64MemoryOperand,
  X64Register,
  X64Register32,
  X64Register64,
  X64Scale,
  X64WordMemoryOperand,
  X64XmmRegister,
} from 'exoproc-asm';

/**
 * Win32-aware compatibility wrapper around the shared x64 assembler.
 *
 * Generic instruction encoding, labels, and fixups live in `exoproc-asm`.
 * This wrapper only translates generic external relocation records into the
 * program format consumed by the simulator runtime.
 */
type Win32ExportRelocationTarget = Extract<
  Win32ProgramRelocationTarget,
  { readonly kind: 'export' }
>;

export class X64Assembler extends SharedX64Assembler<Win32ProgramRelocationTarget> {
  public readonly relocations: Win32ProgramRelocation[] = [];

  public override emitRipRelative32(
    target: Win32ExportRelocationTarget,
  ): number {
    return super.emitRipRelative32(target);
  }

  public override callExternal(target: Win32ExportRelocationTarget): void {
    super.callExternal(target);
  }

  public override call(target: X64Label): void;
  public override call(target: Win32FunctionReference): void;
  public override call(target: X64Label | Win32FunctionReference): void {
    if ('dll' in target) {
      this.callExternal({
        kind: 'export',
        dllName: getWin32DllFileName(target.dll),
        functionName: target.name,
      });
      return;
    }
    super.call(target);
  }

  protected override onExternalRelocation(
    relocation: X64ExternalRelocation<Win32ProgramRelocationTarget>,
  ): void {
    super.onExternalRelocation(relocation);
    this.relocations.push({
      offset: relocation.offset,
      encoding:
        relocation.encoding === 'absolute64' ? 'absolute64' : 'iat-relative32',
      target: relocation.target,
    });
  }
}

export class Win32ProgramBuilder {
  public readonly code = new X64Assembler();
  private readonly dataBytes: number[] = [];
  private readonly offsets = new Map<string, number>();
  private readonly dataSymbols: Win32ProgramDataSymbol[] = [];

  public text(name: string, value: string, nul = true): number {
    return this.appendData(
      name,
      new TextEncoder().encode(nul ? `${value}\0` : value),
      '.rdata',
    );
  }

  public buffer(name: string, size: number): number {
    return this.appendData(name, new Uint8Array(size), '.bss');
  }

  public data(name: string, bytes: Uint8Array): number {
    return this.appendData(name, bytes, '.data');
  }

  private appendData(
    name: string,
    bytes: Uint8Array,
    section: Win32ProgramDataSection,
  ): number {
    if (this.offsets.has(name)) {
      throw new Error(`Duplicate program data symbol: ${name}`);
    }
    const offset = this.dataBytes.length;
    this.offsets.set(name, offset);
    this.dataBytes.push(...bytes);
    this.dataSymbols.push({
      name,
      section,
      offset,
      length: bytes.length,
    });
    return offset;
  }

  public dataAddress(destination: X64Register64, name: string): void {
    this.offset(name);
    this.code.movAddress(destination, {
      kind: 'data',
      symbol: name,
    });
  }

  public invoke(reference: Win32FunctionReference): void {
    this.code.sub('rsp', 0x20);
    this.code.call(reference);
    this.code.add('rsp', 0x20);
  }

  public movR8(value: number): void {
    this.code.mov('r8', value);
  }

  public emitWriteSymbol(name: string): void {
    this.dataAddress('rdx', name);
    this.emitWriteRegisters();
  }

  public emitWriteRegisters(): void {
    const format = '__exoproc_printf_string_format';
    if (!this.offsets.has(format)) {
      this.text(format, '%s');
    }
    this.dataAddress('rcx', format);
    this.invoke(Win32Api.msvcrt.printf);
  }

  public emitPrintfSymbol(name: string): void {
    this.dataAddress('rcx', name);
    this.invoke(Win32Api.msvcrt.printf);
  }

  public finish(
    name: string,
    codeExports?: readonly Win32ProgramCodeExport[],
  ): Win32CompiledProgram {
    const sectionOrder: readonly Win32ProgramDataSection[] = [
      '.rdata',
      '.data',
      '.bss',
    ];
    const dataBytes: number[] = [];
    const dataSymbols: Win32ProgramDataSymbol[] = [];
    for (const section of sectionOrder) {
      for (const symbol of this.dataSymbols) {
        if (symbol.section !== section) continue;
        const offset = dataBytes.length;
        dataBytes.push(
          ...this.dataBytes.slice(symbol.offset, symbol.offset + symbol.length),
        );
        dataSymbols.push({
          ...symbol,
          offset,
        });
      }
    }

    return {
      name,
      code: this.code.finish(),
      data: Uint8Array.from(dataBytes),
      dataSymbols,
      entryOffset: 0,
      relocations: this.code.relocations,
      ...(codeExports ? { codeExports } : {}),
    };
  }

  private offset(name: string): number {
    const value = this.offsets.get(name);
    if (value === undefined) {
      throw new Error(`Missing program data symbol: ${name}`);
    }
    return value;
  }
}

export function createConsoleProgramBuilder(): Win32ProgramBuilder {
  return new Win32ProgramBuilder();
}

/**
 * Compiles a small program which writes a fixed string to its inherited
 * standard output handle and exits.
 */
export function compileConsoleProgram(
  name: string,
  output: string,
  exitCode = 0,
): Win32CompiledProgram {
  const program = new Win32ProgramBuilder();
  const { code } = program;
  program.text('output', output);
  program.emitWriteSymbol('output');
  code.mov('eax', exitCode);
  code.ret();

  return program.finish(name);
}

/** Compatibility surface for callers which previously used the runtime class. */
export class Win32GuestProgramCompiler {
  public static console = compileConsoleProgram;
}
