import { transform } from 'sucrase';
import * as Win32Simulate from 'win32-simulate';
import {
  bindWin64Process,
  createBrowserBunFFI,
  CFunction,
  CString,
  dlopen,
  FFIType,
  getBoundWin64Process,
  JSCallback,
  ptr,
  read,
  toArrayBuffer,
  type Win64Process,
} from 'win32-simulate';
import { toWindowsPath } from '../fs/workspace-paths';
import { getMachine } from './machine';
import { getWorkspaceRoot } from './workspace';

function windowsPath(path: string): string {
  return toWindowsPath(path, getWorkspaceRoot());
}

/**
 * Runs a `.js` file against `machine.fileSystem` (`Win32FileSystem`) using
 * the Worker's *own* JS engine -- not real Node.js.
 *
 * `node.exe`'s actual execution (`NodeHostBridge`, see `packages/
 * simulate/src/runtime/node-host-bridge.ts`) spawns a real
 * `node:worker_threads` worker on a real Node.js host process. That is
 * fundamentally unavailable here: `import('node:fs')`/`'node:worker_threads'`
 * reject unconditionally in any browser context, Worker or not -- not a
 * design gap, a browser sandboxing fact. `shell/main/modules/machine.ts`
 * therefore constructs the machine with `enableNodeHostBridge: false`, and
 * `node-syscalls.ts` installs this app's own replacement for the
 * `node.dll` syscalls `node.exe` calls, dispatching to `runNodeScript`
 * here (see `js-host-programs.ts`).
 *
 * As of F9, `machine.fileSystem` is the single filesystem everything reads
 * (Explorer/Editor, `cmd.exe`'s `dir`, this runner) -- so a `node:fs`
 * import resolves to a small synthetic shim (`NODE_FS_SPECIFIER` below)
 * backed directly by `machine.fileSystem`'s own synchronous methods, no
 * async bridging needed (unlike a design backed by an async source, this
 * one never has to choose between "block" and "not really node:fs").
 *
 * What this *can* do: resolve and run real ES module graphs against
 * `machine.fileSystem`, including workspace packages (`packages/*`
 * `package.json` `name` -> `main`, the same field real Node's own
 * resolution would follow -- and since every package's `main` points at
 * its pre-built `dist/*.js`, not `src/*.ts`, this never needs a
 * TypeScript transpiler). Modules are fetched from the filesystem, have
 * their import specifiers rewritten to point at each other's `Blob`
 * URLs, and are executed via the Worker's native dynamic `import()`.
 *
 * What this cannot do, by deliberate scope, not omission:
 *  - `require()` / CommonJS -- ES module syntax (`import`/`export`) only.
 *  - Node built-ins other than `node:fs` (`node:path`, `node:worker_threads`,
 *    ...) or npm packages outside this workspace.
 *  - Circular imports -- detected and rejected with a clear error rather
 *    than hanging or silently producing a broken module.
 *
 * `-e <code>` (`runNodeEval`) is the same pipeline as running a file
 * (`runNodeScript`), not a separate mode bolted on: a file is read from
 * the filesystem and becomes the entry module's source; `-e` code *is*
 * the entry module's source directly, at a synthetic path so relative
 * imports (`./util.js`) resolve the same way a real script's would.
 */

