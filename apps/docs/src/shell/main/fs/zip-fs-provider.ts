import {
  createFileSystemProviderError,
  EventNone,
  FileSystemProviderCapabilities,
  FileSystemProviderErrorCode,
  FileType,
  joinResourcePath,
  ResourceUri,
  type DirectoryEntry,
  type Disposable,
  type FileDeleteOptions,
  type FileOverwriteOptions,
  type FileStat,
  type FileSystemProvider,
  type FileWatchOptions,
  type FileWriteOptions,
} from 'win32-simulate/files';

/**
 * Read-only `FileSystemProvider` view of a `.zip` archive's bytes, with no
 * server and no dependency. This exists specifically because fetching a
 * zip from GitHub is not an option (neither `codeload.github.com`'s
 * branch archives nor release assets send a CORS header a browser will
 * accept, measured -- see the plan doc), so a zip's bytes have to come
 * from somewhere else (a user-picked file) and be parsed client-side
 * either way.
 *
 * Parses only the central directory up front (cheap: one pass over a
 * small structure at the end of the file) and decompresses each entry
 * lazily, on first read, using the platform's own `DecompressionStream`
 * -- no zip library needed for a format this constrained. ZIP64 (>4GB
 * archives or >65535 entries) is out of scope; source repositories never
 * approach that size.
 *
 * Wired into the live workspace-bind path via `extractZipEntries()`
 * (bottom of this file), used by `shell/main/modules/workspace.ts`'s
 * `WorkspaceSource` `zip` variant to eagerly extract every file into
 * `machine.fileSystem`. The class itself stays a lazy, read-only
 * `FileSystemProvider` -- `extractZipEntries` just walks it recursively
 * rather than duplicating the parsing/decompression logic.
 */

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const MAX_COMMENT_LENGTH = 0xffff;

interface ZipFileEntry {
  readonly kind: 'file';
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
}

type ZipIndexEntry = ZipFileEntry | { readonly kind: 'directory' };

export class ZipFsProvider implements FileSystemProvider {
  public readonly capabilities = FileSystemProviderCapabilities.Readonly;
  public readonly onDidChangeCapabilities = EventNone;
  public readonly onDidChangeFile = EventNone;

  private readonly index = new Map<string, ZipIndexEntry>();
  private readonly view: DataView;

