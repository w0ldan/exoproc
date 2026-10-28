import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export async function commandRun(scriptPath: string): Promise<void> {
  const { executeLocalCode } = await import('exoproc-mcp');
  const absPath = resolve(process.cwd(), scriptPath);
  if (!existsSync(absPath)) {
    console.error(`Script not found: ${absPath}`);
    process.exit(1);
  }

  const code = readFileSync(absPath, 'utf8');
  const res = await executeLocalCode({ code });
  if (res.logs && res.logs.length > 0) {
    console.log(res.logs.join('\n'));
  }
  if (!res.success) {
    console.error('Script error:', res.result);
    process.exit(1);
  } else if (res.result !== undefined && res.result !== null) {
    console.log(JSON.stringify(res.result, null, 2));
  }
}
