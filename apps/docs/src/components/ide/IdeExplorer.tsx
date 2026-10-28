'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  FilePlus,
  Files,
  FileText,
  FolderOpen,
  FolderPlus,
  LogOut,
  Play,
  RefreshCw,
  Save,
  UploadCloud,
  X,
} from 'lucide-react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { useService } from '@/platform/instantiation/browser/instantiationService';
import {
  IExplorerService,
  type ExplorerItem,
} from '@/workbench/services/explorer/IExplorerService';
import { IEditorService } from '@/workbench/services/editor/IEditorService';
import { IFileService } from '@/workbench/services/files/IFileService';
import { IOutputService } from '@/workbench/services/output/IOutputService';
import type { DebugSessionValue } from '@/components/debugger/DebugSessionScope';
import { DisassemblyView } from '@/components/debugger/DisassemblyView';
import { DebugToolbar } from '@/components/debugger/Toolbar';
import { localizedPath } from '@/lib/i18n';
import { useIdeTranslation } from '@/lib/ide-i18n';
import { IdeBottomPanel } from './IdeBottomPanel';
import { type IdeTerminalHandle } from './IdeTerminalPanel';
import { FileTree, SimulateFolderPicker } from './explorer';

export interface ExplorerView {
  readonly sidebar: ReactNode;
  readonly main: ReactNode;
}

const SEPARATOR_Y_CLASS =
  'relative h-1 shrink-0 bg-[#2b2b2b] outline-none transition-colors hover:bg-[#007acc] focus-visible:bg-[#007acc]';

/**
 * Explorer's sidebar (file tree) and main (editor + terminal) content, as a
 * hook rather than a standalone page component -- `IdeWorkbench` mounts one
 * shared `<Panel id="ide-sidebar">`/`<Panel id="ide-main">` pair for the
 * whole `/ide` route and swaps in whichever view's content is active, so
 * the panels themselves (and their resize state) never remount across a
 * tab switch. See `IdeWorkbench.tsx` for why.
 */
