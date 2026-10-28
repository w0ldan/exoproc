import type { Pointer, CString } from 'bun:ffi';

/**
 * Numeric/pointer aliases for the native `cs_*` C signatures. These mirror
 * the `CType` runtime tags used to declare them in `def/index.ts`, but as
 * plain TS types since `CFunction` call signatures are untyped (`any[]`).
 */
export type UINT32 = number;
export type INT32 = number;
export type UINT16 = number;
export type UINT8 = number;
export type INT64 = bigint;
export type UINT64 = bigint;
export type HANDLE = bigint;
export type SIZE_T = bigint;
export type LPVOID = NodeJS.TypedArray | Pointer | CString | null;

export interface Detail {
  regs_read: number[];
  regs_read_count: number;
  regs_write: number[];
  regs_write_count: number;
  groups: number[];
  groups_count: number;
}

/**
 * Handle using with all API
 */
export type csh = HANDLE;

export * from './cs_arch.js';
export * from './cs_mode.js';
export * from './cs_err.js';
export * from './cs_opt_type.js';
export * from './cs_opt_value.js';

export const CS_MNEMONIC_SIZE = 32;
export const CS_INSN_BYTES_MAX = 16;

export * from './x86.js';
export * from './x86_reg.js';
export * from './x86_insn.js';
export * from './x86_op_type.js';
export * from './x86_prefix.js';
export * from './x86_avx_bcast.js';
export * from './x86_avx_cc.js';
export * from './x86_avx_rm.js';
export * from './x86_sse_cc.js';
export * from './x86_xop_cc.js';
