'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Monitor,
  Pencil,
  Trash2,
  Briefcase,
  FileText,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { useService } from '@/platform/instantiation/browser/instantiationService';
import { IFileService } from '@/workbench/services/files/IFileService';
import type { DirectoryEntryDto } from '@/shell/common/channels';
import { useIdeTranslation } from '@/lib/ide-i18n';

export interface SimulateFolderPickerProps {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly lang?: string;
}

const SIMULATE_TREE_ROOT = 'C:\\';
const DESKTOP_PATH = 'C:\\Users\\Serkan\\Desktop';
const DOCUMENTS_PATH = 'C:\\Users\\Serkan\\Documents';

function segmentsOf(path: string): readonly string[] {
  return path.replace(/\\+$/, '').split('\\').filter(Boolean);
}

function pathFromSegments(segments: readonly string[]): string {
  if (segments.length === 0) return SIMULATE_TREE_ROOT;
  const [drive, ...rest] = segments;
  return rest.length === 0 ? `${drive}\\` : `${drive}\\${rest.join('\\')}`;
}

function joinPath(directory: string, name: string): string {
  return `${directory.replace(/\\$/, '')}\\${name}`;
}

/**
 * A dedicated (not shared with anything else -- zip import is its own
 * separate toolbar action, see `IdeExplorer.tsx`) file manager over
 * `machine.fileSystem`: browse (starting from the current workspace root,
 * like a shell's `pwd`) or jump via the shortcut sidebar / a typeable
 * address bar, create/rename/delete files and folders while browsing,
 * then pick a directory as the new workspace root (`WorkspaceSource`'s
 * `simulate-path`).
 */
