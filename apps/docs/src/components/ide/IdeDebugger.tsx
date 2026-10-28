'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bug, ChevronRight, Circle, Play, Plus } from 'lucide-react';
import { getExoprocApi } from '@/shell/renderer/bootstrap';
import type {
  ProcessSnapshotDto,
  ThreadSnapshotDto,
} from '@/shell/common/channels';
import type { DebugSessionValue } from '@/components/debugger/DebugSessionScope';
import { localizedPath } from '@/lib/i18n';
import { useIdeTranslation } from '@/lib/ide-i18n';
import {
  BreakpointsPanel,
  CallStackPanel,
  RegistersPanel,
} from '@/components/debugger/panels';

export interface DebuggerView {
  readonly sidebar: ReactNode;
}

function preferredThread(
  process: ProcessSnapshotDto,
  selectedTid?: number,
): ThreadSnapshotDto | undefined {
  const selected =
    selectedTid === undefined
      ? undefined
      : process.threads.find((t) => t.tid === selectedTid);
  return (
    selected ??
    process.threads.find((t) => t.state !== 'terminated') ??
    process.threads[0]
  );
}

/**
 * Debugger's sidebar: the process/thread picker (attaching just changes the
 * `?pid=&tid=` URL, same as before), plus -- once attached -- Registers/
 * Call Stack/Breakpoints, the same panels `Win64Debugger`'s dockview used
 * to show in its own "SIDEBAR" panel. No `main` anymore: the read-only
 * disassembly that used to be `Win64Debugger`'s own dockview panel is now
 * rendered by `useExplorerView` directly into the shared `ide-editor` pane
 * (see its doc comment) -- Debugger no longer needs its own main-area
 * layout at all, it just feeds the same one everything else uses.
 *
 * `Win64Debugger`'s Memory/Trace/Scanner dockview panels have no home in
 * this simplified layout and are not shown anywhere in the app anymore
 * (the component itself is untouched, just unused) -- a deliberate scope
 * cut, not an oversight.
 */
export function useDebuggerView(
  lang: string,
  debugSession?: DebugSessionValue,
): DebuggerView {
  const api = getExoprocApi();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useIdeTranslation(lang);
  const [processes, setProcesses] = useState<readonly ProcessSnapshotDto[]>([]);

  const refresh = useCallback(() => {
    void api.machine
      .listProcesses()
      .then((list) =>
        setProcesses(list.filter((p) => p.image !== 'exoproc-ide.exe')),
      );
  }, [api]);

  useEffect(() => {
    refresh();
    return api.machine.onDidChangeProcesses(refresh);
  }, [api, refresh]);

  // See `IdeWorkbench`'s doc comment on the same pattern: `Number(null)` is
  // `0`, not `NaN`, so presence has to be checked before parsing or a URL
  // with no `pid` at all would be misread as pid 0.
  const pidParam = searchParams.get('pid');
  const tidParam = searchParams.get('tid');
  const selectedPid = pidParam === null ? NaN : Number(pidParam);
  const selectedTid = tidParam === null ? NaN : Number(tidParam);
  const process = Number.isFinite(selectedPid)
    ? processes.find(
        (p) => p.pid === selectedPid && p.image !== 'exoproc-ide.exe',
      )
    : undefined;
  const thread =
    process && Number.isFinite(selectedTid)
      ? process.threads.find((t) => t.tid === selectedTid)
      : undefined;

  const attach = (
    target: ProcessSnapshotDto,
    targetThread?: ThreadSnapshotDto,
  ) => {
    if (target.image === 'exoproc-ide.exe') return;
    const nextThread = targetThread ?? preferredThread(target);
    if (!nextThread) return;
    router.push(
      `${localizedPath(lang, '/ide')}?view=debugger&pid=${target.pid}&tid=${nextThread.tid}`,
    );
  };

  const createDemo = async () => {
    const created = await api.machine.createDemoProcess();
    refresh();
    attach(created);
  };

  const sidebar = (
    <>
      <div className="flex h-9 shrink-0 items-center justify-between px-4 text-[0.68rem] font-medium tracking-wide text-[#bbbbbb] uppercase">
        <span>{t.debugger.title}</span>
        <button
          type="button"
          onClick={() => void createDemo()}
          className="rounded p-1 text-[#a0a0a0] hover:bg-white/10 hover:text-white"
          aria-label={t.debugger.createDemoAria}
          title={t.debugger.createDemoAria}
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div className="shrink-0 border-y border-[#2b2b2b] px-3 py-3">
        <button
          type="button"
          onClick={() => void createDemo()}
          className="flex w-full items-center justify-center gap-2 rounded-sm bg-[#0e639c] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1177bb]"
        >
          <Play className="size-3.5 fill-current" />
          {t.debugger.launchDemo}
        </button>
      </div>

      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[#2b2b2b] px-2 text-[0.68rem] font-semibold tracking-wide text-[#cccccc] uppercase">
        <ChevronRight className="size-3.5 rotate-90" />
        {t.debugger.processes}
        <span className="ml-auto text-[#777]">{processes.length}</span>
      </div>

      <div
        className={`min-h-0 overflow-y-auto py-1 ${debugSession ? 'max-h-[40%] shrink-0' : 'flex-1'}`}
      >
        {processes.length === 0 && (
          <p className="px-4 py-3 text-xs leading-relaxed text-[#8b8b8b]">
            {t.debugger.noProcesses}
          </p>
        )}

        {processes.map((candidate) => {
          const candidateSelected = candidate.pid === process?.pid;
          return (
            <div key={candidate.pid} className="text-xs">
              <button
                type="button"
                onClick={() => attach(candidate)}
                className={`flex h-6 w-full items-center gap-1.5 px-2 text-left hover:bg-[#2a2d2e] ${
                  candidateSelected ? 'bg-[#37373d] text-white' : ''
                }`}
              >
                <ChevronRight className="size-3.5 rotate-90 text-[#858585]" />
                <Bug className="size-3.5 text-[#d16969]" />
                <span className="min-w-0 flex-1 truncate">
                  {candidate.image}
                </span>
                <span className="font-mono text-[0.62rem] text-[#858585]">
                  {candidate.pid}
                </span>
              </button>

              {candidate.threads.map((candidateThread) => (
                <button
                  type="button"
                  key={candidateThread.tid}
                  onClick={() => attach(candidate, candidateThread)}
                  className={`flex h-6 w-full items-center gap-2 pl-9 pr-2 text-left hover:bg-[#2a2d2e] ${
                    candidateSelected && candidateThread.tid === thread?.tid
                      ? 'bg-[#37373d] text-white'
                      : 'text-[#b8b8b8]'
                  }`}
                >
                  <Circle className="size-2 fill-current text-[#75beff]" />
                  <span className="flex-1">
                    {t.debugger.threadLabel(candidateThread.tid)}
                  </span>
                  <span className="text-[0.62rem] text-[#858585]">
                    {candidateThread.state}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {debugSession ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-[#2b2b2b] bg-[#252526]">
          <RegistersPanel session={debugSession.session} />
          <CallStackPanel session={debugSession.session} />
          <BreakpointsPanel session={debugSession.session} />
        </div>
      ) : null}
    </>
  );

  return { sidebar };
}
