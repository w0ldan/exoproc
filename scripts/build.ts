import { spawnSync } from 'node:child_process';
import {
  readdirSync,
  existsSync,
  readFileSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { join, basename } from 'node:path';
import { log } from './logger.js';

const ROOT_DIR = join(import.meta.dirname, '..');
const PACKAGES_DIR = join(ROOT_DIR, 'packages');

/**
 * A package's `exports` field can declare subpaths (`./cdefine`,
 * `./bun-ffi`, ...) pointing at their own `dist/*.js` file, distinct from
 * the main `dist/index.js` bundle. `bun build entryPath` alone never
 * produces those -- each needs to be its own entry point -- even though
 * another package's bundle can reference one via a plain external
 * `import ... from '<pkg>/<subpath>'` left in place by `--external` below.
 * Resolves each declared subpath's `dist/....js` back to the `src/....ts`
 * it's built from, skipping the main `"."` entry (already `entryPath`)
 * and anything unresolvable (non-string `import` condition, missing
 * source file).
 */
function additionalExportEntries(
  pkgJson: Record<string, unknown>,
  pkgPath: string,
): string[] {
  const exportsField = pkgJson.exports;
  if (!exportsField || typeof exportsField !== 'object') return [];

  const entries: string[] = [];
  for (const [subpath, target] of Object.entries(
    exportsField as Record<string, unknown>,
  )) {
    if (subpath === '.') continue;
    const importPath =
      target && typeof target === 'object'
        ? (target as Record<string, unknown>).import
        : target;
    if (typeof importPath !== 'string') continue;

    const relativeSrc = importPath
      .replace(/^\.\/dist\//, '')
      .replace(/\.js$/, '.ts');
    const srcPath = join(pkgPath, 'src', relativeSrc);
    if (existsSync(srcPath)) entries.push(srcPath);
  }
  return entries;
}

/**
 * Builds all packages in the monorepo centrally.
 */
async function buildAll() {
  log.info('Generating TypeScript declaration files...');
  // `--force`, not a plain `tsc -b`: the incremental build cache
  // (`*.tsbuildinfo`, gitignored) only tracks source mtimes vs. its own
  // last-known state -- it never checks whether the `.d.ts` outputs it
  // recorded are actually still on disk. Delete `dist/` (a clean checkout,
  // a CI cache miss on `dist/` but not on a leftover `.tsbuildinfo`, ...)
  // while the buildinfo survives, and a plain `tsc -b` reports every
  // project "up to date" and silently emits nothing, even though every
  // declaration file is gone -- confirmed reproducing exactly that against
  // Cloudflare's own build-output caching. `--force` ignores the cache
  // and always re-emits, trading a bit of rebuild time for actually being
  // correct.
  const tscResult = spawnSync('bun', ['x', 'tsc', '-b', '--force'], {
    stdio: 'inherit',
  });
  if (tscResult.status !== 0) {
    log.fail('Failed to generate declaration files');
    process.exit(1);
  }

  const findPackageDirs = (baseDir: string): string[] => {
    const results: string[] = [];
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const fullPath = join(baseDir, entry.name);
      if (existsSync(join(fullPath, 'package.json'))) {
        results.push(fullPath);
      } else {
        for (const sub of readdirSync(fullPath, { withFileTypes: true })) {
          if (!sub.isDirectory()) continue;
          const subPath = join(fullPath, sub.name);
          if (existsSync(join(subPath, 'package.json'))) {
            results.push(subPath);
          }
        }
      }
    }
    return results;
  };

  const packagePaths = findPackageDirs(PACKAGES_DIR);

  // Dynamically collect all package names in the workspace to mark them as external
  const externals: string[] = [];
  for (const pkgPath of packagePaths) {
    const pkgJsonPath = join(pkgPath, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
        if (pkgJson.name) {
          externals.push(pkgJson.name);
        }
      } catch (err) {
        log.warn(`Failed to parse package.json for ${pkgPath}: ${err}`);
      }
    }
  }

  for (const pkgPath of packagePaths) {
    const entryPath = join(pkgPath, 'src', 'index.ts');

    if (!existsSync(entryPath)) continue;

    // Parsed once and reused below for the package name, its additional
    // export entries, and the LICENSE-copy check.
    let pkgJson: Record<string, unknown> = {};
    const pkgJsonPath = join(pkgPath, 'package.json');
    if (existsSync(pkgJsonPath)) {
      try {
        pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      } catch (err) {
        log.warn(`Failed to parse package.json for ${pkgPath}: ${err}`);
      }
    }
    const pkgName = (pkgJson.name as string | undefined) ?? basename(pkgPath);

    log.info(`Building ${pkgName}...`);

    // Standalone worker entry points (e.g. `waiter-worker.ts`) get their own
    // bundle, built alongside the main entry in the same invocation, so each
    // is fully self-contained and independently loadable via `new Worker(...)`
    // -- the main bundle only ever references them by relative URL at
    // runtime, never imports them, so `bun build` wouldn't otherwise know
    // they're reachable.
    const srcDir = join(pkgPath, 'src');
    const workerEntries = readdirSync(srcDir).filter((f) =>
      f.endsWith('-worker.ts'),
    );

    const entriesToBuild = [
      entryPath,
      ...workerEntries.map((f) => join(srcDir, f)),
      ...additionalExportEntries(pkgJson, pkgPath),
    ];

    for (const entry of entriesToBuild) {
      const buildArgs = [
        'build',
        entry,
        '--root',
        srcDir,
        '--outdir',
        join(pkgPath, 'dist'),
        '--target',
        'bun',
        '--sourcemap=none',
      ];

      const isStandaloneFlag =
        process.argv.includes('--bundle') ||
        process.argv.includes('--standalone') ||
        process.env.STANDALONE_BUNDLE === '1';

      const isSelfContained =
        isStandaloneFlag &&
        (basename(pkgPath) === 'exoproc-mcp' ||
          basename(pkgPath) === 'exoproc');

      if (isSelfContained) {
        // Self-contained bundle for dev testing / single-file execution
      } else {
        buildArgs.push('--external', '*');
      }

      const result = spawnSync(process.execPath, buildArgs, {
        stdio: 'inherit',
      });

      if (result.status !== 0) {
        log.fail(`Failed to build ${entry} in ${pkgName}`);
        process.exit(1);
      }
    }

    // Each package's `files` array ships its own LICENSE copy -- keep that
    // promise true by copying the root LICENSE alongside its build output.
    if (Array.isArray(pkgJson.files) && pkgJson.files.includes('LICENSE')) {
      copyFileSync(join(ROOT_DIR, 'LICENSE'), join(pkgPath, 'LICENSE'));
    }
  }

  // Remove any stale .js.map files across packages (bundled outputs don't use them)
  function removeJsMaps(dir: string) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') removeJsMaps(full);
      } else if (entry.name.endsWith('.js.map')) {
        try {
          unlinkSync(full);
        } catch {}
      }
    }
  }
  removeJsMaps(PACKAGES_DIR);

  buildTests();

  log.info('All packages and test bundles built successfully.');
}

