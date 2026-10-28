import { cdefines, type CDefineValueType } from 'bun-xffi/cdefine';

export const x86_avx_bcast = cdefines(
  {
    INVALID: 0, // Uninitialized.
    BCAST2: 1, // AVX512 broadcast type {1to2}
    BCAST4: 2, // AVX512 broadcast type {1to4}
    BCAST8: 3, // AVX512 broadcast type {1to8}
    BCAST16: 4, // AVX512 broadcast type {1to16}
  },
  'X86_AVX_BCAST',
);
export type x86_avx_bcast = CDefineValueType<typeof x86_avx_bcast>;
