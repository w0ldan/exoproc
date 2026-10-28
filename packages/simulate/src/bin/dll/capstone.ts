import { CapstoneDll } from 'win32-abi';
// Imported from the side-effect-free `bun-capstone-abi` entry point (not the
// package root, and not `bun-capstone-abi`'s struct layouts): the package
// root pulls in `def/index.js`'s real `load()` call against `capstone.dll`,
// and the struct layouts (`cs_insn`, `cs_detail`) are built with bun-xffi's
// `ffi.struct`, which itself imports real `bun:ffi` (`ptr`) -- neither can
// run under plain Node, which this simulator also has to support. Only the
// pure numeric constants (backed by `bun-xffi/cdefine`, which has zero
// imports) are safe to pull in here.
import {
  cs_arch,
  cs_err,
  x86_op_type,
  x86_reg,
  x86_insn,
} from 'bun-capstone-abi';
import type {
  Win64Machine,
  Win64Process,
} from '../../runtime/win64-machine.js';
import type { DecodedInstruction, X64Operand } from '../../runtime/types.js';
import type { Win32GuestDllSource } from './types.js';

export { CapstoneDll };

export const CapstoneGuestDll = {
  source: CapstoneDll,
} as const satisfies Win32GuestDllSource;

const CS_ARCH_X86 = cs_arch.X86;
const CS_ARCH_ALL = cs_arch.ALL;
const CS_ERR_OK = BigInt(cs_err.OK);
const CS_ERR_ARCH = BigInt(cs_err.ARCH);
const CS_ERR_HANDLE = BigInt(cs_err.HANDLE);

/**
 * `cs_reg_name(id)`/`cs_insn_name(id)` just lowercase the enum key real
 * Capstone was generated from (`x86_reg.RAX` -> `'rax'`,
 * `x86_insn.MOV` -> `'mov'`, ...) -- `bun-capstone-abi`'s `x86_reg`/
 * `x86_insn` are `cdefines()` objects whose keys already match those names
 * exactly, so this reverses them into id -> name lookup tables covering the
 * *entire* real enum, not just the instructions this simulator's decoder
 * currently emits.
 */
function buildReverseNameTable(group: object): ReadonlyMap<number, string> {
  const table = new Map<number, string>();
  for (const [key, value] of Object.entries(group)) {
    if (key.startsWith('_') || key === 'combine') continue;
    if (typeof value !== 'number' && typeof value !== 'bigint') continue;
    const id = Number(value);
    if (!table.has(id)) table.set(id, key.toLowerCase());
  }
  return table;
}

const X86_REG_NAMES = buildReverseNameTable(x86_reg);
const X86_INSN_NAMES = buildReverseNameTable(x86_insn);

// cs_insn/cs_detail/cs_x86/cs_x86_op layouts (Windows Capstone 4.0.2),
// computed by running packages/capstone/src/struct/index.ts's ffi.struct()
// definitions through bun-xffi's struct compiler under Bun+Wine (see git
// history for the throwaway script) -- can't be sourced from there directly
// at runtime (see the `bun-capstone-abi` import comment above), so these
// offsets/sizes are kept in sync with that file by hand.
const CS_INSN_ID_OFFSET = 0;
const CS_INSN_ADDRESS_OFFSET = 8;
const CS_INSN_SIZE_OFFSET = 16;
const CS_INSN_BYTES_OFFSET = 18;
const CS_INSN_MNEMONIC_OFFSET = 34;
const CS_INSN_MNEMONIC_CAPACITY = 32;
const CS_INSN_OP_STR_OFFSET = 66;
const CS_INSN_OP_STR_CAPACITY = 160;
const CS_INSN_DETAIL_OFFSET = 232;
const CS_INSN_SIZE = 240;

