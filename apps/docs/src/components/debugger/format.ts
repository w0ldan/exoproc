import type {
  InstructionDto,
  ProcessSnapshotDto,
  RegisterName,
} from '../../shell/common/channels';

/** Safety cap for Continue / Step Out / Run-to-cursor -- not a UX limit, just a runaway guard. */
export const MAX_CONTINUE_STEPS = 50_000;
/** How many already-executed instructions stay visible above the live edge. */
export const HISTORY_WINDOW = 8;
/** How many not-yet-executed instructions are disassembled ahead of the anchor. */
export const FORWARD_WINDOW = 24;
/** How many executed instructions the trace panel keeps. */
export const TRACE_LIMIT = 512;
/** Monaco line height; the byte viewer mirrors it to stay scroll-synced. */
export const LINE_HEIGHT = 18;

export const REGISTER_ORDER: readonly RegisterName[] = [
  'RIP',
  'RSP',
  'RBP',
  'RAX',
  'RBX',
  'RCX',
  'RDX',
  'R8',
  'R9',
  'R10',
  'R11',
  'R12',
  'R13',
  'R14',
  'R15',
  'RSI',
  'RDI',
  'RFLAGS',
];

export const hex = (value: bigint, width = 16) =>
  `0x${value.toString(16).toUpperCase().padStart(width, '0')}`;

export const byteHex = (value: number) =>
  value.toString(16).toUpperCase().padStart(2, '0');

export const operationOf = (instruction: InstructionDto) =>
  [instruction.mnemonic, instruction.operands].filter(Boolean).join(' ');

/**
 * Parses a user-typed 64-bit integer. Accepts `0x1F4`, `1F4h`, `500` and a
 * leading `-`. Returns `undefined` for anything else -- callers must surface an
 * error instead of falling back to a value the user never typed.
 */
export function parseIntegerInput(raw: string): bigint | undefined {
  const text = raw.trim().replace(/[_\s]/g, '');
  if (!text) return undefined;
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  let value: bigint;
  if (/^0[xX][0-9a-fA-F]+$/.test(body)) {
    value = BigInt(body);
  } else if (/^[0-9a-fA-F]+[hH]$/.test(body)) {
    value = BigInt(`0x${body.slice(0, -1)}`);
  } else if (/^[0-9]+$/.test(body)) {
    value = BigInt(body);
  } else {
    return undefined;
  }
  return negative ? -value : value;
}

/** Parses a single hex byte cell (`0`-`FF`). */
export function parseByteInput(raw: string): number | undefined {
  const text = raw.trim();
  if (!/^[0-9a-fA-F]{1,2}$/.test(text)) return undefined;
  return Number.parseInt(text, 16);
}

/** Little-endian encoding for a typed memory write of `width` bytes. */
export function encodeLittleEndian(value: bigint, width: number): Uint8Array {
  const bytes = new Uint8Array(width);
  let remaining = BigInt.asUintN(width * 8, value);
  for (let index = 0; index < width; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

/**
 * Resolves an address to a `module!export` / `module+offset` label. The main
 * image is not in `process.modules`, so addresses inside its own mapped
 * sections are labelled from `process.image` + `process.imageBase`.
 */
export function resolveSymbol(
  process: ProcessSnapshotDto,
  address: bigint,
): string {
  for (const mod of process.modules) {
    if (address >= mod.base && address < mod.base + BigInt(mod.size)) {
      for (const [name, exportAddress] of mod.exports) {
        if (exportAddress === address) return `${mod.name}!${name}`;
      }
      return `${mod.name}+${hex(address - mod.base, 4)}`;
    }
  }
  const mapping = process.mappings.find(
    (m) => address >= m.base && address < m.base + BigInt(m.size),
  );
  if (mapping?.id.startsWith('image:') && address >= process.imageBase) {
    return `${process.image}+${hex(address - process.imageBase, 4)}`;
  }
  return hex(address);
}

/** Never swallow a fault: keep the runtime's own name + message. */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name && error.name !== 'Error'
      ? `${error.name}: ${error.message}`
      : error.message;
  }
  return String(error);
}
