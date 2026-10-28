export interface HostDirectoryEntry {
  readonly name: string;
}

export interface HostFileStat {
  readonly birthtime: Date;
  isDirectory(): boolean;
}

export interface HostFileSystemModule {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options: { recursive: true }): unknown;
  readdirSync(path: string): string[];
  readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): HostDirectoryEntry[];
  readFileSync(path: string): Uint8Array;
  statSync(path: string): HostFileStat;
  unlinkSync(path: string): void;
  writeFileSync(path: string, data: Uint8Array): void;
  rmSync(path: string, options: { recursive: true; force?: boolean }): unknown;
  renameSync(oldPath: string, newPath: string): unknown;
}

export interface HostPathModule {
  dirname(path: string): string;
  join(...paths: string[]): string;
  resolve(path: string): string;
}

export interface HostProcess {
  cwd(): string;
  getBuiltinModule?(specifier: string): unknown;
}

export interface HostRuntime {
  readonly fileSystem: HostFileSystemModule;
  readonly path: HostPathModule;
  readonly process: HostProcess;
}

function autoDetectHostRuntime(): HostRuntime | undefined {
  const hostProcess = (
    globalThis as typeof globalThis & { process?: HostProcess }
  ).process;
  const getBuiltinModule = hostProcess?.getBuiltinModule;
  if (!hostProcess || !getBuiltinModule) return undefined;

  const fileSystem = getBuiltinModule.call(hostProcess, 'node:fs') as
    HostFileSystemModule | undefined;
  const path = getBuiltinModule.call(hostProcess, 'node:path') as
    HostPathModule | undefined;
  if (!fileSystem || !path) return undefined;

  return { fileSystem, path, process: hostProcess };
}

/** Computed once per realm -- the Bun/Node CLI/test-mode default, unrelated to any one `Win32FileSystem` instance. */
const autoDetectedHostRuntime = autoDetectHostRuntime();

export type Win32FileSystemEntryKind = 'directory' | 'file';

export const WIN32_WORKSPACE_PATH = 'C:\\Users\\Serkan\\Workspace';

export interface Win32FileSystemEntry {
  readonly kind: Win32FileSystemEntryKind;
  readonly name: string;
  readonly path: string;
  readonly createdAt: Date;
  data: Uint8Array;
}

/** One in-memory `entries` row, keyed by its (already-lowercased) map key -- see `Win32FileSystem.snapshotState()`. */
export interface Win32FileSystemEntrySnapshot {
  readonly key: string;
  readonly kind: Win32FileSystemEntryKind;
  readonly name: string;
  readonly path: string;
  readonly createdAt: Date;
  readonly data: Uint8Array;
}

export type Win32FileSystemSnapshot = readonly Win32FileSystemEntrySnapshot[];

const DEFAULT_TIMESTAMP = new Date('2026-07-23T12:00:00Z');

function parentPath(path: string): string | undefined {
  if (/^[A-Z]:\\$/i.test(path)) return undefined;
  const separator = path.lastIndexOf('\\');
  if (separator <= 2) return `${path.slice(0, 2)}\\`;
  return path.slice(0, separator);
}

interface FolderBind {
  /** Already `normalize()`d (uppercase drive letter, backslashes, no
   * trailing separator except a bare drive root like `C:\`). */
  readonly simulatedPrefix: string;
  /** Absolute real host path (`node:path`-resolved), in the host OS's own
   * separator convention. */
  readonly realHostPath: string;
}

/**
 * Case-insensitive Win32 filesystem shared by every process in a Win64Machine.
 *
 * ## Folder binds
 *
 * `bindFolder(simulatedPrefix, realHostPath)` mounts a real host directory
 * under a simulated path prefix -- the same idea as a Docker bind mount,
 * WSL's `/mnt/c`, or a Wine drive mapping. Once bound, every
 * `getEntry`/`readFile`/`writeFile`/`writeFileAt`/`deleteFile`/
 * `readDirectory` call whose (normalized) path falls under that prefix is
 * transparently redirected to the real host file via the runtime's
 * synchronous host filesystem module instead of this class's own in-memory
 * `entries` map -- reads/writes genuinely touch the real file, nothing is
 * cached. This is what lets code running *inside* the simulation (e.g. a
 * worker that just `enterSimulatedProcess`d) read a real, already-`tsc`-
 * compiled `.js` file from `packages/simulate/dist/` without needing to
 * bundle/inline it first.
 *
 * The host runtime a bind actually uses is resolved per-instance
 * (`setHostRuntime`) with a Bun/Node auto-detected fallback -- see
 * `requireHostRuntime()`. This is the seam a browser host (which has no
 * `node:fs` at all) plugs a synchronous, non-Node-shaped backend into
 * (OPFS-backed, in `apps/docs`; deliberately not implemented here -- this
 * package stays unaware OPFS exists at all).
 *
 * Binds are checked before the in-memory store on every call, longest
 * matching prefix wins (so a narrower bind nested under a wider one takes
 * priority). Paths outside any bound prefix behave exactly as before.
 */
