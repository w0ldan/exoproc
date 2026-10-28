import { cdefines, type CDefineValueType } from 'bun-xffi/cdefine';

export const cs_arch = cdefines(
  {
    ARM: 0, // ARM architecture (including Thumb, Thumb-2)
    ARM64: 1, // ARM-64, also called AArch64
    MIPS: 2, // Mips architecture
    X86: 3, // X86 architecture (including x86 & x86-64)
    PPC: 4, // PowerPC architecture
    SPARC: 5, // Sparc architecture
    SYSZ: 6, // SystemZ architecture
    XCORE: 7, // XCore architecture
    M68K: 8, // 68K architecture
    TMS320C64X: 9, // TMS320C64x architecture
    M680X: 10, // 680X architecture
    EVM: 11, // Ethereum architecture
    MAX: 12,
    ALL: 65535, // All architectures - for cs_support()
  },
  'CS_ARCH',
);
export type cs_arch = CDefineValueType<typeof cs_arch>;
