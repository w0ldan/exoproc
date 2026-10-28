import { X64Encoder } from './encoding.js';
import {
  emitAdd,
  emitAnd,
  emitCmp,
  emitDiv,
  emitInc,
  emitMul,
  emitNeg,
  emitOr,
  emitShl,
  emitSub,
  emitTest,
  emitXor,
} from './instructions/arithmetic.js';
import {
  emitCall,
  emitCallExternal,
  emitCallRegister,
  emitJa,
  emitJae,
  emitJb,
  emitJbe,
  emitJe,
  emitJeShort,
  emitJmp,
  emitJmpRegister,
  emitJmpShort,
  emitJne,
  emitJneShort,
  emitRet,
  emitSyscall,
} from './instructions/control-flow.js';
import {
  emitLea,
  emitMov,
  emitMovAddress,
  emitMovByteToMemory,
  emitMovq,
  emitMovzx,
  emitMovzxWord,
} from './instructions/data-movement.js';
import { emitPop, emitPush } from './instructions/stack.js';
import { X64LabelManager, type X64Label } from './labels.js';
import type {
  X64ByteMemoryOperand,
  X64Immediate,
  X64MemoryOperand,
  X64WordMemoryOperand,
} from './operands.js';
import type {
  X64Register,
  X64Register32,
  X64Register64,
  X64XmmRegister,
} from './registers.js';
import type {
  X64ExternalRelocation,
  X64ExternalRelocationEncoding,
} from './relocations.js';

/** Typed assembler for a focused, reusable subset of the x64 instruction set. */
export class X64Assembler<ExternalTarget = unknown> {
  private readonly encoder = new X64Encoder();
  private readonly labels = new X64LabelManager();

  public readonly externalRelocations: X64ExternalRelocation<ExternalTarget>[] =
    [];

  public mov(
    destination: X64Register | X64MemoryOperand,
    source: X64Register | X64MemoryOperand | X64Immediate,
  ): void {
    emitMov(this.encoder, destination, source);
  }

  public movzx(destination: X64Register32, source: X64ByteMemoryOperand): void {
    emitMovzx(this.encoder, destination, source);
  }

  public movzxWord(
    destination: X64Register32,
    source: X64WordMemoryOperand,
  ): void {
    emitMovzxWord(this.encoder, destination, source);
  }

  public movByteToMemory(
    destination: X64ByteMemoryOperand,
    source: X64Register64,
  ): void {
    emitMovByteToMemory(this.encoder, destination, source);
  }

  public movq(
    destination: X64XmmRegister,
    source: X64Register64 | X64MemoryOperand,
  ): void;
  public movq(
    destination: X64Register64 | X64MemoryOperand,
    source: X64XmmRegister,
  ): void;
  public movq(
    destination: X64XmmRegister | X64Register64 | X64MemoryOperand,
    source: X64XmmRegister | X64Register64 | X64MemoryOperand,
  ): void {
    emitMovq(this.encoder, destination, source);
  }

  public lea(destination: X64Register64, source: X64MemoryOperand): void {
    emitLea(this.encoder, destination, source);
  }

  public movAddress(destination: X64Register64, target: ExternalTarget): void {
    emitMovAddress(this.encoder, destination, target, (relocationTarget) =>
      this.emitAbsolute64(relocationTarget),
    );
  }

  public emitAbsolute64(target: ExternalTarget): number {
    return this.emitExternalRelocation('absolute64', target, 8);
  }

  public emitRipRelative32(target: ExternalTarget): number {
    return this.emitExternalRelocation('rip-relative32', target, 4);
  }

  public add(
    destination: X64Register | X64MemoryOperand,
    source: X64Register | X64Immediate,
  ): void {
    emitAdd(this.encoder, destination, source);
  }

  public sub(
    destination: X64Register | X64MemoryOperand,
    source: X64Register | X64Immediate,
  ): void {
    emitSub(this.encoder, destination, source);
  }