/**
 * Compiles all test suites into dist-tests/ for fast, pre-bundled test execution.
 */
function buildTests() {
  const TESTS_DIR = join(ROOT_DIR, 'tests');
  const DIST_TESTS_DIR = join(ROOT_DIR, 'dist-tests');

  if (!existsSync(TESTS_DIR)) return;

  log.info('Building test suites into dist-tests/...');

  function findFiles(dir: string, pattern: RegExp): string[] {
    const results: string[] = [];
    if (!existsSync(dir)) return results;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'dist' || entry.name === 'node_modules') continue;
        results.push(...findFiles(fullPath, pattern));
      } else if (pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
    return results;
  }

  function copyFixtures(srcDir: string, destDir: string) {
    if (!existsSync(srcDir)) return;
    const entries = readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(srcDir, entry.name);
      const destPath = join(destDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'fixtures') {
          mkdirSync(destPath, { recursive: true });
          cpSync(srcPath, destPath, { recursive: true });
        } else if (entry.name !== 'dist' && entry.name !== 'node_modules') {
          copyFixtures(srcPath, destPath);
        }
      }
    }
  }

  copyFixtures(TESTS_DIR, DIST_TESTS_DIR);

  // Bundle setup.ts
  const setupPath = join(TESTS_DIR, 'setup.ts');
  if (existsSync(setupPath)) {
    spawnSync(
      'bun',
      [
        'build',
        setupPath,
        '--outfile',
        join(DIST_TESTS_DIR, 'setup.js'),
        '--target',
        'bun',
        '--external',
        '@aws-sdk/client-s3',
      ],
      { stdio: 'inherit' },
    );
  }

  const testFiles = findFiles(TESTS_DIR, /\.test\.ts$/);
  for (const testFile of testFiles) {
    const relPath = testFile
      .slice(TESTS_DIR.length + 1)
      .replace(/\.ts$/, '.js');
    const outPath = join(DIST_TESTS_DIR, relPath);

    spawnSync(
      'bun',
      [
        'build',
        testFile,
        '--outfile',
        outPath,
        '--target',
        'bun',
        '--external',
        '@aws-sdk/client-s3',
      ],
      { stdio: 'inherit' },
    );
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