const IMPORT_EXPORT_FROM = /\bfrom\s*(['"])((?:\\.|(?!\1).)*)\1/g;
const BARE_IMPORT = /\bimport\s*(['"])((?:\\.|(?!\1).)*)\1\s*;/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(['"])((?:\\.|(?!\1).)*)\1\s*\)/g;

/** Synthetic entry path for `-e` code -- relative imports resolve against workspace root, like a script run from `cwd`. */
const EVAL_ENTRY_PATH = '/__eval__.mjs';
/** Sentinel "path" a `node:fs` import resolves to -- never collides with a real workspace path (leading NUL is illegal in one). */
const NODE_FS_SPECIFIER = 'node:fs';
const NODE_FS_ENTRY_PATH = '\0node:fs';
/** `globalThis` key the synthetic `node:fs` module's synchronous calls bounce through, back into `machine.fileSystem`. */
const FS_BRIDGE_GLOBAL = '__exoprocNodeFsBridge';

/** Sentinel "path" a `bun:ffi` import resolves to. */
const BUN_FFI_SPECIFIERS = new Set(['bun:ffi', 'bun']);
const BUN_FFI_ENTRY_PATH = '\0bun:ffi';
const BUN_FFI_BRIDGE_GLOBAL = '__exoprocBunFfiBridge';

/** Sentinel "path" a `win32-simulate` or `simulate` import resolves to. */
const SIMULATE_SPECIFIERS = new Set([
  'win32-simulate',
  'win32-simulate',
  'simulate',
  '@exoproc/simulate',
]);
const SIMULATE_ENTRY_PATH = '\0simulate';
const SIMULATE_BRIDGE_GLOBAL = '__exoprocSimulateBridge';

export interface NodeRunResult {
  readonly exitCode: number;
}

export async function runNodeScript(
  scriptArgument: string,
  write: (text: string) => void,
  guestProcess?: Win64Process,
): Promise<NodeRunResult> {
  return runModuleGraph(
    normalizeScriptArgument(scriptArgument),
    undefined,
    write,
    guestProcess,
  );
}

/** `node -e <code>`: `code` becomes the entry module's own source, no file read involved. */
export async function runNodeEval(
  code: string,
  write: (text: string) => void,
  guestProcess?: Win64Process,
): Promise<NodeRunResult> {
  return runModuleGraph(EVAL_ENTRY_PATH, code, write, guestProcess);
}

async function runModuleGraph(
  entryPath: string,
  entrySource: string | undefined,
  write: (text: string) => void,
  guestProcess?: Win64Process,
): Promise<NodeRunResult> {
  const machine = getMachine();
  const targetProcess =
    guestProcess ??
    machine.getProcesses()[0] ??
    machine.createProcess({
      image: 'node.exe',
      path: 'C:\\Program Files\\nodejs\\node.exe',
    });

  const packages = resolveWorkspacePackages();
  const sources = new Map<string, string>();
  if (entrySource !== undefined) sources.set(entryPath, entrySource);

  try {
    loadModuleGraph(entryPath, packages, sources);
  } catch (cause) {
    write(`node: ${describeError(cause)}\r\n`);
    return { exitCode: 1 };
  }

  let order: readonly string[];
  try {
    order = topologicalOrder(entryPath, sources, packages);
  } catch (cause) {
    write(`node: ${describeError(cause)}\r\n`);
    return { exitCode: 1 };
  }

  const blobUrls = new Map<string, string>();
  const restoreBinding = bindWin64Process(targetProcess);
  const restoreConsole = captureConsole(write);
  const restoreFsBridge = installFsBridge();
  const restoreBridges = installBridges(targetProcess);
  const restoreBuffer = installBufferShim();
  const restoreProcessPid = installProcessPid(targetProcess);
  try {
    for (const path of order) {
      const raw = sources.get(path);
      if (raw === undefined) continue; // a package.json main path with no queued source
      const rewritten =
        path === NODE_FS_ENTRY_PATH ||
        path === BUN_FFI_ENTRY_PATH ||
        path === SIMULATE_ENTRY_PATH
          ? raw
          : rewriteSpecifiers(raw, path, packages, blobUrls);
      const blob = new Blob([rewritten], { type: 'text/javascript' });
      blobUrls.set(path, URL.createObjectURL(blob));
    }

    const entryUrl = blobUrls.get(entryPath);
    if (!entryUrl) throw new Error(`${entryPath} çözümlenemedi.`);

    await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ entryUrl
    );
    return { exitCode: 0 };
  } catch (cause) {
    write(`${describeError(cause)}\r\n`);
    return { exitCode: 1 };
  } finally {
    restoreProcessPid();
    restoreBuffer();
    restoreBridges();
    restoreConsole();
    restoreFsBridge();
    restoreBinding();
    for (const url of blobUrls.values()) URL.revokeObjectURL(url);
  }
}

/** Accepts either an already-workspace-relative path or a guest `C:\...` one (from manual typing). */
function normalizeScriptArgument(argument: string): string {
  const unquoted = argument.trim().replace(/^"(.*)"$/, '$1');
  const guestPrefix = /^[A-Za-z]:\\Users\\Serkan\\Workspace\\?/;
  if (guestPrefix.test(unquoted)) {
    return `/${unquoted.replace(guestPrefix, '').replace(/\\/g, '/')}`;
  }
  return unquoted.startsWith('/') ? unquoted : `/${unquoted}`;
}

function resolveWorkspacePackages(): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const fileSystem = getMachine().fileSystem;
  let entries;
  try {
    entries = fileSystem.readDirectory(windowsPath('/packages'));
  } catch {
    return map; // no packages/ directory in this workspace -- no bare imports, that's fine
  }

  for (const entry of entries) {
    if (entry.kind !== 'directory') continue;
    const manifestPath = `/packages/${entry.name}/package.json`;
    try {
      const bytes = fileSystem.readFile(windowsPath(manifestPath));
      const manifest = JSON.parse(new TextDecoder().decode(bytes)) as {
        readonly name?: string;
        readonly main?: string;
      };
      if (typeof manifest.name !== 'string') continue;
      const main =
        typeof manifest.main === 'string' ? manifest.main : 'dist/index.js';
      map.set(
        manifest.name,
        `/packages/${entry.name}/${main}`.replace(/\/+/g, '/'),
      );
    } catch {
      // Malformed or missing package.json -- skip it, don't fail the whole run.
    }
  }
  return map;
}

function extractSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  for (const pattern of [IMPORT_EXPORT_FROM, BARE_IMPORT, DYNAMIC_IMPORT]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) specifiers.add(match[2]!);
  }
  return [...specifiers];
}

