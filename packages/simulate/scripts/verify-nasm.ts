import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ARTIFACT_ROOT = join(PACKAGE_ROOT, 'artifacts');

async function assemblyFiles(directory: string): Promise<string[]> {
  return (await readdir(directory))
    .filter((name) => name.endsWith('.asm'))
    .sort()
    .map((name) => join(directory, name));
}

async function main(): Promise<void> {
  const nasm = 'nasm';
  const probe = spawnSync(nasm, ['-v'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    throw new Error(
      'NASM bulunamadı. Önce nasm kurun, sonra npm run inspect:nasm çalıştırın.',
    );
  }

  const sources = [
    ...(await assemblyFiles(join(ARTIFACT_ROOT, 'executables'))),
    ...(await assemblyFiles(join(ARTIFACT_ROOT, 'dlls'))),
  ];
  const temporary = await mkdtemp(join(tmpdir(), 'exoproc-nasm-'));
  try {
    for (const [index, source] of sources.entries()) {
      const output = join(temporary, `${index}.obj`);
      const result = spawnSync(nasm, ['-f', 'win64', '-o', output, source], {
        encoding: 'utf8',
      });
      if (result.status !== 0) {
        throw new Error(
          `NASM doğrulaması başarısız: ${source}\n${
            result.stderr || result.stdout
          }`,
        );
      }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }

  process.stdout.write(
    `${sources.length} NASM artifact relocatable Win64 COFF object olarak assemble edildi.\n`,
  );
}

await main();
