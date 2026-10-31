import { CapstoneX86 } from 'bun-capstone';
import { cmachinecode } from 'bun-xffi';
import { resolveAccessor } from './session.js';

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