function resolveSpecifier(
  specifier: string,
  fromPath: string,
  packages: ReadonlyMap<string, string>,
): string {
  if (specifier === NODE_FS_SPECIFIER) return NODE_FS_ENTRY_PATH;
  if (BUN_FFI_SPECIFIERS.has(specifier)) return BUN_FFI_ENTRY_PATH;
  if (SIMULATE_SPECIFIERS.has(specifier)) return SIMULATE_ENTRY_PATH;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const raw = resolveRelative(fromPath, specifier);
    const fileSystem = getMachine().fileSystem;
    const candidates = [
      raw,
      raw.endsWith('.js') ? raw.slice(0, -3) + '.ts' : undefined,
      `${raw}.ts`,
      `${raw}.js`,
      `${raw}/index.ts`,
      `${raw}/index.js`,
    ].filter((c): c is string => c !== undefined);

    for (const cand of candidates) {
      try {
        if (fileSystem.getEntry(windowsPath(cand))?.kind === 'file')
          return cand;
      } catch {
        // try next
      }
    }
    return raw;
  }
  const resolved = packages.get(specifier);
  if (resolved) return resolved;
  throw new Error(
    `Modül çözümlenemedi: "${specifier}" (yalnızca workspace paketleri, simulate, bun:ffi ve node:fs destekleniyor).`,
  );
}

function resolveRelative(fromPath: string, specifier: string): string {
  const segments = fromPath.split('/').filter(Boolean);
  segments.pop(); // drop the importing file's own name, keep its directory
  for (const part of specifier.split('/').filter(Boolean)) {
    if (part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return `/${segments.join('/')}`;
}

function transpileCodeIfTs(source: string, path: string): string {
  if (
    path.endsWith('.ts') ||
    path.endsWith('.tsx') ||
    path.endsWith('.mts') ||
    path === EVAL_ENTRY_PATH
  ) {
    try {
      return transform(source, { transforms: ['typescript'] }).code;
    } catch {
      return source;
    }
  }
  return source;
}

function loadModuleGraph(
  entryPath: string,
  packages: ReadonlyMap<string, string>,
  sources: Map<string, string>,
): void {
  const fileSystem = getMachine().fileSystem;
  // A separate `visited` set, not `sources.has(path)`: the entry may
  // already be present in `sources` before this runs (`-e` code, seeded
  // by `runModuleGraph`), and it still needs its own specifiers
  // extracted/queued -- `sources.has(path)` alone would wrongly treat an
  // already-known source as "nothing left to do" for it.
  const visited = new Set<string>();
  const queue = [entryPath];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);

    let source = sources.get(path);
    if (source === undefined) {
      if (path === NODE_FS_ENTRY_PATH) {
        source = NODE_FS_MODULE_SOURCE;
      } else if (path === BUN_FFI_ENTRY_PATH) {
        source = BUN_FFI_MODULE_SOURCE;
      } else if (path === SIMULATE_ENTRY_PATH) {
        source = SIMULATE_MODULE_SOURCE;
      } else {
        try {
          source = new TextDecoder().decode(
            fileSystem.readFile(windowsPath(path)),
          );
        } catch {
          throw new Error(`Dosya bulunamadı: ${path}`);
        }
      }
      source = transpileCodeIfTs(source, path);
      sources.set(path, source);
    } else if (path === EVAL_ENTRY_PATH) {
      source = transpileCodeIfTs(source, path);
      sources.set(path, source);
    }

    for (const specifier of extractSpecifiers(source)) {
      const resolved = resolveSpecifier(specifier, path, packages);
      if (!visited.has(resolved)) queue.push(resolved);
    }
  }
}

