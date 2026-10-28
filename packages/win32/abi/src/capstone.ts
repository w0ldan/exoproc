import { CType, type Win32Dll } from './types.js';

/**
 * Native Capstone Definitions
 *
 * capstone.dll is not a real Windows system DLL -- it's the disassembler
 * binary the simulator injects for nhook/minhook trampoline analysis --
 * hence `knownToLinker: false` (nothing on Windows resolves it via the
 * ordinary import table the way kernel32/ntdll do).
 */
export const CapstoneDefinitions = {
  cs_version: { args: [CType.ptr, CType.ptr], returns: CType.uint },
  cs_support: { args: [CType.int], returns: CType.int },
  cs_open: { args: [CType.int, CType.int, CType.ptr], returns: CType.int },
  cs_close: { args: [CType.ptr], returns: CType.int },
  cs_option: {
    args: [CType.uint64_t, CType.int, CType.uint64_t],
    returns: CType.int,
  },
  cs_errno: { args: [CType.uint64_t], returns: CType.int },
  cs_strerror: { args: [CType.int], returns: CType.cstring },
  cs_disasm: {
    args: [
      CType.uint64_t,
      CType.ptr,
      CType.uint64_t,
      CType.uint64_t,
      CType.uint64_t,
      CType.ptr,
    ],
    returns: CType.uint64_t,
  },
  cs_free: { args: [CType.ptr, CType.uint64_t], returns: CType.void },
  cs_reg_name: { args: [CType.uint64_t, CType.uint], returns: CType.cstring },
  cs_insn_name: { args: [CType.uint64_t, CType.uint], returns: CType.cstring },
  cs_group_name: {
    args: [CType.uint64_t, CType.uint],
    returns: CType.cstring,
  },
};

export const CapstoneDll = {
  name: 'capstone',
  knownToLinker: false,
  definitions: CapstoneDefinitions,
} as const satisfies Win32Dll;
