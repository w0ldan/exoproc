import { ffi } from 'bun-xffi';
import { CS_MNEMONIC_SIZE } from 'bun-capstone-abi';

export const cs_x86_encoding = ffi.struct('cs_x86_encoding', {
  modrm_offset: 'u8',
  disp_offset: 'u8',
  disp_size: 'u8',
  imm_offset: 'u8',
  imm_size: 'u8',
});

export const x86_op_mem = ffi.struct('x86_op_mem', {
  segment: 'u32', // x86_reg is enum (int)
  base: 'u32',
  index: 'u32',
  scale: 'i32',
  disp: 'i64',
});

export const cs_x86_op = ffi.struct('cs_x86_op', {
  type: 'i32', // x86_op_type
  __union: ffi.union({
    reg: 'u32', // x86_reg
    imm: 'i64',
    mem: x86_op_mem,
  }),
  size: 'u8',
  access: 'u8', // cs_ac_type
  avx_bcast: 'i32', // x86_avx_bcast
  avx_zero_opmask: 'i32',
});

// Windows Capstone 4.0.2 struct
export const cs_x86 = ffi.struct('cs_x86', {
  prefix: ffi.array('u8', 4),
  opcode: ffi.array('u8', 4),
  rex: 'u8',
  addr_size: 'u8',
  modrm: 'u8',
  sib: 'u8',
  disp: 'i64',
  sib_index: 'u32', // x86_reg
  sib_scale: 'i8',
  sib_base: 'u32', // x86_reg
  xop_cc: 'i32', // x86_xop_cc
  sse_cc: 'i32', // x86_sse_cc
  avx_cc: 'i32', // x86_avx_cc
  avx_sae: 'i32',
  avx_rm: 'i32', // x86_avx_rm
  __union: ffi.union({
    eflags: 'u64',
    fpu_flags: 'u64',
  }),
  op_count: 'u8',
  operands: ffi.array(cs_x86_op, 8),
  encoding: cs_x86_encoding,
});

export const cs_detail = ffi.struct('cs_detail', {
  regs_read: ffi.array('u16', 12),
  regs_read_count: 'u8',
  regs_write: ffi.array('u16', 20),
  regs_write_count: 'u8',
  groups: ffi.array('u8', 8),
  groups_count: 'u8',
  x86: cs_x86,
});

// Windows Capstone 4.0.2 uses 16 bytes for max instruction
export const cs_insn = ffi.struct('cs_insn', {
  id: 'u32',
  address: 'u64',
  size: 'u16',
  bytes: ffi.array('u8', 16),
  mnemonic: ffi.array('u8', CS_MNEMONIC_SIZE),
  op_str: ffi.array('u8', 160),
  detail: ffi.pointer(cs_detail),
});
