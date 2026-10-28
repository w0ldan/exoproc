import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { afterAll } from 'bun:test';
import { plugin } from 'bun';

// ESM compatibility for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Automatic platform detection for test suites:
// Each test suite directory (under tests/ or dist-tests/) corresponds directly to
// a package name in packages/. If running on Linux (or any non-win32 platform),
// check if the package being tested is Windows-only ("os": ["win32"]).
// If so, gracefully intercept and skip its tests without unhandled native errors.
if (process.platform !== 'win32') {
  const repoRoot = path.resolve(__dirname, '..');
  const packagesDir = path.join(repoRoot, 'packages');

  const isWindowsOnly = (pkgName: string): boolean => {
    const pkgJsonPath = path.join(packagesDir, pkgName, 'package.json');
    if (!existsSync(pkgJsonPath)) return false;
    try {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      if (
        Array.isArray(pkgJson.os) &&
        pkgJson.os.includes('win32') &&
        !pkgJson.os.includes('linux')
      ) {
        return true;
      }
      if (
        pkgJson.dependencies?.['bun-winapi'] ||
        pkgJson.dependencies?.['bun-xffi']
      ) {
        return true;
      }
    } catch {}
    return false;
  };

  const winOnlyPackages: string[] = [];
  if (existsSync(packagesDir)) {
    for (const entry of readdirSync(packagesDir)) {
      if (isWindowsOnly(entry)) {
        winOnlyPackages.push(entry);
      }
    }
  }

  if (winOnlyPackages.length > 0) {
    const escaped = winOnlyPackages.map((p) =>
      p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    );
    const filterRegex = new RegExp(
      `(?:dist-tests|tests)[\\\\/](${escaped.join('|')})[\\\\/].*\\.(?:test|spec)\\.[jt]s$`,
    );

    plugin({
      name: 'platform-test-skipper',
      setup(build) {
        build.onLoad({ filter: filterRegex }, (args) => {
          const match = args.path
            .replace(/\\/g, '/')
            .match(/(?:dist-tests|tests)\/([^/]+)\//);
          const pkg = match ? match[1] : 'unknown';
          return {
            contents: `import { test } from 'bun:test';\ntest.skip('[SKIP] Package "${pkg}" is Windows-only, skipping on ${process.platform}', () => {});\n`,
            loader: args.path.endsWith('.ts') ? 'ts' : 'js',
          };
        });
      },
    });
  }
}

// Load test-specific environment variables if dotenv exists
try {
  const dotenv = await import('dotenv');
  dotenv.default?.config?.({ path: path.resolve(__dirname, '.env') });
} catch {}

// Compile Idle.class fixture on-the-fly using njava's compileJavaSync if missing
async function ensureIdleFixture(): Promise<void> {
  const fixturesDir = path.resolve(__dirname, 'njava', 'fixtures');
  const idleClass = path.join(fixturesDir, 'Idle.class');
  if (existsSync(idleClass)) return;

  const idleJava = path.join(fixturesDir, 'Idle.java');
  if (!existsSync(idleJava)) return;

  try {
    const { compileJavaSync } =
      await import('../packages/java/jjit/src/compiler.js');
    const { getTestJavaPath } = await import('./njava/java-test-helpers.js');
    const javaPath = getTestJavaPath(8);
    const source = readFileSync(idleJava, 'utf8');
    compileJavaSync({
      source,
      javaPath,
      javaVersion: 8,
      outputDir: fixturesDir,
    });
  } catch {}
}

if (process.platform === 'win32') {
  await ensureIdleFixture();
}
//
// The logger (exoproc-utils) reads EXOPROC_LOG_DIR once, at module load, to
// decide where its DailyRotateFile writes (default: ~/AppData/Roaming/Exoproc/
// logs). This file is a bun `[test].preload`, so it runs *before* any test file
// imports the logger -- so redirecting it here needs zero changes to production
// code. tests/.env sets a *relative* `EXOPROC_LOG_DIR=logs`, which winston
// resolves against the process cwd -- so it lands in the wrong place whenever
// tests are run from anywhere but the repo root. Pin it to an absolute path
// under the repo so it always ends up in the gitignored `logs/`, while still
// honoring an explicit absolute override.
const configuredLogDir = process.env.EXOPROC_LOG_DIR;
process.env.EXOPROC_LOG_DIR =
  configuredLogDir && path.isAbsolute(configuredLogDir)
    ? configuredLogDir
    : path.resolve(__dirname, '..', configuredLogDir ?? 'logs');

// exoproc-dummy's DummyProcess spawns via a de-elevated CreateProcessAsUserA
// by default (see packages/dummy/src/dummy.ts) -- the real, intended
// behavior, verified working both under Wine and on real Windows hardware,
// locally. That exact call reliably crashes Bun specifically on GitHub
// Actions' *hosted* runners (confirmed via a standalone diagnostic script:
// identical code completes cleanly on two independent real environments and
// faults on the same CreateProcessAsUserA call on both a GitHub-hosted
// Linux+Wine runner and a GitHub-hosted windows-latest runner) -- a hosted-
// runner virtualization incompatibility, not a bug in the call itself. Swap
// in a child_process.spawn-based strategy only in that specific environment,
// without touching the real implementation.
if (process.platform === 'win32') {
  const { closeGlobalDummyProcess, setSpawnStrategy } =
    await import('../packages/dummy/dist/index.js');
  type SpawnStrategy = Parameters<typeof setSpawnStrategy>[0];

  if (process.env.GITHUB_ACTIONS === 'true') {
    const { Kernel32Impl, ProcessAccess } =
      await import('../packages/xffi/dist/index.js');
    const spawnViaChildProcess: SpawnStrategy = (executable, args) => {
      const child = spawn(executable, args, { stdio: 'ignore' });
      if (!child.pid) {
        throw new Error(`Failed to spawn dummy process (${executable})`);
      }
      child.unref();

      let handle = 0;
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        handle = Number(
          Kernel32Impl.OpenProcess(ProcessAccess.ALL_ACCESS, 0, child.pid),
        );
        if (handle !== 0) break;
        Bun.sleepSync(50);
      }
      if (handle === 0) {
        throw new Error(`OpenProcess failed for spawned pid ${child.pid}`);
      }
      return { pid: child.pid, handle };
    };
    setSpawnStrategy(spawnViaChildProcess);
  }

  // Every test file that needs a cross-process target shares one dummy
  // process (see exoproc-dummy) instead of spawning its own -- close it once,
  // for the whole run, here.
  afterAll(async () => {
    await closeGlobalDummyProcess();
  });

  // Give Wine a grace period to clean up native threads before the worker exits
  afterAll(async () => {
    await new Promise((r) => setTimeout(r, 1000));
  });
}
