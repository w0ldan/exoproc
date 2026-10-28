import { X64Encoder } from './encoding.js';

export interface X64Label {
  readonly name: string;
  readonly assemblerId: symbol;
}

type RelativeFixup = {
  readonly displacementOffset: number;
  readonly displacementSize: 1 | 4;
  readonly label: X64Label;
};

export class X64LabelManager {
  private readonly assemblerId = Symbol('X64Assembler');
  private readonly labels = new Map<X64Label, number>();
  private readonly labelNames = new Set<string>();
  private readonly relativeFixups: RelativeFixup[] = [];

  public create(name: string): X64Label {
    if (this.labelNames.has(name)) {
      throw new Error(`Duplicate x64 label: ${name}`);
    }
    this.labelNames.add(name);
    return Object.freeze({ name, assemblerId: this.assemblerId });
  }

  public bind(label: X64Label, offset: number): void {
    this.assertOwn(label);
    if (this.labels.has(label)) {
      throw new Error(`x64 label is already bound: ${label.name}`);
    }
    this.labels.set(label, offset);
  }

  public addRelativeFixup(
    label: X64Label,
    displacementOffset: number,
    displacementSize: 1 | 4,
  ): void {
    this.assertOwn(label);
    this.relativeFixups.push({
      displacementOffset,
      displacementSize,
      label,
    });
  }

  public assertOwn(label: X64Label): void {
    if (label.assemblerId !== this.assemblerId) {
      throw new Error(
        `x64 label "${label.name}" belongs to a different assembler`,
      );
    }
  }

  public applyFixups(encoder: X64Encoder): void {
    for (const fixup of this.relativeFixups) {
      const target = this.labels.get(fixup.label);
      if (target === undefined) {
        throw new Error(`Missing x64 label: ${fixup.label.name}`);
      }
      const next = fixup.displacementOffset + fixup.displacementSize;
      const displacement = target - next;
      if (fixup.displacementSize === 1) {
        if (displacement < -128 || displacement > 127) {
          throw new Error(
            `x64 rel8 jump to ${fixup.label.name} is out of range`,
          );
        }
        encoder.patchByte(fixup.displacementOffset, displacement);
      } else {
        if (displacement < -0x80000000 || displacement > 0x7fffffff) {
          throw new Error(
            `x64 rel32 jump to ${fixup.label.name} is out of range`,
          );
        }
        encoder.patchDword(fixup.displacementOffset, displacement);
      }
    }
  }
}
