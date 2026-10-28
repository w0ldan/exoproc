import { cdefines, type CDefineValueType } from 'bun-xffi/cdefine';

export const x86_avx_rm = cdefines(
  {
    INVALID: 0, // Uninitialized.
    RN: 1, // Round to nearest
    RD: 2, // Round down
    RU: 3, // Round up
    RZ: 4, // Round toward zero
  },
  'X86_AVX_RM',
);
export type x86_avx_rm = CDefineValueType<typeof x86_avx_rm>;