  public cmp(
    destination: X64Register | X64MemoryOperand,
    source: X64Register | X64Immediate,
  ): void {
    emitCmp(this.encoder, destination, source);
  }

  public and(
    destination: X64Register | X64MemoryOperand,
    source: X64Register | X64Immediate,
  ): void {
    emitAnd(this.encoder, destination, source);
  }

  public or(
    destination: X64Register | X64MemoryOperand,
    source: X64Register,
  ): void {
    emitOr(this.encoder, destination, source);
  }

  public xor(
    destination: X64Register | X64MemoryOperand,
    source: X64Register,
  ): void {
    emitXor(this.encoder, destination, source);
  }

  public test(
    destination: X64Register | X64MemoryOperand,
    source: X64Register,
  ): void {
    emitTest(this.encoder, destination, source);
  }

  public neg(destination: X64Register | X64MemoryOperand): void {
    emitNeg(this.encoder, destination);
  }

  public mul(source: X64Register | X64MemoryOperand): void {
    emitMul(this.encoder, source);
  }

  public div(source: X64Register | X64MemoryOperand): void {
    emitDiv(this.encoder, source);
  }

  public shl(
    destination: X64Register | X64MemoryOperand,
    amount: number,
  ): void {
    emitShl(this.encoder, destination, amount);
  }

  public inc(destination: X64Register | X64MemoryOperand): void {
    emitInc(this.encoder, destination);
  }

  public push(value: X64Register64 | number): void {
    emitPush(this.encoder, value);
  }

  public pop(destination: X64Register64): void {
    emitPop(this.encoder, destination);
  }

  public createLabel(name: string): X64Label {
    return this.labels.create(name);
  }

  public bind(label: X64Label): void {
    this.labels.bind(label, this.encoder.length);
  }

  public call(target: X64Label): void {
    emitCall(this.encoder, this.labels, target);
  }

  public callExternal(target: ExternalTarget): void {
    emitCallExternal(this.encoder, target, (relocationTarget) =>
      this.emitRipRelative32(relocationTarget),
    );
  }

  public callRegister(registerName: X64Register64): void {
    emitCallRegister(this.encoder, registerName);
  }

  public jmp(label: X64Label): void {
    emitJmp(this.encoder, this.labels, label);
  }

  public jmpRegister(registerName: X64Register64): void {
    emitJmpRegister(this.encoder, registerName);
  }

  public jmpShort(label: X64Label): void {
    emitJmpShort(this.encoder, this.labels, label);
  }

  public je(label: X64Label): void {
    emitJe(this.encoder, this.labels, label);
  }

  public jeShort(label: X64Label): void {
    emitJeShort(this.encoder, this.labels, label);
  }

  public jne(label: X64Label): void {
    emitJne(this.encoder, this.labels, label);
  }

  public jneShort(label: X64Label): void {
    emitJneShort(this.encoder, this.labels, label);
  }

  public jb(label: X64Label): void {
    emitJb(this.encoder, this.labels, label);
  }

  public jbe(label: X64Label): void {
    emitJbe(this.encoder, this.labels, label);
  }

  public ja(label: X64Label): void {
    emitJa(this.encoder, this.labels, label);
  }

  public jae(label: X64Label): void {
    emitJae(this.encoder, this.labels, label);
  }

  public ret(): void {
    emitRet(this.encoder);
  }

  public syscall(): void {
    emitSyscall(this.encoder);
  }

  public get length(): number {
    return this.encoder.length;
  }

  public finish(): Uint8Array {
    this.labels.applyFixups(this.encoder);
    return this.encoder.finish();
  }

  protected onExternalRelocation(
    relocation: X64ExternalRelocation<ExternalTarget>,
  ): void {
    this.externalRelocations.push(relocation);
  }

  private emitExternalRelocation(
    encoding: X64ExternalRelocationEncoding,
    target: ExternalTarget,
    byteLength: 4 | 8,
  ): number {
    const offset = this.encoder.reserve(byteLength);
    this.onExternalRelocation({ offset, encoding, target });
    return offset;
  }
}
