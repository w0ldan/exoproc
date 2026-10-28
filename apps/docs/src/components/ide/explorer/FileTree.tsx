'use client';

import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import {
  ChevronRight,
  File,
  FileCode2,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  Trash2,
} from 'lucide-react';
import type {
  ExplorerItem,
  IExplorerService,
} from '@/workbench/services/explorer/IExplorerService';
import { useIdeTranslation } from '@/lib/ide-i18n';

export interface FileTreeProps {
  readonly service: IExplorerService;
  readonly selectedId?: string;
  readonly onOpenFile: (file: ExplorerItem) => void;
  readonly lang?: string;
}

export function FileTree({
  service,
  selectedId,
  onOpenFile,
  lang: explicitLang,
}: FileTreeProps) {
  const { lang, t } = useIdeTranslation(explicitLang);
  const [revision, setRevision] = useState(0);
  const [creatingRootFile, setCreatingRootFile] = useState(false);

  useEffect(() => {
    const subscription = service.onDidChange(() =>
      setRevision((value) => value + 1),
    );
    return () => subscription.dispose();
  }, [service]);

  const createRootFile = async (name: string) => {
    setCreatingRootFile(false);
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      await service.createFile(service.root, trimmed);
    } catch (cause) {
      window.alert(
        cause instanceof Error ? cause.message : t.explorer.fileCreateError,
      );
    }
  };

  return (
    <nav
      aria-label={t.explorer.workspaceFilesAria}
      className="min-h-full py-1 text-[13px]"
      // VS Code-style: double-clicking the blank canvas below the tree
      // (not an actual row -- hence the target/currentTarget check) starts
      // a new file at the workspace root.
      onDoubleClick={(event) => {
        if (event.target !== event.currentTarget) return;
        setCreatingRootFile(true);
      }}
    >
      <div role="tree">
        <FileTreeItem
          key={service.root.id}
          item={service.root}
          service={service}
          depth={0}
          revision={revision}
          selectedId={selectedId}
          onOpenFile={onOpenFile}
          lang={lang}
          initiallyExpanded
          trailingNewFile={
            creatingRootFile ? (
              <NewFileRow
                depth={1}
                lang={lang}
                onCommit={(name) => void createRootFile(name)}
                onCancel={() => setCreatingRootFile(false)}
              />
            ) : null
          }
        />
      </div>
    </nav>
  );
}

interface FileTreeItemProps extends FileTreeProps {
  readonly item: ExplorerItem;
  readonly depth: number;
  readonly revision: number;
  readonly initiallyExpanded?: boolean;
  /** Extra row rendered after this item's own children, e.g. the inline "new file" input -- only ever passed for the root item, see `FileTree`. */
  readonly trailingNewFile?: ReactNode;
}

