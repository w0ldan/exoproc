import { type IMemoryAccessor, resolveAddress } from 'bun-xffi';
import {
  CapstoneX86,
  type Instruction,
  x86_reg,
  x86_op_type,
  type X86Detail,
} from 'bun-capstone';
import { TrampolineRelocationError, TrampolineSpaceError } from './errors.js';

/** Size of the JMP written at the hooked function: `E9 rel32`. */
export const JMP_PATCH_SIZE = 5;

export interface Trampoline {
  /** Address of the trampoline in the target process. */
  readonly address: bigint;
  /** Total size of the trampoline's code (relocated instructions + jmp-back). */
  readonly size: number;
  /** Instructions copied out of the target's prologue to make room for the JMP. */
  readonly stolenInstructions: Instruction[];
  /** Bytes overwritten at the target by the 5-byte JMP (>= JMP_PATCH_SIZE). */
  readonly patchLength: number;
  /** The target's original bytes over `patchLength`, saved for disable/restore. */
  readonly originalBytes: Buffer;
}

function findRipRelativeMemOperand(insn: Instruction) {
  const detail = insn.detail as X86Detail | undefined;
  if (!detail?.x86) return undefined;
  for (const op of detail.x86.operands) {
    if (op.type === x86_op_type.MEM && op.mem?.base === x86_reg.RIP) {
      return op.mem;
    }
  }
  return undefined;
}

/**
 * Disassembles at least `JMP_PATCH_SIZE` bytes from `targetAddr`, relocates
 * those instructions (fixing up RIP-relative operands) into a buffer, and
 * appends a `jmp rel32` back to the first unmodified instruction after the
 * patch -- i.e. builds the "call original" trampoline, MinHook-style.
 *
 * Does not write anything to `targetAddr` itself or install any detour --
 * see `MinHook.create()`/`enable()`.
 */
export async function buildTrampoline(
  memory: IMemoryAccessor,
  capstone: CapstoneX86,
  targetAddr: bigint,
): Promise<Trampoline> {
  const prologue = await memory.read(targetAddr, 32);
  const decoded = capstone.disasm(prologue, targetAddr, 8);

  const stolen: Instruction[] = [];
  let patchLength = 0;
  for (const insn of decoded) {
    if (patchLength >= JMP_PATCH_SIZE) break;
    stolen.push(insn);
    patchLength += insn.size;
  }
  if (patchLength < JMP_PATCH_SIZE) {
    throw new TrampolineSpaceError(targetAddr, patchLength);
  }
  // A branch/call inside the stolen region would need its *own* target
  // relocated too (relative displacement changes when moved); rather than
  // attempt that, fail loudly -- this matches real MinHook's behavior of
  // refusing to hook functions whose prologue itself branches.
  for (const insn of stolen) {
    if (insn.isBranch) {
      throw new TrampolineRelocationError(
        `a branch/call instruction ('${insn.mnemonic} ${insn.op_str}') falls within the first ${patchLength} bytes`,
      );
    }
  }

  // Route through a plain number array: a Buffer backed by a read()
  // (ReadProcessMemory) result retains a native-memory association that makes
  // a later write() of the same bytes silently no-op -- so a bare
  // Buffer.from(subarray) here would make disable()'s restore fail on
  // cross-process accessors. (Same de-taint nhook's create() needs.)
  const originalBytes = Buffer.from(
    Array.from(prologue.subarray(0, patchLength)),
  );
  const trampolineSize = patchLength + JMP_PATCH_SIZE;
  const trampolineAddrLike = await memory.allocNear(targetAddr, trampolineSize);
  const trampolineAddr = BigInt(resolveAddress(trampolineAddrLike));

  const code = Buffer.alloc(trampolineSize);
  let writeOffset = 0;
  for (const insn of stolen) {
    // Route through a plain array copy rather than reusing `insn.bytes`'s own
    // backing storage -- keeps this buffer fully independent of whatever
    // capstone/bun:ffi internals produced it.
    const bytes = Buffer.from(Array.from(insn.bytes));
    const mem = findRipRelativeMemOperand(insn);
    if (mem) {
      const detail = insn.detail as X86Detail;
      const { disp_offset: dispOffset, disp_size: dispSize } =
        detail.x86.encoding;
      if (dispSize !== 4) {
        throw new TrampolineRelocationError(
          `RIP-relative '${insn.mnemonic} ${insn.op_str}' has an unexpected ${dispSize}-byte displacement (expected 4)`,
        );
      }
      const originalTarget =
        insn.address + BigInt(insn.size) + BigInt(mem.disp);
      const newInsnAddr = trampolineAddr + BigInt(writeOffset);
      const newDisp = originalTarget - (newInsnAddr + BigInt(insn.size));
      if (newDisp < -0x80000000n || newDisp > 0x7fffffffn) {
        throw new TrampolineRelocationError(
          `recomputed displacement for '${insn.mnemonic} ${insn.op_str}' does not fit in 32 bits after relocation`,
        );
      }
      bytes.writeInt32LE(Number(newDisp), dispOffset);
    }
    bytes.copy(code, writeOffset);
    writeOffset += insn.size;
  }

  // jmp rel32 back to the first untouched instruction after the patch.
  const jmpInsnAddr = trampolineAddr + BigInt(writeOffset);
  const jmpTarget = targetAddr + BigInt(patchLength);
  const jmpDisp = jmpTarget - (jmpInsnAddr + BigInt(JMP_PATCH_SIZE));
  if (jmpDisp < -0x80000000n || jmpDisp > 0x7fffffffn) {
    // allocNear searches within +/-2GB specifically so this can't happen;
    // this is a sanity check, not an expected runtime path.
    throw new TrampolineRelocationError(
      'allocNear returned a trampoline address too far for a rel32 jmp-back',
    );
  }
  code.writeUInt8(0xe9, writeOffset);
  code.writeInt32LE(Number(jmpDisp), writeOffset + 1);

  await memory.write(trampolineAddr, code);

  return {
    address: trampolineAddr,
    size: trampolineSize,
    stolenInstructions: stolen,
    patchLength,
    originalBytes,
  };
}
