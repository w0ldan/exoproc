import {
  assertSignExtendedDword,
  encodeDword,
  encodeQword,
  X64Encoder,
} from '../encoding.js';
import { assertSameWidth, isMemory, operandWidth } from '../operand-utils.js';
import type {
  X64ByteMemoryOperand,
  X64Immediate,
  X64MemoryOperand,
  X64WordMemoryOperand,
} from '../operands.js';
import {
  isRegister,
  isXmmRegister,
  REGISTER_INFO,
  XMM_REGISTER_INFO,
  type X64Register,
  type X64Register32,
  type X64Register64,
  type X64XmmRegister,
} from '../registers.js';

export function emitMov(
  encoder: X64Encoder,
  destination: X64Register | X64MemoryOperand,
  source: X64Register | X64MemoryOperand | X64Immediate,
): void {
  if (typeof source === 'number' || typeof source === 'bigint') {
    emitMovImmediate(encoder, destination, source);
    return;
  }
  if (isMemory(destination) && isMemory(source)) {
    throw new Error('x64 mov does not support memory-to-memory operands');
  }

  const width = assertSameWidth(destination, source);
  if (isRegister(destination)) {
    encoder.emitModRM(0x8b, width, REGISTER_INFO[destination].code, source);
    return;
  }
  if (!isRegister(source)) {
    throw new Error('x64 mov source must be a register');
  }
  encoder.emitModRM(0x89, width, REGISTER_INFO[source].code, destination);
}

export function emitMovzx(
  encoder: X64Encoder,
  destination: X64Register32,
  source: X64ByteMemoryOperand,
): void {
  encoder.emitModRM([0x0f, 0xb6], 32, REGISTER_INFO[destination].code, source);
}

export function emitMovzxWord(
  encoder: X64Encoder,
  destination: X64Register32,
  source: X64WordMemoryOperand,
): void {
  encoder.emitModRM([0x0f, 0xb7], 32, REGISTER_INFO[destination].code, source);
}

export function emitMovByteToMemory(
  encoder: X64Encoder,
  destination: X64ByteMemoryOperand,
  source: X64Register64,
): void {
  encoder.emitModRM(
    0x88,
    32,
    REGISTER_INFO[source].code,
    destination,
    undefined,
    REGISTER_INFO[source].code >= 4,
  );
}

export function emitMovq(
  encoder: X64Encoder,
  destination: X64XmmRegister | X64Register64 | X64MemoryOperand,
  source: X64XmmRegister | X64Register64 | X64MemoryOperand,
): void {
  if (isXmmRegister(destination)) {
    if (isXmmRegister(source) || operandWidth(source) !== 64) {
      throw new Error('x64 movq source must be a 64-bit GPR or memory operand');
    }
    encoder.emitModRM(
      [0x0f, 0x6e],
      64,
      XMM_REGISTER_INFO[destination],
      source,
      [0x66],
    );
    return;
  }

  if (!isXmmRegister(source) || operandWidth(destination) !== 64) {
    throw new Error(
      'x64 movq destination must be a 64-bit GPR or memory operand',
    );
  }
  encoder.emitModRM(
    [0x0f, 0x7e],
    64,
    XMM_REGISTER_INFO[source],
    destination,
    [0x66],
  );
}

export function emitLea(
  encoder: X64Encoder,
  destination: X64Register64,
  source: X64MemoryOperand,
): void {
  encoder.emitModRM(0x8d, 64, REGISTER_INFO[destination].code, source);
}

export function emitMovAddress<Target>(
  encoder: X64Encoder,
  destination: X64Register64,
  target: Target,
  emitAbsolute64: (target: Target) => number,
): void {
  const register = REGISTER_INFO[destination];
  encoder.emitRex(true, undefined, register.code);
  encoder.write(0xb8 + (register.code & 7));
  emitAbsolute64(target);
}

function emitMovImmediate(
  encoder: X64Encoder,
  destination: X64Register | X64MemoryOperand,
  value: X64Immediate,
): void {
  const width = operandWidth(destination);
  if (isRegister(destination)) {
    const register = REGISTER_INFO[destination];
    encoder.emitRex(width === 64, undefined, register.code);
    encoder.write(0xb8 + (register.code & 7));
    encoder.write(
      ...(width === 64 ? encodeQword(BigInt(value)) : encodeDword(value)),
    );
    return;
  }
  assertSignExtendedDword(value, width);
  encoder.emitModRM(0xc7, width, 0, destination);
  encoder.write(...encodeDword(value));
}