  public constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.index.set('/', { kind: 'directory' });
    this.parseCentralDirectory();
  }

  private parseCentralDirectory(): void {
    const eocdOffset = this.findEndOfCentralDirectory();
    const entryCount = this.view.getUint16(eocdOffset + 10, true);
    let cursor = this.view.getUint32(eocdOffset + 16, true);

    interface RawEntry {
      readonly name: string;
      readonly isDirectory: boolean;
      readonly compressionMethod: number;
      readonly compressedSize: number;
      readonly uncompressedSize: number;
      readonly localHeaderOffset: number;
    }
    const raw: RawEntry[] = [];

    for (let index = 0; index < entryCount; index += 1) {
      if (this.view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
        throw new Error('Malformed zip archive: bad central directory entry.');
      }
      const compressionMethod = this.view.getUint16(cursor + 10, true);
      const compressedSize = this.view.getUint32(cursor + 20, true);
      const uncompressedSize = this.view.getUint32(cursor + 24, true);
      const nameLength = this.view.getUint16(cursor + 28, true);
      const extraLength = this.view.getUint16(cursor + 30, true);
      const commentLength = this.view.getUint16(cursor + 32, true);
      const localHeaderOffset = this.view.getUint32(cursor + 42, true);
      const nameStart = cursor + 46;
      const name = new TextDecoder().decode(
        this.bytes.subarray(nameStart, nameStart + nameLength),
      );

      raw.push({
        name,
        isDirectory: name.endsWith('/'),
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });

      cursor = nameStart + nameLength + extraLength + commentLength;
    }

    // Most "download this repo" archives wrap everything in one folder
    // (`reponame-branch/...`); stripping it is what makes the workspace
    // root show the repository's own contents instead of a single folder.
    const prefix = detectStrippablePrefix(raw.map((entry) => entry.name));

    for (const entry of raw) {
      const stripped = prefix ? entry.name.slice(prefix.length) : entry.name;
      if (stripped.length === 0) continue; // the stripped folder itself
      const path = `/${stripped.replace(/\/$/, '')}`;

      this.index.set(
        path,
        entry.isDirectory
          ? { kind: 'directory' }
          : {
              kind: 'file',
              compressionMethod: entry.compressionMethod,
              compressedSize: entry.compressedSize,
              uncompressedSize: entry.uncompressedSize,
              localHeaderOffset: entry.localHeaderOffset,
            },
      );
      this.registerAncestorDirectories(path);
    }
  }

  private findEndOfCentralDirectory(): number {
    const minOffset = Math.max(0, this.bytes.length - 22 - MAX_COMMENT_LENGTH);
    for (
      let offset = this.bytes.length - 22;
      offset >= minOffset;
      offset -= 1
    ) {
      if (
        this.view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE
      ) {
        return offset;
      }
    }
    throw new Error(
      'Not a valid zip archive: end-of-central-directory record not found.',
    );
  }

  private registerAncestorDirectories(path: string): void {
    const segments = path.split('/').filter(Boolean);
    segments.pop();
    let current = '';
    for (const segment of segments) {
      current += `/${segment}`;
      if (!this.index.has(current))
        this.index.set(current, { kind: 'directory' });
    }
  }

  private require(path: string): ZipIndexEntry {
    const entry = this.index.get(path);
    if (!entry) {
      throw createFileSystemProviderError(
        `${path} does not exist.`,
        FileSystemProviderErrorCode.FileNotFound,
      );
    }
    return entry;
  }

  public async stat(resource: ResourceUri): Promise<FileStat> {
    const entry = this.require(resource.path);
    return entry.kind === 'file'
      ? {
          type: FileType.File,
          ctime: 0,
          mtime: 0,
          size: entry.uncompressedSize,
          readonly: true,
        }
      : {
          type: FileType.Directory,
          ctime: 0,
          mtime: 0,
          size: 0,
          readonly: true,
        };
  }

  public async readDirectory(
    resource: ResourceUri,
  ): Promise<readonly DirectoryEntry[]> {
    const entry = this.require(resource.path);
    if (entry.kind !== 'directory') {
      throw createFileSystemProviderError(
        `${resource.toString()} is not a directory.`,
        FileSystemProviderErrorCode.FileNotADirectory,
      );
    }

    const prefix = resource.path === '/' ? '/' : `${resource.path}/`;
    const children: DirectoryEntry[] = [];
    for (const [path, child] of this.index) {
      if (path === resource.path || !path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.includes('/')) continue;
      children.push([
        rest,
        child.kind === 'directory' ? FileType.Directory : FileType.File,
      ]);
    }
    return children;
  }

  public async readFile(resource: ResourceUri): Promise<Uint8Array> {
    const entry = this.require(resource.path);
    if (entry.kind !== 'file') {
      throw createFileSystemProviderError(
        `${resource.toString()} is a directory.`,
        FileSystemProviderErrorCode.FileIsADirectory,
      );
    }

    // The local header is re-read (rather than trusted from the central
    // directory) because its name/extra-field lengths can legally differ
    // from the central directory's -- only it tells us where data starts.
    const offset = entry.localHeaderOffset;
    if (this.view.getUint32(offset, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error('Malformed zip archive: bad local file header.');
    }
    const nameLength = this.view.getUint16(offset + 26, true);
    const extraLength = this.view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + nameLength + extraLength;
    const compressed = this.bytes.subarray(
      dataStart,
      dataStart + entry.compressedSize,
    );

    if (entry.compressionMethod === 0) return compressed.slice();
    if (entry.compressionMethod === 8) {
      const stream = new Blob([new Uint8Array(compressed)])
        .stream()
        .pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error(
      `Unsupported zip compression method ${entry.compressionMethod} for ${resource.path}.`,
    );
  }

  public writeFile(
    _resource: ResourceUri,
    _content: Uint8Array,
    _options: FileWriteOptions,
  ): Promise<void> {
    return this.readonly();
  }

  public createDirectory(_resource: ResourceUri): Promise<void> {
    return this.readonly();
  }

  public delete(
    _resource: ResourceUri,
    _options: FileDeleteOptions,
  ): Promise<void> {
    return this.readonly();
  }

  public rename(
    _source: ResourceUri,
    _target: ResourceUri,
    _options: FileOverwriteOptions,
  ): Promise<void> {
    return this.readonly();
  }

  public watch(_resource: ResourceUri, _options: FileWatchOptions): Disposable {
    return { dispose: () => undefined };
  }

  private readonly(): Promise<never> {
    return Promise.reject(
      createFileSystemProviderError(
        'This workspace source is read-only.',
        FileSystemProviderErrorCode.Readonly,
      ),
    );
  }
}

function detectStrippablePrefix(names: readonly string[]): string | undefined {
  const relevant = names.filter((name) => name.length > 0);
  if (relevant.length === 0) return undefined;

  const slashIndex = relevant[0].indexOf('/');
  if (slashIndex === -1) return undefined;

  const candidate = relevant[0].slice(0, slashIndex + 1);
  return relevant.every((name) => name.startsWith(candidate))
    ? candidate
    : undefined;
}

export interface ExtractedZipFile {
  /** POSIX-style, root-relative (e.g. `/src/index.ts`) -- the archive's own single wrapping folder, if any, is already stripped (see `detectStrippablePrefix`). */
  readonly path: string;
  readonly data: Uint8Array;
}

/**
 * Eagerly walks every file in a zip archive's bytes, decompressing each
 * one. Reuses `ZipFsProvider`'s own (lazy, `FileSystemProvider`-shaped)
 * parsing rather than a separate extraction code path -- this function is
 * just a recursive `readDirectory`/`readFile` walk over it.
 */
export async function extractZipEntries(
  bytes: Uint8Array,
): Promise<readonly ExtractedZipFile[]> {
  const provider = new ZipFsProvider(bytes);
  const results: ExtractedZipFile[] = [];

  async function walk(resource: ResourceUri): Promise<void> {
    const children = await provider.readDirectory(resource);
    for (const [name, kind] of children) {
      const child = joinResourcePath(resource, name);
      if (kind === FileType.Directory) {
        await walk(child);
      } else {
        results.push({
          path: child.path,
          data: await provider.readFile(child),
        });
      }
    }
  }

  await walk(ResourceUri.from({ scheme: 'file', path: '/' }));
  return results;
}
