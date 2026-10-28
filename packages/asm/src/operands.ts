import type { X64Register64 } from './registers.js';

export type X64Immediate = number | bigint;
export type X64Scale = 1 | 2 | 4 | 8;

export interface X64MemoryAddress {
  readonly base: X64Register64;
  readonly index?: X64Register64;
  readonly scale?: X64Scale;
  readonly displacement?: number;
}

interface X64MemoryOperandBase {
  readonly kind: 'memory';
  readonly base: X64Register64;
  readonly index?: X64Register64;
  readonly scale?: X64Scale;
  readonly displacement: number;
}

export interface X64MemoryOperand extends X64MemoryOperandBase {
  readonly width: 32 | 64;
}

export interface X64ByteMemoryOperand extends X64MemoryOperandBase {
  readonly width: 8;
}

export interface X64WordMemoryOperand extends X64MemoryOperandBase {
  readonly width: 16;
}

function createMemoryOperand<Width extends 8 | 16 | 32 | 64>(
  width: Width,
  baseOrAddress: X64Register64 | X64MemoryAddress,
  displacementOrIndex: number | X64Register64 = 0,
  scale: X64Scale = 1,
  displacement = 0,
): X64MemoryOperandBase & { readonly width: Width } {
  let address: X64MemoryAddress;
  if (typeof baseOrAddress === 'object') {
    address = baseOrAddress;
  } else if (typeof displacementOrIndex === 'string') {
    address = {
      base: baseOrAddress,
      index: displacementOrIndex,
      scale,
      displacement,
    };
  } else {
    address = { base: baseOrAddress, displacement: displacementOrIndex };
  }

  if (address.scale !== undefined && address.index === undefined) {
    throw new Error('x64 memory scale requires an index register');
  }
  if (address.index === 'rsp') {
    throw new Error('rsp cannot be used as an x64 memory index register');
  }

  return {
    kind: 'memory',
    width,
    base: address.base,
    displacement: address.displacement ?? 0,
    ...(address.index === undefined
      ? {}
      : { index: address.index, scale: address.scale ?? 1 }),
  };
}

export function byte(
  base: X64Register64,
  displacement?: number,
): X64ByteMemoryOperand;
export function byte(address: X64MemoryAddress): X64ByteMemoryOperand;
export function byte(
  base: X64Register64,
  index: X64Register64,
  scale?: X64Scale,
  displacement?: number,
): X64ByteMemoryOperand;
export function byte(
  baseOrAddress: X64Register64 | X64MemoryAddress,
  displacementOrIndex: number | X64Register64 = 0,
  scale: X64Scale = 1,
  displacement = 0,
): X64ByteMemoryOperand {
  return createMemoryOperand(
    8,
    baseOrAddress,
    displacementOrIndex,
    scale,
    displacement,
  );
}

export function word(
  base: X64Register64,
  displacement?: number,
): X64WordMemoryOperand;
export function word(address: X64MemoryAddress): X64WordMemoryOperand;
export function word(
  base: X64Register64,
  index: X64Register64,
  scale?: X64Scale,
  displacement?: number,
): X64WordMemoryOperand;
export function word(
  baseOrAddress: X64Register64 | X64MemoryAddress,
  displacementOrIndex: number | X64Register64 = 0,
  scale: X64Scale = 1,
  displacement = 0,
): X64WordMemoryOperand {
  return createMemoryOperand(
    16,
    baseOrAddress,
    displacementOrIndex,
    scale,
    displacement,
  );
}

export function dword(
  base: X64Register64,
  displacement?: number,
): X64MemoryOperand;
export function dword(address: X64MemoryAddress): X64MemoryOperand;
export function dword(
  base: X64Register64,
  index: X64Register64,
  scale?: X64Scale,
  displacement?: number,
): X64MemoryOperand;
export function dword(
  baseOrAddress: X64Register64 | X64MemoryAddress,
  displacementOrIndex: number | X64Register64 = 0,
  scale: X64Scale = 1,
  displacement = 0,
): X64MemoryOperand {
  return createMemoryOperand(
    32,
    baseOrAddress,
    displacementOrIndex,
    scale,
    displacement,
  );
}

export function qword(
  base: X64Register64,
  displacement?: number,
): X64MemoryOperand;
export function qword(address: X64MemoryAddress): X64MemoryOperand;
export function qword(
  base: X64Register64,
  index: X64Register64,
  scale?: X64Scale,
  displacement?: number,
): X64MemoryOperand;
export function qword(
  baseOrAddress: X64Register64 | X64MemoryAddress,
  displacementOrIndex: number | X64Register64 = 0,
  scale: X64Scale = 1,
  displacement = 0,
): X64MemoryOperand {
  return createMemoryOperand(
    64,
    baseOrAddress,
    displacementOrIndex,
    scale,
    displacement,
  );
}
