import type { X64AnyMemoryOperand } from './operand-utils.js';
import type { X64Immediate } from './operands.js';
import { isRegister, REGISTER_INFO, type X64Register } from './registers.js';

export function encodeDword(value: X64Immediate): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(
    0,
    Number(BigInt.asUintN(32, BigInt(value))),
    true,
  );
  return [...bytes];
}

export function encodeQword(value: bigint): number[] {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt.asUintN(64, value), true);
  return [...bytes];
}

export function assertSignExtendedDword(
  value: X64Immediate,
  width: 32 | 64,
): void {
  if (width !== 64) return;

  const immediate = BigInt(value);
  const expected = BigInt.asUintN(64, immediate);
  const encoded = BigInt.asUintN(64, BigInt.asIntN(32, immediate));
  if (encoded !== expected) {
    throw new RangeError(
      `x64 immediate ${immediate} is not representable as a sign-extended 32-bit value`,
    );
  }
}

export class X64Encoder {
  private readonly bytes: number[] = [];

  public get length(): number {
    return this.bytes.length;
  }

  public write(...bytes: number[]): void {
    this.bytes.push(...bytes);
  }

  public reserve(byteLength: number): number {
    const offset = this.length;
    this.write(...new Array<number>(byteLength).fill(0));
    return offset;
  }

  public patchByte(offset: number, value: number): void {
    this.bytes[offset] = value & 0xff;
  }

  public patchDword(offset: number, value: number): void {
    const encoded = value >>> 0;
    for (let index = 0; index < 4; index += 1) {
      this.bytes[offset + index] = (encoded >>> (index * 8)) & 0xff;
    }
  }

  public finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  public emitRex(
    width64: boolean,
    registerField?: number,
    rmCode?: number,
    indexCode?: number,
    force = false,
  ): void {
    const rex =
      0x40 |
      (width64 ? 0x08 : 0) |
      ((registerField ?? 0) >= 8 ? 0x04 : 0) |
      ((indexCode ?? 0) >= 8 ? 0x02 : 0) |
      ((rmCode ?? 0) >= 8 ? 0x01 : 0);
    if (force || rex !== 0x40) {
      this.write(rex);
    }
  }

  public emitModRM(
    opcode: number | readonly number[],
    width: 32 | 64,
    registerField: number,
    rm: X64Register | X64AnyMemoryOperand,
    legacyPrefixes?: readonly number[],
    forceRex = false,
  ): void {
    const rmCode = isRegister(rm)
      ? REGISTER_INFO[rm].code
      : REGISTER_INFO[rm.base].code;
    const indexCode = isRegister(rm)
      ? undefined
      : rm.index === undefined
        ? undefined
        : REGISTER_INFO[rm.index].code;

    if (legacyPrefixes !== undefined) this.write(...legacyPrefixes);
    this.emitRex(width === 64, registerField, rmCode, indexCode, forceRex);
    this.write(...(typeof opcode === 'number' ? [opcode] : opcode));

    if (isRegister(rm)) {
      this.write(0xc0 | ((registerField & 7) << 3) | (rmCode & 7));
      return;
    }

    if (rm.index === 'rsp') {
      throw new Error('rsp cannot be used as an x64 memory index register');
    }

    const base = rmCode & 7;
    const displacement = rm.displacement;
    const requiresDisplacement = base === 5 && displacement === 0;
    const mod =
      displacement === 0 && !requiresDisplacement
        ? 0
        : displacement >= -128 && displacement <= 127
          ? 1
          : 2;
    const usesSib = indexCode !== undefined || base === 4;
    this.write((mod << 6) | ((registerField & 7) << 3) | (usesSib ? 4 : base));

    if (usesSib) {
      const scaleBits =
        rm.scale === 8 ? 3 : rm.scale === 4 ? 2 : rm.scale === 2 ? 1 : 0;
      const encodedIndex = indexCode === undefined ? 4 : indexCode & 7;
      this.write((scaleBits << 6) | (encodedIndex << 3) | base);
    }

    if (mod === 1) {
      this.write(displacement & 0xff);
    } else if (mod === 2) {
      this.write(...encodeDword(displacement));
    }
  }
}