/** Dependencies-before-dependents order, so each file's imports already have a blob URL by the time it is rewritten. */
function topologicalOrder(
  entryPath: string,
  sources: ReadonlyMap<string, string>,
  packages: ReadonlyMap<string, string>,
): readonly string[] {
  const order: string[] = [];
  const done = new Set<string>();
  const inProgress = new Set<string>();

  const visit = (path: string): void => {
    if (done.has(path)) return;
    if (inProgress.has(path)) {
      throw new Error(`Dairesel import tespit edildi: ${path}`);
    }
    inProgress.add(path);
    const source = sources.get(path);
    if (source !== undefined) {
      for (const specifier of extractSpecifiers(source)) {
        visit(resolveSpecifier(specifier, path, packages));
      }
    }
    inProgress.delete(path);
    done.add(path);
    order.push(path);
  };

  visit(entryPath);
  return order;
}

function rewriteSpecifiers(
  source: string,
  fromPath: string,
  packages: ReadonlyMap<string, string>,
  blobUrls: ReadonlyMap<string, string>,
): string {
  const replace = (
    _match: string,
    quote: string,
    specifier: string,
    offset: number,
  ): string => {
    const resolved = resolveSpecifier(specifier, fromPath, packages);
    const blobUrl = blobUrls.get(resolved);
    if (!blobUrl) {
      throw new Error(
        `İç hata: ${resolved} için blob URL henüz oluşturulmadı.`,
      );
    }
    // Re-derive the original matched text's prefix (everything up to the
    // quote) so `import x from '...'`, `export * from '...'`, and bare
    // `import '...';` all keep their own surrounding syntax intact --
    // only the specifier string itself changes.
    return source
      .slice(offset, offset + _match.length)
      .replace(`${quote}${specifier}${quote}`, `${quote}${blobUrl}${quote}`);
  };

  return source
    .replace(IMPORT_EXPORT_FROM, replace)
    .replace(BARE_IMPORT, replace)
    .replace(DYNAMIC_IMPORT, replace);
}

function captureConsole(write: (text: string) => void): () => void {
  const original = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
  };
  const pipe =
    (prefix: string) =>
    (...args: readonly unknown[]) => {
      write(`${prefix}${args.map(formatConsoleArgument).join(' ')}\r\n`);
    };
  console.log = pipe('');
  console.info = pipe('');
  console.warn = pipe('');
  console.error = pipe('');
  return () => {
    console.log = original.log;
    console.error = original.error;
    console.warn = original.warn;
    console.info = original.info;
  };
}

