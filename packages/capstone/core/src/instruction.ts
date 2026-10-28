import type { Detail } from 'bun-capstone-abi';

export interface RawInstruction {
  id: number;
  address: number | bigint;
  size: number;
  bytes: number[] | Uint8Array;
  mnemonic?: string;
  op_str?: string;
  /**
   * Raw `cs_detail*` pointer as read off the `cs_insn` struct (bigint), or
   * an already-parsed `Detail` once an arch-specific layer (e.g. CapstoneX86)
   * has decoded it.
   */
  detail?: Detail | bigint;
}

// Common x86 mnemonics for helper methods
const CALL_MNEMONICS = new Set(['call', 'lcall']);
const JMP_MNEMONICS = new Set([
  'jmp',
  'ljmp',
  'je',
  'jne',
  'jz',
  'jnz',
  'ja',
  'jae',
  'jb',
  'jbe',
  'jg',
  'jge',
  'jl',
  'jle',
  'jo',
  'jno',
  'js',
  'jns',
  'jp',
  'jnp',
  'jpe',
  'jpo',
  'jcxz',
  'jecxz',
  'jrcxz',
  'loop',
  'loope',
  'loopne',
  'loopz',
  'loopnz',
]);
const RET_MNEMONICS = new Set([
  'ret',
  'retf',
  'retn',
  'iret',
  'iretd',
  'iretq',
]);
const NOP_MNEMONICS = new Set(['nop']);
const PUSH_MNEMONICS = new Set([
  'push',
  'pusha',
  'pushad',
  'pushf',
  'pushfd',
  'pushfq',
]);
const POP_MNEMONICS = new Set([
  'pop',
  'popa',
  'popad',
  'popf',
  'popfd',
  'popfq',
]);
const MOV_MNEMONICS = new Set([
  'mov',
  'movs',
  'movsb',
  'movsw',
  'movsd',
  'movsq',
  'movzx',
  'movsx',
  'movsxd',
  'movabs',
]);
const LEA_MNEMONICS = new Set(['lea']);
const INT_MNEMONICS = new Set([
  'int',
  'int1',
  'int3',
  'into',
  'syscall',
  'sysenter',
]);
const CMP_MNEMONICS = new Set(['cmp', 'test']);

export class Instruction {
  public id: number;
  public address: bigint;
  public size: number;
  public bytes: number[];
  public mnemonic: string;
  public op_str: string;
  public detail?: Detail | bigint;

  constructor(raw: RawInstruction) {
    this.id = raw.id;
    this.address = BigInt(raw.address);
    this.size = raw.size;
    this.bytes = Array.isArray(raw.bytes)
      ? raw.bytes
      : Array.from(raw.bytes || []);
    this.mnemonic = raw.mnemonic || '';
    this.op_str = raw.op_str || '';
    this.detail = raw.detail;
  }

  // ── Formatting ──────────────────────────────────────────────

  /**
   * Gets the instruction bytes as a space-separated hex string.
   * Example: "48 89 d8"
   */
  get hexBytes(): string {
    return this.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
  }

  /**
   * Formats the instruction as "mnemonic op_str"
   */
  toString(): string {
    if (this.op_str) {
      return `${this.mnemonic} ${this.op_str}`;
    }
    return this.mnemonic;
  }

  /**
   * Returns the end address of this instruction (address + size)
   */
  get endAddress(): bigint {
    return this.address + BigInt(this.size);
  }

  // ── Type Classification ─────────────────────────────────────

  /** True if this is a CALL instruction */
  get isCall(): boolean {
    return CALL_MNEMONICS.has(this.mnemonic.toLowerCase());
  }

  /** True if this is any kind of jump (conditional or unconditional) */
  get isJump(): boolean {
    return JMP_MNEMONICS.has(this.mnemonic.toLowerCase());
  }

  /** True if this is a conditional jump (je, jne, jg, etc.) */
  get isConditionalJump(): boolean {
    const m = this.mnemonic.toLowerCase();
    return this.isJump && m !== 'jmp' && m !== 'ljmp';
  }

  /** True if this is a RET/IRET instruction */
  get isRet(): boolean {
    return RET_MNEMONICS.has(this.mnemonic.toLowerCase());
  }

  /** True if this is a NOP instruction */
  get isNop(): boolean {
    return NOP_MNEMONICS.has(this.mnemonic.toLowerCase());
  }

  /** True if this is a PUSH instruction */
  get isPush(): boolean {
    return PUSH_MNEMONICS.has(this.mnemonic.toLowerCase());
  }

  /** True if this is a POP instruction */
  get isPop(): boolean {
    return POP_MNEMONICS.has(this.mnemonic.toLowerCase());
  }

  /** True if this is a MOV-family instruction */
  get isMov(): boolean {
    return MOV_MNEMONICS.has(this.mnemonic.toLowerCase());
  }

  /** True if this is a LEA instruction */
  get isLea(): boolean {
    return LEA_MNEMONICS.has(this.mnemonic.toLowerCase());
  }

  /** True if this is an INT/SYSCALL instruction */
  get isInterrupt(): boolean {
    return INT_MNEMONICS.has(this.mnemonic.toLowerCase());
  }

  /** True if this is a CMP/TEST instruction */
  get isCompare(): boolean {
    return CMP_MNEMONICS.has(this.mnemonic.toLowerCase());
  }

  /** True if this instruction changes execution flow (call, jump, ret, int) */
  get isBranch(): boolean {
    return this.isCall || this.isJump || this.isRet || this.isInterrupt;
  }

  // ── Detail Helpers ──────────────────────────────────────────

  /** The parsed detail struct, or undefined if not yet decoded (e.g. raw pointer stage) */
  private get parsedDetail(): Detail | undefined {
    return typeof this.detail === 'object' ? this.detail : undefined;
  }

  /** Registers read by this instruction (requires detail mode) */
  get regsRead(): number[] {
    const d = this.parsedDetail;
    return d?.regs_read?.slice(0, d.regs_read_count) ?? [];
  }

  /** Registers written by this instruction (requires detail mode) */
  get regsWrite(): number[] {
    const d = this.parsedDetail;
    return d?.regs_write?.slice(0, d.regs_write_count) ?? [];
  }

  /** Instruction groups this belongs to (requires detail mode) */
  get groups(): number[] {
    const d = this.parsedDetail;
    return d?.groups?.slice(0, d.groups_count) ?? [];
  }
}
