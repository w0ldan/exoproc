import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';
import { resolveOrDownloadDep, type PackageDep } from 'exoproc-utils';
import pkg from '../package.json' with { type: 'json' };

const VERSION = pkg.version || '0.7.0';
const GITHUB_REPO = 'w0ldan/exoproc';

/**
 * Detects whether the current process is running as a standalone Ahead-Of-Time (AOT)
 * compiled binary (e.g. `exoproc.exe`) rather than via a runtime script runner (node, npx, bun, bunx).
 */
export function isAotBinary(): boolean {
  if (typeof (globalThis as any).EXOPROC_AOT !== 'undefined') {
    return Boolean((globalThis as any).EXOPROC_AOT);
  }
  const execBase = process.execPath
    ? basename(process.execPath).toLowerCase()
    : '';
  return (
    execBase.startsWith('exoproc') &&
    !execBase.endsWith('.js') &&
    !execBase.endsWith('.mjs') &&
    !execBase.endsWith('.ts')
  );
}

/**
 * Returns the PackageDep descriptor for the Windows x64 native AOT binary.
 */
export function getAotDep(): PackageDep | null {
  const { platform, arch } = process;
  if (platform === 'win32' && arch === 'x64') {
    return {
      name: `Exoproc Windows x64 Native AOT (v${VERSION})`,
      version: VERSION,
      url: `https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/exoproc.exe`,
      target: `deps/exoproc-v${VERSION}.exe`,
    };
  }
  return null;
}

/**
 * Detects whether an error was caused by missing Bun runtime capabilities
 * (such as attempting to import `bun:ffi` under Node.js).
 */
export function isMissingBunRuntime(err: any): boolean {
  if (typeof (process.versions as any)?.bun === 'string') {
    return false;
  }
  const code = err?.code;
  const msg = err?.message || String(err);
  return (
    code === 'ERR_UNSUPPORTED_ESM_URL_SCHEME' ||
    code === 'ERR_MODULE_NOT_FOUND' ||
    msg.includes('bun:') ||
    msg.includes('Cannot find package') ||
    msg.includes('Cannot find module')
  );
}

/**
 * Activates bridge mode: downloads the matching native AOT executable into the central
 * deps cache via exoproc-utils, then forwards command execution and exits.
 */
export async function runAotBridge(
  args: string[] = process.argv.slice(2),
): Promise<void> {
  const dep = getAotDep();
  if (!dep) {
    throw new Error(
      `Exoproc native AOT binary is only available on Windows x64 (current: ${process.platform} ${process.arch})`,
    );
  }

  const isJson = args.includes('--json');
  const exePath = await resolveOrDownloadDep(dep, undefined, {
    silent: isJson,
  });
  const child = spawnSync(exePath, args, { stdio: 'inherit' });
  process.exit(child.status ?? 0);
}