function formatConsoleArgument(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function describeError(cause: unknown): string {
  return cause instanceof Error
    ? (cause.stack ?? cause.message)
    : String(cause);
}

/**
 * Small `node:fs` subset (mirrors the scope `packages/simulate/src/
 * worker/node-fs-shim.ts` already established for a different, unrelated
 * target filesystem), synchronous end to end since `machine.fileSystem`
 * already is. Every path is resolved relative to the workspace root
 * (`/`), matching a real Node script's `process.cwd()` -- not strictly
 * "relative to the importing file" the way real Node resolves `node:fs`
 * paths either, but close enough for scripts running out of one workspace.
 */
interface NodeFsBridge {
  readFileSync(path: string, encoding?: string): string | Uint8Array;
  writeFileSync(path: string, data: string | Uint8Array): void;
  appendFileSync(path: string, data: string | Uint8Array): void;
  existsSync(path: string): boolean;
  mkdirSync(path: string): void;
  readdirSync(path: string): string[];
  statSync(path: string): {
    readonly size: number;
    isFile(): boolean;
    isDirectory(): boolean;
  };
  unlinkSync(path: string): void;
  renameSync(source: string, target: string): void;
}

function installFsBridge(): () => void {
  const bridge: NodeFsBridge = {
    readFileSync: (path, encoding) => {
      const bytes = getMachine().fileSystem.readFile(windowsPath(path));
      return encoding ? new TextDecoder('utf-8').decode(bytes) : bytes;
    },
    writeFileSync: (path, data) => {
      getMachine().fileSystem.writeFile(windowsPath(path), toBytes(data));
    },
    appendFileSync: (path, data) => {
      const fileSystem = getMachine().fileSystem;
      const targetPath = windowsPath(path);
      const previous =
        fileSystem.getEntry(targetPath)?.kind === 'file'
          ? fileSystem.readFile(targetPath)
          : new Uint8Array(0);
      const appended = toBytes(data);
      const combined = new Uint8Array(previous.length + appended.length);
      combined.set(previous);
      combined.set(appended, previous.length);
      fileSystem.writeFile(targetPath, combined);
    },
    existsSync: (path) =>
      getMachine().fileSystem.getEntry(windowsPath(path)) !== undefined,
    mkdirSync: (path) =>
      getMachine().fileSystem.createDirectory(windowsPath(path)),
    readdirSync: (path) =>
      getMachine()
        .fileSystem.readDirectory(windowsPath(path))
        .map((entry) => entry.name),
    statSync: (path) => {
      const entry = getMachine().fileSystem.getEntry(windowsPath(path));
      if (!entry)
        throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
      return {
        size: entry.data.length,
        isFile: () => entry.kind === 'file',
        isDirectory: () => entry.kind === 'directory',
      };
    },
    unlinkSync: (path) => {
      getMachine().fileSystem.deleteFile(windowsPath(path));
    },
    renameSync: (source, target) => {
      const fileSystem = getMachine().fileSystem;
      const windowsSource = windowsPath(source);
      fileSystem.writeFile(
        windowsPath(target),
        fileSystem.readFile(windowsSource),
      );
      fileSystem.deleteFile(windowsSource);
    },
  };

  const scope = globalThis as typeof globalThis & Record<string, unknown>;
  const previous = scope[FS_BRIDGE_GLOBAL];
  scope[FS_BRIDGE_GLOBAL] = bridge;
  return () => {
    scope[FS_BRIDGE_GLOBAL] = previous;
  };
}

const NODE_FS_MODULE_SOURCE = `
const bridge = globalThis.${FS_BRIDGE_GLOBAL};
export const readFileSync = (path, encoding) => bridge.readFileSync(path, typeof encoding === 'string' ? encoding : encoding?.encoding);
export const writeFileSync = (path, data) => bridge.writeFileSync(path, data);
export const appendFileSync = (path, data) => bridge.appendFileSync(path, data);
export const existsSync = (path) => bridge.existsSync(path);
export const mkdirSync = (path) => bridge.mkdirSync(path);
export const readdirSync = (path) => bridge.readdirSync(path);
export const statSync = (path) => bridge.statSync(path);
export const lstatSync = (path) => bridge.statSync(path);
export const unlinkSync = (path) => bridge.unlinkSync(path);
export const renameSync = (source, target) => bridge.renameSync(source, target);
export default { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync, lstatSync, unlinkSync, renameSync };
`;

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === 'string' ? new TextEncoder().encode(data) : data;
}

const BUN_FFI_MODULE_SOURCE = `
const bridge = globalThis.${BUN_FFI_BRIDGE_GLOBAL};
export const dlopen = (...args) => bridge.dlopen(...args);
export const FFIType = bridge.FFIType;
export const ptr = (...args) => bridge.ptr(...args);
export const toArrayBuffer = (...args) => bridge.toArrayBuffer(...args);
export const CString = bridge.CString;
export const JSCallback = bridge.JSCallback;
export const CFunction = bridge.CFunction;
export const read = (...args) => bridge.read(...args);
export const bindWin64Process = (...args) => bridge.bindWin64Process(...args);
export const getBoundWin64Process = (...args) => bridge.getBoundWin64Process(...args);
export const createBrowserBunFFI = (...args) => bridge.createBrowserBunFFI(...args);
export const cc = (...args) => bridge.cc(...args);
export default bridge;
`;

const SIMULATE_EXPORT_NAMES = Object.keys(Win32Simulate).filter(
  (k) => /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k) && k !== 'default',
);

const SIMULATE_MODULE_SOURCE = `
const sim = globalThis.${SIMULATE_BRIDGE_GLOBAL};
export const {
  ${SIMULATE_EXPORT_NAMES.join(',\n  ')}
} = sim;
export default sim;
`;

