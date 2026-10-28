/**
 * Path utilities for the single workspace scheme the shell speaks.
 *
 * The plan for this layer originally called for a `URI` class mirroring
 * `packages/simulate/src/platform/files/resource-uri.ts` -- but that was
 * written before `FsChannel` existed. Once `FsChannel`/`FsApi` were
 * actually built (F3), the deliberate choice there was plain POSIX-style
 * path strings, not a `ResourceUri`: the renderer has exactly one
 * workspace mounted at a time, no multi-scheme, no multi-root, so a full
 * URI (scheme + authority + path) would model distinctions this app
 * never has. These functions operate on that same plain-string contract
 * instead of introducing a type nothing else here uses.
 */

export function normalizePath(path: string): string {
  const withSlashes = path.replace(/\\/g, '/');
  const withLeadingSlash = withSlashes.startsWith('/')
    ? withSlashes
    : `/${withSlashes}`;
  const collapsed = withLeadingSlash.replace(/\/+/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/$/, '') : collapsed;
}

export function basename(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

export function dirname(path: string): string {
  const normalized = normalizePath(path);
  const separator = normalized.lastIndexOf('/');
  return separator <= 0 ? '/' : normalized.slice(0, separator);
}

export function joinPath(path: string, ...segments: readonly string[]): string {
  return normalizePath([path, ...segments].join('/'));
}

export function extname(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot);
}

/** True when `path` is `candidate` itself or a descendant of it. */
export function isEqualOrParent(path: string, candidate: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedCandidate = normalizePath(candidate);
  return (
    normalizedPath === normalizedCandidate ||
    normalizedPath.startsWith(
      normalizedCandidate === '/' ? '/' : `${normalizedCandidate}/`,
    )
  );
}
