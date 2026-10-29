/// <reference path="./unzipper.d.ts" />

import {
  createWriteStream,
  mkdirSync,
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  copyFileSync,
  writeFileSync,
} from 'fs';
import { inflateRawSync } from 'zlib';
import { pipeline } from 'stream/promises';
import { rm } from 'fs/promises';
import { rmSync } from 'fs';
import { join, dirname, basename, resolve, isAbsolute } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { execSync, spawnSync } from 'child_process';
import { Parse } from 'unzipper';
import { spinner } from '@clack/prompts';
import pc from 'picocolors';
import { getCacheDir } from './cache.js';

export interface PackageDep {
  /** Unique name or identifier for the dependency */
  name: string;
  /** Optional version indicator */
  version?: string;
  /** Download URL */
  url: string;
  /** Relative target file path (e.g. "deps/capstone.dll" or filename "capstone.dll") */
  target: string;
  /** Expected SHA-1 hash for verification (optional) */
  sha1?: string;
  /** Expected SHA-256 hash for verification (optional) */
  sha256?: string;
  /**
   * If the download is a zip archive, specify the entry filename to extract.
   * E.g. "capstone.dll" will locate and extract only that file.
   */
  extractFromZip?: string;
  /** If true, unzips all contents into the target directory */
  extractAll?: boolean;
}

export interface PackageDepsConfig {
  dependencies: PackageDep[];
}

export interface DownloadResult {
  name: string;
  target: string;
  status: 'skipped' | 'downloaded' | 'failed';
  error?: Error;
  message?: string;
}

export interface DownloadOptions {
  force?: boolean;
  silent?: boolean;
  useCache?: boolean;
  onProgress?: (message: string) => void;
}

/**
 * Resolves the persistent cache directory for Exoproc binary dependencies (e.g. ~/.cache/exoproc/deps)
 */
export function getDepsCacheDir(): string {
  return getCacheDir('deps');
}

export function computeHash(
  filePath: string,
  algorithm: 'sha1' | 'sha256' = 'sha1',
): string {
  const fileBuffer = readFileSync(filePath);
  return createHash(algorithm).update(fileBuffer).digest('hex');
}

