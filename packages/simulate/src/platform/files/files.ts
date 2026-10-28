import type { Disposable, Event } from '../common/event.js';
import type { ResourceUri } from './resource-uri.js';

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export enum FileSystemProviderCapabilities {
  None = 0,
  FileReadWrite = 1 << 1,
  FileFolderCopy = 1 << 2,
  PathCaseSensitive = 1 << 10,
  Readonly = 1 << 11,
  FileWatch = 1 << 12,
}

export enum FileChangeType {
  Updated,
  Added,
  Deleted,
}

export interface FileChange {
  readonly type: FileChangeType;
  readonly resource: ResourceUri;
}

export interface FileStat {
  readonly type: FileType;
  readonly ctime: number;
  readonly mtime: number;
  readonly size: number;
  readonly readonly?: boolean;
}

export interface ResolvedFileStat extends FileStat {
  readonly resource: ResourceUri;
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly children?: readonly ResolvedFileStat[];
}

export type DirectoryEntry = readonly [name: string, type: FileType];

export interface FileWriteOptions {
  readonly create: boolean;
  readonly overwrite: boolean;
}

export interface FileDeleteOptions {
  readonly recursive: boolean;
  readonly useTrash: boolean;
}

export interface FileOverwriteOptions {
  readonly overwrite: boolean;
}

export interface FileWatchOptions {
  readonly recursive: boolean;
  readonly excludes?: readonly string[];
}

export interface ResolveFileOptions {
  readonly resolveChildren?: boolean;
}

export interface FileSystemProvider {
  readonly capabilities: FileSystemProviderCapabilities;
  readonly onDidChangeCapabilities: Event<void>;
  readonly onDidChangeFile: Event<readonly FileChange[]>;

  watch(resource: ResourceUri, options: FileWatchOptions): Disposable;
  stat(resource: ResourceUri): Promise<FileStat>;
  readDirectory(resource: ResourceUri): Promise<readonly DirectoryEntry[]>;
  readFile(resource: ResourceUri): Promise<Uint8Array>;
  writeFile(
    resource: ResourceUri,
    content: Uint8Array,
    options: FileWriteOptions,
  ): Promise<void>;
  createDirectory(resource: ResourceUri): Promise<void>;
  delete(resource: ResourceUri, options: FileDeleteOptions): Promise<void>;
  rename(
    source: ResourceUri,
    target: ResourceUri,
    options: FileOverwriteOptions,
  ): Promise<void>;
}

export enum FileSystemProviderErrorCode {
  FileExists = 'EntryExists',
  FileNotFound = 'EntryNotFound',
  FileNotADirectory = 'EntryNotADirectory',
  FileIsADirectory = 'EntryIsADirectory',
  NoPermissions = 'NoPermissions',
  Readonly = 'Readonly',
  Unsupported = 'Unsupported',
  Unavailable = 'Unavailable',
  Unknown = 'Unknown',
}

export class FileSystemProviderError extends Error {
  public constructor(
    message: string,
    public readonly code: FileSystemProviderErrorCode,
  ) {
    super(message);
    this.name = `${code} (FileSystemError)`;
  }
}

export function createFileSystemProviderError(
  message: string,
  code: FileSystemProviderErrorCode,
): FileSystemProviderError {
  return new FileSystemProviderError(message, code);
}
