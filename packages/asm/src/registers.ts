export type X64Register64 =
  | 'rax'
  | 'rcx'
  | 'rdx'
  | 'rbx'
  | 'rsp'
  | 'rbp'
  | 'rsi'
  | 'rdi'
  | 'r8'
  | 'r9'
  | 'r10'
  | 'r11'
  | 'r12'
  | 'r13'
  | 'r14'
  | 'r15';

export type X64Register32 =
  | 'eax'
  | 'ecx'
  | 'edx'
  | 'ebx'
  | 'esp'
  | 'ebp'
  | 'esi'
  | 'edi'
  | 'r8d'
  | 'r9d'
  | 'r10d'
  | 'r11d'
  | 'r12d'
  | 'r13d'
  | 'r14d'
  | 'r15d';

export type X64Register = X64Register64 | X64Register32;

export type X64XmmRegister =
  | 'xmm0'
  | 'xmm1'
  | 'xmm2'
  | 'xmm3'
  | 'xmm4'
  | 'xmm5'
  | 'xmm6'
  | 'xmm7'
  | 'xmm8'
  | 'xmm9'
  | 'xmm10'
  | 'xmm11'
  | 'xmm12'
  | 'xmm13'
  | 'xmm14'
  | 'xmm15';

type RegisterInfo = {
  readonly code: number;
  readonly width: 32 | 64;
};

export const REGISTER_INFO: Readonly<Record<X64Register, RegisterInfo>> = {
  rax: { code: 0, width: 64 },
  rcx: { code: 1, width: 64 },
  rdx: { code: 2, width: 64 },
  rbx: { code: 3, width: 64 },
  rsp: { code: 4, width: 64 },
  rbp: { code: 5, width: 64 },
  rsi: { code: 6, width: 64 },
  rdi: { code: 7, width: 64 },
  r8: { code: 8, width: 64 },
  r9: { code: 9, width: 64 },
  r10: { code: 10, width: 64 },
  r11: { code: 11, width: 64 },
  r12: { code: 12, width: 64 },
  r13: { code: 13, width: 64 },
  r14: { code: 14, width: 64 },
  r15: { code: 15, width: 64 },
  eax: { code: 0, width: 32 },
  ecx: { code: 1, width: 32 },
  edx: { code: 2, width: 32 },
  ebx: { code: 3, width: 32 },
  esp: { code: 4, width: 32 },
  ebp: { code: 5, width: 32 },
  esi: { code: 6, width: 32 },
  edi: { code: 7, width: 32 },
  r8d: { code: 8, width: 32 },
  r9d: { code: 9, width: 32 },
  r10d: { code: 10, width: 32 },
  r11d: { code: 11, width: 32 },
  r12d: { code: 12, width: 32 },
  r13d: { code: 13, width: 32 },
  r14d: { code: 14, width: 32 },
  r15d: { code: 15, width: 32 },
};

export const XMM_REGISTER_INFO: Readonly<Record<X64XmmRegister, number>> = {
  xmm0: 0,
  xmm1: 1,
  xmm2: 2,
  xmm3: 3,
  xmm4: 4,
  xmm5: 5,
  xmm6: 6,
  xmm7: 7,
  xmm8: 8,
  xmm9: 9,
  xmm10: 10,
  xmm11: 11,
  xmm12: 12,
  xmm13: 13,
  xmm14: 14,
  xmm15: 15,
};

export function isRegister(value: unknown): value is X64Register {
  return typeof value === 'string' && value in REGISTER_INFO;
}

export function isXmmRegister(value: unknown): value is X64XmmRegister {
  return typeof value === 'string' && value in XMM_REGISTER_INFO;
}