// cs_detail
const CS_DETAIL_REGS_READ_OFFSET = 0;
const CS_DETAIL_REGS_READ_CAPACITY = 12;
const CS_DETAIL_REGS_READ_COUNT_OFFSET = 24;
const CS_DETAIL_REGS_WRITE_OFFSET = 26;
const CS_DETAIL_REGS_WRITE_CAPACITY = 20;
const CS_DETAIL_REGS_WRITE_COUNT_OFFSET = 66;
const CS_DETAIL_GROUPS_COUNT_OFFSET = 75;
const CS_DETAIL_X86_OFFSET = 80;
const CS_DETAIL_SIZE = 544;

// cs_x86, relative to CS_DETAIL_X86_OFFSET
const CS_X86_OP_COUNT_OFFSET = 64;
const CS_X86_OPERANDS_OFFSET = 72;
const CS_X86_OPERANDS_CAPACITY = 8;

// cs_x86_op, relative to each operand's own base offset. The union's `reg`
// member aliases its first 4 bytes directly, but its `mem` member is a
// nested `x86_op_mem { segment: u32@0, base: u32@4, index: u32@8,
// scale: i32@12, disp: i64@16 }` struct -- `mem.base` is NOT at the union's
// own offset 0 (that's `segment`), it's one field in.
const CS_X86_OP_TYPE_OFFSET = 0;
const CS_X86_OP_UNION_OFFSET = 8;
const CS_X86_OP_REG_OFFSET = CS_X86_OP_UNION_OFFSET + 0;
const CS_X86_OP_MEM_SEGMENT_OFFSET = CS_X86_OP_UNION_OFFSET + 0;
const CS_X86_OP_MEM_BASE_OFFSET = CS_X86_OP_UNION_OFFSET + 4;
const CS_X86_OP_MEM_INDEX_OFFSET = CS_X86_OP_UNION_OFFSET + 8;
const CS_X86_OP_MEM_SCALE_OFFSET = CS_X86_OP_UNION_OFFSET + 12;
const CS_X86_OP_MEM_DISP_OFFSET = CS_X86_OP_UNION_OFFSET + 16;
const CS_X86_OP_SIZE = 48;

// Not a capstone protocol constant -- purely a simulator-side safety cap on
// how many instructions a single cs_disasm() call will decode.
const MAX_DISASSEMBLY_INSTRUCTIONS = 4096;

interface CapstoneHandleState {
  detail: boolean;
}

const handlesByProcess = new WeakMap<
  Win64Process,
  Map<bigint, CapstoneHandleState>
>();
const nextHandleByProcess = new WeakMap<Win64Process, bigint>();
const stringsByProcess = new WeakMap<Win64Process, Map<string, bigint>>();

function handlesFor(process: Win64Process): Map<bigint, CapstoneHandleState> {
  let handles = handlesByProcess.get(process);
  if (!handles) {
    handles = new Map();
    handlesByProcess.set(process, handles);
  }
  return handles;
}

function guestCString(process: Win64Process, value: string): bigint {
  let strings = stringsByProcess.get(process);
  if (!strings) {
    strings = new Map();
    stringsByProcess.set(process, strings);
  }
  const existing = strings.get(value);
  if (existing !== undefined) return existing;
  const bytes = new TextEncoder().encode(`${value}\0`);
  const address = process.allocate(
    bytes.byteLength,
    'rw',
    0n,
    'capstone string',
  );
  process.memory.write(address, bytes);
  strings.set(value, address);
  return address;
}

function writeCString(
  target: Uint8Array,
  offset: number,
  capacity: number,
  value: string,
): void {
  const encoded = new TextEncoder().encode(value);
  target.set(encoded.subarray(0, Math.max(0, capacity - 1)), offset);
}

function writeRegList(
  view: DataView,
  offset: number,
  capacity: number,
  regs: number[] | undefined,
): number {
  const count = Math.min(regs?.length ?? 0, capacity);
  for (let i = 0; i < count; i++)
    view.setUint16(offset + i * 2, regs![i]!, true);
  return count;
}

