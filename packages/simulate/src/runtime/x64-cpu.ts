import { MemoryAccessFault, Win64AddressSpace } from './address-space.js';
import { x86_reg } from 'bun-capstone-abi';
import type {
  CpuStepResult,
  DecodedInstruction,
  X64GeneralRegister,
  X64Operand,
  X64RegisterName,
  X64Registers,
  X64Watchpoint,
  X64WatchpointAccess,
  X64WatchpointHit,
} from './types.js';

/** `x86_reg` id for each `X64GeneralRegister`, by operand width in bits. */
const CAPSTONE_REG_BY_WIDTH: Record<
  X64GeneralRegister,
  Record<8 | 16 | 32 | 64, number>
> = {
  RAX: { 8: x86_reg.AL, 16: x86_reg.AX, 32: x86_reg.EAX, 64: x86_reg.RAX },
  RBX: { 8: x86_reg.BL, 16: x86_reg.BX, 32: x86_reg.EBX, 64: x86_reg.RBX },
  RCX: { 8: x86_reg.CL, 16: x86_reg.CX, 32: x86_reg.ECX, 64: x86_reg.RCX },
  RDX: { 8: x86_reg.DL, 16: x86_reg.DX, 32: x86_reg.EDX, 64: x86_reg.RDX },
  RSI: { 8: x86_reg.SIL, 16: x86_reg.SI, 32: x86_reg.ESI, 64: x86_reg.RSI },
  RDI: { 8: x86_reg.DIL, 16: x86_reg.DI, 32: x86_reg.EDI, 64: x86_reg.RDI },
  RSP: { 8: x86_reg.SPL, 16: x86_reg.SP, 32: x86_reg.ESP, 64: x86_reg.RSP },
  RBP: { 8: x86_reg.BPL, 16: x86_reg.BP, 32: x86_reg.EBP, 64: x86_reg.RBP },
  R8: { 8: x86_reg.R8B, 16: x86_reg.R8W, 32: x86_reg.R8D, 64: x86_reg.R8 },
  R9: { 8: x86_reg.R9B, 16: x86_reg.R9W, 32: x86_reg.R9D, 64: x86_reg.R9 },
  R10: { 8: x86_reg.R10B, 16: x86_reg.R10W, 32: x86_reg.R10D, 64: x86_reg.R10 },
  R11: { 8: x86_reg.R11B, 16: x86_reg.R11W, 32: x86_reg.R11D, 64: x86_reg.R11 },
  R12: { 8: x86_reg.R12B, 16: x86_reg.R12W, 32: x86_reg.R12D, 64: x86_reg.R12 },
  R13: { 8: x86_reg.R13B, 16: x86_reg.R13W, 32: x86_reg.R13D, 64: x86_reg.R13 },
  R14: { 8: x86_reg.R14B, 16: x86_reg.R14W, 32: x86_reg.R14D, 64: x86_reg.R14 },
  R15: { 8: x86_reg.R15B, 16: x86_reg.R15W, 32: x86_reg.R15D, 64: x86_reg.R15 },
};

function capstoneReg(
  register: X64GeneralRegister,
  width: 8 | 16 | 32 | 64,
): number {
  return CAPSTONE_REG_BY_WIDTH[register][width];
}

const REGISTER_BY_CODE: readonly X64GeneralRegister[] = [
  'RAX',
  'RCX',
  'RDX',
  'RBX',
  'RSP',
  'RBP',
  'RSI',
  'RDI',
  'R8',
  'R9',
  'R10',
  'R11',
  'R12',
  'R13',
  'R14',
  'R15',
];

const CARRY_FLAG = 1n << 0n;
const ZERO_FLAG = 1n << 6n;
const SIGN_FLAG = 1n << 7n;
const OVERFLOW_FLAG = 1n << 11n;
const UINT64_MASK = (1n << 64n) - 1n;

type SyscallHandler = (syscallId: number, registers: X64Registers) => bigint;

interface RegisterOperand {
  kind: 'register';
  register: X64GeneralRegister;
}

interface MemoryOperand {
  kind: 'memory';
  base?: X64GeneralRegister;
  index?: X64GeneralRegister;
  scale: 1 | 2 | 4 | 8;
  displacement: number;
  ripRelative: boolean;
}

type RMOperand = RegisterOperand | MemoryOperand;

interface InternalInstruction extends DecodedInstruction {
  execute: (cpu: X64Cpu) => void;
}

export class UnsupportedInstructionFault extends Error {
  constructor(
    public readonly address: bigint,
    public readonly opcode: number,
  ) {
    super(
      `Unsupported x64 opcode 0x${opcode
        .toString(16)
        .padStart(2, '0')} at 0x${address.toString(16)}`,
    );
    this.name = 'UnsupportedInstructionFault';
  }
}

export function createInitialRegisters(
  instructionPointer: bigint,
  stackPointer: bigint,
): X64Registers {
  return {
    RAX: 0n,
    RBX: 0n,
    RCX: 0n,
    RDX: 0n,
    RSI: 0n,
    RDI: 0n,
    RSP: stackPointer,
    RBP: stackPointer,
    RIP: instructionPointer,
    R8: 0n,
    R9: 0n,
    R10: 0n,
    R11: 0n,
    R12: 0n,
    R13: 0n,
    R14: 0n,
    R15: 0n,
    RFLAGS: 0x202n,
  };
}