export class Win32FileSystem {
  private readonly entries = new Map<string, Win32FileSystemEntry>();
  private readonly binds: FolderBind[] = [];
  private injectedHostRuntime: HostRuntime | undefined;

  constructor() {
    this.createDirectory('C:\\');
    this.createDirectory('C:\\Windows\\System32');
    this.createDirectory('C:\\Users\\Serkan\\Desktop');
    this.createDirectory('C:\\Users\\Serkan\\Documents');
    this.createDirectory('C:\\Users\\Serkan\\Downloads');
    this.createDirectory(WIN32_WORKSPACE_PATH);
    this.writeTextFile(
      'C:\\Users\\Serkan\\welcome.txt',
      'Welcome to the Exoproc Win64 machine.\r\n',
    );
    this.writeTextFile(
      'C:\\Users\\Serkan\\Documents\\notes.txt',
      'Win64 ABI experiments\r\n',
    );
    this.writeTextFile(
      `${WIN32_WORKSPACE_PATH}\\01-hello.ts`,
      `// 01-hello.ts - Win32 Simülasyonu & TypeScript Testi\nimport { dlopen, FFIType } from 'bun:ffi';\n\nconsole.log('🚀 Merhaba! Exoproc Win32 Simülasyonu çalışıyor.');\nconsole.log('PID:', process.pid);\n\nconst kernel32 = dlopen('kernel32', {\n  GetCurrentProcessId: { args: [], returns: FFIType.u32 },\n  GetCurrentThreadId: { args: [], returns: FFIType.u32 },\n});\n\nconsole.log('kernel32!GetCurrentProcessId() ->', kernel32.symbols.GetCurrentProcessId());\nconsole.log('kernel32!GetCurrentThreadId()  ->', kernel32.symbols.GetCurrentThreadId());\n`,
    );
    this.writeTextFile(
      `${WIN32_WORKSPACE_PATH}\\02-thread-hijack.ts`,
      `// 02-thread-hijack.ts - nthread Thread Redirection Demosu\nimport { dlopen, FFIType } from 'bun:ffi';\n\nconst kernel32 = dlopen('kernel32', {\n  GetCurrentThread: { args: [], returns: FFIType.u64 },\n  GetCurrentThreadId: { args: [], returns: FFIType.u32 },\n  GetThreadContext: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool },\n  SetThreadContext: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.bool },\n});\n\nconsole.log('=== nthread: x64 Thread Redirection ===');\nconst tid = kernel32.symbols.GetCurrentThreadId();\nconsole.log('[1] Thread ID:', tid);\n\nconst hThread = kernel32.symbols.GetCurrentThread();\nconsole.log('[2] Thread Handle: 0x' + hThread.toString(16));\n\nconst context = Buffer.alloc(1232);\ncontext.writeUInt32LE(0x00100003, 0x30); // CONTROL | INTEGER\n\nconst ok = kernel32.symbols.GetThreadContext(hThread, context);\nconsole.log('[3] GetThreadContext:', ok);\nconsole.log('[4] RIP:', '0x' + context.readBigUInt64LE(0xf8).toString(16));\nconsole.log('[5] RSP:', '0x' + context.readBigUInt64LE(0x98).toString(16));\nconsole.log('[6] RAX:', '0x' + context.readBigUInt64LE(0x78).toString(16));\nconsole.log('✅ İşlem tamamlandı!');\n`,
    );
    this.writeTextFile(
      `${WIN32_WORKSPACE_PATH}\\03-loop-worker.ts`,
      `// 03-loop-worker.ts - Kendi kendine döngüde olan hesaplama işlemi\nconsole.log('🔄 Döngü başlatıldı (PID:', process.pid, ')');\nlet sum = 0;\nfor (let i = 0; i < 1_000_000; i++) {\n  sum += (i % 5) * 2;\n}\nconsole.log('✅ Hesaplama bitti, toplam:', sum);\n`,
    );
    this.bindWorkspace();
  }

