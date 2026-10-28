import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultWin32ExportCatalog } from '../src/bin/dll/index.js';
import type {
  Win32CompiledProgram,
  Win32ProgramDataSection,
  Win32ProgramDataSymbol,
  Win32ProgramRelocation,
  Win32ProgramRelocationTarget,
} from '../src/runtime/programs.js';
import {
  Win64Machine,
  type Win64Process,
  type Win64Thread,
} from '../src/runtime/win64-machine.js';
import type {
  DecodedInstruction,
  Win64Import,
  Win64Module,
} from '../src/runtime/types.js';
import {
  WIN32_DLL_GLOBALS_PAGE_SIZE,
  WIN32_EXPORT_SLOT_SIZE,
  type GeneratedWin32Dll,
  type GeneratedWin32Export,
  type Win32RelocatableExportThunk,
} from '../src/runtime/win32-dlls.js';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ARTIFACT_ROOT = join(PACKAGE_ROOT, 'artifacts');
const EXECUTABLE_ROOT = join(ARTIFACT_ROOT, 'executables');
const DLL_ROOT = join(ARTIFACT_ROOT, 'dlls');

interface DisassemblyLine {
  readonly offset: number;
  readonly instruction?: DecodedInstruction;
  readonly error?: string;
}

const PROGRAM_DATA_SECTIONS: readonly Win32ProgramDataSection[] = [
  '.rdata',
  '.data',
  '.bss',
];

function hex(value: number | bigint, width = 0): string {
  return value.toString(16).padStart(width, '0');
}