/**
 * Small, deterministic x86-64 interpreter for the instruction subset emitted
 * by Exoproc's examples. It is deliberately an interpreter, not a scripted
 * debugger timeline: every step fetches bytes from RIP, decodes them and
 * mutates the supplied address space and register file.
 */
export class X64Cpu {
  public readonly registers: X64Registers;
  private lastMemoryWrite?: { address: bigint; size: number };
  private lastMemoryRead?: { address: bigint; size: number };
  public readonly breakpoints = new Set<bigint>();
  /**
   * Data watchpoints keyed by their start address.
   *
   * Like `breakpoints`, this is a registry the CPU *reports* against rather
   * than enforces: `step()` returns a `watchpointHit` (and `reason:
   * 'watchpoint'`) whenever the step's real read/write overlapped a watched
   * range, and the driver -- a debugger UI stepping this thread, or a
   * `pumpScheduler(onStep)` trace -- decides whether that means "stop". The
   * scheduler deliberately keeps running, exactly as it already does for
   * `breakpoints`.
   */
  public readonly watchpoints = new Map<bigint, X64Watchpoint>();

  constructor(
    public readonly memory: Win64AddressSpace,
    registers: X64Registers,
    private readonly syscallHandler: SyscallHandler,
  ) {
    this.registers = registers;
  }

  public step(): CpuStepResult {
    const before = { ...this.registers };
    const instruction = this.decodeInternal(this.registers.RIP);
    this.lastMemoryWrite = undefined;
    this.lastMemoryRead = undefined;
    this.registers.RIP = instruction.address + BigInt(instruction.size);

    let reason: CpuStepResult['reason'] = 'step';
    let error: Error | undefined;
    try {
      instruction.execute(this);
      if (instruction.mnemonic === 'int3') reason = 'breakpoint';
      if (instruction.mnemonic === 'ret' && this.registers.RIP === 0n) {
        reason = 'halted';
      }
      if (instruction.mnemonic === 'hlt') reason = 'halted';
    } catch (caught) {
      reason = 'fault';
      error = caught instanceof Error ? caught : new Error(String(caught));
    }

    const changedRegisters = (
      Object.keys(this.registers) as X64RegisterName[]
    ).filter((name) => before[name] !== this.registers[name]);

    // A fault/halt/int3 is the more specific reason for stopping, so a
    // watchpoint only claims `reason` when the step was otherwise ordinary --
    // `watchpointHit` is still reported either way.
    const watchpointHit = this.findWatchpointHit();
    if (watchpointHit && reason === 'step') reason = 'watchpoint';

    return {
      instruction: this.publicInstruction(instruction),
      reason,
      changedRegisters,
      memoryWrite: this.lastMemoryWrite,
      memoryRead: this.lastMemoryRead,
      watchpointHit,
      error,
    };
  }

  public decode(address: bigint): DecodedInstruction {
    return this.publicInstruction(this.decodeInternal(address));
  }

  public disassemble(
    start: bigint,
    maxInstructions = 64,
  ): DecodedInstruction[] {
    const instructions: DecodedInstruction[] = [];
    let address = start;
    for (let index = 0; index < maxInstructions; index += 1) {
      const instruction = this.decode(address);
      instructions.push(instruction);
      address += BigInt(instruction.size);
      if (instruction.mnemonic === 'ret' || instruction.mnemonic === 'hlt') {
        break;
      }
    }
    return instructions;
  }

  public addBreakpoint(address: bigint): void {
    this.breakpoints.add(address);
  }

  public removeBreakpoint(address: bigint): void {
    this.breakpoints.delete(address);
  }

  public hasBreakpoint(address: bigint): boolean {
    return this.breakpoints.has(address);
  }

