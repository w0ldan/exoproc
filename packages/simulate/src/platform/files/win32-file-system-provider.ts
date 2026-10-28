import { Emitter, EventNone, type Disposable } from '../common/event.js';
import type { Win32FileSystem } from '../../runtime/file-system.js';
import {
  createFileSystemProviderError,
  FileChangeType,
  FileSystemProviderCapabilities,
  FileSystemProviderErrorCode,
  FileType,
  type DirectoryEntry,
  type FileChange,
  type FileDeleteOptions,
  type FileOverwriteOptions,
  type FileStat,
  type FileSystemProvider,
  type FileWatchOptions,
  type FileWriteOptions,
} from './files.js';
import type { ResourceUri } from './resource-uri.js';

/** Adapts the in-process Win32 filesystem to the platform provider contract. */
export class Win32FileSystemProvider implements FileSystemProvider, Disposable {
  public readonly capabilities = FileSystemProviderCapabilities.FileReadWrite;
  public readonly onDidChangeCapabilities = EventNone;

  private readonly changeEmitter = new Emitter<readonly FileChange[]>();
  public readonly onDidChangeFile = this.changeEmitter.event;

  public constructor(
    private readonly fileSystem: Win32FileSystem,
    private readonly currentDirectory = 'C:\\',
  ) {}

  public watch(_resource: ResourceUri, _options: FileWatchOptions): Disposable {
    return { dispose: () => undefined };
  }

  public async stat(resource: ResourceUri): Promise<FileStat> {
    const entry = this.fileSystem.getEntry(
      this.toPath(resource),
      this.currentDirectory,
    );
    if (!entry) {
      throw createFileSystemProviderError(
        `File does not exist: ${this.toPath(resource)}`,
        FileSystemProviderErrorCode.FileNotFound,
      );
    }
    const timestamp = entry.createdAt.getTime();
    return {
      type: entry.kind === 'directory' ? FileType.Directory : FileType.File,
      ctime: timestamp,
      mtime: timestamp,
      size: entry.kind === 'file' ? entry.data.byteLength : 0,
    };
  }

  public async readDirectory(
    resource: ResourceUri,
  ): Promise<readonly DirectoryEntry[]> {
    try {
      return this.fileSystem
        .readDirectory(this.toPath(resource), this.currentDirectory)
        .map(
          (entry) =>
            [
              entry.name,
              entry.kind === 'directory' ? FileType.Directory : FileType.File,
            ] as const,
        );
    } catch (error) {
      throw this.toProviderError(
        error,
        FileSystemProviderErrorCode.FileNotADirectory,
      );
    }
  }

  public async readFile(resource: ResourceUri): Promise<Uint8Array> {
    try {
      return this.fileSystem.readFile(
        this.toPath(resource),
        0,
        undefined,
        this.currentDirectory,
      );
    } catch (error) {
      throw this.toProviderError(
        error,
        FileSystemProviderErrorCode.FileNotFound,
      );
    }
  }

  public async writeFile(
    resource: ResourceUri,
    content: Uint8Array,
    options: FileWriteOptions,
  ): Promise<void> {
    const path = this.toPath(resource);
    const existing = this.fileSystem.getEntry(path, this.currentDirectory);
    if (existing?.kind === 'directory') {
      throw createFileSystemProviderError(
        `Cannot write directory: ${path}`,
        FileSystemProviderErrorCode.FileIsADirectory,
      );
    }
    if (existing && !options.overwrite) {
      throw createFileSystemProviderError(
        `File already exists: ${path}`,
        FileSystemProviderErrorCode.FileExists,
      );
    }
    if (!existing && !options.create) {
      throw createFileSystemProviderError(
        `File does not exist: ${path}`,
        FileSystemProviderErrorCode.FileNotFound,
      );
    }

    this.fileSystem.writeFile(path, content);
    this.changeEmitter.fire([
      {
        type: existing ? FileChangeType.Updated : FileChangeType.Added,
        resource,
      },
    ]);
  }

  public async createDirectory(resource: ResourceUri): Promise<void> {
    const path = this.toPath(resource);
    const existing = this.fileSystem.getEntry(path, this.currentDirectory);
    if (existing?.kind === 'file') {
      throw createFileSystemProviderError(
        `File already exists: ${path}`,
        FileSystemProviderErrorCode.FileExists,
      );
    }
    this.fileSystem.createDirectory(path);
    if (!existing) {
      this.changeEmitter.fire([{ type: FileChangeType.Added, resource }]);
    }
  }

  public async delete(
    resource: ResourceUri,
    options: FileDeleteOptions,
  ): Promise<void> {
    const path = this.toPath(resource);
    const entry = this.fileSystem.getEntry(path, this.currentDirectory);
    if (!entry) {
      throw createFileSystemProviderError(
        `File does not exist: ${path}`,
        FileSystemProviderErrorCode.FileNotFound,
      );
    }
    if (entry.kind === 'directory') {
      throw createFileSystemProviderError(
        options.recursive
          ? 'Recursive directory deletion is not implemented by Win32FileSystem'
          : `Cannot delete directory as a file: ${path}`,
        FileSystemProviderErrorCode.Unsupported,
      );
    }
    if (!this.fileSystem.deleteFile(path, this.currentDirectory)) {
      throw createFileSystemProviderError(
        `Unable to delete file: ${path}`,
        FileSystemProviderErrorCode.Unknown,
      );
    }
    this.changeEmitter.fire([{ type: FileChangeType.Deleted, resource }]);
  }

  public async rename(
    _source: ResourceUri,
    _target: ResourceUri,
    _options: FileOverwriteOptions,
  ): Promise<void> {
    throw createFileSystemProviderError(
      'Rename is not implemented by Win32FileSystem',
      FileSystemProviderErrorCode.Unsupported,
    );
  }

  public dispose(): void {
    this.changeEmitter.dispose();
  }

  private toPath(resource: ResourceUri): string {
    return resource.fsPath;
  }

  private toProviderError(
    error: unknown,
    fallback: FileSystemProviderErrorCode,
  ): Error {
    if (error instanceof Error) {
      return createFileSystemProviderError(error.message, fallback);
    }
    return createFileSystemProviderError(String(error), fallback);
  }
}
