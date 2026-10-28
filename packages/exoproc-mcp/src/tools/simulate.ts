import { CapstoneX86 } from 'bun-capstone';
import {
  Win64AddressSpace,
  X64Cpu,
  createInitialRegisters,
} from 'win32-simulate';
import { cmachinecode } from 'bun-xffi';
import { resolveAccessor } from './session.js';

export async function simulateRun(options: {
  bytesHex: string;
  maxSteps?: number;
}): Promise<{
  success: boolean;
  stepsExecuted: number;
  rip: string;
  registers: Record<string, string>;
}> {
  const clean = options.bytesHex.replace(/[^0-9a-fA-F]/g, '');
  const code = Buffer.from(clean, 'hex');

  const memory = new Win64AddressSpace();
  const codeBase = 0x0000000140001000n;
  const stackBase = 0x0000000000120000n;

  memory.map(
    'code',
    '.text',
    codeBase,
    Math.max(0x1000, code.length),
    'rwx',
    code,
  );

  memory.map('stack', 'stack', stackBase, 0x10000, 'rw');

  const registers = createInitialRegisters(codeBase, stackBase + 0x8000n);
  const cpu = new X64Cpu(memory, registers, (_syscallId, _regs) => 0n);

  const maxSteps = options.maxSteps ?? 100;
  let steps = 0;
  for (let i = 0; i < maxSteps; i++) {
    const res = cpu.step();
    steps++;
    if (
      res.reason === 'halted' ||
      res.reason === 'fault' ||
      res.reason === 'breakpoint'
    ) {
      break;
    }
  }

  const ctx = cpu.registers;
  return {
    success: true,
    stepsExecuted: steps,
    rip: `0x${ctx.RIP.toString(16)}`,
    registers: {
      rax: `0x${ctx.RAX.toString(16)}`,
      rbx: `0x${ctx.RBX.toString(16)}`,
      rcx: `0x${ctx.RCX.toString(16)}`,
      rdx: `0x${ctx.RDX.toString(16)}`,
      rsi: `0x${ctx.RSI.toString(16)}`,
      rdi: `0x${ctx.RDI.toString(16)}`,
      rsp: `0x${ctx.RSP.toString(16)}`,
      rbp: `0x${ctx.RBP.toString(16)}`,
      r8: `0x${ctx.R8.toString(16)}`,
      r9: `0x${ctx.R9.toString(16)}`,
      r10: `0x${ctx.R10.toString(16)}`,
      r11: `0x${ctx.R11.toString(16)}`,
      r12: `0x${ctx.R12.toString(16)}`,
      r13: `0x${ctx.R13.toString(16)}`,
      r14: `0x${ctx.R14.toString(16)}`,
      r15: `0x${ctx.R15.toString(16)}`,
    },
  };
}

export async function disassembleBytes(options: {
  bytesHex: string;
  address?: string | number | bigint;
}): Promise<{
  success: boolean;
  engine: string;
  count: number;
  instructions: {
    address: string;
    mnemonic: string;
    opStr: string;
    bytes: string;
  }[];
}> {
  const clean = options.bytesHex.replace(/[^0-9a-fA-F]/g, '');
  const buf = Buffer.from(clean, 'hex');
  const baseAddr = options.address ? BigInt(options.address) : 0x1000n;

  const cs = new CapstoneX86();
  const insns = cs.disasm(buf, baseAddr);
  return {
    success: true,
    engine: 'capstone',
    count: insns.length,
    instructions: insns.map((i: any) => ({
      address: `0x${i.address.toString(16)}`,
      mnemonic: i.mnemonic,
      opStr: i.opStr,
      bytes: Buffer.from(i.bytes).toString('hex'),
    })),
  };
}

export interface CompileCOptions {
  code: string;
  returns?: string;
  args?: string[];
  preamble?: string;
  disassemble?: boolean;
  baseAddress?: string | number | bigint;
  entry?: string;
  inject?: boolean;
  session?: string;
}

export async function compileC(options: CompileCOptions): Promise<{
  success: boolean;
  size?: number;
  bytesHex?: string;
  bytes?: number[];
  count?: number;
  instructions?: {
    address: string;
    mnemonic: string;
    opStr: string;
    bytes: string;
  }[];
  remoteAddress?: string;
  error?: string;
}> {
  try {
    let source = (options.code || '').trim();
    if (!source) {
      return { success: false, error: 'Empty C code provided.' };
    }

    const retType = options.returns || 'int';
    const args = options.args || [];

    // If source does not define machineCode, check if it defines any named function
    if (!source.includes('machineCode(') && !source.includes('machineCode (')) {
      const fnMatch = source.match(
        /(?:^|\n)\s*(?!if\b|while\b|for\b|switch\b)([a-zA-Z_][a-zA-Z0-9_*]*)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*\{/,
      );
      if (fnMatch) {
        const fnName = options.entry || fnMatch[2];
        const argNames = args.map((_, i) => `arg${i}`).join(', ');
        const paramStr = args.map((t, i) => `${t} arg${i}`).join(', ');
        source = `${source}\n\n${retType} machineCode(${paramStr}) {\n  return ${fnName}(${argNames});\n}`;
      }
    }

    if (options.preamble) {
      source = `${options.preamble}\n\n${source}`;
    }

    const codeObj = cmachinecode({
      source,
      returns: retType,
      args,
    });

    const buf = Buffer.from(codeObj.bytes);
    const bytesHex = buf.toString('hex');
    const bytes = Array.from(buf);
    const size = codeObj.size;

    let instructions:
      | {
          address: string;
          mnemonic: string;
          opStr: string;
          bytes: string;
        }[]
      | undefined = undefined;

    if (options.disassemble !== false) {
      try {
        const baseAddr = options.baseAddress
          ? BigInt(options.baseAddress)
          : 0x1000n;
        const cs = new CapstoneX86();
        const insns = cs.disasm(buf, baseAddr);
        instructions = insns.map((i: any) => ({
          address: `0x${i.address.toString(16)}`,
          mnemonic: i.mnemonic,
          opStr: i.opStr,
          bytes: Buffer.from(i.bytes).toString('hex'),
        }));
      } catch {
        // Disassembly is best-effort
      }
    }

    let remoteAddress: string | undefined = undefined;
    if (options.inject) {
      const accessor = await resolveAccessor(options.session);
      const addr = await accessor.machineCode(codeObj);
      remoteAddress = `0x${addr.toString(16)}`;
    }

    return {
      success: true,
      size,
      bytesHex,
      bytes,
      count: instructions?.length,
      instructions,
      ...(remoteAddress ? { remoteAddress } : {}),
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || String(err),
    };
  }
}
