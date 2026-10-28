import { cdefines, type CDefineValueType } from 'bun-xffi/cdefine';

export const cs_mode = cdefines(
  {
    LITTLE_ENDIAN: 0, // little-endian mode (default mode)
    ARM: 0, // 32-bit ARM
    _16: 2, // 16-bit mode (X86)
    _32: 4, // 32-bit mode (X86)
    _64: 8, // 64-bit mode (X86, PPC)
    THUMB: 16, // ARM's Thumb mode, including Thumb-2
    MCLASS: 32, // ARM's Cortex-M series
    V8: 64, // ARMv8 A32 encodings for ARM
    MICRO: 16, // MicroMips mode (MIPS)
    MIPS3: 32, // Mips III ISA
    MIPS32R6: 64, // Mips32r6 ISA
    MIPS2: 128, // Mips II ISA
    V9: 16, // SparcV9 mode (Sparc)
    QPX: 16, // Quad Processing eXtensions mode (PPC)
    M68K_000: 2, // M68K 68000 mode
    M68K_010: 4, // M68K 68010 mode
    M68K_020: 8, // M68K 68020 mode
    M68K_030: 16, // M68K 68030 mode
    M68K_040: 32, // M68K 68040 mode
    M68K_060: 64, // M68K 68060 mode
    BIG_ENDIAN: -2147483648, // big-endian mode
    MIPS32: 4, // Mips32 ISA (Mips)
    MIPS64: 8, // Mips64 ISA (Mips)
    M680X_6301: 2, // M680X Hitachi 6301,6303 mode
    M680X_6309: 4, // M680X Hitachi 6309 mode
    M680X_6800: 8, // M680X Motorola 6800,6802 mode
    M680X_6801: 16, // M680X Motorola 6801,6803 mode
    M680X_6805: 32, // M680X Motorola/Freescale 6805 mode
    M680X_6808: 64, // M680X Motorola/Freescale/NXP 68HC08 mode
    M680X_6809: 128, // M680X Motorola 6809 mode
    M680X_6811: 256, // M680X Motorola/Freescale/NXP 68HC11 mode
    M680X_CPU12: 512, // M680X Motorola/Freescale/NXP CPU12
    M680X_HCS08: 1024, // M680X Freescale/NXP HCS08 mode
  },
  'CS_MODE',
);
export type cs_mode = CDefineValueType<typeof cs_mode>;