  /**
   * Captures every in-memory (non-bound) file/directory for a VM snapshot
   * (see `Win64Machine.snapshot()`). Bound (host-backed) paths are never
   * materialized into `entries` in the first place -- reads/writes on them
   * always go straight to the live host -- so they're naturally excluded
   * here too, the same way `network`/other live external state is never
   * captured. Each entry's `data` is defensively copied (`.slice()`) so a
   * later write to the live filesystem can never mutate an already-taken
   * snapshot, mirroring `PhysicalPagePool.snapshotPages()`'s convention.
   */
  public snapshotState(): Win32FileSystemSnapshot {
    return [...this.entries.entries()].map(([key, entry]) => ({
      key,
      kind: entry.kind,
      name: entry.name,
      path: entry.path,
      createdAt: entry.createdAt,
      data: entry.data.slice(),
    }));
  }

  /** Replaces every in-memory entry with a `snapshotState()` result. Existing binds are untouched -- they're live host state, not part of any snapshot. */
  public restoreState(snapshot: Win32FileSystemSnapshot): void {
    this.entries.clear();
    for (const item of snapshot) {
      this.entries.set(item.key, {
        kind: item.kind,
        name: item.name,
        path: item.path,
        createdAt: item.createdAt,
        data: item.data.slice(),
      });
    }
  }

  /**
   * Overrides the host runtime this instance's binds use, in place of the
   * Bun/Node auto-detected default -- the only way a browser host (no
   * `node:fs`, no `process.getBuiltinModule`) can ever have folder binds
   * at all. Pass `undefined` to revert to auto-detection.
   */
  public setHostRuntime(runtime: HostRuntime | undefined): void {
    this.injectedHostRuntime = runtime;
  }

  private get hostRuntime(): HostRuntime | undefined {
    return this.injectedHostRuntime ?? autoDetectedHostRuntime;
  }

  private requireHostRuntime(): HostRuntime {
    const runtime = this.hostRuntime;
    if (!runtime) {
      throw new Error('Host folder binds are unavailable in this runtime.');
    }
    return runtime;
  }

  private hostExistsSync(path: string): boolean {
    return this.requireHostRuntime().fileSystem.existsSync(path);
  }

  private hostMkdirSync(path: string, options: { recursive: true }): void {
    this.requireHostRuntime().fileSystem.mkdirSync(path, options);
  }

  private hostReaddirSync(path: string): string[];
  private hostReaddirSync(
    path: string,
    options: { withFileTypes: true },
  ): HostDirectoryEntry[];
  private hostReaddirSync(
    path: string,
    options?: { withFileTypes: true },
  ): string[] | HostDirectoryEntry[] {
    const fileSystem = this.requireHostRuntime().fileSystem;
    return options
      ? fileSystem.readdirSync(path, options)
      : fileSystem.readdirSync(path);
  }

  private hostReadFileSync(path: string): Uint8Array {
    return this.requireHostRuntime().fileSystem.readFileSync(path);
  }

  private hostStatSync(path: string): HostFileStat {
    return this.requireHostRuntime().fileSystem.statSync(path);
  }

  private hostUnlinkSync(path: string): void {
    this.requireHostRuntime().fileSystem.unlinkSync(path);
  }

  private hostWriteFileSync(path: string, data: Uint8Array): void {
    this.requireHostRuntime().fileSystem.writeFileSync(path, data);
  }

  private hostRmSync(
    path: string,
    options: { recursive: true; force?: boolean },
  ): void {
    this.requireHostRuntime().fileSystem.rmSync(path, options);
  }

  private hostRenameSync(oldPath: string, newPath: string): void {
    this.requireHostRuntime().fileSystem.renameSync(oldPath, newPath);
  }

  private hostDirname(path: string): string {
    return this.requireHostRuntime().path.dirname(path);
  }

