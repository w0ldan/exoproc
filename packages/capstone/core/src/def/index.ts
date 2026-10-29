import { load } from 'bun-xffi';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { CapstoneDef } from 'bun-capstone-abi/def';
import { getDepsCacheDir, resolveOrDownloadDepSync } from 'exoproc-utils';

export { CapstoneDef };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findCapstoneDll(): string {
  // 1. Check persistent central cache (~/.cache/exoproc/deps/capstone.dll)
  try {
    const cached = join(getDepsCacheDir(), 'capstone.dll');
    if (existsSync(cached)) {
      return cached;
    }
  } catch {}

  // 2. Check local repository and distribution candidates
  const execDir = process.execPath ? dirname(process.execPath) : '';
  const candidates = [
    join(execDir, 'capstone.dll'),
    join(execDir, 'deps/capstone.dll'),
    join(__dirname, 'capstone.dll'),
    join(__dirname, '../capstone.dll'),
    join(__dirname, '../deps/capstone.dll'),
    join(__dirname, '../../deps/capstone.dll'),
    join(__dirname, '../../../packages/capstone/core/deps/capstone.dll'),
    join(__dirname, '../../../../packages/capstone/core/deps/capstone.dll'),
    join(process.cwd(), 'packages/capstone/core/deps/capstone.dll'),
    join(process.cwd(), 'packages/capstone/core/dist/capstone.dll'),
    join(process.cwd(), 'packages/capstone/deps/capstone.dll'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // 3. Auto-download and cache on-demand on first use!
  try {
    return resolveOrDownloadDepSync({
      name: 'Capstone 4.0.2 (Windows x64)',
      version: '4.0.2',
      url: 'https://github.com/capstone-engine/capstone/releases/download/4.0.2/capstone-4.0.2-win64.zip',
      target: 'capstone.dll',
      extractFromZip: 'capstone.dll',
      sha1: 'c87eb26c07bb923b6a04da3cbc31b49f64c0c59a',
      sha256:
        'f03321188a1615d044314b1183dcd9a7ffda09286c31c369d109165d4892dcbb',
    });
  } catch {}

  throw new Error(
    'Could not locate or download capstone.dll. Please check your internet connection or run `bun run deps`.',
  );
}

export const CapstoneImpl = load({
  dll: findCapstoneDll(),
  dllFuncs: CapstoneDef,
});
