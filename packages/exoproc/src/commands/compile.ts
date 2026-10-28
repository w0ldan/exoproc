import { readFileSync, existsSync } from 'node:fs';

export interface CompileCliOptions {
  codeOrPath: string;
  entry?: string;
  disassemble?: boolean;
  json?: boolean;
}

export async function commandCompile(
  options: CompileCliOptions,
): Promise<void> {
  const { compileC } = await import('exoproc-mcp');
  let source = options.codeOrPath;
  if (existsSync(source)) {
    source = readFileSync(source, 'utf8');
  }

  const result = await compileC({
    code: source,
    entry: options.entry,
    disassemble: options.disassemble ?? true,
  });

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
    return;
  }

  if (!result.success) {
    console.error('\nCompilation error:', result.error);
    process.exit(1);
  }

  console.log(
    `\nSuccessfully compiled x86_64 machine code (${result.size} bytes):`,
  );
  console.log(`Hex: ${result.bytesHex}\n`);

  if (result.instructions && result.instructions.length > 0) {
    console.log('Disassembly:');
    for (const inst of result.instructions) {
      console.log(
        `  ${inst.address}: ${inst.mnemonic.padEnd(8)} ${inst.opStr || ''} (${inst.bytes})`,
      );
    }
  }
  console.log();
}
