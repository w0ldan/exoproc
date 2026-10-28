import * as bunffi from 'bun:ffi';
import type { Pointer } from 'bun:ffi';
import { cs_detail, cs_x86, cs_x86_op } from './struct/index.js';
import { x86_op_type } from 'bun-capstone-abi';
import type { X86Detail, X86, X86Operand } from 'bun-capstone-abi';

interface StructFields {
  [field: string]: { offset: number };
}
interface CompiledStructClass {
  computed: { fields: StructFields; totalSize: number };
}

function fieldsOf(structClass: unknown): StructFields {
  return (structClass as CompiledStructClass).computed.fields;
}

const DETAIL_FIELDS = fieldsOf(cs_detail);
const X86_FIELDS = fieldsOf(cs_x86);
const X86_OP_FIELDS = fieldsOf(cs_x86_op);
const DETAIL_SIZE = (cs_detail as unknown as CompiledStructClass).computed
  .totalSize;
const X86_OP_SIZE = (cs_x86_op as unknown as CompiledStructClass).computed
  .totalSize;

function readU8Array(buf: Buffer, offset: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(buf.readUInt8(offset + i));
  return out;
}

function readU16Array(buf: Buffer, offset: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(buf.readUInt16LE(offset + i * 2));
  return out;
}

function readOperand(buf: Buffer, base: number): X86Operand {
  const type = buf.readInt32LE(base + X86_OP_FIELDS.type!.offset);
  const unionOffset = base + X86_OP_FIELDS.__union!.offset;
  const operand: X86Operand = {
    type,
    size: buf.readUInt8(base + X86_OP_FIELDS.size!.offset),
    access: buf.readUInt8(base + X86_OP_FIELDS.access!.offset),
    avx_bcast: buf.readInt32LE(base + X86_OP_FIELDS.avx_bcast!.offset),
    avx_zero_opmask:
      buf.readInt32LE(base + X86_OP_FIELDS.avx_zero_opmask!.offset) !== 0,
  };

  switch (type) {
    case x86_op_type.REG:
      operand.reg = buf.readUInt32LE(unionOffset);
      break;
    case x86_op_type.IMM:
      operand.imm = buf.readBigInt64LE(unionOffset);
      break;
    case x86_op_type.MEM:
      operand.mem = {
        segment: buf.readUInt32LE(unionOffset),
        base: buf.readUInt32LE(unionOffset + 4),
        index: buf.readUInt32LE(unionOffset + 8),
        scale: buf.readInt32LE(unionOffset + 12),
        disp: buf.readBigInt64LE(unionOffset + 16),
      };
      break;
  }
  return operand;
}

/**
 * Parses a raw `cs_detail*` pointer (produced by cs_disasm with detail mode
 * enabled) into a plain JS object. The pointer always refers to local-process
 * memory owned by libcapstone (Capstone only ever disassembles in-process
 * buffers), so it's read synchronously via bun:ffi rather than an accessor.
 */
export function readX86Detail(detailPtr: bigint): X86Detail | undefined {
  if (!detailPtr) return undefined;

  const buf = Buffer.from(
    bunffi.toArrayBuffer(
      Number(detailPtr) as unknown as Pointer,
      0,
      DETAIL_SIZE,
    ),
  );

  const regsReadCount = buf.readUInt8(DETAIL_FIELDS.regs_read_count!.offset);
  const regsWriteCount = buf.readUInt8(DETAIL_FIELDS.regs_write_count!.offset);
  const groupsCount = buf.readUInt8(DETAIL_FIELDS.groups_count!.offset);

  const x86Base = DETAIL_FIELDS.x86!.offset;
  const opCount = buf.readUInt8(x86Base + X86_FIELDS.op_count!.offset);
  const operandsBase = x86Base + X86_FIELDS.operands!.offset;
  const operands: X86Operand[] = [];
  for (let i = 0; i < opCount; i++) {
    operands.push(readOperand(buf, operandsBase + i * X86_OP_SIZE));
  }

  const encodingBase = x86Base + X86_FIELDS.encoding!.offset;
  const flagsOffset = x86Base + X86_FIELDS.__union!.offset;

  const x86: X86 = {
    prefix: readU8Array(buf, x86Base + X86_FIELDS.prefix!.offset, 4),
    opcode: readU8Array(buf, x86Base + X86_FIELDS.opcode!.offset, 4),
    rex: buf.readUInt8(x86Base + X86_FIELDS.rex!.offset),
    addr_size: buf.readUInt8(x86Base + X86_FIELDS.addr_size!.offset),
    modrm: buf.readUInt8(x86Base + X86_FIELDS.modrm!.offset),
    sib: buf.readUInt8(x86Base + X86_FIELDS.sib!.offset),
    disp: buf.readBigInt64LE(x86Base + X86_FIELDS.disp!.offset),
    sib_index: buf.readUInt32LE(x86Base + X86_FIELDS.sib_index!.offset),
    sib_scale: buf.readInt8(x86Base + X86_FIELDS.sib_scale!.offset),
    sib_base: buf.readUInt32LE(x86Base + X86_FIELDS.sib_base!.offset),
    xop_cc: buf.readInt32LE(x86Base + X86_FIELDS.xop_cc!.offset),
    sse_cc: buf.readInt32LE(x86Base + X86_FIELDS.sse_cc!.offset),
    avx_cc: buf.readInt32LE(x86Base + X86_FIELDS.avx_cc!.offset),
    avx_sae: buf.readInt32LE(x86Base + X86_FIELDS.avx_sae!.offset) !== 0,
    avx_rm: buf.readInt32LE(x86Base + X86_FIELDS.avx_rm!.offset),
    eflags: buf.readBigUInt64LE(flagsOffset),
    fpu_flags: buf.readBigUInt64LE(flagsOffset),
    op_count: opCount,
    operands,
    encoding: {
      modrm_offset: buf.readUInt8(encodingBase),
      disp_offset: buf.readUInt8(encodingBase + 1),
      disp_size: buf.readUInt8(encodingBase + 2),
      imm_offset: buf.readUInt8(encodingBase + 3),
      imm_size: buf.readUInt8(encodingBase + 4),
    },
  };

  const detail: X86Detail = {
    regs_read: readU16Array(
      buf,
      DETAIL_FIELDS.regs_read!.offset,
      regsReadCount,
    ),
    regs_read_count: regsReadCount,
    regs_write: readU16Array(
      buf,
      DETAIL_FIELDS.regs_write!.offset,
      regsWriteCount,
    ),
    regs_write_count: regsWriteCount,
    groups: readU8Array(buf, DETAIL_FIELDS.groups!.offset, groupsCount),
    groups_count: groupsCount,
    x86,
  };
  return detail;
}