  private hostJoin(...paths: string[]): string {
    return this.requireHostRuntime().path.join(...paths);
  }

  private hostResolve(path: string): string {
    return this.requireHostRuntime().path.resolve(path);
  }

  private findHostProjectRoot(startPath?: string): string | undefined {
    const runtime = this.hostRuntime;
    if (!runtime) return undefined;

    const initialPath = startPath ?? runtime.process.cwd();
    const resolvedInitialPath = this.hostResolve(initialPath);
    let current = resolvedInitialPath;
    let projectRoot: string | undefined;

    let parent = this.hostDirname(current);
    while (parent !== current) {
      if (this.hostExistsSync(this.hostJoin(current, 'package.json'))) {
        projectRoot = current;
      }
      current = parent;
      parent = this.hostDirname(current);
    }

    if (this.hostExistsSync(this.hostJoin(current, 'package.json'))) {
      projectRoot = current;
    }

    const baseRoot = projectRoot ?? resolvedInitialPath;
    const simulatePackage = this.hostJoin(baseRoot, 'packages', 'simulate');
    if (this.hostExistsSync(this.hostJoin(simulatePackage, 'package.json'))) {
      return simulatePackage;
    }
    return baseRoot;
  }

  private resolveHostSegments(
    realHostPath: string,
    relativeSegments: readonly string[],
  ): string {
    let target = realHostPath;
    for (const segment of relativeSegments) {
      const existingName =
        this.hostExistsSync(target) && this.hostStatSync(target).isDirectory()
          ? this.hostReaddirSync(target).find(
              (name) => name.toLowerCase() === segment.toLowerCase(),
            )
          : undefined;
      target = this.hostJoin(target, existingName ?? segment);
    }
    return target;
  }

  public bindWorkspace(rootPath = this.findHostProjectRoot()): void {
    if (rootPath && this.hostRuntime && this.hostExistsSync(rootPath)) {
      this.bindFolder(WIN32_WORKSPACE_PATH, rootPath);
    }
  }

