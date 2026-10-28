import { cdefines, type CDefineValueType } from 'bun-xffi/cdefine';

export const cs_opt_type = cdefines(
  {
    INVALID: 0, // No option specified
    SYNTAX: 1, // Assembly output syntax
    DETAIL: 2, // Break down instruction structure into details
    MODE: 3, // Change engine's mode at run-time
    MEM: 4, // User-defined dynamic memory related functions
    SKIPDATA: 5, // Skip data when disassembling. Then engine is in SKIPDATA mode.
    SKIPDATA_SETUP: 6, // Setup user-defined function for SKIPDATA option
    MNEMONIC: 7, // Customize instruction mnemonic
    UNSIGNED: 8, // print immediate operands in unsigned form
  },
  'CS_OPT',
);
export type cs_opt_type = CDefineValueType<typeof cs_opt_type>;