export function verifyChecksum(
  filePath: string,
  dep: { sha1?: string; sha256?: string },
): boolean {
  if (!existsSync(filePath)) return false;
  try {
    if (dep.sha1) {
      const actualSha1 = computeHash(filePath, 'sha1');
      if (actualSha1.toLowerCase() !== dep.sha1.toLowerCase()) {
        return false;
      }
    }
    if (dep.sha256) {
      const actualSha256 = computeHash(filePath, 'sha256');
      if (actualSha256.toLowerCase() !== dep.sha256.toLowerCase()) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function downloadFile(
  url: string,
  destPath: string,
): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download from ${url}: ${response.status} ${response.statusText}`,
    );
  }
  if (!response.body) {
    throw new Error(`Failed to download from ${url}: Empty response body`);
  }
  const destDir = dirname(destPath);
  if (destDir && destDir !== '.' && !existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pipeline(response.body as any, createWriteStream(destPath));
}

export function downloadFileSync(url: string, destPath: string): void {
  const destDir = dirname(destPath);
  if (destDir && destDir !== '.' && !existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  const dlScript = `
fetch(${JSON.stringify(url)}).then(function(r) {
  if (!r.ok) { process.exit(1); }
  return r.arrayBuffer();
}).then(function(ab) {
  require('node:fs').writeFileSync(${JSON.stringify(destPath)}, Buffer.from(ab));
  process.exit(0);
}).catch(function() {
  process.exit(1);
});
`.trim();

  // 1. Try using the current process executable (Bun, Node, or compiled exoproc executable)
  const execPath = process.execPath;
  if (execPath) {
    const execBase = basename(execPath).toLowerCase();
    if (execBase.includes('node') || execBase.includes('bun')) {
      try {
        const res = spawnSync(execPath, ['-e', dlScript], {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 120000,
        });
        if (
          res.status === 0 &&
          existsSync(destPath) &&
          statSync(destPath).size > 0
        ) {
          return;
        }
      } catch {}
    } else {
      // Compiled executable (e.g. exoproc / exoproc.exe) invoking its internal download command
      try {
        const res = spawnSync(
          execPath,
          ['__internal_download', url, destPath],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 120000,
          },
        );
        if (
          res.status === 0 &&
          existsSync(destPath) &&
          statSync(destPath).size > 0
        ) {
          return;
        }
      } catch {}
    }
  }

  // 2. Try global bun or node binaries if in PATH
  for (const bin of ['bun', 'node']) {
    try {
      const res = spawnSync(bin, ['-e', dlScript], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
      });
      if (
        res.status === 0 &&
        existsSync(destPath) &&
        statSync(destPath).size > 0
      ) {
        return;
      }
    } catch {}
  }

  // 3. Fallback: curl if available as last resort
  try {
    execSync(`curl -fsSL -o "${destPath}" "${url}"`, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
    });
    if (existsSync(destPath) && statSync(destPath).size > 0) {
      return;
    }
  } catch {}

  throw new Error(`Synchronous download failed for ${url}`);
}

export function extractEntryFromZip(
  zipPath: string,
  destFile: string,
  entryName: string,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const destDir = dirname(destFile);
    if (destDir && destDir !== '.' && !existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    let found = false;
    const readStream = createReadStream(zipPath);
    const stream = readStream.pipe(Parse());

    stream.on('entry', (entry: any) => {
      const fileName = basename(entry.path);

      if (!found && fileName.toLowerCase() === entryName.toLowerCase()) {
        entry
          .pipe(createWriteStream(destFile))
          .on('finish', () => {
            found = true;
          })
          .on('error', (err: any) => {
            readStream.destroy();
            rejectPromise(err);
          });
      } else {
        entry.autodrain();
      }
    });

    stream.on('finish', () => {
      readStream.destroy();
      if (found) resolvePromise();
      else
        rejectPromise(
          new Error(`Could not find ${entryName} in archive ${zipPath}`),
        );
    });

    stream.on('error', (err: any) => {
      readStream.destroy();
      rejectPromise(err);
    });
  });
}

/**
 * Synchronous ZIP entry extraction in 100% pure TypeScript/JavaScript.
 * Operates entirely in-memory using Node/Bun's native zlib.inflateRawSync,
 * requiring zero external binaries (no PowerShell, no unzip, no python).
 */
export function extractEntryFromZipSync(
  zipPath: string,
  destFile: string,
  entryName: string,
): void {
  const destDir = dirname(destFile);
  if (destDir && destDir !== '.' && !existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  const zipBuf = readFileSync(zipPath);

  // Locate End of Central Directory Record (EOCD).
  // Signature is 0x06054b50 (PK\x05\x06), min size 22 bytes.
  let eocdOffset = -1;
  const maxComment = 65535;
  const minEocdSearch = Math.max(0, zipBuf.length - 22 - maxComment);
  for (let i = zipBuf.length - 22; i >= minEocdSearch; i--) {
    if (zipBuf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error(
      `Invalid ZIP archive ${zipPath}: End of Central Directory record not found`,
    );
  }

  const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);

  const targetNameLower = entryName.toLowerCase();
  const targetBaseName = basename(entryName).toLowerCase();

  let currentOffset = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (currentOffset + 46 > zipBuf.length) {
      break;
    }

    const sig = zipBuf.readUInt32LE(currentOffset);
    if (sig !== 0x02014b50) {
      throw new Error(
        `Corrupt ZIP archive ${zipPath}: expected Central Directory signature 0x02014b50 at offset ${currentOffset}`,
      );
    }

    const method = zipBuf.readUInt16LE(currentOffset + 10);
    const compressedSize = zipBuf.readUInt32LE(currentOffset + 20);
    const fileNameLen = zipBuf.readUInt16LE(currentOffset + 28);
    const extraLen = zipBuf.readUInt16LE(currentOffset + 30);
    const commentLen = zipBuf.readUInt16LE(currentOffset + 32);
    const localHeaderOffset = zipBuf.readUInt32LE(currentOffset + 42);

    const fileName = zipBuf.toString(
      'utf8',
      currentOffset + 46,
      currentOffset + 46 + fileNameLen,
    );
    currentOffset += 46 + fileNameLen + extraLen + commentLen;

    const fileBaseName = basename(fileName).toLowerCase();
    const fileNameLower = fileName.toLowerCase();

    if (
      fileNameLower === targetNameLower ||
      fileBaseName === targetBaseName ||
      fileNameLower.endsWith('/' + targetNameLower) ||
      fileNameLower.endsWith('\\' + targetNameLower)
    ) {
      // Read Local File Header
      if (localHeaderOffset + 30 > zipBuf.length) {
        throw new Error(
          `Corrupt ZIP archive ${zipPath}: invalid local header offset`,
        );
      }

      const localSig = zipBuf.readUInt32LE(localHeaderOffset);
      if (localSig !== 0x04034b50) {
        throw new Error(
          `Corrupt ZIP archive ${zipPath}: expected Local Header signature 0x04034b50 at offset ${localHeaderOffset}`,
        );
      }

      const localNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

      if (dataOffset + compressedSize > zipBuf.length) {
        throw new Error(`Corrupt ZIP archive ${zipPath}: truncated entry data`);
      }

      const compressedData = zipBuf.subarray(
        dataOffset,
        dataOffset + compressedSize,
      );
      let decompressed: Buffer;

      if (method === 0) {
        decompressed = compressedData;
      } else if (method === 8) {
        decompressed = inflateRawSync(compressedData);
      } else {
        throw new Error(
          `Unsupported ZIP compression method ${method} for entry ${fileName} in ${zipPath}`,
        );
      }

      writeFileSync(destFile, decompressed);
      return;
    }
  }

  throw new Error(`Could not find ${entryName} in archive ${zipPath}`);
}

export function extractAllFromZip(
  zipPath: string,
  destDir: string,
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    mkdirSync(destDir, { recursive: true });

    const readStream = createReadStream(zipPath);
    const stream = readStream.pipe(Parse());

    stream.on('entry', (entry: any) => {
      const targetPath = join(destDir, entry.path);
      if (entry.type === 'Directory') {
        mkdirSync(targetPath, { recursive: true });
        entry.autodrain();
      } else {
        mkdirSync(dirname(targetPath), { recursive: true });
        entry.pipe(createWriteStream(targetPath));
      }
    });

    stream.on('finish', () => {
      readStream.destroy();
      resolvePromise();
    });

    stream.on('error', (err: any) => {
      readStream.destroy();
      rejectPromise(err);
    });
  });
}

/**
 * Checks if a dependency is already satisfied locally in the package or in the central cache.
 * Returns the valid file path, or null if it must be downloaded.
 */
export function resolveDepPath(
  dep: PackageDep,
  packageDir?: string,
): string | null {
  const filename = basename(dep.target);

  // 1. Check local target path if packageDir is provided
  if (packageDir) {
    const localTarget = isAbsolute(dep.target)
      ? dep.target
      : resolve(packageDir, dep.target);
    if (verifyChecksum(localTarget, dep)) {
      return localTarget;
    }
  }

  // 2. Check central cache directory (~/.cache/exoproc/deps/filename)
  const cachedPath = join(getDepsCacheDir(), filename);
  if (verifyChecksum(cachedPath, dep)) {
    return cachedPath;
  }

  return null;
}

/**
 * Resolves a dependency path, or automatically downloads and caches it on first use (asynchronous).
 * Always caches into ~/.cache/exoproc/deps/ so it is permanently available to all tools.
 */
export async function resolveOrDownloadDep(
  dep: PackageDep,
  packageDir?: string,
  options: DownloadOptions = {},
): Promise<string> {
  const { force = false, silent = false, onProgress } = options;
  const logMessage = (msg: string) => {
    if (!silent) {
      if (onProgress) onProgress(msg);
      else console.error(msg);
    }
  };

  if (!force) {
    const existing = resolveDepPath(dep, packageDir);
    if (existing) {
      return existing;
    }
  }

  const filename = basename(dep.target);
  const cacheDest = join(getDepsCacheDir(), filename);
  const tempDir = join(
    tmpdir(),
    `exoproc-dep-${randomBytes(6).toString('hex')}`,
  );
  mkdirSync(tempDir, { recursive: true });

  try {
    logMessage(`[${dep.name}] Fetching dependency into cache: ${cacheDest}...`);

    if (dep.extractFromZip) {
      const tempZip = join(tempDir, `${randomBytes(6).toString('hex')}.zip`);
      await downloadFile(dep.url, tempZip);
      await extractEntryFromZip(tempZip, cacheDest, dep.extractFromZip);
      await rm(tempZip, { force: true });
    } else if (dep.extractAll) {
      const tempZip = join(tempDir, `${randomBytes(6).toString('hex')}.zip`);
      await downloadFile(dep.url, tempZip);
      await extractAllFromZip(tempZip, cacheDest);
      await rm(tempZip, { force: true });
    } else {
      await downloadFile(dep.url, cacheDest);
    }

    if (!verifyChecksum(cacheDest, dep)) {
      await rm(cacheDest, { force: true });
      throw new Error(`Checksum verification failed for ${dep.name}`);
    }

    logMessage(`[${dep.name}] Successfully cached at ${cacheDest}`);

    // If packageDir is provided and different from cache, also copy to packageDir target if requested
    if (packageDir) {
      const localTarget = isAbsolute(dep.target)
        ? dep.target
        : resolve(packageDir, dep.target);
      if (localTarget !== cacheDest) {
        try {
          mkdirSync(dirname(localTarget), { recursive: true });
          copyFileSync(cacheDest, localTarget);
        } catch {}
      }
    }

    return cacheDest;
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3 });
  }
}

/**
 * Synchronous version of resolveOrDownloadDep.
 * Resolves immediately from cache/local, or downloads synchronously via curl/PowerShell on first run.
 */
export function resolveOrDownloadDepSync(
  dep: PackageDep,
  packageDir?: string,
  options: DownloadOptions = {},
): string {
  const { force = false, silent = false, onProgress } = options;
  const logMessage = (msg: string) => {
    if (!silent) {
      if (onProgress) onProgress(msg);
      else console.error(msg);
    }
  };

  if (!force) {
    const existing = resolveDepPath(dep, packageDir);
    if (existing) {
      return existing;
    }
  }

  const filename = basename(dep.target);
  const cacheDest = join(getDepsCacheDir(), filename);
  const tempDir = join(
    tmpdir(),
    `exoproc-dep-sync-${randomBytes(6).toString('hex')}`,
  );
  mkdirSync(tempDir, { recursive: true });

  try {
    logMessage(
      `[${dep.name}] Downloading into persistent cache: ${cacheDest}...`,
    );

    if (dep.extractFromZip) {
      const tempZip = join(tempDir, `${randomBytes(6).toString('hex')}.zip`);
      downloadFileSync(dep.url, tempZip);
      extractEntryFromZipSync(tempZip, cacheDest, dep.extractFromZip);
      rmSync(tempZip, { force: true });
    } else {
      downloadFileSync(dep.url, cacheDest);
    }

    if (!verifyChecksum(cacheDest, dep)) {
      rmSync(cacheDest, { force: true });
      throw new Error(`Checksum verification failed for ${dep.name}`);
    }

    logMessage(
      `[${dep.name}] Cached and verified successfully at ${cacheDest}`,
    );

    if (packageDir) {
      const localTarget = isAbsolute(dep.target)
        ? dep.target
        : resolve(packageDir, dep.target);
      if (localTarget !== cacheDest) {
        try {
          mkdirSync(dirname(localTarget), { recursive: true });
          copyFileSync(cacheDest, localTarget);
        } catch {}
      }
    }

    return cacheDest;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Downloads all dependencies declared in a package directory's deps.json or config object.
 */
export async function downloadPackageDeps(
  packageDir: string,
  configOrFile?: string | PackageDepsConfig,
  options: DownloadOptions = {},
): Promise<DownloadResult[]> {
  let config: PackageDepsConfig;
  if (!configOrFile) {
    const defaultJson = join(packageDir, 'deps.json');
    const altJson = join(packageDir, 'exoproc-deps.json');
    if (existsSync(defaultJson)) {
      config = JSON.parse(readFileSync(defaultJson, 'utf-8'));
    } else if (existsSync(altJson)) {
      config = JSON.parse(readFileSync(altJson, 'utf-8'));
    } else {
      return [];
    }
  } else if (typeof configOrFile === 'string') {
    const resolvedPath = isAbsolute(configOrFile)
      ? configOrFile
      : join(packageDir, configOrFile);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Deps config file not found at: ${resolvedPath}`);
    }
    config = JSON.parse(readFileSync(resolvedPath, 'utf-8'));
  } else {
    config = configOrFile;
  }

  const results: DownloadResult[] = [];

  for (const dep of config.dependencies) {
    try {
      const cachedOrLocal = await resolveOrDownloadDep(
        dep,
        packageDir,
        options,
      );
      results.push({
        name: dep.name,
        target: cachedOrLocal,
        status: 'downloaded',
        message: 'Cached and verified',
      });
    } catch (err: any) {
      results.push({
        name: dep.name,
        target: dep.target,
        status: 'failed',
        error: err,
        message: err.message,
      });
      throw err;
    }
  }

  return results;
}

