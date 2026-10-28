import { cdefines, type CDefineValueType } from 'bun-xffi/cdefine';

export const x86_sse_cc = cdefines(
  {
    INVALID: 0, // Uninitialized.
    EQ: 1,
    LT: 2,
    LE: 3,
    UNORD: 4,
    NEQ: 5,
    NLT: 6,
    NLE: 7,
    ORD: 8,
  },
  'X86_SSE_CC',
);
export type x86_sse_cc = CDefineValueType<typeof x86_sse_cc>;
