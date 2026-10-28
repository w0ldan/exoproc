import { WIN32_WORKSPACE_PATH } from 'win32-simulate';
import {
  WorkspaceChannel,
  type DirectoryEntryDto,
  type WorkspaceInfoDto,
  type WorkspaceSource,
} from '../../common/channels';
import { extractZipEntries } from '../fs/zip-fs-provider';
import { ipc } from '../ipc';
import { getMachine } from './machine';

/**
 * Owns the workspace bind for this session, and -- separately -- which
 * absolute `Win32FileSystem` path the workspace *root* currently points
 * at.
 *
 * `Win32FileSystem` (`machine.fileSystem`, see `packages/simulate/src/
 * runtime/file-system.ts`) is the single filesystem -- `cmd.exe`'s `dir`,
 * `node.exe`, `fs.ts`'s channel, and this module's own root-navigation all
 * read/write the exact same tree.
 *
 * **Nothing here auto-persists.** An earlier design (F9) bound this tree
 * to OPFS so every write survived a page reload on its own; that was
 * deliberately replaced with a snapshot-only model (explicit user
 * decision): the workspace is a plain in-memory filesystem for the
 * lifetime of this Worker, and the *only* way any of it survives a reload
 * is taking a VM snapshot from the "VM Snapshots" tab first --
 * `Win64Machine.snapshot()` now captures `fileSystem` too (see that
 * method's doc comment), so "Restore" brings files back exactly as they
 * were at snapshot time, same as it does for processes/threads/memory.
 * Skip taking one and every edit is gone the moment the Worker restarts.
 *
 * `bind({type:'simulate-path', path})` re-points the workspace root at any
 * existing directory already reachable in `machine.fileSystem` (picked via
 * `browseSimulateTree`, see `SimulateFolderPicker.tsx`), and
 * `bind({type:'zip', ...})` extracts an archive into a fixed location and
 * re-points there -- both just write into the same ordinary filesystem.
 */

const DEFAULT_SOURCE_LABEL =
  'oturum içi (yalnızca snapshot alınırsa kalıcı olur)';

let info: WorkspaceInfoDto | undefined;
let currentRoot = WIN32_WORKSPACE_PATH;

export function getWorkspaceRoot(): string {
  return currentRoot;
}

/**
 * Sets the initial workspace root. Purely synchronous (nothing async left
 * to wait on since OPFS was removed) -- also called again after a VM
 * restore (`vm-snapshot-reattach.ts`) to reset the root to a location
 * guaranteed to exist in the just-restored filesystem, since the restored
 * content may not contain whatever path was selected before the restore.
 */
export function initializeWorkspace(): void {
  setRoot(WIN32_WORKSPACE_PATH, DEFAULT_SOURCE_LABEL);
}

function rootNameFromPath(path: string): string {
  const trimmed = path.replace(/\\+$/, '');
  const separator = trimmed.lastIndexOf('\\');
  return separator === -1 ? trimmed : trimmed.slice(separator + 1);
}

function setRoot(path: string, sourceLabel: string): void {
  currentRoot = path;
  info = {
    rootName: rootNameFromPath(path) || path,
    rootPath: path,
    sourceLabel,
  };
  ipc.send(WorkspaceChannel.onDidChangeRoot, info);
}

/**
 * Sanitizes an archive's file name into a safe single path segment
 * (strips `.zip`, replaces characters `Win32FileSystem.normalize` and a
 * real Windows path would reject).
 */
function sanitizeArchiveName(name: string): string {
  const withoutExtension = name.replace(/\.zip$/i, '');
  const sanitized = withoutExtension.replace(/[<>:"/\\|?*]+/g, '_').trim();
  return sanitized || 'archive';
}

/** Extracts every file in the archive into `C:\Users\Serkan\Zips\<archive name>\...`, overwriting any prior extraction of the same name. Returns the extraction root. */
async function importZip(name: string, bytes: Uint8Array): Promise<string> {
  const fileSystem = getMachine().fileSystem;
  const targetRoot = `C:\\Users\\Serkan\\Zips\\${sanitizeArchiveName(name)}`;
  fileSystem.createDirectory(targetRoot);

  const entries = await extractZipEntries(bytes);
  for (const entry of entries) {
    const relative = entry.path.replace(/^\/+/, '').replace(/\//g, '\\');
    if (!relative) continue;
    const targetPath = `${targetRoot}\\${relative}`;
    const parent = targetPath.slice(0, targetPath.lastIndexOf('\\'));
    if (parent && !fileSystem.isDirectory(parent))
      fileSystem.createDirectory(parent);
    fileSystem.writeFile(targetPath, entry.data);
  }
  return targetRoot;
}

export function registerWorkspaceHandlers(): void {
  ipc.handle(WorkspaceChannel.bind, async (source: WorkspaceSource) => {
    const fileSystem = getMachine().fileSystem;

    if (source.type === 'empty') {
      setRoot(WIN32_WORKSPACE_PATH, DEFAULT_SOURCE_LABEL);
    } else if (source.type === 'simulate-path') {
      const normalized = fileSystem.normalize(source.path);
      if (!fileSystem.isDirectory(normalized)) {
        throw new Error(`"${source.path}" bir dizin değil ya da mevcut değil.`);
      }
      setRoot(normalized, `simulate: ${normalized}`);
    } else {
      const targetRoot = await importZip(source.name, source.bytes);
      setRoot(targetRoot, `zip: ${source.name}`);
    }

    if (!info) throw new Error('Workspace bağlanamadı.');
    return info;
  });

  ipc.handle(WorkspaceChannel.getInfo, () => info);

  ipc.handle(
    WorkspaceChannel.browseSimulateTree,
    (path: string): readonly DirectoryEntryDto[] =>
      getMachine()
        .fileSystem.readDirectory(path)
        .map((entry): DirectoryEntryDto => [entry.name, entry.kind]),
  );

  ipc.handle(WorkspaceChannel.createSimulateDirectory, (path: string) => {
    getMachine().fileSystem.createDirectory(path);
  });

  ipc.handle(WorkspaceChannel.deleteSimulateEntry, (path: string) => {
    const fileSystem = getMachine().fileSystem;
    const entry = fileSystem.getEntry(path);
    if (!entry) throw new Error(`"${path}" bulunamadı.`);
    const deleted =
      entry.kind === 'directory'
        ? fileSystem.deleteDirectory(path)
        : fileSystem.deleteFile(path);
    if (!deleted) throw new Error(`"${path}" silinemedi.`);
  });

  ipc.handle(
    WorkspaceChannel.renameSimulateEntry,
    (source: string, target: string) => {
      const fileSystem = getMachine().fileSystem;
      if (!fileSystem.rename(source, target)) {
        throw new Error(
          `"${source}" -> "${target}" yeniden adlandırılamadı (kaynak yok ya da hedef zaten var).`,
        );
      }
    },
  );
}