/**
 * Discovers and returns all package directories containing deps.json or exoproc-deps.json
 */
export function findWorkspaceDepsConfigs(
  workspaceRoot: string,
): { packageDir: string; configPath: string; packageName?: string }[] {
  const found: {
    packageDir: string;
    configPath: string;
    packageName?: string;
  }[] = [];

  const packagesDir = join(workspaceRoot, 'packages');
  if (!existsSync(packagesDir)) return found;

  const searchDir = (dir: string) => {
    if (!existsSync(dir)) return;
    const items = readdirSync(dir, { withFileTypes: true });

    const depsPath = join(dir, 'deps.json');
    const altDepsPath = join(dir, 'exoproc-deps.json');

    if (existsSync(depsPath)) {
      let pkgName: string | undefined;
      const pkgJson = join(dir, 'package.json');
      if (existsSync(pkgJson)) {
        try {
          pkgName = JSON.parse(readFileSync(pkgJson, 'utf-8')).name;
        } catch {
          // ignore
        }
      }
      found.push({
        packageDir: dir,
        configPath: depsPath,
        packageName: pkgName,
      });
    } else if (existsSync(altDepsPath)) {
      let pkgName: string | undefined;
      const pkgJson = join(dir, 'package.json');
      if (existsSync(pkgJson)) {
        try {
          pkgName = JSON.parse(readFileSync(pkgJson, 'utf-8')).name;
        } catch {
          // ignore
        }
      }
      found.push({
        packageDir: dir,
        configPath: altDepsPath,
        packageName: pkgName,
      });
    }

    for (const item of items) {
      if (
        item.isDirectory() &&
        item.name !== 'node_modules' &&
        item.name !== 'dist'
      ) {
        searchDir(join(dir, item.name));
      }
    }
  };

  searchDir(packagesDir);
  return found;
}

