import { Emitter, type Event } from '@/base/common/event';
import { createDecorator } from '@/platform/instantiation/common/instantiation';
import { IFileService } from '@/workbench/services/files/IFileService';
import type { ExplorerItem } from '../explorer/IExplorerService';

export interface OpenEditorInput {
  readonly item: ExplorerItem;
  readonly content: string;
}

/**
 * Analogue of VS Code's `IEditorService` (`openEditor()` /
 * `activeEditorPane`), scoped down to this workbench's single-editor-group
 * reality: one active document at a time. Extracted out of `IdeExplorer`'s
 * local `useState<OpenDocument>` so other views (a future "recently
 * opened" list, the terminal's "run active file" action, etc.) can read or
 * drive it without prop-drilling through the explorer component.
 *
 * Previously took a `readFileText` callback injected by whatever wired it
 * up (a layer of indirection that only ever pointed at one thing: the
 * explorer's file reader). Takes `IFileService` directly now that it is a
 * first-class registered service -- same relationship every other
 * workbench service already has to its dependencies.
 */
export interface IEditorService {
  readonly activeEditor: OpenEditorInput | undefined;
  readonly openEditors: readonly OpenEditorInput[];
  openFile(item: ExplorerItem): Promise<void>;
  selectEditor(item: ExplorerItem): void;
  closeEditor(item: ExplorerItem): void;
  /** Re-reads the active document's content in place (e.g. after an external filesystem change). */
  reloadActiveEditor(): Promise<void>;
  /** Writes `content` to the active document's file and adopts it as the new clean baseline. */
  saveActiveEditor(content: string): Promise<void>;
  closeActiveEditor(): void;
  readonly onDidActiveEditorChange: Event<OpenEditorInput | undefined>;
  readonly onDidOpenEditorsChange: Event<readonly OpenEditorInput[]>;
}

export const IEditorService = createDecorator<IEditorService>('editorService');

export class EditorService implements IEditorService {
  private current: OpenEditorInput | undefined;
  private readonly editors: OpenEditorInput[] = [];
  private readonly activeEditorChangeEmitter = new Emitter<
    OpenEditorInput | undefined
  >();
  private readonly openEditorsChangeEmitter = new Emitter<
    readonly OpenEditorInput[]
  >();

  public readonly onDidActiveEditorChange =
    this.activeEditorChangeEmitter.event;
  public readonly onDidOpenEditorsChange = this.openEditorsChangeEmitter.event;

  public constructor(private readonly fileService: IFileService) {}

  public get activeEditor(): OpenEditorInput | undefined {
    return this.current;
  }

  public get openEditors(): readonly OpenEditorInput[] {
    return this.editors;
  }

  public async openFile(item: ExplorerItem): Promise<void> {
    if (item.isDirectory) {
      throw new Error('Klasörler düzenleyicide açılamaz.');
    }
    const existing = this.editors.find((e) => e.item.path === item.path);
    if (existing) {
      this.current = existing;
      this.activeEditorChangeEmitter.fire(this.current);
      return;
    }
    const content = await this.fileService.readFileText(item.path);
    const entry: OpenEditorInput = { item, content };
    this.editors.push(entry);
    this.current = entry;
    this.openEditorsChangeEmitter.fire(this.editors);
    this.activeEditorChangeEmitter.fire(this.current);
  }

  public selectEditor(item: ExplorerItem): void {
    const existing = this.editors.find((e) => e.item.path === item.path);
    if (existing && existing !== this.current) {
      this.current = existing;
      this.activeEditorChangeEmitter.fire(this.current);
    }
  }

  public closeEditor(item: ExplorerItem): void {
    const index = this.editors.findIndex((e) => e.item.path === item.path);
    if (index === -1) return;
    const isClosingActive = this.current?.item.path === item.path;
    this.editors.splice(index, 1);
    this.openEditorsChangeEmitter.fire(this.editors);
    if (isClosingActive) {
      this.current = this.editors[Math.min(index, this.editors.length - 1)];
      this.activeEditorChangeEmitter.fire(this.current);
    }
  }

  public async reloadActiveEditor(): Promise<void> {
    if (!this.current) return;
    const content = await this.fileService.readFileText(this.current.item.path);
    this.current = { ...this.current, content };
    const index = this.editors.findIndex(
      (e) => e.item.path === this.current!.item.path,
    );
    if (index !== -1) this.editors[index] = this.current;
    this.openEditorsChangeEmitter.fire(this.editors);
    this.activeEditorChangeEmitter.fire(this.current);
  }

  public async saveActiveEditor(content: string): Promise<void> {
    if (!this.current) return;
    await this.fileService.writeFileText(this.current.item.path, content);
    this.current = { ...this.current, content };
    const index = this.editors.findIndex(
      (e) => e.item.path === this.current!.item.path,
    );
    if (index !== -1) this.editors[index] = this.current;
    this.openEditorsChangeEmitter.fire(this.editors);
    this.activeEditorChangeEmitter.fire(this.current);
  }

  public closeActiveEditor(): void {
    if (!this.current) return;
    this.closeEditor(this.current.item);
  }
}
