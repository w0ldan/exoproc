import { cdefines, type CDefineValueType } from 'bun-xffi/cdefine';

export const x86_xop_cc = cdefines(
  {
    INVALID: 0, // Uninitialized.
    LT: 1,
    LE: 2,
    GT: 3,
    GE: 4,
    EQ: 5,
    NEQ: 6,
    FALSE: 7,
    TRUE: 8,
  },
  'X86_XOP_CC',
);
export type x86_xop_cc = CDefineValueType<typeof x86_xop_cc>;