function writeX86Operand(
  view: DataView,
  base: number,
  operand: X64Operand,
): void {
  if (operand.kind === 'reg') {
    view.setInt32(base + CS_X86_OP_TYPE_OFFSET, x86_op_type.REG, true);
    view.setUint32(base + CS_X86_OP_REG_OFFSET, operand.reg ?? 0, true);
    return;
  }
  if (operand.kind === 'imm') {
    view.setInt32(base + CS_X86_OP_TYPE_OFFSET, x86_op_type.IMM, true);
    view.setBigInt64(base + CS_X86_OP_UNION_OFFSET, operand.imm ?? 0n, true);
    return;
  }
  view.setInt32(base + CS_X86_OP_TYPE_OFFSET, x86_op_type.MEM, true);
  view.setUint32(base + CS_X86_OP_MEM_SEGMENT_OFFSET, 0, true);
  view.setUint32(
    base + CS_X86_OP_MEM_BASE_OFFSET,
    operand.mem?.base ?? 0,
    true,
  );
  view.setUint32(
    base + CS_X86_OP_MEM_INDEX_OFFSET,
    operand.mem?.index ?? 0,
    true,
  );
  view.setInt32(
    base + CS_X86_OP_MEM_SCALE_OFFSET,
    operand.mem?.scale ?? 1,
    true,
  );
  view.setBigInt64(
    base + CS_X86_OP_MEM_DISP_OFFSET,
    operand.mem?.disp ?? 0n,
    true,
  );
}

/**
 * Fills in a `cs_detail` block (previously zero-initialized by
 * `process.allocate`) from the simulator's own structured decode info.
 * `groups`/`groups_count` are left empty: real Capstone's `cs_group_type`
 * ids (CS_GRP_JUMP, CS_GRP_CALL, ...) aren't exposed anywhere in
 * `bun-capstone`'s types, and `Instruction.isCall`/`isJump`/`isRet` (the
 * only consumers of groups in this codebase) are computed from the mnemonic
 * string instead, not from `cs_detail.groups`.
 */
function writeDetail(
  target: Uint8Array,
  view: DataView,
  instruction: DecodedInstruction,
): void {
  const readCount = writeRegList(
    view,
    CS_DETAIL_REGS_READ_OFFSET,
    CS_DETAIL_REGS_READ_CAPACITY,
    instruction.implicitRegsRead,
  );
  target[CS_DETAIL_REGS_READ_COUNT_OFFSET] = readCount;
  const writeCount = writeRegList(
    view,
    CS_DETAIL_REGS_WRITE_OFFSET,
    CS_DETAIL_REGS_WRITE_CAPACITY,
    instruction.implicitRegsWrite,
  );
  target[CS_DETAIL_REGS_WRITE_COUNT_OFFSET] = writeCount;
  target[CS_DETAIL_GROUPS_COUNT_OFFSET] = 0;

  const operands = instruction.structuredOperands ?? [];
  const opCount = Math.min(operands.length, CS_X86_OPERANDS_CAPACITY);
  target[CS_DETAIL_X86_OFFSET + CS_X86_OP_COUNT_OFFSET] = opCount;
  for (let i = 0; i < opCount; i++) {
    writeX86Operand(
      view,
      CS_DETAIL_X86_OFFSET + CS_X86_OPERANDS_OFFSET + i * CS_X86_OP_SIZE,
      operands[i]!,
    );
  }
}

function logicalOperands(
  instruction: DecodedInstruction,
  decodedAt: bigint,
  logicalAddress: bigint,
): string {
  if (instruction.branchTarget === undefined) return instruction.operands;
  const logicalTarget = logicalAddress + (instruction.branchTarget - decodedAt);
  return `0x${logicalTarget.toString(16)}`;
}

/**
 * Installs the host side of capstone.dll's syscall exports. The guest DLL
 * itself is generated by the same Win32 catalog/compiler path as system DLLs.
 */
