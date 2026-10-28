import { describe, expect, test } from 'bun:test';
import { X64Assembler, qword } from 'exoproc-asm';

function bytes(assembler: X64Assembler): number[] {
  return [...assembler.finish()];
}

describe('X64Assembler', () => {
  test('preserves base plus displacement addressing', () => {
    const assembler = new X64Assembler();
    assembler.mov('rax', qword('rbp'));

    expect(bytes(assembler)).toEqual([0x48, 0x8b, 0x45, 0x00]);
  });

  test('encodes extended base, index, scale, and displacement', () => {
    const assembler = new X64Assembler();
    assembler.mov(
      'r10',
      qword({ base: 'r12', index: 'r9', scale: 8, displacement: -16 }),
    );

    expect(bytes(assembler)).toEqual([0x4f, 0x8b, 0x54, 0xcc, 0xf0]);
  });

  test('moves raw qwords between extended GPR and XMM registers', () => {
    const assembler = new X64Assembler();
    assembler.movq('xmm8', 'r9');
    assembler.movq('r10', 'xmm15');

    expect(bytes(assembler)).toEqual([
      0x66, 0x4d, 0x0f, 0x6e, 0xc1, 0x66, 0x4d, 0x0f, 0x7e, 0xfa,
    ]);
  });

  test('moves an XMM qword through indexed memory', () => {
    const assembler = new X64Assembler();
    assembler.movq(qword('r13', 'r14', 4, 0x20), 'xmm12');

    expect(bytes(assembler)).toEqual([
      0x66, 0x4f, 0x0f, 0x7e, 0x64, 0xb5, 0x20,
    ]);
  });

  test('encodes arithmetic forms used by generated thunks', () => {
    const assembler = new X64Assembler();
    assembler.and('rcx', 1);
    assembler.shl('r9', 3);
    assembler.inc('rdx');

    expect(bytes(assembler)).toEqual([
      0x48, 0x83, 0xe1, 0x01, 0x49, 0xc1, 0xe1, 0x03, 0x48, 0xff, 0xc2,
    ]);
  });

  test('preserves valid 64-bit immediate semantics', () => {
    const assembler = new X64Assembler();
    assembler.mov('rax', 0xffffffffn);
    assembler.mov(qword('rbx'), -0x80000000n);
    assembler.and('rcx', 0xffffffffffffffffn);

    expect(bytes(assembler)).toEqual([
      0x48, 0xb8, 0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x48, 0xc7,
      0x03, 0x00, 0x00, 0x00, 0x80, 0x48, 0x81, 0xe1, 0xff, 0xff, 0xff, 0xff,
    ]);
  });

  test('rejects 64-bit immediates that imm32 would change', () => {
    const move = new X64Assembler();
    const binary = new X64Assembler();

    expect(() => move.mov(qword('rax'), 0xffffffffn)).toThrow(RangeError);
    expect(() => binary.and('rax', 0xffffffffn)).toThrow(RangeError);
    expect(bytes(move)).toEqual([]);
    expect(bytes(binary)).toEqual([]);
  });

  test('encodes indirect register jumps', () => {
    const assembler = new X64Assembler();
    assembler.jmpRegister('r11');

    expect(bytes(assembler)).toEqual([0x41, 0xff, 0xe3]);
  });

  test('resolves local label fixups', () => {
    const assembler = new X64Assembler();
    const done = assembler.createLabel('done');
    assembler.jmpShort(done);
    assembler.ret();
    assembler.bind(done);
    assembler.ret();

    expect(bytes(assembler)).toEqual([0xeb, 0x01, 0xc3, 0xc3]);
  });

  test('records generic absolute and RIP-relative relocations', () => {
    type Target = { readonly symbol: string };
    const assembler = new X64Assembler<Target>();
    const address = { symbol: 'address' };
    const callable = { symbol: 'callable' };

    assembler.movAddress('rax', address);
    assembler.callExternal(callable);

    expect(bytes(assembler)).toEqual([
      0x48, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0x15, 0, 0, 0, 0,
    ]);
    expect(assembler.externalRelocations).toEqual([
      { offset: 2, encoding: 'absolute64', target: address },
      { offset: 12, encoding: 'rip-relative32', target: callable },
    ]);
  });
});
