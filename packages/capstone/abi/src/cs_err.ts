import { cdefines, type CDefineValueType } from 'bun-xffi/cdefine';

export const cs_err = cdefines(
  {
    OK: 0, // No error: everything was fine
    MEM: 1, // Out-Of-Memory error: cs_open(), cs_disasm(), cs_disasm_iter()
    ARCH: 2, // Unsupported architecture: cs_open()
    HANDLE: 3, // Invalid handle: cs_op_count(), cs_op_index()
    CSH: 4, // Invalid csh argument: cs_close(), cs_errno(), cs_option()
    MODE: 5, // Invalid/unsupported mode: cs_open()
    OPTION: 6, // Invalid/unsupported option: cs_option()
    DETAIL: 7, // Information is unavailable because detail option is OFF
    MEMSETUP: 8, // Dynamic memory management uninitialized (see CS_OPT_MEM)
    VERSION: 9, // Unsupported version (bindings)
    DIET: 10, // Access irrelevant data in "diet" engine
    SKIPDATA: 11, // Access irrelevant data for "data" instruction in SKIPDATA mode
    X86_ATT: 12, // X86 AT&T syntax is unsupported (opt-out at compile time)
    X86_INTEL: 13, // X86 Intel syntax is unsupported (opt-out at compile time)
    X86_MASM: 14, // X86 Masm syntax is unsupported (opt-out at compile time)
  },
  'CS_ERR',
);
export type cs_err = CDefineValueType<typeof cs_err>;
