import { cdefines, type CDefineValueType } from 'bun-xffi/cdefine';

export const x86_op_type = cdefines(
  {
    INVALID: 0, // = CS_OP_INVALID (Uninitialized).
    REG: 1, // = CS_OP_REG (Register operand).
    IMM: 2, // = CS_OP_IMM (Immediate operand).
    MEM: 3, // = CS_OP_MEM (Memory operand).
  },
  'X86_OP',
);
export type x86_op_type = CDefineValueType<typeof x86_op_type>;