function FileTreeItem({
  item,
  service,
  depth,
  revision,
  selectedId,
  onOpenFile,
  lang: explicitLang,
  initiallyExpanded = false,
  trailingNewFile,
}: FileTreeItemProps) {
  const { lang, t } = useIdeTranslation(explicitLang);
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [children, setChildren] = useState<readonly ExplorerItem[]>();
  const [loading, setLoading] = useState(initiallyExpanded);
  const [error, setError] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const deleteItem = async (event: MouseEvent) => {
    event.stopPropagation();
    if (
      !window.confirm(t.explorer.deleteConfirm(item.name, item.isDirectory))
    ) {
      return;
    }
    setDeleting(true);
    try {
      await service.delete(item);
      // No `setDeleting(false)` on success: `onDidChangeFile` invalidates
      // the parent's cache and this item unmounts as part of that refresh.
    } catch (cause) {
      setDeleting(false);
      window.alert(
        cause instanceof Error
          ? cause.message
          : lang === 'tr'
            ? 'Silinemedi.'
            : 'Failed to delete.',
      );
    }
  };

  useEffect(() => {
    if (!item.isDirectory || !expanded) return;

    let cancelled = false;

    void service.resolveChildren(item).then(
      (resolvedChildren) => {
        if (cancelled) return;
        setChildren(resolvedChildren);
        // Clears a stale error from an earlier attempt against a
        // different `item` reference with the same id -- e.g. the root
        // item is replaced wholesale when a workspace finishes binding
        // (see `ExplorerService`), so a placeholder root's failed
        // "no workspace bound yet" resolve must not keep showing an
        // error message forever once the real root resolves fine.
        setError(false);
        setLoading(false);
      },
      () => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [expanded, item, revision, service]);

  const selected = selectedId === item.id;

  return (
    <div role="none">
      <div
        role="none"
        className={`group flex h-5.5 items-center overflow-hidden pr-1 hover:bg-[#2a2d2e] ${
          selected ? 'bg-[#37373d]' : ''
        } ${deleting ? 'opacity-50' : ''}`}
      >
        <button
          type="button"
          role="treeitem"
          aria-expanded={item.isDirectory ? expanded : undefined}
          aria-selected={selected}
          disabled={deleting}
          className={`flex h-full min-w-0 flex-1 items-center gap-1 overflow-hidden text-left outline-none focus-visible:bg-[#37373d] ${
            selected ? 'text-white' : 'text-[#cccccc]'
          }`}
          style={{ paddingLeft: `${4 + depth * 12}px` }}
          onClick={() => {
            if (item.isDirectory) {
              const nextExpanded = !expanded;
              setExpanded(nextExpanded);
              if (nextExpanded) {
                setLoading(true);
                setError(false);
              }
            } else {
              onOpenFile(item);
            }
          }}
          title={item.path}
        >
          {item.isDirectory ? (
            <ChevronRight
              aria-hidden="true"
              className={`size-3.5 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
          ) : (
            <span aria-hidden="true" className="w-3.5 shrink-0" />
          )}
          <TreeIcon item={item} expanded={expanded} />
          <span className="truncate">{item.name}</span>
        </button>
        {depth > 0 ? (
          <button
            type="button"
            onClick={(event) => void deleteItem(event)}
            disabled={deleting}
            title={t.snapshots.delete}
            aria-label={t.explorer.deleteItemAria(item.name)}
            className="grid size-5 shrink-0 place-items-center rounded-sm text-[#a7a7a7] opacity-0 group-hover:opacity-100 hover:bg-[#3d1f1f] hover:text-[#f4b8b8] disabled:opacity-100"
          >
            <Trash2 aria-hidden="true" className="size-3" />
          </button>
        ) : null}
      </div>

      {item.isDirectory && expanded ? (
        <div role="group">
          {loading && !children ? (
            <TreeMessage depth={depth + 1}>{t.explorer.loading}</TreeMessage>
          ) : null}
          {error ? (
            <TreeMessage depth={depth + 1}>
              {t.explorer.folderUnreadable}
            </TreeMessage>
          ) : null}
          {!loading && !error && children?.length === 0 ? (
            <TreeMessage depth={depth + 1}>
              {t.explorer.folderEmpty}
            </TreeMessage>
          ) : null}
          {children?.map((child) => (
            <FileTreeItem
              key={child.id}
              item={child}
              service={service}
              depth={depth + 1}
              revision={revision}
              selectedId={selectedId}
              onOpenFile={onOpenFile}
              lang={lang}
            />
          ))}
          {trailingNewFile}
        </div>
      ) : null}
    </div>
  );
}

function TreeMessage({
  depth,
  children,
}: {
  readonly depth: number;
  readonly children: string;
}) {
  return (
    <div
      className="h-5.5 truncate pr-2 text-[12px] italic leading-5.5 text-[#858585]"
      style={{ paddingLeft: `${20 + depth * 12}px` }}
    >
      {children}
    </div>
  );
}

function NewFileRow({
  depth,
  lang: explicitLang,
  onCommit,
  onCancel,
}: {
  readonly depth: number;
  readonly lang?: string;
  readonly onCommit: (name: string) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useIdeTranslation(explicitLang);
  const [value, setValue] = useState('');
  return (
    <div
      role="none"
      className="flex h-5.5 items-center gap-1 overflow-hidden pr-1"
      style={{ paddingLeft: `${4 + depth * 12}px` }}
    >
      <span aria-hidden="true" className="w-3.5 shrink-0" />
      <File aria-hidden="true" className="size-3.5 shrink-0 text-[#c5c5c5]" />
      <input
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit(value);
          if (event.key === 'Escape') onCancel();
        }}
        onBlur={() => onCommit(value)}
        placeholder={t.explorer.fileNamePlaceholder}
        aria-label={t.explorer.newFileNameAria}
        className="h-4.5 min-w-0 flex-1 rounded-sm border border-[#007fd4] bg-[#3c3c3c] px-1 text-xs text-white outline-none"
      />
    </div>
  );
}

function TreeIcon({
  item,
  expanded,
}: {
  readonly item: ExplorerItem;
  readonly expanded: boolean;
}) {
  if (item.isDirectory) {
    const FolderIcon = expanded ? FolderOpen : Folder;
    return (
      <FolderIcon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-[#dcb67a]"
      />
    );
  }

  const extension = item.name
    .slice(item.name.lastIndexOf('.') + 1)
    .toLowerCase();
  if (extension === 'json') {
    return (
      <FileJson
        aria-hidden="true"
        className="size-3.5 shrink-0 text-[#e5c07b]"
      />
    );
  }
  if (
    ['ts', 'tsx', 'js', 'jsx', 'c', 'cpp', 'h', 'hpp', 'rs'].includes(extension)
  ) {
    return (
      <FileCode2
        aria-hidden="true"
        className="size-3.5 shrink-0 text-[#75beff]"
      />
    );
  }
  if (['md', 'mdx', 'txt'].includes(extension)) {
    return (
      <FileText
        aria-hidden="true"
        className="size-3.5 shrink-0 text-[#a9dc76]"
      />
    );
  }
  return (
    <File aria-hidden="true" className="size-3.5 shrink-0 text-[#c5c5c5]" />
  );
}
