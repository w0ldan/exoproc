import { X64Encoder } from '../encoding.js';
import { X64LabelManager, type X64Label } from '../labels.js';
import { REGISTER_INFO, type X64Register64 } from '../registers.js';

export function emitCall(
  encoder: X64Encoder,
  labels: X64LabelManager,
  target: X64Label,
): void {
  labels.assertOwn(target);
  encoder.write(0xe8, 0, 0, 0, 0);
  labels.addRelativeFixup(target, encoder.length - 4, 4);
}

export function emitCallExternal<Target>(
  encoder: X64Encoder,
  target: Target,
  emitRipRelative32: (target: Target) => number,
): void {
  encoder.write(0xff, 0x15);
  emitRipRelative32(target);
}

export function emitCallRegister(
  encoder: X64Encoder,
  registerName: X64Register64,
): void {
  const register = REGISTER_INFO[registerName];
  encoder.emitRex(false, undefined, register.code);
  encoder.write(0xff, 0xc0 | (2 << 3) | (register.code & 7));
}

export function emitJmp(
  encoder: X64Encoder,
  labels: X64LabelManager,
  label: X64Label,
): void {
  labels.assertOwn(label);
  encoder.write(0xe9, 0, 0, 0, 0);
  labels.addRelativeFixup(label, encoder.length - 4, 4);
}

export function emitJmpRegister(
  encoder: X64Encoder,
  registerName: X64Register64,
): void {
  const register = REGISTER_INFO[registerName];
  encoder.emitRex(false, undefined, register.code);
  encoder.write(0xff, 0xc0 | (4 << 3) | (register.code & 7));
}

export function emitJmpShort(
  encoder: X64Encoder,
  labels: X64LabelManager,
  label: X64Label,
): void {
  emitRelativeJump(encoder, labels, 0xeb, label);
}

export function emitJe(
  encoder: X64Encoder,
  labels: X64LabelManager,
  label: X64Label,
): void {
  emitConditionalJump(encoder, labels, 0x84, label);
}

export function emitJeShort(
  encoder: X64Encoder,
  labels: X64LabelManager,
  label: X64Label,
): void {
  emitRelativeJump(encoder, labels, 0x74, label);
}

export function emitJne(
  encoder: X64Encoder,
  labels: X64LabelManager,
  label: X64Label,
): void {
  emitConditionalJump(encoder, labels, 0x85, label);
}

export function emitJneShort(
  encoder: X64Encoder,
  labels: X64LabelManager,
  label: X64Label,
): void {
  emitRelativeJump(encoder, labels, 0x75, label);
}

export function emitJb(
  encoder: X64Encoder,
  labels: X64LabelManager,
  label: X64Label,
): void {
  emitConditionalJump(encoder, labels, 0x82, label);
}

export function emitJbe(
  encoder: X64Encoder,
  labels: X64LabelManager,
  label: X64Label,
): void {
  emitConditionalJump(encoder, labels, 0x86, label);
}

export function emitJa(
  encoder: X64Encoder,
  labels: X64LabelManager,
  label: X64Label,
): void {
  emitConditionalJump(encoder, labels, 0x87, label);
}

export function emitJae(
  encoder: X64Encoder,
  labels: X64LabelManager,
  label: X64Label,
): void {
  emitConditionalJump(encoder, labels, 0x83, label);
}

export function emitRet(encoder: X64Encoder): void {
  encoder.write(0xc3);
}

export function emitSyscall(encoder: X64Encoder): void {
  encoder.write(0x0f, 0x05);
}

function emitConditionalJump(
  encoder: X64Encoder,
  labels: X64LabelManager,
  opcode: 0x82 | 0x83 | 0x84 | 0x85 | 0x86 | 0x87,
  label: X64Label,
): void {
  labels.assertOwn(label);
  encoder.write(0x0f, opcode, 0, 0, 0, 0);
  labels.addRelativeFixup(label, encoder.length - 4, 4);
}

function emitRelativeJump(
  encoder: X64Encoder,
  labels: X64LabelManager,
  opcode: 0x74 | 0x75 | 0xeb,
  label: X64Label,
): void {
  labels.assertOwn(label);
  encoder.write(opcode, 0);
  labels.addRelativeFixup(label, encoder.length - 1, 1);
}
