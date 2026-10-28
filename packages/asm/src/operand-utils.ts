import type { X64MemoryOperand } from './operands.js';
import { isRegister, REGISTER_INFO, type X64Register } from './registers.js';

export type X64AnyMemoryOperand =
  | X64MemoryOperand
  | import('./operands.js').X64ByteMemoryOperand
  | import('./operands.js').X64WordMemoryOperand;

export function isMemory(value: unknown): value is X64AnyMemoryOperand {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'memory'
  );
}

export function operandWidth(operand: X64Register | X64MemoryOperand): 32 | 64 {
  return isRegister(operand) ? REGISTER_INFO[operand].width : operand.width;
}

export function assertSameWidth(
  destination: X64Register | X64MemoryOperand,
  source: X64Register | X64MemoryOperand,
): 32 | 64 {
  const destinationWidth = operandWidth(destination);
  const sourceWidth = operandWidth(source);
  if (destinationWidth !== sourceWidth) {
    throw new Error(
      `x64 operand width mismatch: ${destinationWidth} and ${sourceWidth}`,
    );
  }
  return destinationWidth;
}