function byteString(bytes: Uint8Array): string {
  return [...bytes].map((byte) => hex(byte, 2)).join(' ');
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function disassemble(
  process: Win64Process,
  base: bigint,
  length: number,
  decoderThread?: Win64Thread,
): DisassemblyLine[] {
  const thread =
    decoderThread ??
    process.createThread('artifact disassembler', base, 0n, true);
  const lines: DisassemblyLine[] = [];
  let offset = 0;
  while (offset < length) {
    try {
      const instruction = thread.cpu.decode(base + BigInt(offset));
      if (instruction.size <= 0 || instruction.size > length - offset) {
        lines.push({
          offset,
          error: 'instruction crosses the end of the emitted code range',
        });
        break;
      }
      lines.push({ offset, instruction });
      offset += instruction.size;
    } catch (error) {
      lines.push({
        offset,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }
  return lines;
}

function formatDetailedDisassembly(
  lines: readonly DisassemblyLine[],
  annotate?: (line: DisassemblyLine) => string | undefined,
): string {
  return `${lines
    .map((line) => {
      if (!line.instruction) {
        return `${' '.repeat(18)} +${hex(line.offset, 4)}  ${
          line.error ?? 'decode failed'
        }`;
      }
      const bytes = byteString(line.instruction.bytes).padEnd(31);
      const notes: string[] = [];
      if (line.instruction.branchTarget !== undefined) {
        notes.push(`-> 0x${hex(line.instruction.branchTarget)}`);
      }
      const annotation = annotate?.(line);
      if (annotation) notes.push(annotation);
      const suffix = notes.length > 0 ? ` ; ${notes.join(' ; ')}` : '';
      return `0x${hex(line.instruction.address, 16)} +${hex(
        line.offset,
        4,
      )}  ${bytes} ${line.instruction.mnemonic.padEnd(8)} ${
        line.instruction.operands
      }${suffix}`.trimEnd();
    })
    .join('\n')}\n`;
}

function requireImport(
  imports: readonly Win64Import[],
  dllName: string,
  functionName: string,
): Win64Import {
  const imported = imports.find(
    (entry) =>
      entry.dllName.toLowerCase() === dllName.toLowerCase() &&
      entry.functionName === functionName,
  );
  if (!imported) {
    throw new Error(`Missing IAT entry for ${dllName}!${functionName}`);
  }
  return imported;
}

function formatIatDisassembly(
  iatBase: bigint,
  imports: readonly Win64Import[],
  process: Win64Process,
): string {
  const lines = [
    'section .idata',
    `; address=0x${hex(iatBase)} size=${imports.length * 8} protection=r`,
  ];
  if (imports.length === 0) {
    lines.push('; empty');
  }
  for (const imported of imports) {
    lines.push(
      `0x${hex(imported.slotAddress, 16)} +${hex(
        imported.slotAddress - iatBase,
        4,
      )}  ${byteString(process.memory.read(imported.slotAddress, 8)).padEnd(
        23,
      )} ${imported.symbol.padEnd(28)} -> ${imported.dllName}!${
        imported.functionName
      } (0x${hex(imported.targetAddress)}) state=resolved`,
    );
  }
  return lines.join('\n');
}

interface ProgramSectionLayout {
  readonly name: Win32ProgramDataSection;
  readonly offset: number;
  readonly bytes: number;
  readonly symbols: readonly Win32ProgramDataSymbol[];
}

function programSectionLayouts(
  program: Win32CompiledProgram,
): readonly ProgramSectionLayout[] {
  let offset = 0;
  return PROGRAM_DATA_SECTIONS.map((name) => {
    const symbols = program.dataSymbols.filter(
      (symbol) => symbol.section === name,
    );
    const bytes = symbols.reduce((total, symbol) => total + symbol.length, 0);
    const layout = { name, offset, bytes, symbols };
    let expectedSymbolOffset = offset;
    for (const symbol of symbols) {
      if (symbol.offset !== expectedSymbolOffset) {
        throw new Error(
          `${program.name} ${name} symbol ${symbol.name} is not contiguous`,
        );
      }
      expectedSymbolOffset += symbol.length;
    }
    offset += bytes;
    return layout;
  });
}

function requireDataSymbol(
  program: Win32CompiledProgram,
  name: string,
): Win32ProgramDataSymbol {
  const symbol = program.dataSymbols.find((entry) => entry.name === name);
  if (!symbol) {
    throw new Error(`${program.name} data symbol is missing: ${name}`);
  }
  return symbol;
}

/**
 * EXE programs can only reference `'export'`/`'data'` relocation targets --
 * `'module-globals'` is DLL-only (see programs.ts's `load()`) -- so narrow it
 * away here for the inspector's own relocation summaries.
 */
function requireExportTarget(
  target: Win32ProgramRelocationTarget,
): Extract<Win32ProgramRelocationTarget, { kind: 'export' }> {
  if (target.kind !== 'export') {
    throw new Error(`Unsupported relocation target kind: ${target.kind}`);
  }
  return target;
}

function symbolBytes(
  program: Win32CompiledProgram,
  symbol: Win32ProgramDataSymbol,
): Uint8Array {
  return program.data.slice(symbol.offset, symbol.offset + symbol.length);
}

function formatDataBytes(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.slice(offset, offset + 16);
    lines.push(
      `  db ${[...chunk].map((value) => `0x${hex(value, 2)}`).join(', ')}`,
    );
  }
  return lines;
}

function printableText(bytes: Uint8Array): string | undefined {
  if (
    ![...bytes].every(
      (value) =>
        value === 0 ||
        value === 9 ||
        value === 10 ||
        value === 13 ||
        (value >= 0x20 && value <= 0x7e),
    )
  ) {
    return undefined;
  }
  return new TextDecoder().decode(bytes);
}

function formatDetailedProgramDataSection(
  program: Win32CompiledProgram,
  layout: ProgramSectionLayout,
  dataBase: bigint,
): string {
  const lines = [
    `section ${layout.name}`,
    `; address=0x${hex(dataBase + BigInt(layout.offset))} size=${layout.bytes}`,
    '; EXOPROC64 container içinde ortak data mapping alanında tutulur.',
  ];
  if (layout.symbols.length === 0) {
    lines.push('; empty');
  }
  for (const symbol of layout.symbols) {
    const address = dataBase + BigInt(symbol.offset);
    lines.push(
      '',
      `${symbol.name}: ; address=0x${hex(address)} size=${symbol.length}`,
    );
    if (layout.name === '.bss') {
      lines.push(`  resb ${symbol.length}`);
      continue;
    }
    const bytes = symbolBytes(program, symbol);
    const text = layout.name === '.rdata' ? printableText(bytes) : undefined;
    if (text !== undefined) {
      lines.push(`  ; utf8=${JSON.stringify(text)}`);
    }
    lines.push(...formatDataBytes(bytes));
  }
  return lines.join('\n');
}

function formatExecutableDisassembly(
  program: Win32CompiledProgram,
  textBase: bigint,
  iatBase: bigint,
  imports: readonly Win64Import[],
  dataBase: bigint,
  lines: readonly DisassemblyLine[],
  process: Win64Process,
): string {
  const relocations = program.relocations.map((relocation) => {
    const target = relocation.target;
    if (target.kind === 'data') {
      const symbol = requireDataSymbol(program, target.symbol);
      return `; +${hex(
        relocation.offset,
        4,
      )} absolute64 -> ${target.symbol} (0x${hex(
        dataBase + BigInt(symbol.offset),
      )})`;
    }
    const exportTarget = requireExportTarget(target);
    const address = process.resolveSymbol(
      exportTarget.dllName,
      exportTarget.functionName,
    );
    if (relocation.encoding === 'iat-relative32') {
      const imported = requireImport(
        imports,
        exportTarget.dllName,
        exportTarget.functionName,
      );
      return `; +${hex(relocation.offset, 4)} iat-relative32 -> IAT+${hex(
        imported.slotAddress - iatBase,
        4,
      )} (0x${hex(imported.slotAddress)}) -> ${exportTarget.dllName}!${
        exportTarget.functionName
      } (0x${hex(imported.targetAddress)})`;
    }
    return `; +${hex(relocation.offset, 4)} absolute64 -> ${
      exportTarget.dllName
    }!${exportTarget.functionName}${
      address === undefined ? '' : ` (0x${hex(address)})`
    }`;
  });
  const sections = [
    `${program.name} / linked EXOPROC64 image`,
    `text-base=0x${hex(textBase)} iat-base=0x${hex(
      iatBase,
    )} data-base=0x${hex(dataBase)}`,
    `entry=0x${hex(textBase + BigInt(program.entryOffset))}`,
    `text-bytes=${program.code.length} data-bytes=${program.data.length}`,
    '',
    'relocations:',
    ...(relocations.length === 0 ? ['; none'] : relocations),
    '',
    'section .text',
    `; address=0x${hex(textBase)} size=${program.code.length} protection=rx`,
    formatDetailedDisassembly(lines, (line) => {
      const relocation = relocationForLine(program.relocations, line);
      if (
        relocation?.encoding !== 'iat-relative32' ||
        relocation.target.kind !== 'export'
      ) {
        return undefined;
      }
      const imported = requireImport(
        imports,
        relocation.target.dllName,
        relocation.target.functionName,
      );
      return `IAT[0x${hex(imported.slotAddress)}] -> ${
        imported.dllName
      }!${imported.functionName} (0x${hex(imported.targetAddress)})`;
    }).trimEnd(),
    '',
    formatIatDisassembly(iatBase, imports, process),
    ...programSectionLayouts(program).flatMap((layout) => [
      '',
      formatDetailedProgramDataSection(program, layout, dataBase),
    ]),
  ];
  return `${sections.join('\n')}\n`;
}

function nasmIdentifier(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_.$#@~?]/g, '_');
  return /^[A-Za-z_.$#@~?]/.test(normalized) ? normalized : `_${normalized}`;
}

function importIdentifier(functionName: string): string {
  return nasmIdentifier(functionName);
}

/** NASM extern identifier for a DLL's private "globals" page (see win32-dlls.ts). */
function moduleGlobalsIdentifier(dllName: string): string {
  return nasmIdentifier(`${dllName.replace(/\./g, '_')}_globals`);
}

function addNasmImport(
  imports: Map<string, string>,
  dllName: string,
  functionName: string,
): void {
  const identifier = importIdentifier(functionName);
  const target = `${dllName}!${functionName}`;
  const existing = imports.get(identifier);
  if (existing !== undefined && existing !== target) {
    throw new Error(
      `NASM import symbol collision: ${identifier} maps to both ${existing} and ${target}`,
    );
  }
  imports.set(identifier, target);
}

function normalizeNasmOperands(operands: string): string {
  return operands.replace(/0x-([0-9a-f]+)/gi, '-0x$1');
}

function branchSize(
  instruction: DecodedInstruction,
): 'short' | 'near' | undefined {
  if (!['jmp', 'je', 'jne'].includes(instruction.mnemonic)) {
    return undefined;
  }
  const opcode = instruction.bytes[0];
  return opcode === 0xeb || opcode === 0x74 || opcode === 0x75
    ? 'short'
    : 'near';
}

function relocationForLine(
  relocations: readonly Win32ProgramRelocation[],
  line: DisassemblyLine,
) {
  const instruction = line.instruction;
  if (!instruction) return undefined;
  const instructionEnd = line.offset + instruction.size;
  return relocations.find(
    (relocation) =>
      relocation.offset >= line.offset && relocation.offset < instructionEnd,
  );
}

/**
 * Annotates a DLL disassembly line's relocation, if any: resolved IAT slot
 * for `iat-relative32` exports, or the target DLL's private globals page
 * address for `module-globals` (see win32-dlls.ts).
 */
function annotateDllRelocation(
  relocation: Win32ProgramRelocation | undefined,
  module: Win64Module,
): string | undefined {
  if (!relocation) return undefined;
  const target = relocation.target;
  if (relocation.encoding === 'iat-relative32' && target.kind === 'export') {
    const imported = requireImport(
      module.imports,
      target.dllName,
      target.functionName,
    );
    return `IAT[0x${hex(imported.slotAddress)}] -> ${imported.dllName}!${
      imported.functionName
    } (0x${hex(imported.targetAddress)})`;
  }
  if (target.kind === 'module-globals') {
    return `-> ${target.dllName} globals page (0x${hex(
      DefaultWin32ExportCatalog.getModuleGlobalsAddress(target.dllName),
    )})`;
  }
  return undefined;
}

function formatNasmInstructions(
  lines: readonly DisassemblyLine[],
  rangeBase: bigint,
  rangeLength: number,
  entryAddress: bigint,
  entryLabel: string,
  relocations: readonly Win32ProgramRelocation[] = [],
): string[] {
  const rangeEnd = rangeBase + BigInt(rangeLength);
  const labels = new Map<bigint, string>([[entryAddress, entryLabel]]);
  for (const line of lines) {
    const target = line.instruction?.branchTarget;
    if (
      target !== undefined &&
      target >= rangeBase &&
      target < rangeEnd &&
      !labels.has(target)
    ) {
      labels.set(target, `.loc_${hex(target - rangeBase, 4)}`);
    }
  }

  const output: string[] = [];
  for (const line of lines) {
    const instruction = line.instruction;
    if (!instruction) {
      throw new Error(
        `Cannot produce NASM at +0x${hex(line.offset)}: ${
          line.error ?? 'decode failed'
        }`,
      );
    }
    const label = labels.get(instruction.address);
    if (label) output.push(`${label}:`);

    let operands = normalizeNasmOperands(instruction.operands);
    const branchLabel =
      instruction.branchTarget === undefined
        ? undefined
        : labels.get(instruction.branchTarget);
    if (branchLabel) {
      const size = branchSize(instruction);
      operands = `${size ? `${size} ` : ''}${branchLabel}`;
    } else {
      const relocation = relocationForLine(relocations, line);
      if (relocation) {
        const relocationTarget = relocation.target;
        const target =
          relocationTarget.kind === 'data'
            ? nasmIdentifier(relocationTarget.symbol)
            : relocationTarget.kind === 'module-globals'
              ? moduleGlobalsIdentifier(relocationTarget.dllName)
              : importIdentifier(relocationTarget.functionName);
        if (relocation.encoding === 'iat-relative32') {
          operands = target;
        } else {
          const comma = operands.indexOf(',');
          if (comma < 0) {
            throw new Error(
              `Cannot apply relocation at +0x${hex(
                relocation.offset,
              )} to ${instruction.mnemonic} ${operands}`,
            );
          }
          operands = `${operands.slice(0, comma + 1)} ${target}`;
        }
      }
    }
    const source = `${instruction.mnemonic}${operands ? ` ${operands}` : ''}`;
    output.push(
      `  ${source.padEnd(42)} ; linked-va=0x${hex(
        instruction.address,
      )} linked-bytes=${byteString(instruction.bytes)}`,
    );
  }
  return output;
}

function formatNasmDataSection(
  program: Win32CompiledProgram,
  layout: ProgramSectionLayout,
): string {
  const lines = [
    `section ${layout.name}`,
    `; bytes=${layout.bytes}; linker chooses the section RVA`,
  ];
  if (layout.symbols.length === 0) lines.push('; empty');
  for (const symbol of layout.symbols) {
    lines.push('', `${nasmIdentifier(symbol.name)}:`);
    if (layout.name === '.bss') {
      if (symbol.length > 0) lines.push(`  resb ${symbol.length}`);
      else lines.push('  ; zero-length symbol');
      continue;
    }
    const bytes = symbolBytes(program, symbol);
    const text = layout.name === '.rdata' ? printableText(bytes) : undefined;
    if (text !== undefined) {
      lines.push(`  ; utf8=${JSON.stringify(text)}`);
    }
    if (bytes.length > 0) lines.push(...formatDataBytes(bytes));
    else lines.push('  ; zero-length symbol');
  }
  return lines.join('\n');
}

function formatExecutableNasm(
  program: Win32CompiledProgram,
  textBase: bigint,
  lines: readonly DisassemblyLine[],
): string {
  const imports = new Map<string, string>();
  for (const relocation of program.relocations) {
    const target = relocation.target;
    if (target.kind !== 'export') continue;
    addNasmImport(imports, target.dllName, target.functionName);
  }
  const importLines = [...imports.keys()].map((name) => `extern ${name}`);
  const entryAddress = textBase + BigInt(program.entryOffset);
  return `${[
    `; ${program.name} / relocatable NASM source`,
    '; Assemble to a Win64 COFF object: nasm -f win64 <file>.asm',
    '; COFF relocations mirror EXOPROC export/data relocation targets.',
    'BITS 64',
    'DEFAULT REL',
    '',
    ...importLines,
    ...(importLines.length > 0 ? [''] : []),
    'global entry',
    '',
    'section .text',
    `; bytes=${program.code.length}; loader chooses the image base and RVA`,
    ...formatNasmInstructions(
      lines,
      textBase,
      program.code.length,
      entryAddress,
      'entry',
      program.relocations,
    ),
    ...programSectionLayouts(program).flatMap((layout) => [
      '',
      formatNasmDataSection(program, layout),
    ]),
  ].join('\n')}\n`;
}

function executableSectionSummary(
  program: Win32CompiledProgram,
  textBase: bigint,
  iatBase: bigint,
  imports: readonly Win64Import[],
  dataBase: bigint,
) {
  const dataSections = Object.fromEntries(
    programSectionLayouts(program).map((layout) => {
      const symbols = layout.symbols.map((symbol) => ({
        name: symbol.name,
        address: `0x${hex(dataBase + BigInt(symbol.offset))}`,
        offset: symbol.offset,
        bytes: symbol.length,
      }));
      return [
        layout.name,
        {
          address: `0x${hex(dataBase + BigInt(layout.offset))}`,
          bytes: layout.bytes,
          zeroFill: layout.name === '.bss',
          symbols,
        },
      ];
    }),
  );
  return {
    '.text': {
      address: `0x${hex(textBase)}`,
      bytes: program.code.length,
      protection: 'rx',
    },
    '.idata': {
      address: `0x${hex(iatBase)}`,
      bytes: imports.length * 8,
      protection: 'r',
      symbols: imports.map((entry) => ({
        name: entry.symbol,
        address: `0x${hex(entry.slotAddress)}`,
        target: `${entry.dllName}!${entry.functionName}`,
        targetAddress: `0x${hex(entry.targetAddress)}`,
        state: 'resolved',
      })),
    },
    ...dataSections,
  };
}

function relocationSummary(
  program: Win32CompiledProgram,
  process: Win64Process,
  iatBase: bigint,
  imports: readonly Win64Import[],
  dataBase: bigint,
) {
  return program.relocations.map((relocation) => {
    const target = relocation.target;
    if (target.kind === 'data') {
      return {
        offset: relocation.offset,
        encoding: relocation.encoding,
        target: {
          kind: 'data',
          symbol: target.symbol,
          address: `0x${hex(
            dataBase + BigInt(requireDataSymbol(program, target.symbol).offset),
          )}`,
        },
      };
    }
    const exportTarget = requireExportTarget(target);
    const imported =
      relocation.encoding === 'iat-relative32'
        ? requireImport(
            imports,
            exportTarget.dllName,
            exportTarget.functionName,
          )
        : undefined;
    return {
      offset: relocation.offset,
      encoding: relocation.encoding,
      target: {
        kind: 'export',
        dll: exportTarget.dllName,
        function: exportTarget.functionName,
        address: `0x${hex(
          process.resolveSymbol(
            exportTarget.dllName,
            exportTarget.functionName,
          ) ?? 0n,
        )}`,
        ...(imported
          ? {
              iatOffset: Number(imported.slotAddress - iatBase),
              iatSlotAddress: `0x${hex(imported.slotAddress)}`,
            }
          : {}),
      },
    };
  });
}

async function inspectExecutable(
  machine: Win64Machine,
  path: string,
  program: Win32CompiledProgram,
) {
  const process = machine.createProcess({
    image: program.name,
    path,
  });
  const loaded = machine.programs.load(process, program);
  const image = machine.fileSystem.readFile(path);
  const textBase = loaded.entryPoint - BigInt(program.entryOffset);
  const linkedText = process.memory.read(textBase, program.code.length);
  const iat = new Uint8Array(loaded.iatSize);
  if (loaded.iatSize > 0) {
    iat.set(process.memory.read(loaded.iatBase, loaded.iatSize));
  }
  const lines = disassemble(process, textBase, program.code.length);
  const fileName = win32.basename(path);
  const imports = program.relocations.flatMap((relocation) => {
    const target = relocation.target;
    return target.kind === 'export'
      ? [`${target.dllName}!${target.functionName}`]
      : [];
  });
  const metadata = {
    format: 'EXOPROC64',
    windowsPe: false,
    path,
    name: program.name,
    imageBytes: image.length,
    headerBytes: 64,
    textBytes: program.code.length,
    iatBytes: loaded.iatSize,
    importCount: loaded.imports.length,
    dataBytes: program.data.length,
    entryOffset: program.entryOffset,
    relocationCount: program.relocations.length,
    imports: [...new Set(imports)].sort(),
    hashes: {
      imageSha256: sha256(image),
      compilerTextSha256: sha256(program.code),
      linkedTextSha256: sha256(linkedText),
      iatSha256: sha256(iat),
      dataSha256: sha256(program.data),
    },
    sections: executableSectionSummary(
      program,
      textBase,
      loaded.iatBase,
      loaded.imports,
      loaded.dataBase,
    ),
    relocations: relocationSummary(
      program,
      process,
      loaded.iatBase,
      loaded.imports,
      loaded.dataBase,
    ),
  };

  await Promise.all([
    writeFile(join(EXECUTABLE_ROOT, fileName), image),
    writeFile(join(EXECUTABLE_ROOT, `${fileName}.text.bin`), program.code),
    writeFile(join(EXECUTABLE_ROOT, `${fileName}.linked.text.bin`), linkedText),
    writeFile(join(EXECUTABLE_ROOT, `${fileName}.iat.bin`), iat),
    writeFile(join(EXECUTABLE_ROOT, `${fileName}.data.bin`), program.data),
    writeFile(
      join(EXECUTABLE_ROOT, `${fileName}.dis`),
      formatExecutableDisassembly(
        program,
        textBase,
        loaded.iatBase,
        loaded.imports,
        loaded.dataBase,
        lines,
        process,
      ),
    ),
    writeFile(
      join(EXECUTABLE_ROOT, `${fileName}.asm`),
      formatExecutableNasm(program, textBase, lines),
    ),
    writeFile(join(EXECUTABLE_ROOT, `${fileName}.json`), json(metadata)),
  ]);
  return metadata;
}

function bindingSummary(entry: GeneratedWin32Export) {
  const binding = entry.binding;
  if (binding.kind === 'forwarder') {
    return `${binding.kind}:${binding.dllName}!${binding.functionName}`;
  }
  return binding.kind;
}

interface InspectedDllCode {
  readonly entry: GeneratedWin32Export;
  readonly address: bigint;
  readonly relocatable: Win32RelocatableExportThunk;
  readonly thunk: Uint8Array;
  readonly lines: readonly DisassemblyLine[];
}

function formatDllDisassembly(
  dll: GeneratedWin32Dll,
  module: Win64Module,
  codeEntries: readonly InspectedDllCode[],
  process: Win64Process,
  dllMainCode?: InspectedDllCode,
  globals?: { readonly address: bigint; readonly bytes: Uint8Array },
): string {
  const output = [
    `${dll.name} / generated DLL memory image`,
    `image-base=0x${hex(module.base)} image-bytes=${module.size}`,
    `export-slot-bytes=${WIN32_EXPORT_SLOT_SIZE}`,
    '',
    'section .text',
    `; address=0x${hex(module.base)} size=${module.size} protection=rx`,
    '',
  ];
  for (const code of codeEntries) {
    output.push(
      `${dll.name}!${code.entry.name}`,
      `address=0x${hex(code.address)} offset=0x${hex(
        code.entry.functionOrdinal * WIN32_EXPORT_SLOT_SIZE,
      )} thunk-bytes=${code.thunk.length} binding=${bindingSummary(
        code.entry,
      )}`,
      formatDetailedDisassembly(code.lines, (line) =>
        annotateDllRelocation(
          relocationForLine(code.relocatable.relocations, line),
          module,
        ),
      ).trimEnd(),
      '',
    );
  }
  output.push(formatIatDisassembly(module.iatBase, module.imports, process));
  if (dllMainCode) {
    output.push(
      '',
      'section .dllmain',
      `; address=0x${hex(dllMainCode.address)} size=${
        dllMainCode.thunk.length
      } protection=rx -- invoked once per process, right after this module is mapped`,
      '',
      `${dll.name}!DllMain`,
      formatDetailedDisassembly(dllMainCode.lines, (line) =>
        annotateDllRelocation(
          relocationForLine(dllMainCode.relocatable.relocations, line),
          module,
        ),
      ).trimEnd(),
    );
  }
  output.push('', 'section .rdata', '; empty', '', 'section .data');
  if (globals) {
    const heapHandle = new DataView(
      globals.bytes.buffer,
      globals.bytes.byteOffset,
      globals.bytes.byteLength,
    ).getBigUint64(0, true);
    output.push(
      `; address=0x${hex(globals.address)} size=${
        globals.bytes.length
      } protection=rw -- ${dll.name}'s private "globals" page, CoW-backed like`,
      "; an EXE's own .data: zero-initialized/shared until DllMain writes it.",
      `crt_heap_handle: dq 0x${hex(heapHandle, 16)} ; +0x0000 (set by DllMain via HeapCreate)`,
      `; remaining ${globals.bytes.length - 8} bytes are zero`,
    );
  } else {
    output.push('; empty');
  }
  output.push('', 'section .bss', '; empty');
  return `${output.join('\n')}\n`;
}

function formatDllNasm(
  dll: GeneratedWin32Dll,
  module: Win64Module,
  codeEntries: readonly InspectedDllCode[],
  dllMainCode?: InspectedDllCode,
): string {
  const imports = new Map<string, string>();
  // A DLL's own globals page is defined right in this file's `.data` section
  // (like an EXE's own .data symbol), so it's a `global` label, not `extern`
  // -- only a *different* DLL's globals page would need an extern.
  const ownGlobals = new Set<string>();
  const relocatables = dllMainCode
    ? [...codeEntries, dllMainCode].map(({ relocatable }) => relocatable)
    : codeEntries.map(({ relocatable }) => relocatable);
  for (const relocatable of relocatables) {
    for (const relocation of relocatable.relocations) {
      const target = relocation.target;
      if (target.kind === 'export') {
        addNasmImport(imports, target.dllName, target.functionName);
      } else if (target.kind === 'module-globals') {
        const identifier = moduleGlobalsIdentifier(target.dllName);
        if (target.dllName === dll.name) {
          ownGlobals.add(identifier);
        } else {
          imports.set(identifier, `${target.dllName}!__module_globals`);
        }
      }
    }
  }
  const labels = codeEntries.map(({ entry }) => nasmIdentifier(entry.name));
  const dllMainLabel = dllMainCode ? nasmIdentifier('DllMain') : undefined;
  const output = [
    `; ${dll.name} / relocatable NASM source`,
    '; Assemble to a Win64 COFF object: nasm -f win64 <file>.asm',
    '; COFF relocations mirror EXOPROC export relocation targets.',
    'BITS 64',
    'DEFAULT REL',
    '',
    ...[...imports.keys()].map((name) => `extern ${name}`),
    ...(imports.size > 0 ? [''] : []),
    ...labels.map((label) => `global ${label}`),
    ...(dllMainLabel ? [`global ${dllMainLabel}`] : []),
    ...[...ownGlobals].map((label) => `global ${label}`),
    '',
    'section .text',
    `; bytes=${module.size}; loader chooses the image base and RVA`,
  ];
  for (const code of codeEntries) {
    const label = nasmIdentifier(code.entry.name);
    output.push(
      '',
      `; export=${code.entry.name} ordinal=${
        code.entry.functionOrdinal
      } binding=${code.entry.binding.kind}`,
      ...formatNasmInstructions(
        code.lines,
        code.address,
        code.thunk.length,
        code.address,
        label,
        code.relocatable.relocations,
      ),
      `  times ${WIN32_EXPORT_SLOT_SIZE} - ($ - ${label}) db 0xcc`,
    );
  }
  output.push(`  times ${module.size} - ($ - $$) db 0xcc`);
  if (dllMainCode && dllMainLabel) {
    output.push(
      '',
      'section .dllmain',
      `; bytes=${dllMainCode.thunk.length}; invoked once per process after this module is mapped`,
      ...formatNasmInstructions(
        dllMainCode.lines,
        dllMainCode.address,
        dllMainCode.thunk.length,
        dllMainCode.address,
        dllMainLabel,
        dllMainCode.relocatable.relocations,
      ),
    );
  }
  output.push('', 'section .rdata', '; empty', '', 'section .data');
  if (ownGlobals.size > 0) {
    for (const label of ownGlobals) {
      output.push(
        `${label}: ; ${dll.name}'s private globals page (CoW, zero at load)`,
        '  dq 0 ; crt heap handle -- written by DllMain via HeapCreate',
        `  resb ${WIN32_DLL_GLOBALS_PAGE_SIZE - 8}`,
      );
    }
  } else {
    output.push('; empty');
  }
  output.push('', 'section .bss', '; empty');
  return `${output.join('\n')}\n`;
}

async function inspectDll(
  process: Win64Process,
  dll: GeneratedWin32Dll,
  decoderThread: Win64Thread,
) {
  const module = process.getModule(dll.name);
  if (!module) throw new Error(`Mapped DLL is missing: ${dll.name}`);
  const image = process.memory.read(module.base, module.size);
  const iat = new Uint8Array(module.iatSize);
  if (module.iatSize > 0) {
    iat.set(process.memory.read(module.iatBase, module.iatSize));
  }
  const codeEntries: InspectedDllCode[] = Object.values(dll.functions).map(
    (entry) => {
      const address =
        dll.imageBase + BigInt(entry.functionOrdinal * WIN32_EXPORT_SLOT_SIZE);
      const relocatable = DefaultWin32ExportCatalog.compileExportThunk(entry);
      const thunk = process.memory.read(address, relocatable.code.length);
      return {
        entry,
        address,
        relocatable,
        thunk,
        lines: disassemble(process, address, thunk.length, decoderThread),
      };
    },
  );
  const exports = codeEntries.map(({ entry, address, relocatable, thunk }) => {
    return {
      name: entry.name,
      ordinal: entry.functionOrdinal,
      address: `0x${hex(address)}`,
      offset: entry.functionOrdinal * WIN32_EXPORT_SLOT_SIZE,
      slotBytes: WIN32_EXPORT_SLOT_SIZE,
      thunkBytes: thunk.length,
      syscallId: entry.syscallId,
      binding: bindingSummary(entry),
      args: entry.args,
      returns: entry.returns,
      compilerBytes: byteString(relocatable.code),
      linkedBytes: byteString(thunk),
      relocations: relocatable.relocations.map((relocation) => ({
        offset: relocation.offset,
        encoding: relocation.encoding,
        target: relocation.target,
        ...(relocation.encoding === 'iat-relative32' &&
        relocation.target.kind === 'export'
          ? {
              iatSlotAddress: `0x${hex(
                requireImport(
                  module.imports,
                  relocation.target.dllName,
                  relocation.target.functionName,
                ).slotAddress,
              )}`,
            }
          : {}),
      })),
    };
  });
  const bindingCounts: Record<string, number> = {};
  for (const entry of exports) {
    const kind = entry.binding.split(':', 1)[0] ?? entry.binding;
    bindingCounts[kind] = (bindingCounts[kind] ?? 0) + 1;
  }

  const dllMainCode: InspectedDllCode | undefined = dll.dllMain
    ? (() => {
        const entry = dll.dllMain as GeneratedWin32Export;
        const address = DefaultWin32ExportCatalog.getDllMainAddress(dll.name);
        const relocatable = DefaultWin32ExportCatalog.compileExportThunk(entry);
        const thunk = process.memory.read(address, relocatable.code.length);
        return {
          entry,
          address,
          relocatable,
          thunk,
          lines: disassemble(process, address, thunk.length, decoderThread),
        };
      })()
    : undefined;
  const globals = dll.dllMain
    ? {
        address: DefaultWin32ExportCatalog.getModuleGlobalsAddress(dll.name),
        bytes: process.memory.read(
          DefaultWin32ExportCatalog.getModuleGlobalsAddress(dll.name),
          WIN32_DLL_GLOBALS_PAGE_SIZE,
        ),
      }
    : undefined;
  const dllMainMetadata = dllMainCode
    ? {
        address: `0x${hex(dllMainCode.address)}`,
        thunkBytes: dllMainCode.thunk.length,
        binding: bindingSummary(dllMainCode.entry),
        compilerBytes: byteString(dllMainCode.relocatable.code),
        linkedBytes: byteString(dllMainCode.thunk),
        relocations: dllMainCode.relocatable.relocations.map((relocation) => ({
          offset: relocation.offset,
          encoding: relocation.encoding,
          target: relocation.target,
          ...(relocation.encoding === 'iat-relative32' &&
          relocation.target.kind === 'export'
            ? {
                iatSlotAddress: `0x${hex(
                  requireImport(
                    module.imports,
                    relocation.target.dllName,
                    relocation.target.functionName,
                  ).slotAddress,
                )}`,
              }
            : {}),
        })),
      }
    : undefined;
  const globalsMetadata = globals
    ? {
        address: `0x${hex(globals.address)}`,
        bytes: globals.bytes.length,
        protection: 'rw',
        crtHeapHandle: `0x${hex(
          new DataView(
            globals.bytes.buffer,
            globals.bytes.byteOffset,
            globals.bytes.byteLength,
          ).getBigUint64(0, true),
          16,
        )}`,
      }
    : undefined;

  const metadata = {
    format: 'EXOPROC DLL memory image',
    windowsPe: false,
    name: dll.name,
    imageBase: `0x${hex(dll.imageBase)}`,
    imageBytes: image.length,
    iatBytes: module.iatSize,
    importCount: module.imports.length,
    exportSlotBytes: WIN32_EXPORT_SLOT_SIZE,
    exportCount: exports.length,
    bindingCounts,
    hashes: {
      memoryImageSha256: sha256(image),
      iatSha256: sha256(iat),
    },
    sections: {
      '.text': {
        address: `0x${hex(module.base)}`,
        bytes: module.size,
        protection: 'rx',
      },
      '.idata': {
        address: `0x${hex(module.iatBase)}`,
        bytes: module.iatSize,
        protection: 'r',
        symbols: module.imports.map((entry) => ({
          name: entry.symbol,
          address: `0x${hex(entry.slotAddress)}`,
          target: `${entry.dllName}!${entry.functionName}`,
          targetAddress: `0x${hex(entry.targetAddress)}`,
          state: 'resolved',
        })),
      },
      '.rdata': { bytes: 0, symbols: [] },
      '.data': globalsMetadata
        ? {
            bytes: globalsMetadata.bytes,
            symbols: [
              {
                name: 'crtHeapHandle',
                address: globalsMetadata.address,
                protection: globalsMetadata.protection,
                value: globalsMetadata.crtHeapHandle,
              },
            ],
          }
        : { bytes: 0, symbols: [] },
      '.bss': { bytes: 0, symbols: [] },
      ...(dllMainMetadata
        ? {
            '.dllmain': {
              address: dllMainMetadata.address,
              bytes: dllMainMetadata.thunkBytes,
              protection: 'rx',
            },
          }
        : {}),
    },
    exports,
    ...(dllMainMetadata ? { dllMain: dllMainMetadata } : {}),
  };

  await Promise.all([
    writeFile(join(DLL_ROOT, `${dll.name}.memory.bin`), image),
    writeFile(join(DLL_ROOT, `${dll.name}.iat.bin`), iat),
    writeFile(
      join(DLL_ROOT, `${dll.name}.dis`),
      formatDllDisassembly(
        dll,
        module,
        codeEntries,
        process,
        dllMainCode,
        globals,
      ),
    ),
    writeFile(
      join(DLL_ROOT, `${dll.name}.asm`),
      formatDllNasm(dll, module, codeEntries, dllMainCode),
    ),
    writeFile(join(DLL_ROOT, `${dll.name}.json`), json(metadata)),
  ]);
  return metadata;
}

async function main(): Promise<void> {
  await rm(ARTIFACT_ROOT, { recursive: true, force: true });
  await Promise.all([
    mkdir(EXECUTABLE_ROOT, { recursive: true }),
    mkdir(DLL_ROOT, { recursive: true }),
  ]);

  const machine = new Win64Machine();
  const executables: Awaited<ReturnType<typeof inspectExecutable>>[] = [];
  for (const installed of machine.programs.entries()) {
    executables.push(
      await inspectExecutable(machine, installed.path, installed.program),
    );
  }

  const dllProcess = machine.createProcess({
    image: 'artifact-inspector.exe',
    path: 'C:\\Users\\Serkan\\Workspace\\artifact-inspector.exe',
  });
  const decoderThread = dllProcess.createThread(
    'artifact disassembler',
    DefaultWin32ExportCatalog.dlls[0]?.imageBase ?? 0n,
    0n,
    true,
  );
  const dlls: Awaited<ReturnType<typeof inspectDll>>[] = [];
  for (const dll of DefaultWin32ExportCatalog.dlls) {
    dlls.push(await inspectDll(dllProcess, dll, decoderThread));
  }

  const totalExports = dlls.reduce((count, dll) => count + dll.exportCount, 0);
  const manifest = {
    generatedAt: new Date().toISOString(),
    warning:
      'Bunlar EXOPROC64 executable image ve simüle DLL bellek image dosyalarıdır; Windows PE32+ değildir.',
    executables,
    dlls,
  };
  const executableRows = executables
    .map(
      (entry) =>
        `| \`${entry.name}\` | ${entry.textBytes} | ${entry.iatBytes} | ${entry.dataBytes} | ${entry.relocationCount} |`,
    )
    .join('\n');
  const dllRows = dlls
    .map(
      (entry) =>
        `| \`${entry.name}\` | ${entry.imageBytes} | ${entry.iatBytes} | ${entry.exportCount} |`,
    )
    .join('\n');
  const report = `# Exoproc tarafından üretilen binary artifact'ları

> Bu dosyalar simülatörün bugün tam olarak ne ürettiğini gösterir. Henüz
> Windows PE32+ executable veya DLL dosyaları değildir.

Bu dizin yalnız geliştirme sırasında \`bun run simulate:inspect\` ile üretilir.
Generator \`packages/simulate/scripts/\` altındadır; runtime build'ine ve
yayınlanan npm paketine dahil edilmez. Sistemde NASM kuruluysa
\`bun run simulate:inspect:nasm\` bütün \`.asm\` dosyalarını relocatable
Win64 COFF object olarak assemble ederek doğrular.

## Executable image'ları

\`.exe\`, sanal dosya sistemine kurulan image'ın birebir kopyasıdır. İlk iki
byte'ı \`MZ\` olsa da PE header ve section table içermez; format
\`EXOPROC64\` adlı özel container'dır. \`.text.bin\` relocation öncesi compiler
byte'larını, \`.linked.text.bin\` loader'ın process memory'sine yazdığı
relocation sonrası byte'ları, \`.iat.bin\` salt-okunur Import Address Table
slotlarını ve \`.data.bin\` ortak data image'ını içerir. \`.dis\`; RIP-relative
\`call [rip+disp32]\` instruction'ını, IAT slot adresini, çözülen DLL exportunu,
virtual address'leri ve opcode byte'larını birlikte gösterir. \`.asm\` ise IAT
uygulama ayrıntısını göstermez; importları \`extern WriteFile\`, çağrıyı
\`call WriteFile\` olarak bırakır ve NASM'in Win64 COFF \`REL32\` relocation
kaydı üretmesini sağlar.
ABI kataloğu export adlarının bütün DLL'ler arasında benzersiz olduğunu
doğrular. \`.json\` section/symbol haritasıyla SHA-256 değerlerini taşır.

| Image | .text byte | IAT byte | .data byte | Relocation |
| --- | ---: | ---: | ---: | ---: |
${executableRows}

## Simüle DLL image'ları

\`.memory.bin\`, her process'e map edilen üretilmiş thunk image'ının birebir
kopyasıdır; \`.iat.bin\` ise DLL guest wrapper ve forwarder import slotlarını
taşır. MZ/PE header veya export directory içermez. \`.dis\` linked IAT
durumunu, \`.asm\` IAT tablosunu göstermeden \`global\` export ve doğrudan
\`extern\` çağrıları, \`.json\` ise binding türünü, otomatik syscall numarasını,
ABI imzasını, IAT relocation'larını ve SHA-256 değerini gösterir.
DLL compiler'ı henüz ayrı data section'ları üretmediği için \`.rdata\`,
\`.data\` ve \`.bss\` başlıkları
mevcut artifact'larda açıkça \`empty\` görünür.

| DLL | Map edilen .text byte | IAT byte | Export |
| --- | ---: | ---: | ---: |
${dllRows}

Toplam ${executables.length} executable image, ${dlls.length} DLL bellek
image'ı ve ${totalExports} üretilmiş export bulunuyor.
`;

  await Promise.all([
    writeFile(join(ARTIFACT_ROOT, 'manifest.json'), json(manifest)),
    writeFile(join(ARTIFACT_ROOT, 'README.md'), report),
  ]);

  process.stdout.write(
    `${executables.length} executable image ve ${dlls.length} DLL bellek image'ı (${totalExports} export) üretildi.\n${ARTIFACT_ROOT}\n`,
  );
}

await main();
