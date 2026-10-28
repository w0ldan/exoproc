import {
  assertSignExtendedDword,
  encodeDword,
  X64Encoder,
} from '../encoding.js';
import { assertSameWidth, operandWidth } from '../operand-utils.js';
import type { X64Immediate, X64MemoryOperand } from '../operands.js';
import { isRegister, REGISTER_INFO, type X64Register } from '../registers.js';

type BinaryDestination = X64Register | X64MemoryOperand;
type BinarySource = X64Register | X64Immediate;

export function emitAdd(
  encoder: X64Encoder,
  destination: BinaryDestination,
  source: BinarySource,
): void {
  emitBinary(encoder, 0x01, 0, destination, source);
}

export function emitSub(
  encoder: X64Encoder,
  destination: BinaryDestination,
  source: BinarySource,
): void {
  emitBinary(encoder, 0x29, 5, destination, source);
}

export function emitCmp(
  encoder: X64Encoder,
  destination: BinaryDestination,
  source: BinarySource,
): void {
  emitBinary(encoder, 0x39, 7, destination, source);
}

export function emitAnd(
  encoder: X64Encoder,
  destination: BinaryDestination,
  source: BinarySource,
): void {
  emitBinary(encoder, 0x21, 4, destination, source);
}

export function emitOr(
  encoder: X64Encoder,
  destination: BinaryDestination,
  source: X64Register,
): void {
  emitRegisterBinary(encoder, 0x09, destination, source);
}

export function emitXor(
  encoder: X64Encoder,
  destination: BinaryDestination,
  source: X64Register,
): void {
  emitRegisterBinary(encoder, 0x31, destination, source);
}

export function emitTest(
  encoder: X64Encoder,
  destination: BinaryDestination,
  source: X64Register,
): void {
  emitRegisterBinary(encoder, 0x85, destination, source);
}

export function emitNeg(
  encoder: X64Encoder,
  destination: BinaryDestination,
): void {
  encoder.emitModRM(0xf7, operandWidth(destination), 3, destination);
}

export function emitMul(encoder: X64Encoder, source: BinaryDestination): void {
  encoder.emitModRM(0xf7, operandWidth(source), 4, source);
}

export function emitDiv(encoder: X64Encoder, source: BinaryDestination): void {
  encoder.emitModRM(0xf7, operandWidth(source), 6, source);
}

export function emitShl(
  encoder: X64Encoder,
  destination: BinaryDestination,
  amount: number,
): void {
  if (!Number.isInteger(amount) || amount < 0 || amount > 0xff) {
    throw new RangeError(
      `x64 shift amount must fit an unsigned byte: ${amount}`,
    );
  }
  encoder.emitModRM(0xc1, operandWidth(destination), 4, destination);
  encoder.write(amount);
}

export function emitInc(
  encoder: X64Encoder,
  destination: BinaryDestination,
): void {
  encoder.emitModRM(0xff, operandWidth(destination), 0, destination);
}

function emitBinary(
  encoder: X64Encoder,
  registerOpcode: number,
  immediateExtension: number,
  destination: BinaryDestination,
  source: BinarySource,
): void {
  if (isRegister(source)) {
    emitRegisterBinary(encoder, registerOpcode, destination, source);
    return;
  }
  const width = operandWidth(destination);
  assertSignExtendedDword(source, width);
  const immediate = BigInt(source);
  const useByte = immediate >= -128n && immediate <= 127n;
  encoder.emitModRM(
    useByte ? 0x83 : 0x81,
    width,
    immediateExtension,
    destination,
  );
  encoder.write(
    ...(useByte ? [Number(immediate & 0xffn)] : encodeDword(immediate)),
  );
}

function emitRegisterBinary(
  encoder: X64Encoder,
  opcode: number,
  destination: BinaryDestination,
  source: X64Register,
): void {
  const width = assertSameWidth(destination, source);
  encoder.emitModRM(opcode, width, REGISTER_INFO[source].code, destination);
}