  public addWatchpoint(
    address: bigint,
    size: number,
    access: X64WatchpointAccess = 'write',
  ): X64Watchpoint {
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new RangeError(`Invalid watchpoint size: ${size}`);
    }
    const watchpoint: X64Watchpoint = { address, size, access };
    this.watchpoints.set(address, watchpoint);
    return watchpoint;
  }

  public removeWatchpoint(address: bigint): boolean {
    return this.watchpoints.delete(address);
  }

  public hasWatchpoint(address: bigint): boolean {
    return this.watchpoints.has(address);
  }

  public push(value: bigint): void {
    this.registers.RSP -= 8n;
    this.memory.writeU64(this.registers.RSP, value);
    this.lastMemoryWrite = {
      address: this.registers.RSP,
      size: 8,
    };
  }

  public pop(): bigint {
    const value = this.memory.readU64(this.registers.RSP);
    this.lastMemoryRead = { address: this.registers.RSP, size: 8 };
    this.registers.RSP += 8n;
    return value;
  }

  /**
   * Matches this step's real data accesses against the watchpoint registry.
   * At most one read and one write happen per step in this instruction subset
   * (the only both-at-once case is a read-modify-write like `add [mem], reg`,
   * where both refer to the same address), so a single hit is enough; the
   * write is reported in preference to the read because it is the access that
   * changed guest state.
   */
  private findWatchpointHit(): X64WatchpointHit | undefined {
    if (this.watchpoints.size === 0) return undefined;
    const accesses = [
      { access: 'write' as const, span: this.lastMemoryWrite },
      { access: 'read' as const, span: this.lastMemoryRead },
    ];
    for (const { access, span } of accesses) {
      if (!span) continue;
      for (const watchpoint of this.watchpoints.values()) {
        if (watchpoint.access !== 'access' && watchpoint.access !== access) {
          continue;
        }
        const overlaps =
          span.address < watchpoint.address + BigInt(watchpoint.size) &&
          watchpoint.address < span.address + BigInt(span.size);
        if (!overlaps) continue;
        return {
          watchpoint,
          access,
          address: span.address,
          size: span.size,
        };
      }
    }
    return undefined;
  }

  private publicInstruction(
    instruction: InternalInstruction,
  ): DecodedInstruction {
    return {
      address: instruction.address,
      size: instruction.size,
      bytes: instruction.bytes,
      mnemonic: instruction.mnemonic,
      operands: instruction.operands,
      branchTarget: instruction.branchTarget,
      structuredOperands: instruction.structuredOperands,
      implicitRegsRead: instruction.implicitRegsRead,
      implicitRegsWrite: instruction.implicitRegsWrite,
    };
  }

  private decodeInternal(address: bigint): InternalInstruction {
    const source = this.memory.read(address, 15, 'execute');
    let cursor = 0;
    let rex = 0;
    if (source[cursor]! >= 0x40 && source[cursor]! <= 0x4f) {
      rex = source[cursor]!;
      cursor += 1;
    }

    const rexW = (rex & 0x08) !== 0;
    const rexR = (rex & 0x04) !== 0 ? 8 : 0;
    const rexX = (rex & 0x02) !== 0 ? 8 : 0;
    const rexB = (rex & 0x01) !== 0 ? 8 : 0;
    const opcode = source[cursor++]!;
    const finish = (
      mnemonic: string,
      operands: string,
      execute: (cpu: X64Cpu) => void,
      branchTarget?: bigint,
      detail?: {
        operands?: X64Operand[];
        implicitRead?: number[];
        implicitWrite?: number[];
      },
    ): InternalInstruction => ({
      address,
      size: cursor,
      bytes: source.slice(0, cursor),
      mnemonic,
      operands,
      execute,
      branchTarget,
      structuredOperands: detail?.operands,
      implicitRegsRead: detail?.implicitRead,
      implicitRegsWrite: detail?.implicitWrite,
    });
    const readI8 = () => {
      const value = source[cursor++]!;
      return value > 0x7f ? value - 0x100 : value;
    };
    const readU32 = () => {
      const value = new DataView(
        source.buffer,
        source.byteOffset + cursor,
        4,
      ).getUint32(0, true);
      cursor += 4;
      return value;
    };
    const readI32 = () => {
      const value = new DataView(
        source.buffer,
        source.byteOffset + cursor,
        4,
      ).getInt32(0, true);
      cursor += 4;
      return value;
    };
    const readU64 = () => {
      const value = new DataView(
        source.buffer,
        source.byteOffset + cursor,
        8,
      ).getBigUint64(0, true);
      cursor += 8;
      return value;
    };
    const regName = (code: number) => {
      const register = REGISTER_BY_CODE[code];
      if (!register) throw new Error(`Invalid register code ${code}`);
      return register;
    };
    const registerText = (register: X64GeneralRegister, width64: boolean) => {
      if (width64) {
        return register.toLowerCase();
      }
      const legacy32: Partial<Record<X64GeneralRegister, string>> = {
        RAX: 'eax',
        RBX: 'ebx',
        RCX: 'ecx',
        RDX: 'edx',
        RSI: 'esi',
        RDI: 'edi',
        RSP: 'esp',
        RBP: 'ebp',
      };
      return legacy32[register] ?? `${register.toLowerCase()}d`;
    };
    const parseModRM = (): {
      reg: X64GeneralRegister;
      rm: RMOperand;
      extension: number;
    } => {
      const modrm = source[cursor++]!;
      const mod = modrm >>> 6;
      const extension = (modrm >>> 3) & 7;
      const reg = regName(extension + rexR);
      const rmLow = modrm & 7;
      const rmCode = rmLow + rexB;
      if (mod === 3) {
        return {
          reg,
          rm: { kind: 'register', register: regName(rmCode) },
          extension,
        };
      }

      let displacement = 0;
      let ripRelative = false;
      let base: X64GeneralRegister | undefined;
      let index: X64GeneralRegister | undefined;
      let scale: MemoryOperand['scale'] = 1;

      if (rmLow === 4) {
        const sib = source[cursor++]!;
        scale = (1 << (sib >>> 6)) as MemoryOperand['scale'];
        const indexLow = (sib >>> 3) & 7;
        const baseLow = sib & 7;
        if (indexLow !== 4 || rexX !== 0) {
          index = regName(indexLow + rexX);
        }
        if (mod === 0 && baseLow === 5) {
          displacement = readI32();
        } else {
          base = regName(baseLow + rexB);
          if (mod === 1) displacement = readI8();
          else if (mod === 2) displacement = readI32();
        }
      } else if (mod === 0 && rmLow === 5) {
        displacement = readI32();
        ripRelative = true;
      } else {
        base = regName(rmCode);
        if (mod === 1) displacement = readI8();
        else if (mod === 2) displacement = readI32();
      }

      return {
        reg,
        rm: {
          kind: 'memory',
          base,
          index,
          scale,
          displacement,
          ripRelative,
        },
        extension,
      };
    };
    const formatRM = (operand: RMOperand, width64 = true) => {
      if (operand.kind === 'register') {
        return registerText(operand.register, width64);
      }
      const base = operand.ripRelative
        ? 'rip'
        : (operand.base?.toLowerCase() ?? '0');
      const index = operand.index
        ? `+${operand.index.toLowerCase()}${
            operand.scale === 1 ? '' : `*${operand.scale}`
          }`
        : '';
      const displacement =
        operand.displacement === 0
          ? ''
          : operand.displacement > 0
            ? `+0x${operand.displacement.toString(16)}`
            : `-0x${Math.abs(operand.displacement).toString(16)}`;
      return `[${base}${index}${displacement}]`;
    };
    const addressOf = (operand: MemoryOperand, nextRip: bigint) =>
      operand.ripRelative
        ? nextRip + BigInt(operand.displacement)
        : (operand.base ? this.registers[operand.base] : 0n) +
          (operand.index
            ? this.registers[operand.index] * BigInt(operand.scale)
            : 0n) +
          BigInt(operand.displacement);
    const regOperand = (
      register: X64GeneralRegister,
      width: 8 | 16 | 32 | 64,
    ): X64Operand => ({ kind: 'reg', reg: capstoneReg(register, width) });
    const immOperand = (value: bigint): X64Operand => ({
      kind: 'imm',
      imm: value,
    });
    const memOperandOf = (operand: MemoryOperand): X64Operand => ({
      kind: 'mem',
      mem: {
        base: operand.ripRelative
          ? x86_reg.RIP
          : operand.base
            ? capstoneReg(operand.base, 64)
            : undefined,
        index: operand.index ? capstoneReg(operand.index, 64) : undefined,
        scale: operand.scale,
        disp: BigInt(operand.displacement),
      },
    });
    const rmOperand = (
      operand: RMOperand,
      width: 8 | 16 | 32 | 64,
    ): X64Operand =>
      operand.kind === 'register'
        ? regOperand(operand.register, width)
        : memOperandOf(operand);
    const readRM = (
      cpu: X64Cpu,
      operand: RMOperand,
      width64: boolean,
      nextRip: bigint,
    ) => {
      if (operand.kind === 'register') {
        const value = cpu.registers[operand.register];
        return width64 ? value : value & 0xffffffffn;
      }
      const target = addressOf(operand, nextRip);
      const value = width64
        ? cpu.memory.readU64(target)
        : BigInt(cpu.memory.readU32(target));
      cpu.lastMemoryRead = { address: target, size: width64 ? 8 : 4 };
      return value;
    };
    const readRM8 = (cpu: X64Cpu, operand: RMOperand, nextRip: bigint) => {
      if (operand.kind === 'register') {
        return cpu.registers[operand.register] & 0xffn;
      }
      const target = addressOf(operand, nextRip);
      const value = BigInt(cpu.memory.read(target, 1)[0] ?? 0);
      cpu.lastMemoryRead = { address: target, size: 1 };
      return value;
    };
    const readRM16 = (cpu: X64Cpu, operand: RMOperand, nextRip: bigint) => {
      if (operand.kind === 'register') {
        return cpu.registers[operand.register] & 0xffffn;
      }
      const target = addressOf(operand, nextRip);
      const bytes = cpu.memory.read(target, 2);
      const value = BigInt((bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8));
      cpu.lastMemoryRead = { address: target, size: 2 };
      return value;
    };
    const writeRM8 = (
      cpu: X64Cpu,
      operand: RMOperand,
      value: bigint,
      nextRip: bigint,
    ) => {
      const normalized = Number(value & 0xffn);
      if (operand.kind === 'register') {
        cpu.registers[operand.register] =
          (cpu.registers[operand.register] & ~0xffn) | BigInt(normalized);
        return;
      }
      const target = addressOf(operand, nextRip);
      cpu.memory.write(target, [normalized]);
      cpu.lastMemoryWrite = { address: target, size: 1 };
    };
    const writeRM = (
      cpu: X64Cpu,
      operand: RMOperand,
      value: bigint,
      width64: boolean,
      nextRip: bigint,
    ) => {
      const normalized = width64 ? value & UINT64_MASK : value & 0xffffffffn;
      if (operand.kind === 'register') {
        cpu.registers[operand.register] = normalized;
        return;
      }
      const target = addressOf(operand, nextRip);
      if (width64) cpu.memory.writeU64(target, normalized);
      else cpu.memory.writeU32(target, Number(normalized));
      cpu.lastMemoryWrite = {
        address: target,
        size: width64 ? 8 : 4,
      };
    };
    const updateArithmeticFlags = (
      cpu: X64Cpu,
      value: bigint,
      width64: boolean,
    ) => {
      const bits = width64 ? 64 : 32;
      const normalized = BigInt.asUintN(bits, value);
      cpu.registers.RFLAGS &= ~(
        CARRY_FLAG |
        ZERO_FLAG |
        SIGN_FLAG |
        OVERFLOW_FLAG
      );
      if (normalized === 0n) cpu.registers.RFLAGS |= ZERO_FLAG;
      if ((normalized & (1n << BigInt(bits - 1))) !== 0n) {
        cpu.registers.RFLAGS |= SIGN_FLAG;
      }
    };
    const updateAddFlags = (
      cpu: X64Cpu,
      left: bigint,
      right: bigint,
      result: bigint,
      width64: boolean,
    ) => {
      const bits = width64 ? 64 : 32;
      const mask = (1n << BigInt(bits)) - 1n;
      const sign = 1n << BigInt(bits - 1);
      const normalizedLeft = left & mask;
      const normalizedRight = right & mask;
      const normalizedResult = result & mask;
      updateArithmeticFlags(cpu, normalizedResult, width64);
      if (normalizedLeft + normalizedRight > mask) {
        cpu.registers.RFLAGS |= CARRY_FLAG;
      }
      if (
        (~(normalizedLeft ^ normalizedRight) &
          (normalizedLeft ^ normalizedResult) &
          sign) !==
        0n
      ) {
        cpu.registers.RFLAGS |= OVERFLOW_FLAG;
      }
    };
    const updateSubFlags = (
      cpu: X64Cpu,
      left: bigint,
      right: bigint,
      result: bigint,
      width64: boolean,
    ) => {
      const bits = width64 ? 64 : 32;
      const mask = (1n << BigInt(bits)) - 1n;
      const sign = 1n << BigInt(bits - 1);
      const normalizedLeft = left & mask;
      const normalizedRight = right & mask;
      const normalizedResult = result & mask;
      updateArithmeticFlags(cpu, normalizedResult, width64);
      if (normalizedLeft < normalizedRight) {
        cpu.registers.RFLAGS |= CARRY_FLAG;
      }
      if (
        ((normalizedLeft ^ normalizedRight) &
          (normalizedLeft ^ normalizedResult) &
          sign) !==
        0n
      ) {
        cpu.registers.RFLAGS |= OVERFLOW_FLAG;
      }
    };

    const width: 32 | 64 = rexW ? 64 : 32;

    if (opcode >= 0x50 && opcode <= 0x57) {
      const register = regName(opcode - 0x50 + rexB);
      return finish(
        'push',
        register.toLowerCase(),
        (cpu) => cpu.push(cpu.registers[register]),
        undefined,
        {
          operands: [regOperand(register, 64)],
          implicitRead: [x86_reg.RSP],
          implicitWrite: [x86_reg.RSP],
        },
      );
    }
    if (opcode >= 0x58 && opcode <= 0x5f) {
      const register = regName(opcode - 0x58 + rexB);
      return finish(
        'pop',
        register.toLowerCase(),
        (cpu) => {
          cpu.registers[register] = cpu.pop();
        },
        undefined,
        {
          operands: [regOperand(register, 64)],
          implicitRead: [x86_reg.RSP],
          implicitWrite: [x86_reg.RSP],
        },
      );
    }
    if (opcode >= 0xb8 && opcode <= 0xbf) {
      const register = regName(opcode - 0xb8 + rexB);
      const immediate = rexW ? readU64() : BigInt(readU32());
      return finish(
        'mov',
        `${registerText(register, rexW)}, 0x${immediate.toString(16)}`,
        (cpu) => {
          cpu.registers[register] = immediate;
        },
        undefined,
        { operands: [regOperand(register, width), immOperand(immediate)] },
      );
    }

    switch (opcode) {
      case 0x68: {
        const value = BigInt(readI32());
        return finish(
          'push',
          `0x${value.toString(16)}`,
          (cpu) => cpu.push(value),
          undefined,
          {
            operands: [immOperand(value)],
            implicitRead: [x86_reg.RSP],
            implicitWrite: [x86_reg.RSP],
          },
        );
      }
      case 0x6a: {
        const value = BigInt(readI8());
        return finish(
          'push',
          `0x${value.toString(16)}`,
          (cpu) => cpu.push(value),
          undefined,
          {
            operands: [immOperand(value)],
            implicitRead: [x86_reg.RSP],
            implicitWrite: [x86_reg.RSP],
          },
        );
      }
      case 0x88: {
        const parsed = parseModRM();
        const nextRip = address + BigInt(cursor);
        return finish(
          'mov',
          `byte ${formatRM(parsed.rm, false)}, ${registerText(parsed.reg, false)}`,
          (cpu) => {
            writeRM8(cpu, parsed.rm, cpu.registers[parsed.reg], nextRip);
          },
          undefined,
          { operands: [rmOperand(parsed.rm, 8), regOperand(parsed.reg, 8)] },
        );
      }
      case 0x89:
      case 0x8b:
      case 0x31:
      case 0x85:
      case 0x8d: {
        const parsed = parseModRM();
        const nextRip = address + BigInt(cursor);
        if (opcode === 0x89) {
          return finish(
            'mov',
            `${formatRM(parsed.rm, rexW)}, ${registerText(parsed.reg, rexW)}`,
            (cpu) =>
              writeRM(cpu, parsed.rm, cpu.registers[parsed.reg], rexW, nextRip),
            undefined,
            {
              operands: [
                rmOperand(parsed.rm, width),
                regOperand(parsed.reg, width),
              ],
            },
          );
        }
        if (opcode === 0x8b) {
          return finish(
            'mov',
            `${registerText(parsed.reg, rexW)}, ${formatRM(parsed.rm, rexW)}`,
            (cpu) => {
              cpu.registers[parsed.reg] = readRM(cpu, parsed.rm, rexW, nextRip);
            },
            undefined,
            {
              operands: [
                regOperand(parsed.reg, width),
                rmOperand(parsed.rm, width),
              ],
            },
          );
        }
        if (opcode === 0x31) {
          return finish(
            'xor',
            `${formatRM(parsed.rm, rexW)}, ${registerText(parsed.reg, rexW)}`,
            (cpu) => {
              const result =
                readRM(cpu, parsed.rm, rexW, nextRip) ^
                cpu.registers[parsed.reg];
              writeRM(cpu, parsed.rm, result, rexW, nextRip);
              updateArithmeticFlags(cpu, result, rexW);
            },
            undefined,
            {
              operands: [
                rmOperand(parsed.rm, width),
                regOperand(parsed.reg, width),
              ],
            },
          );
        }
        if (opcode === 0x85) {
          return finish(
            'test',
            `${formatRM(parsed.rm, rexW)}, ${registerText(parsed.reg, rexW)}`,
            (cpu) => {
              const result =
                readRM(cpu, parsed.rm, rexW, nextRip) &
                cpu.registers[parsed.reg];
              updateArithmeticFlags(cpu, result, rexW);
            },
            undefined,
            {
              operands: [
                rmOperand(parsed.rm, width),
                regOperand(parsed.reg, width),
              ],
            },
          );
        }
        if (parsed.rm.kind !== 'memory') {
          throw new UnsupportedInstructionFault(address, opcode);
        }
        return finish(
          'lea',
          `${registerText(parsed.reg, true)}, ${formatRM(parsed.rm)}`,
          (cpu) => {
            cpu.registers[parsed.reg] = addressOf(
              parsed.rm as MemoryOperand,
              nextRip,
            );
          },
          undefined,
          {
            operands: [
              regOperand(parsed.reg, 64),
              memOperandOf(parsed.rm as MemoryOperand),
            ],
          },
        );
      }
      case 0x01:
      case 0x03:
      case 0x09:
      case 0x0b:
      case 0x21:
      case 0x23:
      case 0x29:
      case 0x2b:
      case 0x39:
      case 0x3b: {
        const parsed = parseModRM();
        const nextRip = address + BigInt(cursor);
        const destinationIsRM =
          opcode === 0x01 ||
          opcode === 0x09 ||
          opcode === 0x21 ||
          opcode === 0x29 ||
          opcode === 0x39;
        const destination: RMOperand = destinationIsRM
          ? parsed.rm
          : { kind: 'register', register: parsed.reg };
        const source: RMOperand = destinationIsRM
          ? { kind: 'register', register: parsed.reg }
          : parsed.rm;
        const operation =
          opcode === 0x01 || opcode === 0x03
            ? 'add'
            : opcode === 0x09 || opcode === 0x0b
              ? 'or'
              : opcode === 0x21 || opcode === 0x23
                ? 'and'
                : opcode === 0x29 || opcode === 0x2b
                  ? 'sub'
                  : 'cmp';
        return finish(
          operation,
          `${formatRM(destination, rexW)}, ${formatRM(source, rexW)}`,
          (cpu) => {
            const left = readRM(cpu, destination, rexW, nextRip);
            const right = readRM(cpu, source, rexW, nextRip);
            const result =
              operation === 'add'
                ? left + right
                : operation === 'or'
                  ? left | right
                  : operation === 'and'
                    ? left & right
                    : left - right;
            if (operation !== 'cmp') {
              writeRM(cpu, destination, result, rexW, nextRip);
            }
            if (operation === 'add') {
              updateAddFlags(cpu, left, right, result, rexW);
            } else if (operation === 'sub' || operation === 'cmp') {
              updateSubFlags(cpu, left, right, result, rexW);
            } else {
              updateArithmeticFlags(cpu, result, rexW);
            }
          },
          undefined,
          {
            operands: [rmOperand(destination, width), rmOperand(source, width)],
          },
        );
      }
      case 0x81:
      case 0x83: {
        const parsed = parseModRM();
        const immediate =
          opcode === 0x83 ? BigInt(readI8()) : BigInt(readI32());
        const nextRip = address + BigInt(cursor);
        const names: Record<number, string> = {
          0: 'add',
          5: 'sub',
          7: 'cmp',
        };
        const mnemonic = names[parsed.extension];
        if (!mnemonic) {
          throw new UnsupportedInstructionFault(address, opcode);
        }
        return finish(
          mnemonic,
          `${formatRM(parsed.rm, rexW)}, 0x${immediate.toString(16)}`,
          (cpu) => {
            const current = readRM(cpu, parsed.rm, rexW, nextRip);
            const result =
              parsed.extension === 0
                ? current + immediate
                : current - immediate;
            if (parsed.extension !== 7) {
              writeRM(cpu, parsed.rm, result, rexW, nextRip);
            }
            if (parsed.extension === 0) {
              updateAddFlags(cpu, current, immediate, result, rexW);
            } else {
              updateSubFlags(cpu, current, immediate, result, rexW);
            }
          },
          undefined,
          { operands: [rmOperand(parsed.rm, width), immOperand(immediate)] },
        );
      }
      case 0xc7: {
        const parsed = parseModRM();
        if (parsed.extension !== 0) {
          throw new UnsupportedInstructionFault(address, opcode);
        }
        const immediate = BigInt(readU32());
        const nextRip = address + BigInt(cursor);
        return finish(
          'mov',
          `${formatRM(parsed.rm, rexW)}, 0x${immediate.toString(16)}`,
          (cpu) => writeRM(cpu, parsed.rm, immediate, rexW, nextRip),
          undefined,
          { operands: [rmOperand(parsed.rm, width), immOperand(immediate)] },
        );
      }
      case 0xf7: {
        const parsed = parseModRM();
        const nextRip = address + BigInt(cursor);
        if (parsed.extension === 3) {
          return finish(
            'neg',
            formatRM(parsed.rm, rexW),
            (cpu) => {
              const current = readRM(cpu, parsed.rm, rexW, nextRip);
              const result = -current;
              writeRM(cpu, parsed.rm, result, rexW, nextRip);
              updateArithmeticFlags(cpu, result, rexW);
            },
            undefined,
            { operands: [rmOperand(parsed.rm, width)] },
          );
        }
        if (parsed.extension === 4) {
          return finish(
            'mul',
            formatRM(parsed.rm, rexW),
            (cpu) => {
              const bits = rexW ? 64n : 32n;
              const mask = (1n << bits) - 1n;
              const multiplier = readRM(cpu, parsed.rm, rexW, nextRip) & mask;
              const product = (cpu.registers.RAX & mask) * multiplier;
              cpu.registers.RAX = product & mask;
              cpu.registers.RDX = (product >> bits) & mask;
            },
            undefined,
            {
              operands: [rmOperand(parsed.rm, width)],
              implicitRead: [x86_reg.RAX],
              implicitWrite: [x86_reg.RAX, x86_reg.RDX],
            },
          );
        }
        if (parsed.extension === 6) {
          return finish(
            'div',
            formatRM(parsed.rm, rexW),
            (cpu) => {
              const divisor = readRM(cpu, parsed.rm, rexW, nextRip);
              if (divisor === 0n) {
                throw new RangeError('x64 divide error: divisor is zero');
              }
              const bits = rexW ? 64n : 32n;
              const mask = (1n << bits) - 1n;
              const dividend =
                ((cpu.registers.RDX & mask) << bits) |
                (cpu.registers.RAX & mask);
              const quotient = dividend / divisor;
              if (quotient > mask) {
                throw new RangeError('x64 divide error: quotient overflow');
              }
              cpu.registers.RAX = quotient;
              cpu.registers.RDX = dividend % divisor;
            },
            undefined,
            {
              operands: [rmOperand(parsed.rm, width)],
              implicitRead: [x86_reg.RAX, x86_reg.RDX],
              implicitWrite: [x86_reg.RAX, x86_reg.RDX],
            },
          );
        }
        throw new UnsupportedInstructionFault(address, opcode);
      }
      case 0xe8: {
        const displacement = readI32();
        const nextRip = address + BigInt(cursor);
        const target = nextRip + BigInt(displacement);
        return finish(
          'call',
          `0x${target.toString(16)}`,
          (cpu) => {
            cpu.push(nextRip);
            cpu.registers.RIP = target;
          },
          target,
          {
            operands: [immOperand(target)],
            implicitRead: [x86_reg.RSP],
            implicitWrite: [x86_reg.RSP],
          },
        );
      }
      case 0xe9:
      case 0xeb: {
        const displacement = opcode === 0xeb ? readI8() : readI32();
        const target = address + BigInt(cursor) + BigInt(displacement);
        return finish(
          'jmp',
          `0x${target.toString(16)}`,
          (cpu) => {
            cpu.registers.RIP = target;
          },
          target,
          { operands: [immOperand(target)] },
        );
      }
      case 0x74:
      case 0x75: {
        const displacement = readI8();
        const target = address + BigInt(cursor) + BigInt(displacement);
        const jumpOnZero = opcode === 0x74;
        return finish(
          jumpOnZero ? 'je' : 'jne',
          `0x${target.toString(16)}`,
          (cpu) => {
            const zero = (cpu.registers.RFLAGS & ZERO_FLAG) !== 0n;
            if (zero === jumpOnZero) cpu.registers.RIP = target;
          },
          target,
          { operands: [immOperand(target)] },
        );
      }
      case 0xff: {
        const parsed = parseModRM();
        if (parsed.extension !== 2 && parsed.extension !== 4) {
          throw new UnsupportedInstructionFault(address, opcode);
        }
        const nextRip = address + BigInt(cursor);
        const isCall = parsed.extension === 2;
        return finish(
          isCall ? 'call' : 'jmp',
          formatRM(parsed.rm),
          (cpu) => {
            const target = readRM(cpu, parsed.rm, true, nextRip);
            if (isCall) cpu.push(nextRip);
            cpu.registers.RIP = target;
          },
          undefined,
          isCall
            ? {
                operands: [rmOperand(parsed.rm, 64)],
                implicitRead: [x86_reg.RSP],
                implicitWrite: [x86_reg.RSP],
              }
            : { operands: [rmOperand(parsed.rm, 64)] },
        );
      }
      case 0xc3:
        return finish(
          'ret',
          '',
          (cpu) => {
            cpu.registers.RIP = cpu.pop();
          },
          undefined,
          {
            implicitRead: [x86_reg.RSP],
            implicitWrite: [x86_reg.RSP],
          },
        );
      case 0x90:
        return finish('nop', '', () => undefined);
      case 0xcc:
        return finish('int3', '', () => undefined);
      case 0xf4:
        return finish('hlt', '', () => undefined);
      case 0x0f: {
        const second = source[cursor++]!;
        if (second === 0x05) {
          return finish('syscall', '', (cpu) => {
            const id = Number(cpu.registers.RAX & 0xffffffffn);
            cpu.registers.RAX = BigInt.asUintN(
              64,
              cpu.syscallHandler(id, cpu.registers),
            );
          });
        }
        if (second === 0x84 || second === 0x85) {
          const displacement = readI32();
          const target = address + BigInt(cursor) + BigInt(displacement);
          const jumpOnZero = second === 0x84;
          return finish(
            jumpOnZero ? 'je' : 'jne',
            `0x${target.toString(16)}`,
            (cpu) => {
              const zero = (cpu.registers.RFLAGS & ZERO_FLAG) !== 0n;
              if (zero === jumpOnZero) {
                cpu.registers.RIP = target;
              }
            },
            target,
            { operands: [immOperand(target)] },
          );
        }
        if (
          second === 0x82 ||
          second === 0x83 ||
          second === 0x86 ||
          second === 0x87
        ) {
          const displacement = readI32();
          const target = address + BigInt(cursor) + BigInt(displacement);
          const mnemonics: Record<number, string> = {
            0x82: 'jb',
            0x83: 'jae',
            0x86: 'jbe',
            0x87: 'ja',
          };
          return finish(
            mnemonics[second]!,
            `0x${target.toString(16)}`,
            (cpu) => {
              const carry = (cpu.registers.RFLAGS & CARRY_FLAG) !== 0n;
              const zero = (cpu.registers.RFLAGS & ZERO_FLAG) !== 0n;
              const take =
                second === 0x82
                  ? carry
                  : second === 0x83
                    ? !carry
                    : second === 0x86
                      ? carry || zero
                      : !carry && !zero;
              if (take) cpu.registers.RIP = target;
            },
            target,
            { operands: [immOperand(target)] },
          );
        }
        if (second === 0xb6) {
          const parsed = parseModRM();
          const nextRip = address + BigInt(cursor);
          return finish(
            'movzx',
            `${registerText(parsed.reg, false)}, byte ${formatRM(
              parsed.rm,
              false,
            )}`,
            (cpu) => {
              cpu.registers[parsed.reg] = readRM8(cpu, parsed.rm, nextRip);
            },
            undefined,
            { operands: [regOperand(parsed.reg, 32), rmOperand(parsed.rm, 8)] },
          );
        }
        if (second === 0xb7) {
          const parsed = parseModRM();
          const nextRip = address + BigInt(cursor);
          return finish(
            'movzx',
            `${registerText(parsed.reg, false)}, word ${formatRM(
              parsed.rm,
              false,
            )}`,
            (cpu) => {
              cpu.registers[parsed.reg] = readRM16(cpu, parsed.rm, nextRip);
            },
            undefined,
            {
              operands: [regOperand(parsed.reg, 32), rmOperand(parsed.rm, 16)],
            },
          );
        }
        throw new UnsupportedInstructionFault(address, second);
      }
      default:
        throw new UnsupportedInstructionFault(address, opcode);
    }
  }
}

export function isCpuFault(
  error: unknown,
): error is MemoryAccessFault | UnsupportedInstructionFault {
  return (
    error instanceof MemoryAccessFault ||
    error instanceof UnsupportedInstructionFault
  );
}