  public normalize(path: string, currentDirectory = 'C:\\'): string {
    const input = path.trim().replace(/^"|"$/g, '').replace(/\//g, '\\');
    const current = currentDirectory.replace(/\//g, '\\');
    const currentDrive = /^[A-Za-z]:/.test(current)
      ? current.slice(0, 2).toUpperCase()
      : 'C:';

    let drive = currentDrive;
    let remainder: string;
    if (/^[A-Za-z]:/.test(input)) {
      drive = input.slice(0, 2).toUpperCase();
      remainder = input.slice(2);
      if (!remainder.startsWith('\\')) {
        remainder = `\\${remainder}`;
      }
    } else if (input.startsWith('\\')) {
      remainder = input;
    } else {
      const base = current.endsWith('\\') ? current : `${current}\\`;
      remainder = `${base.slice(2)}${input}`;
    }

    const segments: string[] = [];
    for (const segment of remainder.split('\\')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') {
        segments.pop();
        continue;
      }
      segments.push(segment);
    }
    return segments.length > 0
      ? `${drive}\\${segments.join('\\')}`
      : `${drive}\\`;
  }

  /**
   * Mounts `realHostPath` (resolved to an absolute real host path) under the
   * simulated path `simulatedPrefix`. Replaces any existing bind at the same
   * (normalized) prefix.
   */
  public bindFolder(simulatedPrefix: string, realHostPath: string): void {
    const normalizedPrefix = this.normalize(simulatedPrefix);
    this.unbindFolder(normalizedPrefix);
    this.binds.push({
      simulatedPrefix: normalizedPrefix,
      realHostPath: this.hostResolve(realHostPath),
    });
  }

  /** Resolves a simulated path to its bound real host path, if it has one. */
  public resolveHostPath(
    path: string,
    currentDirectory = 'C:\\',
  ): string | undefined {
    const normalized = this.normalize(path, currentDirectory);
    return this.resolveBind(normalized)?.realTargetPath;
  }

  /** Removes a previously-registered bind at `simulatedPrefix`, if any. */
  public unbindFolder(simulatedPrefix: string): void {
    const normalizedPrefix = this.normalize(simulatedPrefix).toLowerCase();
    const index = this.binds.findIndex(
      (bind) => bind.simulatedPrefix.toLowerCase() === normalizedPrefix,
    );
    if (index !== -1) this.binds.splice(index, 1);
  }

  /** Resolves an already-`normalize()`d simulated path to the real host path
   * it's bound to, or `undefined` if it isn't under any bound prefix. */
  private resolveBind(
    normalizedPath: string,
  ): (FolderBind & { realTargetPath: string }) | undefined {
    let best: FolderBind | undefined;
    const candidate = normalizedPath.toLowerCase();
    for (const bind of this.binds) {
      const prefix = bind.simulatedPrefix.toLowerCase();
      if (candidate !== prefix && !candidate.startsWith(`${prefix}\\`))
        continue;
      if (!best || bind.simulatedPrefix.length > best.simulatedPrefix.length) {
        best = bind;
      }
    }
    if (!best) return undefined;
    const relativeSegments = normalizedPath
      .slice(best.simulatedPrefix.length)
      .split('\\')
      .filter(Boolean);
    return {
      ...best,
      realTargetPath: this.resolveHostSegments(
        best.realHostPath,
        relativeSegments,
      ),
    };
  }

  private entryFromRealPath(
    normalizedPath: string,
    realTargetPath: string,
  ): Win32FileSystemEntry | undefined {
    if (!this.hostExistsSync(realTargetPath)) return undefined;
    const stat = this.hostStatSync(realTargetPath);
    const isDrive = normalizedPath === `${normalizedPath.slice(0, 2)}\\`;
    return {
      kind: stat.isDirectory() ? 'directory' : 'file',
      name: isDrive
        ? normalizedPath
        : normalizedPath.slice(normalizedPath.lastIndexOf('\\') + 1),
      path: normalizedPath,
      createdAt: stat.birthtime,
      data: stat.isDirectory()
        ? new Uint8Array(0)
        : this.hostReadFileSync(realTargetPath),
    };
  }

  public getEntry(
    path: string,
    currentDirectory = 'C:\\',
  ): Win32FileSystemEntry | undefined {
    const normalized = this.normalize(path, currentDirectory);
    const bind = this.resolveBind(normalized);
    if (bind) return this.entryFromRealPath(normalized, bind.realTargetPath);
    return this.entries.get(normalized.toLowerCase());
  }

  public isDirectory(path: string, currentDirectory = 'C:\\'): boolean {
    return this.getEntry(path, currentDirectory)?.kind === 'directory';
  }

  public createDirectory(path: string): Win32FileSystemEntry {
    const normalized = this.normalize(path);
    const parent = parentPath(normalized);
    if (parent && !this.entries.has(parent.toLowerCase())) {
      this.createDirectory(parent);
    }
    const existing = this.entries.get(normalized.toLowerCase());
    if (existing) {
      if (existing.kind !== 'directory') {
        throw new Error(`${normalized} already exists as a file`);
      }
      return existing;
    }
    const entry: Win32FileSystemEntry = {
      kind: 'directory',
      name:
        normalized === `${normalized.slice(0, 2)}\\`
          ? normalized
          : normalized.slice(normalized.lastIndexOf('\\') + 1),
      path: normalized,
      createdAt: new Date(DEFAULT_TIMESTAMP),
      data: new Uint8Array(0),
    };
    this.entries.set(normalized.toLowerCase(), entry);
    return entry;
  }

  public writeFile(path: string, data: Uint8Array): Win32FileSystemEntry {
    const normalized = this.normalize(path);
    const bind = this.resolveBind(normalized);
    if (bind) {
      this.hostMkdirSync(this.hostDirname(bind.realTargetPath), {
        recursive: true,
      });
      this.hostWriteFileSync(bind.realTargetPath, data);
      const written = this.entryFromRealPath(normalized, bind.realTargetPath);
      if (!written) {
        throw new Error(`Failed to write bound file: ${normalized}`);
      }
      return written;
    }
    const parent = parentPath(normalized);
    if (!parent || !this.isDirectory(parent)) {
      throw new Error(
        `Parent directory does not exist: ${parent ?? normalized}`,
      );
    }
    const entry: Win32FileSystemEntry = {
      kind: 'file',
      name: normalized.slice(normalized.lastIndexOf('\\') + 1),
      path: normalized,
      createdAt: new Date(DEFAULT_TIMESTAMP),
      data: data.slice(),
    };
    this.entries.set(normalized.toLowerCase(), entry);
    return entry;
  }

  public writeTextFile(path: string, text: string): Win32FileSystemEntry {
    return this.writeFile(path, new TextEncoder().encode(text));
  }

  public readFile(
    path: string,
    offset = 0,
    length?: number,
    currentDirectory = 'C:\\',
  ): Uint8Array {
    const entry = this.getEntry(path, currentDirectory);
    if (!entry || entry.kind !== 'file') {
      throw new Error(
        `File does not exist: ${this.normalize(path, currentDirectory)}`,
      );
    }
    const start = Math.max(0, offset);
    const end =
      length === undefined
        ? entry.data.length
        : Math.min(entry.data.length, start + Math.max(0, length));
    return entry.data.slice(start, end);
  }

  public writeFileAt(
    path: string,
    offset: number,
    data: Uint8Array,
    currentDirectory = 'C:\\',
  ): number {
    const normalized = this.normalize(path, currentDirectory);
    const bind = this.resolveBind(normalized);
    if (bind) {
      const existing = this.hostExistsSync(bind.realTargetPath)
        ? this.hostReadFileSync(bind.realTargetPath)
        : new Uint8Array(0);
      const start = Math.max(0, offset);
      const next = new Uint8Array(
        Math.max(existing.length, start + data.length),
      );
      next.set(existing);
      next.set(data, start);
      this.hostMkdirSync(this.hostDirname(bind.realTargetPath), {
        recursive: true,
      });
      this.hostWriteFileSync(bind.realTargetPath, next);
      return data.length;
    }
    const entry = this.getEntry(path, currentDirectory);
    if (!entry || entry.kind !== 'file') {
      throw new Error(
        `File does not exist: ${this.normalize(path, currentDirectory)}`,
      );
    }
    const start = Math.max(0, offset);
    const next = new Uint8Array(
      Math.max(entry.data.length, start + data.length),
    );
    next.set(entry.data);
    next.set(data, start);
    entry.data = next;
    return data.length;
  }

  /**
   * Removes a file entry (directories are left alone -- nothing in this
   * simulator needs recursive/`RemoveDirectory` semantics yet). Returns
   * whether an entry was actually removed, mirroring `DeleteFileA`'s
   * boolean result rather than throwing on a missing path.
   */
  public deleteFile(path: string, currentDirectory = 'C:\\'): boolean {
    const normalizedPath = this.normalize(path, currentDirectory);
    const bind = this.resolveBind(normalizedPath);
    if (bind) {
      if (!this.hostExistsSync(bind.realTargetPath)) return false;
      if (this.hostStatSync(bind.realTargetPath).isDirectory()) return false;
      this.hostUnlinkSync(bind.realTargetPath);
      return true;
    }
    const normalized = normalizedPath.toLowerCase();
    const entry = this.entries.get(normalized);
    if (!entry || entry.kind !== 'file') return false;
    return this.entries.delete(normalized);
  }

  /**
   * Recursively removes a directory and everything under it, including
   * bound (host-backed) ones -- `HostFileSystemModule.rmSync` handles the
   * real recursive removal there. Returns whether the directory actually
   * existed and was removed.
   */
  public deleteDirectory(path: string, currentDirectory = 'C:\\'): boolean {
    const normalizedPath = this.normalize(path, currentDirectory);
    const bind = this.resolveBind(normalizedPath);
    if (bind) {
      if (
        !this.hostExistsSync(bind.realTargetPath) ||
        !this.hostStatSync(bind.realTargetPath).isDirectory()
      ) {
        return false;
      }
      this.hostRmSync(bind.realTargetPath, { recursive: true });
      return true;
    }
    const key = normalizedPath.toLowerCase();
    const entry = this.entries.get(key);
    if (!entry || entry.kind !== 'directory') return false;
    const prefix = `${key}\\`;
    for (const candidate of [...this.entries.keys()]) {
      if (candidate.startsWith(prefix)) this.entries.delete(candidate);
    }
    return this.entries.delete(key);
  }

  /**
   * Renames or moves a file or directory (target may be under a different
   * parent), including bound (host-backed) ones -- `HostFileSystemModule.
   * renameSync` handles the real move there, and works recursively for
   * directories on its own (no manual re-keying needed, unlike the
   * in-memory branch below). Both `source` and `target` must resolve to
   * the same bind (or neither); mixing bound and unbound paths throws,
   * since there's no single host primitive that could move across that
   * boundary atomically. Returns `false` if `source` doesn't exist or
   * `target` already does (never silently overwrites); throws if
   * `target`'s parent directory doesn't exist, matching `writeFile`'s
   * existing contract.
   */
  public rename(
    source: string,
    target: string,
    currentDirectory = 'C:\\',
  ): boolean {
    const normalizedSource = this.normalize(source, currentDirectory);
    const normalizedTarget = this.normalize(target, currentDirectory);
    const sourceBind = this.resolveBind(normalizedSource);
    const targetBind = this.resolveBind(normalizedTarget);
    if (sourceBind || targetBind) {
      if (!sourceBind || !targetBind) {
        throw new Error(
          `Cannot rename across a bound/unbound boundary: ${normalizedSource} -> ${normalizedTarget}`,
        );
      }
      if (!this.hostExistsSync(sourceBind.realTargetPath)) return false;
      if (this.hostExistsSync(targetBind.realTargetPath)) return false;
      this.hostMkdirSync(this.hostDirname(targetBind.realTargetPath), {
        recursive: true,
      });
      this.hostRenameSync(sourceBind.realTargetPath, targetBind.realTargetPath);
      return true;
    }
    const sourceKey = normalizedSource.toLowerCase();
    const entry = this.entries.get(sourceKey);
    if (!entry) return false;
    const targetKey = normalizedTarget.toLowerCase();
    if (this.entries.has(targetKey)) return false;
    const parent = parentPath(normalizedTarget);
    if (parent && !this.isDirectory(parent)) {
      throw new Error(`Parent directory does not exist: ${parent}`);
    }

    if (entry.kind === 'file') {
      this.entries.delete(sourceKey);
      this.entries.set(targetKey, {
        ...entry,
        name: normalizedTarget.slice(normalizedTarget.lastIndexOf('\\') + 1),
        path: normalizedTarget,
      });
      return true;
    }

    const sourcePrefix = `${sourceKey}\\`;
    const moved = [...this.entries.entries()].filter(
      ([key]) => key === sourceKey || key.startsWith(sourcePrefix),
    );
    for (const [key, value] of moved) {
      this.entries.delete(key);
      const newPath = `${normalizedTarget}${value.path.slice(normalizedSource.length)}`;
      this.entries.set(newPath.toLowerCase(), {
        ...value,
        name: newPath.slice(newPath.lastIndexOf('\\') + 1),
        path: newPath,
      });
    }
    return true;
  }

  public readDirectory(
    path: string,
    currentDirectory = 'C:\\',
  ): Win32FileSystemEntry[] {
    const normalizedPath = this.normalize(path, currentDirectory);
    const bind = this.resolveBind(normalizedPath);
    if (bind) {
      if (
        !this.hostExistsSync(bind.realTargetPath) ||
        !this.hostStatSync(bind.realTargetPath).isDirectory()
      ) {
        throw new Error(`Directory does not exist: ${normalizedPath}`);
      }
      return this.hostReaddirSync(bind.realTargetPath, { withFileTypes: true })
        .map((dirent) => {
          const childPath = `${normalizedPath}\\${dirent.name}`;
          const childReal = this.hostJoin(bind.realTargetPath, dirent.name);
          const entry = this.entryFromRealPath(childPath, childReal);
          if (!entry) {
            throw new Error(`Failed to stat bound entry: ${childPath}`);
          }
          return entry;
        })
        .sort((left, right) => {
          if (left.kind !== right.kind) {
            return left.kind === 'directory' ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        });
    }
    const directory = this.getEntry(path, currentDirectory);
    if (!directory || directory.kind !== 'directory') {
      throw new Error(
        `Directory does not exist: ${this.normalize(path, currentDirectory)}`,
      );
    }
    const key = directory.path.toLowerCase();
    return [...this.entries.values()]
      .filter((entry) => parentPath(entry.path)?.toLowerCase() === key)
      .sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === 'directory' ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });
  }
}