function installBridges(process: Win64Process): () => void {
  const scope = globalThis as typeof globalThis & Record<string, unknown>;

  const bunFfiBridge = {
    dlopen: <T extends Record<string, Parameters<typeof dlopen>[1][string]>>(
      name: string,
      defs: T,
    ) => {
      const restore = bindWin64Process(process);
      try {
        return dlopen(name, defs);
      } finally {
        restore();
      }
    },
    FFIType,
    ptr: (val: unknown) => {
      const restore = bindWin64Process(process);
      try {
        return ptr(val);
      } finally {
        restore();
      }
    },
    toArrayBuffer,
    CString,
    JSCallback,
    CFunction,
    read,
    bindWin64Process,
    getBoundWin64Process,
    createBrowserBunFFI: () => createBrowserBunFFI(process),
    cc: (opts: Parameters<typeof Win32Simulate.cc>[0]) =>
      Win32Simulate.cc(opts),
  };

  const prevFfi = scope[BUN_FFI_BRIDGE_GLOBAL];
  const prevSim = scope[SIMULATE_BRIDGE_GLOBAL];

  scope[BUN_FFI_BRIDGE_GLOBAL] = bunFfiBridge;
  scope[SIMULATE_BRIDGE_GLOBAL] = Win32Simulate;

  return () => {
    scope[BUN_FFI_BRIDGE_GLOBAL] = prevFfi;
    scope[SIMULATE_BRIDGE_GLOBAL] = prevSim;
  };
}

function installProcessPid(process: Win64Process): () => void {
  const scope = globalThis as unknown as Record<string, unknown>;
  const proc = scope['process'] as { pid?: number } | undefined;
  if (!proc) {
    scope['process'] = { pid: process.pid };
    return () => {
      delete scope['process'];
    };
  }
  const prevPid = proc.pid;
  try {
    Object.defineProperty(proc, 'pid', {
      value: process.pid,
      configurable: true,
      writable: true,
    });
  } catch {
    // If not configurable, ignore
  }
  return () => {
    if (prevPid !== undefined) {
      try {
        Object.defineProperty(proc, 'pid', {
          value: prevPid,
          configurable: true,
          writable: true,
        });
      } catch {
        // ignore
      }
    }
  };
}

function installBufferShim(): () => void {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope['Buffer'] !== undefined) return () => undefined;

  class BufferShim extends Uint8Array {
    public static alloc(size: number, fill?: number): BufferShim {
      const buf = new BufferShim(size);
      if (fill !== undefined) buf.fill(fill);
      return buf;
    }

    public static from(value: unknown): BufferShim {
      if (typeof value === 'string') {
        const bytes = new TextEncoder().encode(value);
        const buf = new BufferShim(bytes.length);
        buf.set(bytes);
        return buf;
      }
      if (value instanceof Uint8Array || Array.isArray(value)) {
        const buf = new BufferShim(value.length);
        buf.set(value);
        return buf;
      }
      if (value instanceof ArrayBuffer) {
        return new BufferShim(value);
      }
      return new BufferShim(0);
    }

    public static isBuffer(val: unknown): boolean {
      return val instanceof Uint8Array;
    }

    public readUInt32LE(offset = 0): number {
      return new DataView(
        this.buffer,
        this.byteOffset,
        this.byteLength,
      ).getUint32(offset, true);
    }

    public writeUInt32LE(value: number, offset = 0): number {
      new DataView(this.buffer, this.byteOffset, this.byteLength).setUint32(
        offset,
        value,
        true,
      );
      return offset + 4;
    }

    public readBigUInt64LE(offset = 0): bigint {
      return new DataView(
        this.buffer,
        this.byteOffset,
        this.byteLength,
      ).getBigUint64(offset, true);
    }

    public writeBigUInt64LE(value: bigint, offset = 0): number {
      new DataView(this.buffer, this.byteOffset, this.byteLength).setBigUint64(
        offset,
        value,
        true,
      );
      return offset + 8;
    }

    public readInt32LE(offset = 0): number {
      return new DataView(
        this.buffer,
        this.byteOffset,
        this.byteLength,
      ).getInt32(offset, true);
    }

    public writeInt32LE(value: number, offset = 0): number {
      new DataView(this.buffer, this.byteOffset, this.byteLength).setInt32(
        offset,
        value,
        true,
      );
      return offset + 4;
    }

    public override toString(
      encoding = 'utf8',
      start = 0,
      end = this.length,
    ): string {
      const slice = this.subarray(start, end);
      if (encoding === 'hex') {
        return Array.from(slice)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
      }
      if (encoding === 'utf16le') {
        return new TextDecoder('utf-16le').decode(slice);
      }
      return new TextDecoder('utf-8').decode(slice);
    }
  }

  scope['Buffer'] = BufferShim;
  return () => {
    delete scope['Buffer'];
  };
}
