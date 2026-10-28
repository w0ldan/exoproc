'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Camera, Plus, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { useService } from '@/platform/instantiation/browser/instantiationService';
import { ISnapshotService } from '@/workbench/services/snapshots/ISnapshotService';
import { IOutputService } from '@/workbench/services/output/IOutputService';
import type { SnapshotMetaDto } from '@/shell/common/channels';
import { useIdeTranslation } from '@/lib/ide-i18n';

export interface SnapshotsView {
  readonly sidebar: ReactNode;
}

/**
 * VM Snapshots tab: a QEMU-style snapshot manager for the whole simulated
 * machine (processes/threads/registers/memory/kernel objects/scheduler,
 * AND the workspace filesystem -- this is the only thing that saves your
 * files at all; nothing auto-persists between reloads). Snapshot creation
 * is always manual, from the form below -- there is no automatic
 * snapshot-on-close.
 *
 * Sidebar-only, unlike `useExplorerView`/`useDebuggerView` -- this view has
 * no `main` content of its own. `IdeWorkbench` leaves the main pane showing
 * whatever Explorer's editor/terminal are already doing while this tab is
 * active, rather than replacing it (see `IdeWorkbench.tsx`'s doc comment
 * for why this used to hijack that whole area when it was its own route).
 */
export function useSnapshotsView(explicitLang?: string): SnapshotsView {
  const service = useService(ISnapshotService);
  const outputService = useService(IOutputService);
  const { lang, t } = useIdeTranslation(explicitLang);
  const dateLocale = lang === 'tr' ? 'tr-TR' : 'en-US';
  const [snapshots, setSnapshots] = useState<readonly SnapshotMetaDto[]>([]);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();

  const refresh = useCallback(() => {
    void service.list().then(setSnapshots);
  }, [service]);

  useEffect(() => {
    refresh();
    return service.onDidChangeList(refresh).dispose;
  }, [service, refresh]);

  const create = async () => {
    const name =
      newName.trim() || `Snapshot ${new Date().toLocaleString(dateLocale)}`;
    setCreating(true);
    setError(undefined);
    try {
      await service.create(name);
      setNewName('');
      outputService.append('output', t.snapshots.created(name), 'success');
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : t.snapshots.createErrorDefault;
      setError(message);
      outputService.append(
        'output',
        t.snapshots.createFailed(name, message),
        'error',
      );
    } finally {
      setCreating(false);
    }
  };

  const restore = async (id: string) => {
    const name = snapshots.find((snapshot) => snapshot.id === id)?.name ?? id;
    setBusyId(id);
    setError(undefined);
    try {
      await service.restore(id);
      outputService.append('output', t.snapshots.restored(name), 'success');
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : t.snapshots.restoreErrorDefault;
      setError(message);
      outputService.append(
        'output',
        t.snapshots.restoreFailed(name, message),
        'error',
      );
    } finally {
      setBusyId(undefined);
    }
  };

  const remove = async (id: string) => {
    const name = snapshots.find((snapshot) => snapshot.id === id)?.name ?? id;
    setBusyId(id);
    setError(undefined);
    try {
      await service.remove(id);
      outputService.append('output', t.snapshots.deleted(name), 'success');
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : t.snapshots.deleteErrorDefault;
      setError(message);
      outputService.append(
        'output',
        t.snapshots.deleteFailed(name, message),
        'error',
      );
    } finally {
      setBusyId(undefined);
    }
  };

  const sidebar = (
    <>
      <div className="flex h-9 shrink-0 items-center px-5 text-[11px] uppercase tracking-wide text-[#bbbbbb]">
        {t.snapshots.title}
      </div>

      <div className="flex shrink-0 flex-col gap-1.5 border-y border-[#2b2b2b] px-3 py-2.5">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !creating) void create();
          }}
          placeholder={t.snapshots.namePlaceholder}
          aria-label={t.snapshots.nameAria}
          className="h-7 w-full rounded-sm border border-[#3c3c3c] bg-[#3c3c3c] px-2 text-xs text-white outline-none placeholder:text-[#8c8c8c]"
        />
        <button
          type="button"
          onClick={() => void create()}
          disabled={creating}
          className="flex h-7 w-full items-center justify-center gap-1.5 rounded-sm bg-[#0e639c] text-xs font-medium text-white hover:bg-[#1177bb] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {creating ? t.snapshots.creating : t.snapshots.takeSnapshot}
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="shrink-0 border-b border-[#5a1d1d] bg-[#3d1f1f] px-3 py-2 text-xs text-[#f4b8b8]"
        >
          {error}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {snapshots.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <div>
              <Camera
                aria-hidden="true"
                className="mx-auto mb-3 size-8 text-[#4f4f4f]"
                strokeWidth={1.2}
              />
              <p className="text-xs leading-relaxed text-[#8b8b8b]">
                {t.snapshots.noSnapshots}
              </p>
            </div>
          </div>
        ) : (
          <ul className="py-1">
            {snapshots.map((snapshot) => (
              <li
                key={snapshot.id}
                className="group border-b border-[#252525] px-3 py-2 hover:bg-[#22252a]"
              >
                <div className="flex items-center gap-1.5">
                  <Camera
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-[#75beff]"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-white">
                    {snapshot.name}
                  </span>
                  {snapshot.warnings.length > 0 ? (
                    <span
                      title={snapshot.warnings.join('\n')}
                      className="shrink-0"
                    >
                      <TriangleAlert
                        aria-hidden="true"
                        className="size-3.5 text-[#cca700]"
                      />
                    </span>
                  ) : null}
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2 pl-5">
                  <span className="min-w-0 truncate text-[10px] text-[#8c8c8c]">
                    {new Date(snapshot.createdAt).toLocaleString(dateLocale)}
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => void restore(snapshot.id)}
                      disabled={busyId === snapshot.id}
                      title={t.snapshots.restore}
                      aria-label={t.snapshots.restoreAria(snapshot.name)}
                      className="grid size-6 place-items-center rounded-sm text-[#a7a7a7] hover:bg-[#3a3d41] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RotateCcw aria-hidden="true" className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(snapshot.id)}
                      disabled={busyId === snapshot.id}
                      title={t.snapshots.delete}
                      aria-label={t.snapshots.deleteAria(snapshot.name)}
                      className="grid size-6 place-items-center rounded-sm text-[#a7a7a7] hover:bg-[#3d1f1f] hover:text-[#f4b8b8] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Trash2 aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );

  return { sidebar };
}