/**
 * Downloads all dependencies across all packages in the workspace that define a deps.json.
 */
export async function downloadAllWorkspaceDeps(
  workspaceRoot: string,
  options: DownloadOptions = {},
): Promise<Map<string, DownloadResult[]>> {
  const configs = findWorkspaceDepsConfigs(workspaceRoot);
  const results = new Map<string, DownloadResult[]>();

  for (const cfg of configs) {
    const pkgTitle = cfg.packageName || basename(cfg.packageDir);
    const s = options.silent ? null : spinner();
    s?.start(`Checking dependencies for ${pc.cyan(pkgTitle)}...`);

    try {
      const pkgResults = await downloadPackageDeps(
        cfg.packageDir,
        cfg.configPath,
        options,
      );
      results.set(pkgTitle, pkgResults);
      s?.stop(`Dependencies verified for ${pc.cyan(pkgTitle)}`);
    } catch (err) {
      s?.stop(pc.red(`Failed dependencies for ${pkgTitle}`));
      throw err;
    }
  }

  return results;
}

export interface DepCheckResult {
  name: string;
  target: string;
  filename: string;
  resolvedPath?: string;
  source: 'cache' | 'local' | 'missing';
  expectedSha1?: string;
  actualSha1?: string;
  expectedSha256?: string;
  actualSha256?: string;
  status: 'verified' | 'mismatch' | 'not_cached';
  error?: string;
}