export function useExplorerView(
  langParam?: string,
  debugSession?: DebugSessionValue,
): ExplorerView {
  const router = useRouter();
  const service = useService(IExplorerService);
  const editorService = useService(IEditorService);
  const fileService = useService(IFileService);
  const outputService = useService(IOutputService);
  const { lang, t } = useIdeTranslation(langParam);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [openingId, setOpeningId] = useState<string>();
  const [zipImporting, setZipImporting] = useState(false);
  const openRequest = useRef(0);
  const terminalRef = useRef<IdeTerminalHandle>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  // No bind-on-mount here anymore (F9): the workspace root is already set
  // by the main process itself during its own boot sequence
  // (`initializeWorkspace()`, kicked off from `exoproc-ide.exe`'s own
  // callback), before the renderer ever gets a chance to ask. The
  // `workspaceReady` gate below already handles "not bound yet" by
  // waiting for `onDidChangeRoot` -- nothing renderer-side needs to
  // proactively bind anything for the default case.

  // Gates the tree so it never resolves children against the placeholder
  // root `IExplorerService` starts with before any workspace is bound --
  // that resolve is guaranteed to fail (nothing to serve yet), a wasted
  // round trip that also briefly showed a stale "Klasör okunamadı" once
  // the real root replaced the placeholder.
  const workspaceReady = useSyncExternalStore(
    (onStoreChange) => fileService.onDidChangeWorkspace(onStoreChange).dispose,
    () => fileService.getWorkspaceInfo() !== undefined,
    () => false,
  );

  const document = useSyncExternalStore(
    (onStoreChange) =>
      editorService.onDidActiveEditorChange(onStoreChange).dispose,
    () => editorService.activeEditor,
    () => undefined,
  );

  const openEditors = useSyncExternalStore(
    (onStoreChange) =>
      editorService.onDidOpenEditorsChange(onStoreChange).dispose,
    () => editorService.openEditors,
    () => [],
  );

  // Locally edited drafts per document ID (path), so multi-tab editing preserves
  // unsaved edits across tab switches.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const isDirty =
    document !== undefined &&
    drafts[document.item.id] !== undefined &&
    drafts[document.item.id] !== document.content;

  // Forces a re-render whenever the explorer tree changes (workspace
  // rebound, filesystem refreshed) -- IExplorerService has no queryable
  // "current value" of its own (just a change event), so this is a plain
  // revision counter rather than useSyncExternalStore. FileTree
  // subscribes to the same event independently for its own subtree.
  const [, setServiceRevision] = useState(0);
  useEffect(() => {
    const subscription = service.onDidChange(() =>
      setServiceRevision((value) => value + 1),
    );
    return () => subscription.dispose();
  }, [service]);

  const openFile = useCallback(
    async (item: ExplorerItem) => {
      if (item.id === document?.item.id) return;
      const request = ++openRequest.current;
      setOpeningId(item.id);
      setError(undefined);

      try {
        await editorService.openFile(item);
      } catch (cause) {
        if (request !== openRequest.current) return;
        setError(
          cause instanceof Error
            ? cause.message
            : lang === 'tr'
              ? 'Dosya açılırken bilinmeyen bir hata oluştu.'
              : 'An unknown error occurred while opening file.',
        );
      } finally {
        if (request === openRequest.current) setOpeningId(undefined);
      }
    },
    [editorService, document, lang],
  );

  const closeEditor = useCallback(
    (item: ExplorerItem) => {
      const tabDraft = drafts[item.id];
      const targetEditor = openEditors.find((e) => e.item.id === item.id);
      const isTabDirty =
        tabDraft !== undefined &&
        targetEditor !== undefined &&
        tabDraft !== targetEditor.content;

      if (isTabDirty) {
        const proceed = window.confirm(
          t.explorer.unsavedChangesCloseConfirm(item.name),
        );
        if (!proceed) return;
      }

      setDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      editorService.closeEditor(item);
    },
    [drafts, openEditors, editorService, t],
  );

  const saveDocument = useCallback(async () => {
    if (!document) return;
    const currentDraft = drafts[document.item.id];
    if (currentDraft === undefined || currentDraft === document.content) {
      return;
    }
    setError(undefined);
    try {
      await editorService.saveActiveEditor(currentDraft);
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[document.item.id];
        return next;
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : lang === 'tr'
            ? 'Dosya kaydedilemedi.'
            : 'Failed to save file.',
      );
    }
  }, [document, drafts, editorService, lang]);

  const handleCreateFile = useCallback(async () => {
    const name = window.prompt(t.explorer.promptNewFileName);
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    try {
      await service.createFile(service.root, trimmed);
      service.refresh();
      const path = `${service.root.path.replace(/\/$/, '')}/${trimmed}`;
      await editorService.openFile({
        id: path,
        name: trimmed,
        path,
        isDirectory: false,
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t.explorer.fileCreateError,
      );
    }
  }, [service, editorService, t]);

  const handleCreateFolder = useCallback(async () => {
    const name = window.prompt(t.explorer.promptNewFolderName);
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    try {
      await service.createFolder(service.root, trimmed);
      service.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t.explorer.folderCreateError,
      );
    }
  }, [service, t]);

  // Standard Ctrl/Cmd+S, wired at the window level (not just while the
  // editor itself has focus) since this is the only editable surface in
  // the workbench right now.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveDocument();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveDocument]);

  const importZipFile = useCallback(
    async (file: File) => {
      setZipImporting(true);
      setError(undefined);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await fileService.bindWorkspace({
          type: 'zip',
          name: file.name,
          bytes,
        });
        outputService.append(
          'output',
          t.explorer.zipImported(file.name),
          'success',
        );
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : t.explorer.zipImportError;
        setError(message);
        outputService.append(
          'output',
          t.explorer.zipImportFailed(file.name, message),
          'error',
        );
      } finally {
        setZipImporting(false);
      }
    },
    [fileService, outputService, t],
  );

  const runDocument = useCallback(() => {
    if (!document || !isRunnableJavaScript(document.item.name)) return;
    terminalRef.current?.runCommand(`node "${document.item.path}"`);
  }, [document]);

  // Keeps the open editor's content in sync with the underlying filesystem
  // (e.g. re-running the same script rewrites the file the explorer shows).
  useEffect(() => {
    const subscription = service.onDidChange(() => {
      void editorService.reloadActiveEditor();
    });
    return () => subscription.dispose();
  }, [service, editorService]);

  const sidebar = (
    <>
      <div className="flex h-9 shrink-0 items-center px-5 text-[11px] uppercase tracking-wide text-[#bbbbbb]">
        {t.explorer.title}
      </div>
      <div className="flex h-7 shrink-0 items-center border-y border-[#242424] px-2">
        <span
          className="min-w-0 truncate text-[11px] font-semibold uppercase text-[#cccccc]"
          title={service.root.path}
        >
          {service.root.name}
        </span>
        <div className="ml-auto flex shrink-0 items-center">
          <ExplorerAction
            label={t.explorer.newFile}
            onClick={() => void handleCreateFile()}
          >
            <FilePlus aria-hidden="true" className="size-3.5" />
          </ExplorerAction>

          <ExplorerAction
            label={t.explorer.newFolder}
            onClick={() => void handleCreateFolder()}
          >
            <FolderPlus aria-hidden="true" className="size-3.5" />
          </ExplorerAction>

          <ExplorerAction
            label={t.explorer.openFolder}
            onClick={() => setFolderPickerOpen(true)}
          >
            <FolderOpen aria-hidden="true" className="size-3.5" />
          </ExplorerAction>

          <ExplorerAction
            label={
              zipImporting ? t.explorer.importingZip : t.explorer.importZip
            }
            onClick={() => zipInputRef.current?.click()}
            disabled={zipImporting}
          >
            <UploadCloud aria-hidden="true" className="size-3.5" />
          </ExplorerAction>

          <ExplorerAction
            label={t.explorer.refresh}
            onClick={() => service.refresh()}
          >
            <RefreshCw aria-hidden="true" className="size-3.5" />
          </ExplorerAction>

          <input
            ref={zipInputRef}
            type="file"
            accept=".zip"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importZipFile(file);
            }}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {workspaceReady ? (
          <FileTree
            service={service}
            selectedId={document?.item.id}
            onOpenFile={(item) => void openFile(item)}
            lang={lang}
          />
        ) : (
          <p className="px-5 py-3 text-xs leading-relaxed text-[#8b8b8b]">
            {t.explorer.openingWorkspace}
          </p>
        )}
      </div>
      <SimulateFolderPicker
        open={folderPickerOpen}
        onCancel={() => setFolderPickerOpen(false)}
        lang={lang}
      />
    </>
  );

  const main = (
    <Group orientation="vertical" className="flex min-h-0 flex-1 flex-col">
      <Panel id="ide-editor" defaultSize="70" minSize="15">
        <div className="flex h-full min-h-0 flex-col">
          {debugSession ? (
            <>
              <div className="flex shrink-0 items-center justify-between border-b border-[#2d2d2d] bg-[#252526] pr-2">
                <div className="min-w-0 flex-1">
                  <DebugToolbar
                    session={debugSession.session}
                    tid={debugSession.tid}
                    selectedAddress={debugSession.selectedAddress}
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    router.push(`${localizedPath(lang, '/ide')}?view=explorer`)
                  }
                  className="flex items-center gap-1.5 rounded border border-[#3c3c3c] bg-[#1e1e1e] px-2.5 py-1 text-xs text-[#b8b8b8] hover:bg-[#2a2d2e] hover:text-white"
                  title={t.explorer.backToCodeTooltip}
                >
                  <LogOut aria-hidden="true" className="size-3.5" />
                  {t.explorer.backToCode}
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <DisassemblyView
                  session={debugSession.session}
                  selectedAddress={debugSession.selectedAddress}
                  onSelectAddress={debugSession.onSelectAddress}
                />
              </div>
            </>
          ) : document ? (
            <>
              <div className="flex h-9 shrink-0 border-b border-[#252525] bg-[#181818] overflow-x-auto no-scrollbar">
                <div className="flex min-w-0 flex-1 items-stretch">
                  {openEditors.map((editor) => {
                    const isActive = editor.item.path === document.item.path;
                    const tabDraft = drafts[editor.item.id];
                    const isTabDirty =
                      tabDraft !== undefined && tabDraft !== editor.content;
                    return (
                      <div
                        key={editor.item.path}
                        onClick={() => editorService.selectEditor(editor.item)}
                        className={`group flex min-w-0 max-w-60 cursor-pointer items-center gap-2 border-r border-[#252525] px-3 text-xs transition-colors ${
                          isActive
                            ? 'border-t-2 border-t-[#007acc] bg-[#1e1e1e] text-white'
                            : 'bg-[#181818] text-[#969696] hover:bg-[#1f1f1f] hover:text-[#cccccc]'
                        }`}
                      >
                        <FileText
                          aria-hidden="true"
                          className={`size-3.5 shrink-0 ${isActive ? 'text-[#75beff]' : 'text-[#858585]'}`}
                        />
                        <span className="truncate" title={editor.item.path}>
                          {editor.item.name}
                        </span>
                        {isTabDirty ? (
                          <span
                            aria-label={t.explorer.unsavedChanges}
                            title={t.explorer.unsavedChanges}
                            className="size-2 shrink-0 rounded-full bg-[#cccccc]"
                          />
                        ) : null}
                        <button
                          type="button"
                          aria-label={`${editor.item.name} (${t.folderPicker.cancel})`}
                          title={t.folderPicker.cancel}
                          onClick={(e) => {
                            e.stopPropagation();
                            closeEditor(editor.item);
                          }}
                          className="ml-auto rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-[#333333] hover:text-white"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => void saveDocument()}
                    disabled={!isDirty}
                    className="flex items-center gap-1.5 px-3 text-xs text-[#b8b8b8] hover:bg-[#2a2d2e] hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    title={`${t.explorer.save} (Ctrl+S)`}
                  >
                    <Save aria-hidden="true" className="size-3.5" />
                    {t.explorer.save}
                  </button>
                  {isRunnableJavaScript(document.item.name) ? (
                    <button
                      type="button"
                      onClick={runDocument}
                      className="flex items-center gap-1.5 px-3 text-xs text-[#b8b8b8] hover:bg-[#2a2d2e] hover:text-white"
                      title={t.explorer.runTooltip}
                    >
                      <Play
                        aria-hidden="true"
                        className="size-3.5 fill-current text-[#89d185]"
                      />
                      {t.explorer.run}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="flex h-7 shrink-0 items-center border-b border-[#252525] px-4 text-[11px] text-[#8c8c8c]">
                <span className="truncate" title={document.item.path}>
                  {service.root.name.toLocaleUpperCase(
                    lang === 'tr' ? 'tr' : 'en',
                  )}{' '}
                  › {rootRelativePath(document.item, service.root)}
                </span>
                {openingId ? (
                  <span className="ml-auto pl-3">{t.explorer.opening}</span>
                ) : null}
              </div>
              {error ? (
                <div
                  role="alert"
                  className="border-b border-[#5a1d1d] bg-[#3d1f1f] px-4 py-2 text-xs text-[#f4b8b8]"
                >
                  {error}
                </div>
              ) : null}
              <div className="min-h-0 flex-1 [&>div]:m-0! [&>div]:h-full [&>div]:rounded-none! [&>div]:border-0!">
                <CodeEditor
                  height="100%"
                  path={document.item.path}
                  language={languageForFile(document.item.name)}
                  value={drafts[document.item.id] ?? document.content}
                  onChange={(value) => {
                    const text = value ?? '';
                    setDrafts((prev) => ({
                      ...prev,
                      [document.item.id]: text,
                    }));
                  }}
                  options={{
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    wordWrap: 'on',
                  }}
                />
              </div>
            </>
          ) : (
            <div className="relative flex flex-1 items-center justify-center px-8">
              {error ? (
                <div
                  role="alert"
                  className="absolute inset-x-6 top-6 border border-[#5a1d1d] bg-[#3d1f1f] px-4 py-2 text-xs text-[#f4b8b8]"
                >
                  {error}
                </div>
              ) : null}
              <div className="max-w-sm text-center text-[#8c8c8c]">
                <Files
                  aria-hidden="true"
                  className="mx-auto mb-4 size-14 stroke-1 text-[#555555]"
                />
                <h1 className="mb-2 text-lg font-medium text-[#cccccc]">
                  Exoproc IDE
                </h1>
                <p className="text-sm leading-6">{t.explorer.emptyState}</p>
              </div>
            </div>
          )}
        </div>
      </Panel>

      <Separator className={SEPARATOR_Y_CLASS} />

      <Panel id="ide-terminal" defaultSize="30" minSize="10">
        <IdeBottomPanel
          terminalRef={terminalRef}
          debugSession={debugSession}
          lang={lang}
        />
      </Panel>
    </Group>
  );

  return { sidebar, main };
}

function ExplorerAction({
  label,
  onClick,
  disabled,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-[#a7a7a7] hover:bg-[#2a2d2e] hover:text-white focus-visible:outline-1 focus-visible:outline-[#75beff] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function rootRelativePath(item: ExplorerItem, root: ExplorerItem): string {
  const rootPath = root.path.replace(/\/$/, '');
  const relative = item.path.startsWith(`${rootPath}/`)
    ? item.path.slice(rootPath.length + 1)
    : item.path;
  return relative.split('/').filter(Boolean).join(' › ') || item.name;
}

function isRunnableJavaScript(name: string): boolean {
  return /\.(?:cjs|js|mjs|ts|mts|tsx)$/i.test(name);
}

function languageForFile(name: string): string {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  const languages: Record<string, string> = {
    c: 'c',
    cpp: 'cpp',
    css: 'css',
    h: 'c',
    hpp: 'cpp',
    html: 'html',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    mdx: 'markdown',
    ps1: 'powershell',
    py: 'python',
    rs: 'rust',
    sh: 'shell',
    ts: 'typescript',
    tsx: 'typescript',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return languages[extension] ?? 'plaintext';
}
