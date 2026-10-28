import { describe, expect, test } from 'bun:test';
import {
  Capstone,
  CapstoneX86,
  x86_reg,
  x86_insn,
  x86_op_type,
} from 'bun-capstone';

describe('Capstone native binding', () => {
  test('cs_version() reports a sane libcapstone version', () => {
    const { major, minor } = Capstone.version();
    expect(major).toBeGreaterThanOrEqual(4);
    expect(minor).toBeGreaterThanOrEqual(0);
  });

  test('regName()/insnName() resolve IDs through the live handle', () => {
    const cs = new CapstoneX86();
    expect(cs.regName(x86_reg.RAX)).toBe('rax');
    expect(cs.regName(x86_reg.RIP)).toBe('rip');
    expect(cs.insnName(x86_insn.MOV)).toBe('mov');
    expect(cs.insnName(x86_insn.LEA)).toBe('lea');
  });
});

describe('CapstoneX86 disasm()', () => {
  const cs = new CapstoneX86();

  test('decodes mnemonic and op_str correctly (regression: cs_insn field offsets)', () => {
    // A wrong `bytes[]` field width in the cs_insn parser shifts every
    // later field (mnemonic, op_str) by the same number of bytes, so this
    // exercises the exact layout bug this refactor fixed.
    const cases: Array<[number[], string, string]> = [
      [[0x48, 0x89, 0xd8], 'mov', 'rax, rbx'],
      [[0x48, 0x83, 0xec, 0x28], 'sub', 'rsp, 0x28'],
      [[0x90], 'nop', ''],
      [[0xc3], 'ret', ''],
      [[0x50], 'push', 'rax'],
    ];

    for (const [bytes, mnemonic, op_str] of cases) {
      const [insn] = cs.disasm(Buffer.from(bytes), 0x1000n);
      expect(insn).toBeDefined();
      expect(insn!.mnemonic).toBe(mnemonic);
      expect(insn!.op_str).toBe(op_str);
      expect(insn!.size).toBe(bytes.length);
      expect(insn!.address).toBe(0x1000n);
    }
  });

  test('honors the `count` limit (used by nhook to steal the minimum prologue)', () => {
    // sub rsp, 0x28 ; mov rax, rbx ; ret  -- only ask for the first 2.
    const bytes = [0x48, 0x83, 0xec, 0x28, 0x48, 0x89, 0xd8, 0xc3];
    const insns = cs.disasm(Buffer.from(bytes), 0x1000n, 2);
    expect(insns).toHaveLength(2);
    expect(insns[0]!.mnemonic).toBe('sub');
    expect(insns[1]!.mnemonic).toBe('mov');
  });

  test('decodes register/register operands in detail', () => {
    const [insn] = cs.disasm(Buffer.from([0x48, 0x89, 0xd8]), 0x1000n); // mov rax, rbx
    const detail = insn!.detail!;
    expect(detail).toBeDefined();
    expect(detail.x86.op_count).toBe(2);

    const [dst, src] = detail.x86.operands;
    expect(dst!.type).toBe(x86_op_type.REG);
    expect(dst!.reg).toBe(x86_reg.RAX);
    expect(src!.type).toBe(x86_op_type.REG);
    expect(src!.reg).toBe(x86_reg.RBX);

    // regs_read/regs_write list only *implicit* accesses beyond the explicit
    // operands above, per Capstone's docs -- a plain reg/reg mov has none.
    expect(insn!.regsWrite).toEqual([]);
    expect(insn!.regsRead).toEqual([]);
  });

  test('decodes an immediate operand', () => {
    const [insn] = cs.disasm(Buffer.from([0x48, 0x83, 0xec, 0x28]), 0x1000n); // sub rsp, 0x28
    const [dst, src] = insn!.detail!.x86.operands;
    expect(dst!.type).toBe(x86_op_type.REG);
    expect(dst!.reg).toBe(x86_reg.RSP);
    expect(src!.type).toBe(x86_op_type.IMM);
    expect(src!.imm).toBe(0x28n);
  });

  test('decodes a rip-relative memory operand with the correct effective-address inputs', () => {
    // mov rax, [rip + 0x10] at address 0x2000 (7-byte instruction)
    const [insn] = cs.disasm(
      Buffer.from([0x48, 0x8b, 0x05, 0x10, 0x00, 0x00, 0x00]),
      0x2000n,
    );
    const [dst, src] = insn!.detail!.x86.operands;
    expect(dst!.type).toBe(x86_op_type.REG);
    expect(dst!.reg).toBe(x86_reg.RAX);
    expect(src!.type).toBe(x86_op_type.MEM);
    expect(src!.mem!.base).toBe(x86_reg.RIP);
    expect(src!.mem!.disp).toBe(0x10n);
    expect(insn!.size).toBe(7);
  });

  test('decodes a single-operand push, with RSP as an implicit read+write', () => {
    const [insn] = cs.disasm(Buffer.from([0x50]), 0x1000n); // push rax
    const [op] = insn!.detail!.x86.operands;
    expect(insn!.detail!.x86.op_count).toBe(1);
    expect(op!.type).toBe(x86_op_type.REG);
    expect(op!.reg).toBe(x86_reg.RAX);
    // RAX is explicit (the operand above); RSP is implicitly read (to find
    // the write address) and written (decremented) -- this is also a
    // regression check for a use-after-free where cs_free() ran before
    // detail was decoded, corrupting regs_read/regs_write with stale data.
    expect(insn!.regsRead).toContain(x86_reg.RSP);
    expect(insn!.regsWrite).toContain(x86_reg.RSP);
  });

  test('isBranch/isRet/isCall classification lines up with decoded groups', () => {
    const [call] = cs.disasm(
      Buffer.from([0xe8, 0xfb, 0x0f, 0x00, 0x00]),
      0x1000n,
    );
    expect(call!.isCall).toBe(true);
    expect(call!.isBranch).toBe(true);

    const [ret] = cs.disasm(Buffer.from([0xc3]), 0x1000n);
    expect(ret!.isRet).toBe(true);
    expect(ret!.isBranch).toBe(true);
  });
});