export const STANDARD_EXOPROC_DEPS: PackageDep[] = [
  {
    name: 'Capstone 4.0.2 (Windows x64)',
    version: '4.0.2',
    url: 'https://github.com/capstone-engine/capstone/releases/download/4.0.2/capstone-4.0.2-win64.zip',
    target: 'deps/capstone.dll',
    extractFromZip: 'capstone.dll',
    sha1: 'c87eb26c07bb923b6a04da3cbc31b49f64c0c59a',
    sha256: 'f03321188a1615d044314b1183dcd9a7ffda09286c31c369d109165d4892dcbb',
  },
  {
    name: 'ECJ 3.26.0 (Java 8)',
    version: '3.26.0',
    url: 'https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/3.26.0/ecj-3.26.0.jar',
    target: 'deps/ecj-3.26.0.jar',
    sha1: '4837be609a3368a0f7e7cf0dc1bdbc7fe94993de',
  },
  {
    name: 'ECJ 3.46.100 (Java 17+)',
    version: '3.46.100',
    url: 'https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/3.46.100/ecj-3.46.100.jar',
    target: 'deps/ecj-3.46.100.jar',
    sha1: 'a06c482cdb8601a94328aae668c7236e3818fbe9',
  },
  {
    name: 'Tiny-Remapper 0.14.1 (Fat)',
    version: '0.14.1',
    url: 'https://maven.fabricmc.net/net/fabricmc/tiny-remapper/0.14.1/tiny-remapper-0.14.1-fat.jar',
    target: 'deps/tiny-remapper-0.14.1-fat.jar',
    sha1: '0cae38cf0446be5f17f8cb58df8fdfac56aabcbd',
  },
];

