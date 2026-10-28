import { Emitter, type Event } from '@/base/common/event';
import { joinPath } from '@/base/common/resource';
import { createDecorator } from '@/platform/instantiation/common/instantiation';
import { IFileService } from '@/workbench/services/files/IFileService';

/**
 * A tree node in the sidebar. Plain path, not a `ResourceUri`: the
 * workbench (and everything downstream of it -- `FileTree`, this
 * service) may not import `@exoproc/simulate*`, and `IFileService`
 * already settled on plain POSIX-style paths as the one representation
 * for "where something is" (see `IFileService`'s own doc comment).
 */
export interface ExplorerItem {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
}

/**
 * Cached tree view-model over `IFileService`, the same layering VS
 * Code's own explorer has above its `IFileService`: this is where
 * "resolve children lazily, cache until something changes" lives, kept
 * separate from the low-level read/write primitive.
 *
 * Previously wrapped a standalone `ExplorerService` class talking to a
 * server-side `SimulatedFileSystemProvider` over `/api/ide/files`; now
 * wraps `IFileService`, which talks to the bound workspace (GitHub/zip/
 * empty, see `IFileService.bindWorkspace`) through the shell boundary.
 * `resolveDirectory`/`setRoot` are gone with it -- there is exactly one
 * workspace root at a time now, changed by binding a new workspace
 * rather than by re-rooting into an arbitrary subfolder.
 */
export interface IExplorerService {
  readonly root: ExplorerItem;
  resolveChildren(directory: ExplorerItem): Promise<readonly ExplorerItem[]>;
  readFileText(file: ExplorerItem): Promise<string>;
  /** Creates an empty file inside `directory`. Rejects if an entry with that name already exists there. */
  createFile(directory: ExplorerItem, name: string): Promise<void>;
  /** Creates an empty directory inside `directory`. Rejects if an entry with that name already exists there. */
  createFolder(directory: ExplorerItem, name: string): Promise<void>;
  /** Deletes a file, or a directory and everything under it. */
  delete(item: ExplorerItem): Promise<void>;
  refresh(): void;
  readonly onDidChange: Event<void>;
}

export const IExplorerService =
  createDecorator<IExplorerService>('explorerService');

function rootItem(name: string): ExplorerItem {
  return { id: '/', name, path: '/', isDirectory: true };
}

export class ExplorerService implements IExplorerService {
  private _root: ExplorerItem;
  private readonly changeEmitter = new Emitter<void>();
  private readonly childrenCache = new Map<
    string,
    Promise<readonly ExplorerItem[]>
  >();

  public readonly onDidChange: Event<void> = this.changeEmitter.event;

  public constructor(private readonly fileService: IFileService) {
    const info = fileService.getWorkspaceInfo();
    this._root = rootItem(info?.rootName ?? 'workspace');

    this.fileService.onDidChangeWorkspace((info) => {
      this._root = rootItem(info.rootName);
      this.invalidate();
    });
    this.fileService.onDidChangeFile(() => this.invalidate());
  }

  public get root(): ExplorerItem {
    return this._root;
  }

  public resolveChildren(
    directory: ExplorerItem,
  ): Promise<readonly ExplorerItem[]> {
    if (!directory.isDirectory) return Promise.resolve([]);

    const cached = this.childrenCache.get(directory.path);
    if (cached) return cached;

    const pending = this.fileService
      .readDirectory(directory.path)
      .then((entries) =>
        entries
          .map<ExplorerItem>(([name, kind]) => {
            const path = joinPath(directory.path, name);
            return { id: path, name, path, isDirectory: kind === 'directory' };
          })
          .sort((left, right) => {
            if (left.isDirectory !== right.isDirectory) {
              return left.isDirectory ? -1 : 1;
            }
            return left.name.localeCompare(right.name, 'tr', {
              sensitivity: 'base',
            });
          }),
      )
      .catch((error: unknown) => {
        if (this.childrenCache.get(directory.path) === pending) {
          this.childrenCache.delete(directory.path);
        }
        throw error;
      });

    this.childrenCache.set(directory.path, pending);
    return pending;
  }

  public async readFileText(file: ExplorerItem): Promise<string> {
    if (file.isDirectory) {
      throw new Error('Klasörler metin dosyası olarak açılamaz.');
    }
    return this.fileService.readFileText(file.path);
  }

  public async createFile(
    directory: ExplorerItem,
    name: string,
  ): Promise<void> {
    const siblings = await this.resolveChildren(directory);
    if (siblings.some((entry) => entry.name === name)) {
      throw new Error(`"${name}" zaten mevcut.`);
    }
    await this.fileService.writeFileText(joinPath(directory.path, name), '');
  }

  public async createFolder(
    directory: ExplorerItem,
    name: string,
  ): Promise<void> {
    const siblings = await this.resolveChildren(directory);
    if (siblings.some((entry) => entry.name === name)) {
      throw new Error(`"${name}" zaten mevcut.`);
    }
    await this.fileService.createDirectory(joinPath(directory.path, name));
  }

  public delete(item: ExplorerItem): Promise<void> {
    return this.fileService.delete(item.path, { recursive: item.isDirectory });
  }

  public refresh(): void {
    this.invalidate();
  }

  private invalidate(): void {
    this.childrenCache.clear();
    this.changeEmitter.fire();
  }
}
