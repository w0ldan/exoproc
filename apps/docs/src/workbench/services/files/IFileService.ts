import { Emitter, type Event } from '@/base/common/event';
import { createDecorator } from '@/platform/instantiation/common/instantiation';
import type {
  DeleteOptions,
  DirectoryEntryDto,
  FileChangeDto,
  FileStatDto,
  RenameOptions,
  WorkspaceInfoDto,
  WorkspaceSource,
  WriteFileOptions,
} from '@/shell/common/channels';
import type { ExoprocApi } from '@/shell/preload/api';

/**
 * Analogue of VS Code's `IFileService`, thinned to this workbench's
 * reality: exactly one workspace mounted at a time, so "which filesystem
 * is active" and "read/write within it" are one service rather than a
 * separate `IWorkspaceContextService` plus a multi-provider file service.
 *
 * This is the first workbench service that talks to `window.exoproc`
 * rather than wrapping local state -- every method is a round trip to the
 * main process (see `shell/main/modules/{workspace,fs}.ts`), which is why
 * every one of them is `async` even where the pre-shell `ExplorerService`
 * equivalent wasn't.
 */
export interface IFileService {
  readonly onDidChangeWorkspace: Event<WorkspaceInfoDto>;
  readonly onDidChangeFile: Event<readonly FileChangeDto[]>;

  getWorkspaceInfo(): WorkspaceInfoDto | undefined;
  bindWorkspace(source: WorkspaceSource): Promise<WorkspaceInfoDto>;
  /** Lists a directory's immediate children anywhere in the simulated machine's filesystem, by absolute path -- unlike `readDirectory`, never workspace-root-relative. Powers `SimulateFolderPicker`'s folder browser. */
  browseSimulateTree(path: string): Promise<readonly DirectoryEntryDto[]>;
  /** Absolute-path create/delete/rename for `SimulateFolderPicker`'s file-manager actions -- directory delete/rename are recursive, see `WorkspaceChannel`'s own doc comment for scope. */
  createSimulateDirectory(path: string): Promise<void>;
  deleteSimulateEntry(path: string): Promise<void>;
  renameSimulateEntry(source: string, target: string): Promise<void>;

  stat(path: string): Promise<FileStatDto>;
  readDirectory(path: string): Promise<readonly DirectoryEntryDto[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** Decodes as UTF-8 and strips a leading BOM, matching the pre-shell `ExplorerService.readFileText`. */
  readFileText(path: string): Promise<string>;
  writeFile(
    path: string,
    content: Uint8Array,
    options?: WriteFileOptions,
  ): Promise<void>;
  writeFileText(path: string, text: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  delete(path: string, options?: DeleteOptions): Promise<void>;
  rename(
    source: string,
    target: string,
    options?: RenameOptions,
  ): Promise<void>;
}

export const IFileService = createDecorator<IFileService>('fileService');

export class FileService implements IFileService {
  private workspaceInfo: WorkspaceInfoDto | undefined;

  private readonly workspaceChangeEmitter = new Emitter<WorkspaceInfoDto>();
  public readonly onDidChangeWorkspace = this.workspaceChangeEmitter.event;

  private readonly fileChangeEmitter = new Emitter<readonly FileChangeDto[]>();
  public readonly onDidChangeFile = this.fileChangeEmitter.event;

  public constructor(private readonly api: ExoprocApi) {
    this.api.workspace.onDidChangeRoot((info) => {
      this.workspaceInfo = info;
      this.workspaceChangeEmitter.fire(info);
    });
    this.api.fs.onDidChangeFile((changes) => {
      this.fileChangeEmitter.fire(changes);
    });
    void this.api.workspace.getInfo().then((info) => {
      this.workspaceInfo = info;
    });
  }

  public getWorkspaceInfo(): WorkspaceInfoDto | undefined {
    return this.workspaceInfo;
  }

  public async bindWorkspace(
    source: WorkspaceSource,
  ): Promise<WorkspaceInfoDto> {
    const info = await this.api.workspace.bind(source);
    this.workspaceInfo = info;
    return info;
  }

  public browseSimulateTree(
    path: string,
  ): Promise<readonly DirectoryEntryDto[]> {
    return this.api.workspace.browseSimulateTree(path);
  }

  public createSimulateDirectory(path: string): Promise<void> {
    return this.api.workspace.createSimulateDirectory(path);
  }

  public deleteSimulateEntry(path: string): Promise<void> {
    return this.api.workspace.deleteSimulateEntry(path);
  }

  public renameSimulateEntry(source: string, target: string): Promise<void> {
    return this.api.workspace.renameSimulateEntry(source, target);
  }

  public stat(path: string): Promise<FileStatDto> {
    return this.api.fs.stat(path);
  }

  public readDirectory(path: string): Promise<readonly DirectoryEntryDto[]> {
    return this.api.fs.readDirectory(path);
  }

  public readFile(path: string): Promise<Uint8Array> {
    return this.api.fs.readFile(path);
  }

  public async readFileText(path: string): Promise<string> {
    const bytes = await this.api.fs.readFile(path);
    return new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
  }

  public writeFile(
    path: string,
    content: Uint8Array,
    options?: WriteFileOptions,
  ): Promise<void> {
    return this.api.fs.writeFile(path, content, options);
  }

  public writeFileText(path: string, text: string): Promise<void> {
    return this.api.fs.writeFile(path, new TextEncoder().encode(text), {
      create: true,
      overwrite: true,
    });
  }

  public createDirectory(path: string): Promise<void> {
    return this.api.fs.createDirectory(path);
  }

  public delete(path: string, options?: DeleteOptions): Promise<void> {
    return this.api.fs.delete(path, options);
  }

  public rename(
    source: string,
    target: string,
    options?: RenameOptions,
  ): Promise<void> {
    return this.api.fs.rename(source, target, options);
  }
}
