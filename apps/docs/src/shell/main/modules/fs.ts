import type { Win32FileSystemEntry } from 'win32-simulate';
import {
  FsChannel,
  type DeleteOptions,
  type DirectoryEntryDto,
  type FileChangeDto,
  type FileKind,
  type FileStatDto,
  type RenameOptions,
  type WriteFileOptions,
} from '../../common/channels';
import { toWindowsPath } from '../fs/workspace-paths';
import { ipc } from '../ipc';
import { getMachine } from './machine';
import { getWorkspaceRoot } from './workspace';

function windowsPath(path: string): string {
  return toWindowsPath(path, getWorkspaceRoot());
}

/**
 * Bridges `FsChannel` directly to `machine.fileSystem` (`Win32FileSystem`)
 * -- the same filesystem `cmd.exe`/`node.exe`/every guest Win32 file API
 * reads and writes, per F9. `Win32FileSystem` is fully synchronous, so
 * every handler here is too; the plain-string paths this channel already
 * used (workspace-relative, POSIX-style, e.g. `/src/index.ts`) are
 * translated to/from the guest's own `C:\Users\Serkan\Workspace\...`
 * convention at the boundary -- the renderer/`IFileService`/Explorer/
 * Editor never learn that convention changed underneath them.
 *
 * `Win32FileSystem` has no change-event system of its own (a plain
 * synchronous `Map`, no pub/sub) -- unlike the old `FileSystemProvider`-
 * based design, which forwarded a provider's own `onDidChangeFile`. Every
 * mutating handler below synthesizes and pushes the equivalent
 * `FsChannel.onDidChangeFile` event itself instead, which covers every
 * edit made *through this channel* (Explorer/Editor's own writes) --
 * the same set of edits the old design actually observed in practice.
 */

function toFileKind(entry: Win32FileSystemEntry): FileKind {
  return entry.kind === 'directory' ? 'directory' : 'file';
}

function toStatDto(entry: Win32FileSystemEntry): FileStatDto {
  return {
    kind: toFileKind(entry),
    ctime: entry.createdAt.getTime(),
    mtime: entry.createdAt.getTime(),
    size: entry.data.length,
    readonly: false,
  };
}

function toDirectoryEntryDto(entry: Win32FileSystemEntry): DirectoryEntryDto {
  return [entry.name, toFileKind(entry)];
}

function notifyChanged(path: string, kind: FileChangeDto['kind']): void {
  ipc.send(FsChannel.onDidChangeFile, [{ kind, path }]);
}

export function registerFsHandlers(): void {
  ipc.handle(FsChannel.stat, (path: string) => {
    const entry = getMachine().fileSystem.getEntry(windowsPath(path));
    if (!entry) throw new Error(`Dosya bulunamadı: ${path}`);
    return toStatDto(entry);
  });

  ipc.handle(FsChannel.readDirectory, (path: string) =>
    getMachine()
      .fileSystem.readDirectory(windowsPath(path))
      .map(toDirectoryEntryDto),
  );

  ipc.handle(FsChannel.readFile, (path: string) =>
    getMachine().fileSystem.readFile(windowsPath(path)),
  );

  ipc.handle(
    FsChannel.writeFile,
    (path: string, content: Uint8Array, _options?: WriteFileOptions) => {
      const fileSystem = getMachine().fileSystem;
      const targetPath = windowsPath(path);
      // `Win32FileSystem.writeFile` requires the parent directory to
      // already exist (unlike the pre-F9 provider layer, which created
      // it implicitly) -- ensure it here so Explorer creating a file at
      // a not-yet-materialized nested path doesn't need a separate
      // `createDirectory` round trip first.
      const parent = targetPath.slice(0, targetPath.lastIndexOf('\\'));
      if (parent && !fileSystem.isDirectory(parent))
        fileSystem.createDirectory(parent);
      fileSystem.writeFile(targetPath, content);
      notifyChanged(path, 'updated');
    },
  );

  ipc.handle(FsChannel.createDirectory, (path: string) => {
    getMachine().fileSystem.createDirectory(windowsPath(path));
    notifyChanged(path, 'added');
  });

  ipc.handle(FsChannel.delete, (path: string, options?: DeleteOptions) => {
    const targetPath = windowsPath(path);
    const fileSystem = getMachine().fileSystem;
    const entry = fileSystem.getEntry(targetPath);
    if (!entry) throw new Error(`Dosya bulunamadı: ${path}`);
    if (entry.kind === 'directory') {
      if (!options?.recursive) {
        throw new Error(
          `"${path}" bir dizin -- silmek için recursive seçeneği gerekli.`,
        );
      }
      if (!fileSystem.deleteDirectory(targetPath)) {
        throw new Error(`"${path}" silinemedi.`);
      }
    } else {
      fileSystem.deleteFile(targetPath);
    }
    notifyChanged(path, 'deleted');
  });

  ipc.handle(
    FsChannel.rename,
    (source: string, target: string, options?: RenameOptions) => {
      const windowsSource = windowsPath(source);
      const fileSystem = getMachine().fileSystem;
      const entry = fileSystem.getEntry(windowsSource);
      if (!entry) throw new Error(`Dosya bulunamadı: ${source}`);
      const windowsTarget = windowsPath(target);
      if (!options?.overwrite && fileSystem.getEntry(windowsTarget)) {
        throw new Error(`Hedef zaten var: ${target}`);
      }
      if (entry.kind === 'directory') {
        if (!fileSystem.rename(windowsSource, windowsTarget)) {
          throw new Error(
            `"${source}" -> "${target}" yeniden adlandırılamadı.`,
          );
        }
      } else {
        fileSystem.writeFile(windowsTarget, fileSystem.readFile(windowsSource));
        fileSystem.deleteFile(windowsSource);
      }
      notifyChanged(source, 'deleted');
      notifyChanged(target, 'added');
    },
  );
}
