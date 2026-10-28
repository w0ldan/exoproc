import { getBoundWin64Process } from '../runtime/bun-ffi.js';

/**
 * `node:fs` replacement for code running in a simulated worker process.
 *
 * The simulator's C compiler and FFI support use synchronous file operations
 * to stage small source and output files. Redirecting those operations to the
 * bound process's `Win32FileSystem` keeps every stage on the same virtual
 * filesystem, with no host disk I/O.
 *
 * Only the handful of synchronous `node:fs` entry points used by that pipeline
 * are implemented. This is not a general `node:fs` polyfill.
 */

type PathLike = string | { toString(): string };

function resolvePath(path: PathLike): string {
  const process = getBoundWin64Process();
  return process.machine.fileSystem.normalize(
    String(path),
    process.currentDirectory,
  );
}

export function writeFileSync(
  path: PathLike,
  data: string | ArrayBufferView,
  _options?: unknown,
): void {
  const process = getBoundWin64Process();
  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  process.machine.fileSystem.writeFile(resolvePath(path), bytes);
}

/**
 * Returns a `Uint8Array` when no encoding is requested (real `node:fs`
 * returns a `Buffer`, which is itself a `Uint8Array` subclass -- close
 * enough for every caller in this worker subsystem, none of which rely on
 * Buffer-only methods on the no-encoding path) or a decoded `string` when an
 * encoding is given, exactly like real `readFileSync`.
 */
export function readFileSync(
  path: PathLike,
  encoding?: string | { readonly encoding?: string },
): string | Uint8Array {
  const process = getBoundWin64Process();
  const bytes = process.machine.fileSystem.readFile(
    resolvePath(path),
    0,
    undefined,
    process.currentDirectory,
  );
  const requested =
    typeof encoding === 'string' ? encoding : encoding?.encoding;
  // The compiler pipeline only requests UTF-8. Any other requested encoding
  // still decodes as UTF-8 rather than silently ignoring the request.
  if (requested) {
    return new TextDecoder('utf-8').decode(bytes);
  }
  return bytes;
}

export function unlinkSync(path: PathLike): void {
  const process = getBoundWin64Process();
  process.machine.fileSystem.deleteFile(
    resolvePath(path),
    process.currentDirectory,
  );
}

export function existsSync(path: PathLike): boolean {
  const process = getBoundWin64Process();
  return (
    process.machine.fileSystem.getEntry(
      resolvePath(path),
      process.currentDirectory,
    ) !== undefined
  );
}

export function mkdirSync(
  path: PathLike,
  _options?: unknown,
): string | undefined {
  const process = getBoundWin64Process();
  process.machine.fileSystem.createDirectory(resolvePath(path));
  return undefined;
}

function fileStats(path: PathLike) {
  const process = getBoundWin64Process();
  const entry = process.machine.fileSystem.getEntry(
    resolvePath(path),
    process.currentDirectory,
  );
  if (!entry)
    throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
  return {
    size: entry.data.length,
    birthtime: entry.createdAt,
    ctime: entry.createdAt,
    mtime: entry.createdAt,
    isFile: () => entry.kind === 'file',
    isDirectory: () => entry.kind === 'directory',
    isSymbolicLink: () => false,
  };
}

export const statSync = fileStats;
export const lstatSync = fileStats;

export function readdirSync(
  path: PathLike,
  options?: { readonly withFileTypes?: boolean },
):
  | string[]
  | Array<{
      readonly name: string;
      isFile(): boolean;
      isDirectory(): boolean;
    }> {
  const process = getBoundWin64Process();
  const entries = process.machine.fileSystem.readDirectory(
    resolvePath(path),
    process.currentDirectory,
  );
  if (!options?.withFileTypes) return entries.map((entry) => entry.name);
  return entries.map((entry) => ({
    name: entry.name,
    isFile: () => entry.kind === 'file',
    isDirectory: () => entry.kind === 'directory',
  }));
}

export function renameSync(source: PathLike, destination: PathLike): void {
  const process = getBoundWin64Process();
  const bytes = process.machine.fileSystem.readFile(resolvePath(source));
  process.machine.fileSystem.writeFile(resolvePath(destination), bytes);
  process.machine.fileSystem.deleteFile(resolvePath(source));
}

export function appendFileSync(
  path: PathLike,
  data: string | ArrayBufferView,
): void {
  const process = getBoundWin64Process();
  const resolved = resolvePath(path);
  const previous = existsSync(resolved)
    ? process.machine.fileSystem.readFile(resolved)
    : new Uint8Array(0);
  const appended =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const combined = new Uint8Array(previous.length + appended.length);
  combined.set(previous);
  combined.set(appended, previous.length);
  process.machine.fileSystem.writeFile(resolved, combined);
}

type StreamListener = (...args: unknown[]) => void;

export function createWriteStream(
  path: PathLike,
  options?: { readonly flags?: string },
) {
  const listeners = new Map<string, Set<StreamListener>>();
  const append = options?.flags?.includes('a') ?? false;
  if (!append) writeFileSync(path, new Uint8Array(0));
  const stream = {
    on(event: string, listener: StreamListener) {
      let eventListeners = listeners.get(event);
      if (!eventListeners) listeners.set(event, (eventListeners = new Set()));
      eventListeners.add(listener);
      return stream;
    },
    once(event: string, listener: StreamListener) {
      const wrapped: StreamListener = (...args) => {
        listeners.get(event)?.delete(wrapped);
        listener(...args);
      };
      return stream.on(event, wrapped);
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
      return true;
    },
    write(chunk: string | ArrayBufferView) {
      appendFileSync(path, chunk);
      return true;
    },
    end(chunk?: string | ArrayBufferView) {
      if (chunk !== undefined) appendFileSync(path, chunk);
      queueMicrotask(() => {
        stream.emit('finish');
        stream.emit('close');
      });
      return stream;
    },
    close() {
      stream.emit('close');
    },
  };
  queueMicrotask(() => stream.emit('open', 1));
  return stream;
}

export const F_OK = 0;

export function exists(
  path: PathLike,
  callback: (present: boolean) => void,
): void {
  queueMicrotask(() => callback(existsSync(path)));
}

export function stat(
  path: PathLike,
  callback: (error: Error | null, stats?: ReturnType<typeof fileStats>) => void,
): void {
  queueMicrotask(() => {
    try {
      callback(null, fileStats(path));
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function unlink(
  path: PathLike,
  callback: (error?: Error | null) => void,
): void {
  queueMicrotask(() => {
    try {
      unlinkSync(path);
      callback(null);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function rename(
  source: PathLike,
  destination: PathLike,
  callback: (error?: Error | null) => void,
): void {
  queueMicrotask(() => {
    try {
      renameSync(source, destination);
      callback(null);
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function access(
  path: PathLike,
  callback: (error?: Error | null) => void,
): void {
  queueMicrotask(() =>
    callback(existsSync(path) ? null : new Error(`ENOENT: ${path}`)),
  );
}

export function watch() {
  return { close() {} };
}

export function symlinkSync(target: PathLike, path: PathLike): void {
  writeFileSync(path, String(target));
}

const fs = {
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  appendFileSync,
  statSync,
  lstatSync,
  readdirSync,
  renameSync,
  createWriteStream,
  exists,
  stat,
  unlink,
  rename,
  access,
  watch,
  symlinkSync,
  F_OK,
};

export default fs;