export function registerCapstoneHandlers(machine: Win64Machine): void {
  machine.registerHandler(
    'capstone.dll',
    'cs_version',
    (process, _thread, registers) => {
      if (registers.RCX !== 0n) process.memory.writeU32(registers.RCX, 4);
      if (registers.RDX !== 0n) process.memory.writeU32(registers.RDX, 0);
      return 0x400n;
    },
  );
  machine.registerHandler(
    'capstone.dll',
    'cs_support',
    (_process, _thread, registers) =>
      registers.RCX === BigInt(CS_ARCH_X86) ||
      registers.RCX === BigInt(CS_ARCH_ALL)
        ? 1n
        : 0n,
  );
  machine.registerHandler(
    'capstone.dll',
    'cs_open',
    (process, _thread, registers) => {
      if (registers.RCX !== BigInt(CS_ARCH_X86)) return CS_ERR_ARCH;
      if (registers.R8 === 0n) return CS_ERR_HANDLE;
      const handle = nextHandleByProcess.get(process) ?? 1n;
      nextHandleByProcess.set(process, handle + 1n);
      handlesFor(process).set(handle, { detail: false });
      process.memory.writeU64(registers.R8, handle);
      return CS_ERR_OK;
    },
  );
  machine.registerHandler(
    'capstone.dll',
    'cs_close',
    (process, _thread, registers) => {
      if (registers.RCX === 0n) return CS_ERR_HANDLE;
      const handle = process.memory.readU64(registers.RCX);
      if (!handlesFor(process).delete(handle)) return CS_ERR_HANDLE;
      process.memory.writeU64(registers.RCX, 0n);
      return CS_ERR_OK;
    },
  );
  machine.registerHandler(
    'capstone.dll',
    'cs_option',
    (process, _thread, registers) => {
      const state = handlesFor(process).get(registers.RCX);
      if (!state) return CS_ERR_HANDLE;
      // CS_OPT_DETAIL = 2, CS_OPT_ON = 3. Other options are accepted because
      // the simulator currently emits Intel syntax only.
      if (registers.RDX === 2n) state.detail = registers.R8 === 3n;
      return CS_ERR_OK;
    },
  );
  machine.registerHandler(
    'capstone.dll',
    'cs_errno',
    (process, _thread, registers) =>
      handlesFor(process).has(registers.RCX) ? CS_ERR_OK : CS_ERR_HANDLE,
  );
  machine.registerHandler(
    'capstone.dll',
    'cs_strerror',
    (process, _thread, registers) => {
      const messages = new Map<bigint, string>([
        [CS_ERR_OK, 'OK (CS_ERR_OK)'],
        [CS_ERR_ARCH, 'Invalid/unsupported architecture (CS_ERR_ARCH)'],
        [CS_ERR_HANDLE, 'Invalid handle (CS_ERR_HANDLE)'],
      ]);
      return guestCString(
        process,
        messages.get(registers.RCX) ?? 'Capstone error',
      );
    },
  );
  machine.registerHandler(
    'capstone.dll',
    'cs_disasm',
    (process, thread, registers) => {
      const state = handlesFor(process).get(registers.RCX);
      const codePointer = registers.RDX;
      const codeSize = Number(registers.R8);
      const logicalBase = registers.R9;
      const requestedCount = Number(
        process.memory.readU64(registers.RSP + 0x28n),
      );
      const resultPointer = process.memory.readU64(registers.RSP + 0x30n);
      if (
        !state ||
        codePointer === 0n ||
        codeSize <= 0 ||
        resultPointer === 0n
      ) {
        return 0n;
      }

      const limit = Math.min(
        requestedCount > 0 ? requestedCount : MAX_DISASSEMBLY_INSTRUCTIONS,
        MAX_DISASSEMBLY_INSTRUCTIONS,
      );
      const decodeBase = process.allocate(
        codeSize + 15,
        'rwx',
        0n,
        'capstone decode buffer',
      );
      process.memory.write(
        decodeBase,
        process.memory.read(codePointer, codeSize),
      );
      const decoded: Array<{
        instruction: DecodedInstruction;
        decodedAt: bigint;
        logicalAddress: bigint;
      }> = [];
      let offset = 0;
      while (offset < codeSize && decoded.length < limit) {
        const decodedAt = decodeBase + BigInt(offset);
        let instruction: DecodedInstruction;
        try {
          instruction = thread.cpu.decode(decodedAt);
        } catch {
          break;
        }
        if (instruction.size <= 0 || offset + instruction.size > codeSize)
          break;
        decoded.push({
          instruction,
          decodedAt,
          logicalAddress: logicalBase + BigInt(offset),
        });
        offset += instruction.size;
      }
      if (decoded.length === 0) {
        process.free(decodeBase);
        process.memory.writeU64(resultPointer, 0n);
        return 0n;
      }

      const detailBytes = state.detail ? decoded.length * CS_DETAIL_SIZE : 0;
      const allocationSize = decoded.length * CS_INSN_SIZE + detailBytes;
      const allocation = process.allocate(
        allocationSize,
        'rw',
        0n,
        'capstone disassembly results',
      );
      const detailsBase = allocation + BigInt(decoded.length * CS_INSN_SIZE);

      decoded.forEach(({ instruction, decodedAt, logicalAddress }, index) => {
        const record = new Uint8Array(CS_INSN_SIZE);
        const view = new DataView(record.buffer);
        view.setUint32(CS_INSN_ID_OFFSET, 0, true);
        view.setBigUint64(CS_INSN_ADDRESS_OFFSET, logicalAddress, true);
        view.setUint16(CS_INSN_SIZE_OFFSET, instruction.size, true);
        record.set(instruction.bytes.subarray(0, 16), CS_INSN_BYTES_OFFSET);
        writeCString(
          record,
          CS_INSN_MNEMONIC_OFFSET,
          CS_INSN_MNEMONIC_CAPACITY,
          instruction.mnemonic,
        );
        writeCString(
          record,
          CS_INSN_OP_STR_OFFSET,
          CS_INSN_OP_STR_CAPACITY,
          logicalOperands(instruction, decodedAt, logicalAddress),
        );
        if (state.detail) {
          const detailAddress = detailsBase + BigInt(index * CS_DETAIL_SIZE);
          view.setBigUint64(CS_INSN_DETAIL_OFFSET, detailAddress, true);
          const detailRecord = new Uint8Array(CS_DETAIL_SIZE);
          writeDetail(
            detailRecord,
            new DataView(detailRecord.buffer),
            instruction,
          );
          process.memory.write(detailAddress, detailRecord);
        }
        process.memory.write(allocation + BigInt(index * CS_INSN_SIZE), record);
      });
      process.free(decodeBase);
      process.memory.writeU64(resultPointer, allocation);
      return BigInt(decoded.length);
    },
  );
  machine.registerHandler(
    'capstone.dll',
    'cs_free',
    (process, _thread, registers) => {
      if (registers.RCX !== 0n) process.free(registers.RCX);
      return 0n;
    },
  );
  machine.registerHandler(
    'capstone.dll',
    'cs_reg_name',
    (process, _thread, registers) => {
      const name = X86_REG_NAMES.get(Number(registers.RDX));
      return name ? guestCString(process, name) : 0n;
    },
  );
  machine.registerHandler(
    'capstone.dll',
    'cs_insn_name',
    (process, _thread, registers) => {
      const name = X86_INSN_NAMES.get(Number(registers.RDX));
      return name ? guestCString(process, name) : 0n;
    },
  );
  // cs_group_name stays a stub -- see writeDetail()'s comment: this
  // simulator never populates cs_group_type ids (groups/groups_count),
  // so there's nothing meaningful to look a name up for yet.
  machine.registerHandler('capstone.dll', 'cs_group_name', () => 0n);
}