export function SimulateFolderPicker({
  open,
  onCancel,
  lang: explicitLang,
}: SimulateFolderPickerProps) {
  const fileService = useService(IFileService);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const { lang, t } = useIdeTranslation(explicitLang);

  const startPath =
    fileService.getWorkspaceInfo()?.rootPath ?? SIMULATE_TREE_ROOT;

  const [browsePath, setBrowsePath] = useState(startPath);
  const [entries, setEntries] = useState<readonly DirectoryEntryDto[]>([]);
  // See the identical pattern's rationale below (render-time reset, only
  // `.then()`-continuation state writes in the effect) -- required by the
  // React Compiler's `set-state-in-effect` rule.
  const [loadedPath, setLoadedPath] = useState<string>();
  const [loadedToken, setLoadedToken] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const [fetchError, setFetchError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [bindError, setBindError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingName, setRenamingName] = useState<string>();
  const [renameValue, setRenameValue] = useState('');

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setBrowsePath(startPath);
      setEntries([]);
      setLoadedPath(undefined);
      setFetchError(undefined);
      setActionError(undefined);
      setBindError(undefined);
      setCreatingFolder(false);
      setRenamingName(undefined);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fileService.browseSimulateTree(browsePath).then(
      (result) => {
        if (cancelled) return;
        setEntries(result);
        setLoadedPath(browsePath);
        setLoadedToken(refreshToken);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setFetchError(
          cause instanceof Error ? cause.message : t.folderPicker.readError,
        );
        setLoadedPath(browsePath);
        setLoadedToken(refreshToken);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, browsePath, refreshToken, fileService, t]);

  const loading =
    open && (loadedPath !== browsePath || loadedToken !== refreshToken);
  const error = loading ? undefined : (actionError ?? bindError ?? fetchError);

  const refresh = () => setRefreshToken((token) => token + 1);
  const navigate = (path: string) => {
    setCreatingFolder(false);
    setRenamingName(undefined);
    setBrowsePath(path);
  };

  const selectCurrentFolder = async () => {
    setBusy(true);
    setBindError(undefined);
    try {
      await fileService.bindWorkspace({
        type: 'simulate-path',
        path: browsePath,
      });
      onCancel();
    } catch (cause) {
      setBindError(
        cause instanceof Error ? cause.message : t.folderPicker.bindError,
      );
      setBusy(false);
    }
  };

  const createFolder = async () => {
    const name = newFolderName.trim();
    setCreatingFolder(false);
    setNewFolderName('');
    if (!name) return;
    setActionError(undefined);
    try {
      await fileService.createSimulateDirectory(joinPath(browsePath, name));
      refresh();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : t.folderPicker.createError,
      );
    }
  };

  const deleteEntry = async (name: string, isDirectory: boolean) => {
    if (!window.confirm(t.explorer.deleteConfirm(name, isDirectory))) return;
    setActionError(undefined);
    try {
      await fileService.deleteSimulateEntry(joinPath(browsePath, name));
      refresh();
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : lang === 'tr'
            ? 'Silinemedi.'
            : 'Failed to delete.',
      );
    }
  };

  const commitRename = async (oldName: string) => {
    const newName = renameValue.trim();
    setRenamingName(undefined);
    if (!newName || newName === oldName) return;
    setActionError(undefined);
    try {
      await fileService.renameSimulateEntry(
        joinPath(browsePath, oldName),
        joinPath(browsePath, newName),
      );
      refresh();
    } catch (cause) {
      setActionError(
        cause instanceof Error ? cause.message : t.folderPicker.renameError,
      );
    }
  };

  const segments = segmentsOf(browsePath);
  const shortcuts = [
    {
      label: t.folderPicker.workspace,
      path: fileService.getWorkspaceInfo()?.rootPath,
      icon: Briefcase,
    },
    { label: t.folderPicker.desktop, path: DESKTOP_PATH, icon: Monitor },
    {
      label: lang === 'tr' ? 'Belgeler' : 'Documents',
      path: DOCUMENTS_PATH,
      icon: FileText,
    },
    {
      label: lang === 'tr' ? 'Bu Bilgisayar (C:)' : 'This PC (C:)',
      path: SIMULATE_TREE_ROOT,
      icon: HardDrive,
    },
  ].filter(
    (
      shortcut,
    ): shortcut is { label: string; path: string; icon: typeof Briefcase } =>
      !!shortcut.path,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex w-[min(760px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-sm border border-[#454545] bg-[#1e1e1e] p-0 text-[#cccccc] shadow-2xl ring-0 sm:max-w-none"
      >
        <header className="flex h-10 shrink-0 items-center border-b border-[#3c3c3c] bg-[#252526] px-3">
          <FolderOpen
            aria-hidden="true"
            className="mr-2 size-4 text-[#75beff]"
          />
          <DialogTitle className="truncate text-[13px] font-normal text-[#f0f0f0]">
            {t.folderPicker.title}
          </DialogTitle>
          <button
            type="button"
            aria-label={t.folderPicker.cancel}
            title={t.folderPicker.cancel}
            onClick={onCancel}
            className="ml-auto grid size-7 place-items-center rounded-sm text-[#c5c5c5] outline-none hover:bg-[#3a3d41] hover:text-white focus-visible:outline-1 focus-visible:outline-[#007fd4]"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>

        <DialogDescription className="sr-only">
          {t.folderPicker.description}
        </DialogDescription>

        {/* Address bar -- typeable, always shows `browsePath`; navigating any
            other way (sidebar/breadcrumb/list) remounts it (`key={browsePath}`)
            so it never fights the controlled/uncontrolled split with an effect. */}
        <div className="border-b border-[#3c3c3c] bg-[#252526] px-3 py-2">
          <input
            key={browsePath}
            defaultValue={browsePath}
            onKeyDown={(event) => {
              if (event.key === 'Enter')
                navigate(
                  event.currentTarget.value.trim() || SIMULATE_TREE_ROOT,
                );
            }}
            aria-label="Yol"
            spellCheck={false}
            className="h-7 w-full rounded-sm border border-[#3c3c3c] bg-[#3c3c3c] px-2 font-mono text-xs text-white outline-none focus:border-[#007fd4]"
          />
        </div>

        <div className="flex items-center gap-1 overflow-x-auto border-b border-[#3c3c3c] bg-[#1e1e1e] px-3 py-1.5 text-xs text-[#cccccc]">
          {segments.map((segment, index) => (
            <span key={index} className="flex shrink-0 items-center gap-1">
              {index > 0 ? (
                <ChevronRight
                  aria-hidden="true"
                  className="size-3 text-[#6b6b6b]"
                />
              ) : null}
              <button
                type="button"
                onClick={() =>
                  navigate(pathFromSegments(segments.slice(0, index + 1)))
                }
                className="rounded-sm px-1 hover:bg-[#3a3d41] hover:text-white"
              >
                {segment}
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => setCreatingFolder(true)}
            title={t.folderPicker.newFolder}
            aria-label={t.folderPicker.newFolderAria}
            className="ml-auto grid size-6 shrink-0 place-items-center rounded-sm text-[#a7a7a7] hover:bg-[#2a2d2e] hover:text-white"
          >
            <FolderPlus aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0">
          <nav className="flex w-40 shrink-0 flex-col gap-0.5 border-r border-[#3c3c3c] bg-[#181818] p-2">
            {shortcuts.map(({ label, path, icon: Icon }) => (
              <button
                key={label}
                type="button"
                onClick={() => navigate(path)}
                className={`flex h-7 items-center gap-2 rounded-sm px-2 text-left text-xs hover:bg-[#2a2d2e] ${
                  browsePath === path
                    ? 'bg-[#37373d] text-white'
                    : 'text-[#cccccc]'
                }`}
              >
                <Icon
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-[#75beff]"
                />
                <span className="min-w-0 flex-1 truncate">{label}</span>
              </button>
            ))}
          </nav>

          <div className="h-80 min-w-0 flex-1 overflow-y-auto bg-[#181818]">
            {creatingFolder ? (
              <div className="flex h-7 items-center gap-2 border-b border-[#252525] px-3">
                <Folder
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-[#c09553]"
                />
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void createFolder();
                    if (event.key === 'Escape') {
                      setCreatingFolder(false);
                      setNewFolderName('');
                    }
                  }}
                  onBlur={() => void createFolder()}
                  placeholder={t.folderPicker.folderNamePlaceholder}
                  aria-label={t.folderPicker.folderNameAria}
                  className="h-6 min-w-0 flex-1 rounded-sm border border-[#007fd4] bg-[#3c3c3c] px-1.5 text-xs text-white outline-none"
                />
              </div>
            ) : null}

            {loading ? (
              <p className="px-3 py-2 text-xs text-[#8b8b8b]">
                {t.folderPicker.loading}
              </p>
            ) : entries.length === 0 && !creatingFolder ? (
              <p className="px-3 py-2 text-xs text-[#8b8b8b]">
                {t.folderPicker.emptyFolder}
              </p>
            ) : (
              <ul>
                {entries.map(([name, kind]) => {
                  const isDirectory = kind === 'directory';
                  const isRenaming = renamingName === name;
                  return (
                    <li
                      key={name}
                      className="group flex h-7 items-center gap-2 border-b border-[#252525] pr-1 pl-3 hover:bg-[#2a2d2e]"
                    >
                      {isDirectory ? (
                        <Folder
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-[#c09553]"
                        />
                      ) : (
                        <File
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-[#8b8b8b]"
                        />
                      )}
                      {isRenaming ? (
                        <input
                          ref={renameInputRef}
                          autoFocus
                          value={renameValue}
                          onChange={(event) =>
                            setRenameValue(event.target.value)
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') void commitRename(name);
                            if (event.key === 'Escape')
                              setRenamingName(undefined);
                          }}
                          onBlur={() => void commitRename(name)}
                          aria-label={t.folderPicker.renameInputAria(name)}
                          className="h-6 min-w-0 flex-1 rounded-sm border border-[#007fd4] bg-[#3c3c3c] px-1.5 text-xs text-white outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={!isDirectory}
                          onClick={() => navigate(joinPath(browsePath, name))}
                          className="min-w-0 flex-1 truncate text-left text-xs text-[#cccccc] disabled:text-[#6b6b6b]"
                        >
                          {name}
                        </button>
                      )}
                      {!isRenaming ? (
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingName(name);
                              setRenameValue(name);
                            }}
                            title={t.folderPicker.rename}
                            aria-label={t.folderPicker.renameAria(name)}
                            className="grid size-6 place-items-center rounded-sm text-[#a7a7a7] hover:bg-[#3a3d41] hover:text-white"
                          >
                            <Pencil aria-hidden="true" className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteEntry(name, isDirectory)}
                            title={t.snapshots.delete}
                            aria-label={t.folderPicker.deleteAria(name)}
                            className="grid size-6 place-items-center rounded-sm text-[#a7a7a7] hover:bg-[#3d1f1f] hover:text-[#f4b8b8]"
                          >
                            <Trash2 aria-hidden="true" className="size-3.5" />
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="border-t border-[#5a1d1d] bg-[#3d1f1f] px-3 py-2 text-xs text-[#f4b8b8]"
          >
            {error}
          </div>
        ) : null}

        <div className="border-t border-[#3c3c3c] p-3">
          <button
            type="button"
            onClick={() => void selectCurrentFolder()}
            disabled={busy || loading}
            className="flex h-8 w-full items-center justify-center gap-2 rounded-sm bg-[#0e639c] text-xs font-medium text-white hover:bg-[#1177bb] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy
              ? t.folderPicker.connecting
              : t.folderPicker.selectFolder(browsePath)}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SimulateFolderPicker;
