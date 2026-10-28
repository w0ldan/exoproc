import { CType } from 'bun-xffi/types';
import type { CImportSymbol } from 'bun-xffi';

/**
 * Pure ABI shape for capstone.dll -- no native loader side effects, so this
 * module is safe for `bun-capstone`'s own native `def/index.ts` loader to
 * import as a value (not just `import type`).
 *
 * Deliberately exported via the `bun-capstone-abi/def` subpath, NOT
 * re-exported from the package root (`index.ts`): `CType` still needs
 * `bun:ffi`'s `FFIType` at module-evaluation time (via `bun-xffi/types`),
 * and while that resolves fine under Node (the simulator's `bun:ffi` shim
 * provides `FFIType`), it broke `simulate`'s *browser* bundle
 * (Turbopack, in `apps/docs`) with `ReferenceError: Cannot access 'FFIType'
 * before initialization` the one time this was folded into the root
 * barrel -- something about the browser shim's own `FFIType` proxy and
 * this module's evaluation order under bundling. `simulate`'s own
 * `bin/dll/capstone.ts` only ever needs the plain enum tables (`cs_arch`,
 * `x86_reg`, ...), never `CapstoneDef`, so keeping this off the root
 * export avoids dragging it into a consumer that never asked for it.
 */
export const CapstoneDef = {
  cs_version: { args: [CType.ptr, CType.ptr], returns: CType.u32 },
  cs_support: { args: [CType.i32], returns: CType.i32 },
  cs_open: { args: [CType.i32, CType.i32, CType.ptr], returns: CType.i32 },
  cs_close: { args: [CType.ptr], returns: CType.i32 },
  cs_option: {
    args: [CType.u64, CType.i32, CType.u64],
    returns: CType.i32,
  },
  cs_errno: { args: [CType.u64], returns: CType.i32 },
  // Returns `const char*`: declared as `cstring` (not `ptr`) so bun:ffi
  // marshals the result into a JS-usable `CString` automatically.
  cs_strerror: { args: [CType.i32], returns: CType.cstring },
  cs_disasm: {
    args: [CType.u64, CType.ptr, CType.u64, CType.u64, CType.u64, CType.ptr],
    returns: CType.u64,
  },
  cs_free: { args: [CType.ptr, CType.u64], returns: CType.void },
  cs_reg_name: { args: [CType.u64, CType.u32], returns: CType.cstring },
  cs_insn_name: { args: [CType.u64, CType.u32], returns: CType.cstring },
  cs_group_name: { args: [CType.u64, CType.u32], returns: CType.cstring },
} satisfies Record<string, CImportSymbol>;
