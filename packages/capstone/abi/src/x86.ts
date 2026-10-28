import type { Detail } from './index.js';

export * from './x86_reg.js';
export * from './x86_op_type.js';
export * from './x86_xop_cc.js';
export * from './x86_sse_cc.js';
export * from './x86_avx_bcast.js';
export * from './x86_avx_cc.js';
export * from './x86_avx_rm.js';
export * from './x86_prefix.js';
export * from './x86_insn.js';

export interface X86OpMem {
  segment: number;
  base: number;
  index: number;
  scale: number;
  disp: number | bigint;
}

export interface X86Operand {
  type: number; // x86_op_type
  reg?: number;
  imm?: number | bigint;
  mem?: X86OpMem;
  size: number;
  access: number;
  avx_bcast: number;
  avx_zero_opmask: boolean;
}

export interface X86Encoding {
  modrm_offset: number;
  disp_offset: number;
  disp_size: number;
  imm_offset: number;
  imm_size: number;
}

export interface X86 {
  prefix: number[];
  opcode: number[];
  rex: number;
  addr_size: number;
  modrm: number;
  sib: number;
  disp: number | bigint;
  sib_index: number;
  sib_scale: number;
  sib_base: number;
  xop_cc: number;
  sse_cc: number;
  avx_cc: number;
  avx_sae: boolean;
  avx_rm: number;
  eflags: number | bigint;
  fpu_flags: number | bigint;
  op_count: number;
  operands: X86Operand[];
  encoding: X86Encoding;
}

export interface X86Detail extends Detail {
  x86: X86;
}