/**
 * Inspects a single binary dependency, calculates its SHA-1/SHA-256 checksum,
 * and verifies it against the expected hash.
 */
export function inspectDepChecksum(
  dep: PackageDep,
  packageDir?: string,
): DepCheckResult {
  const filename = basename(dep.target);
  let foundPath: string | null = null;
  let source: 'cache' | 'local' | 'missing' = 'missing';

  // 1. Check local target path if packageDir is provided
  if (packageDir) {
    const localTarget = isAbsolute(dep.target)
      ? dep.target
      : resolve(packageDir, dep.target);
    if (existsSync(localTarget)) {
      foundPath = localTarget;
      source = 'local';
    }
  }

  // 2. Check central cache directory (~/.cache/exoproc/deps/filename)
  if (!foundPath) {
    const cachedPath = join(getDepsCacheDir(), filename);
    if (existsSync(cachedPath)) {
      foundPath = cachedPath;
      source = 'cache';
    }
  }

  // 3. Check fallback repository candidate paths
  if (!foundPath) {
    const cwd = process.cwd();
    const candidateDirs = [
      join(cwd, 'packages/java/jjit/deps'),
      join(cwd, 'packages/capstone/core/deps'),
      join(cwd, 'packages/exoproc/dist/deps'),
      join(cwd, 'packages/exoproc/dist'),
      join(cwd, 'deps'),
    ];
    for (const dir of candidateDirs) {
      const p = join(dir, filename);
      if (existsSync(p)) {
        foundPath = p;
        source = 'local';
        break;
      }
    }
  }

  if (!foundPath) {
    return {
      name: dep.name,
      target: dep.target,
      filename,
      source: 'missing',
      status: 'not_cached',
      expectedSha1: dep.sha1,
      expectedSha256: dep.sha256,
    };
  }

  let actualSha1: string | undefined;
  let actualSha256: string | undefined;
  try {
    actualSha1 = computeHash(foundPath, 'sha1');
    if (dep.sha256) {
      actualSha256 = computeHash(foundPath, 'sha256');
    }
  } catch (err: any) {
    return {
      name: dep.name,
      target: dep.target,
      filename,
      resolvedPath: foundPath,
      source,
      status: 'mismatch',
      expectedSha1: dep.sha1,
      expectedSha256: dep.sha256,
      error: `Failed to compute hash: ${err?.message || String(err)}`,
    };
  }

  let isMatch = true;
  let errorMsg: string | undefined;

  if (dep.sha1 && actualSha1) {
    if (actualSha1.toLowerCase() !== dep.sha1.toLowerCase()) {
      isMatch = false;
      errorMsg = `SHA-1 mismatch: expected ${dep.sha1}, got ${actualSha1}`;
    }
  }
  if (dep.sha256 && actualSha256) {
    if (actualSha256.toLowerCase() !== dep.sha256.toLowerCase()) {
      isMatch = false;
      errorMsg = `SHA-256 mismatch: expected ${dep.sha256}, got ${actualSha256}`;
    }
  }

  return {
    name: dep.name,
    target: dep.target,
    filename,
    resolvedPath: foundPath,
    source,
    expectedSha1: dep.sha1,
    actualSha1,
    expectedSha256: dep.sha256,
    actualSha256,
    status: isMatch ? 'verified' : 'mismatch',
    error: errorMsg,
  };
}

/**
 * Inspects all known dependencies across workspace deps.json configs and standard dependencies,
 * verifying their SHA checksums.
 */
export function inspectAllDeps(workspaceRoot?: string): DepCheckResult[] {
  const root = workspaceRoot || process.cwd();
  const configs = findWorkspaceDepsConfigs(root);
  const results: DepCheckResult[] = [];
  const processedFilenames = new Set<string>();

  if (configs.length > 0) {
    for (const cfg of configs) {
      try {
        const content = JSON.parse(readFileSync(cfg.configPath, 'utf-8'));
        if (Array.isArray(content.dependencies)) {
          for (const dep of content.dependencies) {
            const res = inspectDepChecksum(dep, cfg.packageDir);
            results.push(res);
            processedFilenames.add(res.filename.toLowerCase());
          }
        }
      } catch {
        // ignore
      }
    }
  }

  // Ensure all standard Exoproc tools are inspected
  for (const stdDep of STANDARD_EXOPROC_DEPS) {
    const fn = basename(stdDep.target).toLowerCase();
    if (!processedFilenames.has(fn)) {
      results.push(inspectDepChecksum(stdDep));
      processedFilenames.add(fn);
    }
  }

  return results;
}
