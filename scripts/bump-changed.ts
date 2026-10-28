#!/usr/bin/env tsx

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { log } from './logger';

export type ReleaseType = 'patch' | 'minor' | 'major';

function incSemver(version: string, type: ReleaseType = 'patch'): string {
  const clean = (version || '0.0.0').split('-')[0] ?? '0.0.0';
  const parts = clean.split('.').map((p) => parseInt(p, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

interface PackageInfo {
  name: string;
  dir: string;
  packageJsonPath: string;
  version: string;
  isRoot: boolean;
}

/**
 * Discovers all workspace packages in packages/ plus root package.json
 */
function getWorkspacePackages(): Map<string, PackageInfo> {
  const map = new Map<string, PackageInfo>();

  // Add root package
  const rootPkgPath = join(rootDir, 'package.json');
  if (existsSync(rootPkgPath)) {
    const json = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));
    map.set(rootDir, {
      name: json.name || 'exoproc-workspace-root',
      dir: rootDir,
      packageJsonPath: rootPkgPath,
      version: json.version || '0.0.0',
      isRoot: true,
    });
  }

  // Find all packages/*
  const packagesDir = join(rootDir, 'packages');
  function scan(dir: string) {
    if (!existsSync(dir)) return;
    const items = readdirSync(dir, { withFileTypes: true });
    const pkgJson = join(dir, 'package.json');
    if (existsSync(pkgJson)) {
      try {
        const json = JSON.parse(readFileSync(pkgJson, 'utf-8'));
        map.set(dir, {
          name: json.name,
          dir,
          packageJsonPath: pkgJson,
          version: json.version,
          isRoot: false,
        });
      } catch {
        // ignore
      }
    }

    for (const item of items) {
      if (
        item.isDirectory() &&
        item.name !== 'node_modules' &&
        item.name !== 'dist'
      ) {
        scan(join(dir, item.name));
      }
    }
  }

  scan(packagesDir);
  return map;
}

const TEST_DIR_TO_PACKAGE: Record<string, string> = {
  accessors: 'exoproc-accessors',
  asm: 'exoproc-asm',
  capstone: 'bun-capstone',
  exoproc: 'exoproc',
  'exoproc-mcp': 'exoproc-mcp',
  jjit: 'exoproc-jjit',
  minecraft: 'exoproc-minecraft',
  minhook: 'bun-minhook',
  njava: 'bun-njava',
  'njava-mappings': 'exoproc-mappings',
  'njava-nashorn': 'exoproc-nashorn',
  'njava-runtime': 'exoproc-runtime',
  nshm: 'bun-nshm',
  nthread: 'bun-nthread',
  simulate: 'win32-simulate',
  utils: 'exoproc-utils',
  winapi: 'bun-winapi',
  xffi: 'bun-xffi',
};

/**
 * Finds which package directory owns a given relative file path
 */
function findOwnerPackage(
  relPath: string,
  packages: Map<string, PackageInfo>,
): PackageInfo {
  const norm = relPath.replace(/\\/g, '/');

  // Check if it belongs to a package-specific test suite (tests/<subfolder>/...)
  if (norm.startsWith('tests/')) {
    const parts = norm.split('/');
    if (parts.length > 2 && parts[1]) {
      const targetPkgName = TEST_DIR_TO_PACKAGE[parts[1]];
      if (targetPkgName) {
        for (const pkg of packages.values()) {
          if (pkg.name === targetPkgName) {
            return pkg;
          }
        }
      }
    }
  }

  const absPath = resolve(rootDir, relPath);
  let currentDir = dirname(absPath);

  while (currentDir.startsWith(rootDir) && currentDir !== rootDir) {
    if (packages.has(currentDir)) {
      return packages.get(currentDir)!;
    }
    currentDir = dirname(currentDir);
  }

  // Belongs to root monorepo
  return packages.get(rootDir)!;
}

/**
 * Gets list of modified / changed files from git
 */
function getChangedFiles(baseRef?: string): string[] {
  const files = new Set<string>();

  try {
    // 1. Uncommitted changes (working tree & staged)
    const statusOut = execSync('git status --porcelain -uall', {
      cwd: rootDir,
      encoding: 'utf-8',
    });
    for (const rawLine of statusOut.split('\n')) {
      if (!rawLine || rawLine.length < 4) continue;
      // Format is XY filename -> slice from index 3 on the raw line
      const filePath = rawLine.slice(3).trim();
      if (filePath) files.add(filePath);
    }

    // 2. Committed changes compared to baseRef (default: HEAD~1 if exists)
    const compareTarget = baseRef || 'HEAD~1';
    try {
      const diffOut = execSync(`git diff --name-only ${compareTarget} HEAD`, {
        cwd: rootDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      for (const line of diffOut.split('\n')) {
        const trimmed = line.trim();
        if (trimmed) files.add(trimmed);
      }
    } catch {
      // If HEAD~1 does not exist, ignore
    }
  } catch (err: any) {
    log.warn(`Could not run git status/diff: ${err.message}`);
  }

  return Array.from(files);
}

export async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const bumpAll = args.includes('--all');
  const typeArg = args.find((a) => a.startsWith('--type='));
  const baseArg = args.find((a) => a.startsWith('--base='));
  const baseRef = baseArg ? baseArg.split('=')[1] : undefined;
  const releaseType: ReleaseType = (
    typeArg ? typeArg.split('=')[1] : 'patch'
  ) as ReleaseType;

  log.section('Independent Package Version Bump');

  const packages = getWorkspacePackages();
  const changedFiles = getChangedFiles(baseRef);

  log.info(`Found ${log.bold(String(packages.size))} packages in monorepo.`);
  log.info(
    `Detected ${log.bold(String(changedFiles.length))} changed files in git.`,
  );

  // Group changed files by package
  const changesByPackage = new Map<PackageInfo, string[]>();

  for (const file of changedFiles) {
    // Ignore versioning/metadata/dist/lock files
    const base = file.split('/').pop() || '';
    if (
      file.startsWith('.git') ||
      file.includes('/dist/') ||
      file.startsWith('.changeset/') ||
      base === 'package.json' ||
      base === 'package-lock.json' ||
      base === 'bun.lock' ||
      base === 'CHANGELOG.md' ||
      base === 'LICENSE' ||
      file.endsWith('.log')
    ) {
      continue;
    }

    const owner = findOwnerPackage(file, packages);
    if (!changesByPackage.has(owner)) {
      changesByPackage.set(owner, []);
    }
    changesByPackage.get(owner)!.push(file);
  }

  const toBump: { pkg: PackageInfo; nextVersion: string; files: string[] }[] =
    [];
  const untouched: PackageInfo[] = [];

  for (const pkg of packages.values()) {
    if (bumpAll || changesByPackage.has(pkg)) {
      const files = changesByPackage.get(pkg) || ['(all requested)'];
      const next = incSemver(pkg.version, releaseType);
      toBump.push({ pkg, nextVersion: next, files });
    } else {
      untouched.push(pkg);
    }
  }

  if (toBump.length === 0) {
    log.done(
      'No changed packages detected. All package versions are up to date!',
    );
    return;
  }

  log.line();
  log.section(`Packages to Bump (${releaseType}):`);
  for (const item of toBump) {
    const label = item.pkg.isRoot ? '[Monorepo Root] ' : '· ';
    log.line(
      `   ${label} ${log.bold(item.pkg.name)}: ${log.dim(item.pkg.version)} -> ${log.bold(item.nextVersion)} (${item.files.length} changed files)`,
    );
  }

  if (untouched.length > 0) {
    log.line();
    log.info(
      `Untouched packages (keeping current version): ${untouched.map((u) => u.name).join(', ')}`,
    );
  }

  if (isDryRun) {
    log.line();
    log.warn('Dry-run mode: No files were modified.');
    return;
  }

  // Apply updates to package.json files
  for (const item of toBump) {
    const content = readFileSync(item.pkg.packageJsonPath, 'utf-8');
    const json = JSON.parse(content);
    json.version = item.nextVersion;
    writeFileSync(
      item.pkg.packageJsonPath,
      JSON.stringify(json, null, 2) + '\n',
      'utf-8',
    );
  }

  // Synchronize server.json versions with root and exoproc package.json
  const serverJsonPath = join(rootDir, 'server.json');
  if (existsSync(serverJsonPath)) {
    try {
      const serverJson = JSON.parse(readFileSync(serverJsonPath, 'utf-8'));
      const rootPkg = packages.get(rootDir);
      const rootBump = toBump.find((b) => b.pkg.isRoot);
      const exoprocBump = toBump.find((b) => b.pkg.name === 'exoproc');
      let exoprocVersion = exoprocBump?.nextVersion;
      if (!exoprocVersion) {
        for (const p of packages.values()) {
          if (p.name === 'exoproc') {
            exoprocVersion = p.version;
            break;
          }
        }
      }

      if (rootBump) {
        serverJson.version = rootBump.nextVersion;
      } else if (rootPkg) {
        serverJson.version = rootPkg.version;
      }

      if (exoprocVersion && Array.isArray(serverJson.packages)) {
        for (const pkgEntry of serverJson.packages) {
          if (pkgEntry && pkgEntry.identifier === 'exoproc') {
            pkgEntry.version = exoprocVersion;
          }
        }
      }

      writeFileSync(
        serverJsonPath,
        JSON.stringify(serverJson, null, 2) + '\n',
        'utf-8',
      );
    } catch {
      // ignore
    }
  }

  log.line();
  log.done(`Successfully bumped ${toBump.length} package(s)!`);
  log.info('Running bun install to synchronize lockfile...');
  execSync('bun install', { cwd: rootDir, stdio: 'inherit' });
}

main().catch((err) => {
  log.fail(`Version bump failed: ${err.message}`);
  process.exit(1);
});
