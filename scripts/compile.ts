import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { log } from './logger.js';

const ROOT_DIR = join(import.meta.dirname, '..');
const EXOPROC_DIR = join(ROOT_DIR, 'packages', 'exoproc');
const ENTRYPOINT = join(EXOPROC_DIR, 'src', 'cli.ts');

function parseArgs() {
  const args = process.argv.slice(2);
  let target: string | undefined;
  let outfile: string | undefined;

  for (const arg of args) {
    if (arg.startsWith('--target=')) {
      target = arg.slice('--target='.length);
    } else if (arg.startsWith('--outfile=')) {
      outfile = arg.slice('--outfile='.length);
    }
  }

  return { target, outfile };
}

async function main() {
  const { target, outfile } = parseArgs();

  // Read Exoproc package metadata
  const pkgJsonPath = join(EXOPROC_DIR, 'package.json');
  let version = '0.7.0';
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      if (pkg.version) version = pkg.version;
    } catch {}
  }

  const isWindowsHost = process.platform === 'win32';
  const defaultOutDir = join(EXOPROC_DIR, 'dist');
  const finalOutfile = resolve(outfile ?? join(defaultOutDir, 'exoproc.exe'));
  const outParent = dirname(finalOutfile);
  if (!existsSync(outParent)) {
    mkdirSync(outParent, { recursive: true });
  }

  const buildArgs: string[] = ['build', '--compile'];

  if (isWindowsHost && !target) {
    // Native AOT compilation on Windows (or inside Wine with Bun Canary)
    log.info(
      'Compiling native Windows x64 AOT executable with API trimming...',
    );
    buildArgs.push(
      '--aot',
      '--trim',
      '--windows-title=Exoproc',
      '--windows-description=Unified CLI & MCP Server for Windows x64 Instrumentation',
      `--windows-version=${version}.0`,
    );
  } else {
    // Cross-compiling from Linux: Note that Bun --aot requires native compilation on Windows host
    const targetPlatform =
      target && target !== 'windows' ? target : 'bun-windows-x64';
    log.info(
      `Cross-compiling Windows x64 binary (--target=${targetPlatform}). Note: native --aot requires building on Windows host.`,
    );
    buildArgs.push(`--target=${targetPlatform}`);
  }

  buildArgs.push(ENTRYPOINT, `--outfile=${finalOutfile}`);

  log.info(`Entrypoint : ${ENTRYPOINT}`);
  log.info(`Output     : ${finalOutfile}`);

  const start = performance.now();
  const result = spawnSync(process.execPath, buildArgs, {
    stdio: 'inherit',
    cwd: ROOT_DIR,
  });

  if (result.status !== 0) {
    log.fail('AOT Compilation failed.');
    process.exit(1);
  }

  const elapsed = ((performance.now() - start) / 1000).toFixed(2);
  const sizeMb = existsSync(finalOutfile)
    ? (statSync(finalOutfile).size / (1024 * 1024)).toFixed(2)
    : 'unknown';

  log.done(
    `Successfully generated AOT executable in ${elapsed}s (${sizeMb} MB)`,
  );
  log.line();
  log.info(`Capabilities bundled into single executable:`);
  log.info(`  - Default / No args : Starts stdio MCP server for AI agents`);
  log.info(`  - "exoproc setup"   : Interactive AI agent configuration wizard`);
  log.info(`  - "exoproc doctor"  : Health and dependency diagnostics`);
  log.info(`  - "exoproc ps|windows|screenshot|compile|exec|run"`);
}

main().catch((err) => {
  log.fail(`Error: ${err.message}`);
  process.exit(1);
});
