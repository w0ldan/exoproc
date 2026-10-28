import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Resolves the persistent root cache directory for Exoproc tools and libraries.
 * Standard OS paths:
 *   - Linux/macOS: $XDG_CACHE_HOME/exoproc or ~/.cache/exoproc
 *   - Windows: %LOCALAPPDATA%\exoproc\cache or %USERPROFILE%\.cache\exoproc
 *   - Fallback: <system_temp>/exoproc_cache
 */
export function getCacheDir(subpath?: string): string {
  let baseDir: string;

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    const userProfile = process.env.USERPROFILE;
    if (localAppData) {
      baseDir = join(localAppData, 'exoproc', 'cache');
    } else if (userProfile) {
      baseDir = join(userProfile, '.cache', 'exoproc');
    } else {
      baseDir = join(tmpdir(), 'exoproc_cache');
    }
  } else {
    const xdgCache = process.env.XDG_CACHE_HOME;
    const home = process.env.HOME;
    if (xdgCache) {
      baseDir = join(xdgCache, 'exoproc');
    } else if (home) {
      baseDir = join(home, '.cache', 'exoproc');
    } else {
      baseDir = join(tmpdir(), 'exoproc_cache');
    }
  }

  const finalDir = subpath ? join(baseDir, subpath) : baseDir;
  if (!existsSync(finalDir)) {
    try {
      mkdirSync(finalDir, { recursive: true });
    } catch {}
  }
  return finalDir;
}

/**
 * Resolves the real system temp directory (os.tmpdir()).
 * Never creates arbitrary workspace tmp/ directories.
 */
export function getRealTempDir(subpath?: string): string {
  const base = tmpdir();
  if (!subpath) return base;
  const target = join(base, subpath);
  if (!existsSync(target)) {
    try {
      mkdirSync(target, { recursive: true });
    } catch {}
  }
  return target;
}

/**
 * Returns the standard cache directory for compiled Java agents and mappings.
 * e.g. ~/.cache/exoproc/agents
 */
export function getAgentCacheDir(): string {
  return getCacheDir('agents');
}

/**
 * Returns the standard path to the daemon runtime state file.
 * e.g. ~/.cache/exoproc/.exoproc-daemon.json
 */
export function getDaemonStatePath(): string {
  return join(getCacheDir(), '.exoproc-daemon.json');
}

/**
 * Cleans up a cache subpath or the root cache directory.
 */
export function clearCache(subpath?: string): void {
  const dir = getCacheDir(subpath);
  if (existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}
