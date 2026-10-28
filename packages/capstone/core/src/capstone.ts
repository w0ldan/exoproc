import {
  cs_arch,
  cs_mode,
  cs_err,
  cs_opt_type,
  cs_opt_value,
} from 'bun-capstone-abi';
import type {
  UINT32,
  INT32,
  UINT64,
  csh,
  LPVOID,
  Detail,
} from 'bun-capstone-abi';
import { Instruction, type RawInstruction } from './instruction.js';
import { CapstoneImpl } from './def/index.js';
import * as bunffi from 'bun:ffi';
import type { Pointer } from 'bun:ffi';

export * from './struct/index.js';
export * from './def/index.js';

function closeHandle(handle: csh): void {
  const handlePtr = Buffer.alloc(8);
  handlePtr.writeBigUint64LE(BigInt(handle));
  CapstoneImpl.cs_close(handlePtr as unknown as LPVOID);
}

const registry = new FinalizationRegistry((handle: csh) => {
  closeHandle(handle);
});

export class Capstone<T extends Instruction = Instruction> {
  protected handle: csh = 0n;

  constructor(arch: cs_arch, mode: cs_mode) {
    const handlePtr = Buffer.alloc(8);
    const err = CapstoneImpl.cs_open(
      arch,
      mode,
      handlePtr as unknown as LPVOID,
    );
    if (Number(err) !== cs_err.OK) {
      throw new Error(
        `Failed to open Capstone handle: ${CapstoneImpl.cs_strerror(err) || err}`,
      );
    }
    this.handle = handlePtr.readBigUint64LE();
    registry.register(this, this.handle, this);
  }

  static version(): { major: number; minor: number } {
    const majorPtr = Buffer.alloc(4);
    const minorPtr = Buffer.alloc(4);
    CapstoneImpl.cs_version(
      majorPtr as unknown as LPVOID,
      minorPtr as unknown as LPVOID,
    );
    return {
      major: majorPtr.readInt32LE(),
      minor: minorPtr.readInt32LE(),
    };
  }

  static support(query: number): boolean {
    return CapstoneImpl.cs_support(query);
  }

  option(type: cs_opt_type, value: cs_opt_value | UINT64): void {
    const val = typeof value === 'bigint' ? value : BigInt(value);
    const err = CapstoneImpl.cs_option(this.handle, type, val);
    if (err !== cs_err.OK) {
      throw new Error(
        `Failed to set option: ${CapstoneImpl.cs_strerror(err) || err}`,
      );
    }
  }

  onDetail(): void {
    this.option(cs_opt_type.DETAIL, BigInt(cs_opt_value.ON));
  }

  offDetail(): void {
    this.option(cs_opt_type.DETAIL, BigInt(cs_opt_value.OFF));
  }

  errno(): INT32 {
    return CapstoneImpl.cs_errno(this.handle);
  }

  strerror(code: INT32): string {
    return CapstoneImpl.cs_strerror(code)?.toString() || 'Unknown error';
  }

  /**
   * Decodes a raw `cs_detail*` pointer into this class's `Detail` shape.
   * Must run synchronously during `disasm()`, before `cs_free()` releases
   * the underlying instruction array — `cs_detail` is allocated inline as
   * part of that array, not separately. The base implementation just
   * passes the pointer through; arch-specific subclasses (e.g.
   * `CapstoneX86`) override this to eagerly parse it into a plain object.
   */
  protected decodeDetail(detailPtr: bigint): Detail | bigint | undefined {
    return detailPtr || undefined;
  }

  disasm(code: Buffer, address: bigint, count: number = 0): T[] {
    const insnPtrPtr = Buffer.alloc(8);
    const resultCount = CapstoneImpl.cs_disasm(
      this.handle,
      code as unknown as LPVOID,
      code.length,
      BigInt(address),
      count,
      insnPtrPtr as unknown as LPVOID,
    );

    const resultCountBig = BigInt(resultCount);
    if (resultCountBig <= 0n) {
      return [];
    }

    const insnPtr = insnPtrPtr.readBigUint64LE();
    const countNum = Number(resultCountBig);

    // cs_insn size in x64 is 240 bytes
    // id: 4, (pad 4), address: 8, size: 2, bytes: 16, mnemonic: 32, op_str: 160, (pad 6), detail: 8
    const INSN_SIZE = 240;
    const results: T[] = [];

    const insnsBuf = Buffer.from(
      bunffi.toArrayBuffer(
        Number(insnPtr) as unknown as Pointer,
        0,
        countNum * INSN_SIZE,
      ),
    );

    for (let i = 0; i < countNum; i++) {
      const offset = i * INSN_SIZE;
      const insn: RawInstruction = {
        id: insnsBuf.readUInt32LE(offset),
        address: insnsBuf.readBigUint64LE(offset + 8),
        size: insnsBuf.readUInt16LE(offset + 16),
        bytes: Array.from(insnsBuf.subarray(offset + 18, offset + 18 + 16)),
        mnemonic: insnsBuf
          .subarray(offset + 34, offset + 34 + 32)
          .toString()
          .split('\0')[0],
        op_str: insnsBuf
          .subarray(offset + 66, offset + 66 + 160)
          .toString()
          .split('\0')[0],
        detail: this.decodeDetail(insnsBuf.readBigUint64LE(offset + 232)),
      };

      const res = insn;
      res.bytes = res.bytes.slice(0, res.size);

      results.push(res as T);
    }

    CapstoneImpl.cs_free(insnPtr, resultCount);
    return results;
  }

  regName(regId: UINT32): string {
    return CapstoneImpl.cs_reg_name(this.handle, regId)?.toString() || '';
  }

  insnName(insnId: UINT32): string {
    return CapstoneImpl.cs_insn_name(this.handle, insnId)?.toString() || '';
  }

  close(): void {
    if (this.handle !== 0n) {
      closeHandle(this.handle);
      this.handle = 0n;
      registry.unregister(this);
    }
  }

  // Architecture types
  static readonly X86 = cs_arch.X86;
  static readonly ARM = cs_arch.ARM;
  static readonly ARM64 = cs_arch.ARM64;
  static readonly MIPS = cs_arch.MIPS;
  static readonly PPC = cs_arch.PPC;
  static readonly SPARC = cs_arch.SPARC;
  static readonly SYSZ = cs_arch.SYSZ;
  static readonly XCORE = cs_arch.XCORE;
  static readonly M68K = cs_arch.M68K;
  static readonly TMS320C64X = cs_arch.TMS320C64X;
  static readonly M680X = cs_arch.M680X;
  static readonly EVM = cs_arch.EVM;
}
