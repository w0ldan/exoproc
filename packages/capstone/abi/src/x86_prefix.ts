import { cdefines, type CDefineValueType } from 'bun-xffi/cdefine';

export const x86_prefix = cdefines(
  {
    LOCK: 240, // lock (cs_x86.prefix[0]
    REP: 243, // rep (cs_x86.prefix[0]
    REPE: 243, // repe/repz (cs_x86.prefix[0]
    REPNE: 242, // repne/repnz (cs_x86.prefix[0]
    CS: 46, // segment override CS (cs_x86.prefix[1]
    SS: 54, // segment override SS (cs_x86.prefix[1]
    DS: 62, // segment override DS (cs_x86.prefix[1]
    ES: 38, // segment override ES (cs_x86.prefix[1]
    FS: 100, // segment override FS (cs_x86.prefix[1]
    GS: 101, // segment override GS (cs_x86.prefix[1]
    OPSIZE: 102, // operand-size override (cs_x86.prefix[2]
    ADDRSIZE: 103, // address-size override (cs_x86.prefix[3]
  },
  'X86_PREFIX',
);
export type x86_prefix = CDefineValueType<typeof x86_prefix>;
