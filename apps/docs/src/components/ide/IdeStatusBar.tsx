'use client';

import { useSyncExternalStore } from 'react';
import { useService } from '@/platform/instantiation/browser/instantiationService';
import { IStatusbarService } from '@/workbench/services/statusbar/IStatusbarService';
import { IDebugService } from '@/workbench/services/debug/IDebugService';

/**
 * Persistent bottom status bar, always mounted for `/ide/*` (see the
 * `/ide` layout) -- plain VS Code blue when idle, switching to the
 * debug-session style (orange, matching VS Code's own `statusBar.
 * debuggingBackground`; red on an actual error) the moment `Win64Debugger`
 * publishes a session through `IDebugService`. Generic left/right-aligned
 * items come from `IStatusbarService.getEntries()` (VS Code's
 * `addEntry()` registry) -- currently unused by anything, but any future
 * feature can add one without this component knowing about it.
 */
export function IdeStatusBar() {
  const statusbarService = useService(IStatusbarService);
  const debugService = useService(IDebugService);

  const entries = useSyncExternalStore(
    (onStoreChange) => statusbarService.onDidChange(onStoreChange).dispose,
    () => statusbarService.getEntries(),
    () => statusbarService.getEntries(),
  );
  const session = useSyncExternalStore(
    (onStoreChange) => debugService.onDidChangeSession(onStoreChange).dispose,
    () => debugService.currentSession,
    () => undefined,
  );

  if (!session) {
    const left = entries.filter((entry) => entry.alignment === 'left');
    const right = entries.filter((entry) => entry.alignment === 'right');
    return (
      <div className="flex h-[22px] shrink-0 items-center gap-3 bg-[#007acc] px-3 text-[0.68rem] text-white">
        <span className="shrink-0">Exoproc IDE</span>
        {left.map((entry) => (
          <StatusbarItem key={entry.id} entry={entry} />
        ))}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          {right.map((entry) => (
            <StatusbarItem key={entry.id} entry={entry} />
          ))}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex h-[22px] shrink-0 items-center gap-3 px-3 text-[0.68rem] text-white ${
        session.messageTone === 'error' ? 'bg-[#a1260d]' : 'bg-[#cc6633]'
      }`}
    >
      <span className="flex shrink-0 items-center gap-1.5">
        <span
          className={`inline-block size-2 rounded-full ${session.stateDotClass}`}
        />
        {session.stateLabel}
      </span>
      {session.suspendCount > 0 ? (
        <>
          <span className="h-3 w-px bg-white/30" />
          <span className="shrink-0 whitespace-nowrap">
            SUSPEND {session.suspendCount}
          </span>
        </>
      ) : null}
      <span className="h-3 w-px bg-white/30" />
      <span className="truncate opacity-90" title={session.messageText}>
        {session.messageText}
      </span>
      <span className="ml-auto shrink-0 whitespace-nowrap opacity-90">
        RIP {session.rip} &middot; {session.image} &middot; PID {session.pid}{' '}
        &middot; TID {session.tid}
      </span>
    </div>
  );
}

function StatusbarItem({
  entry,
}: {
  readonly entry: { readonly text: string; readonly tooltip?: string };
}) {
  return (
    <span
      className="shrink-0 whitespace-nowrap opacity-90"
      title={entry.tooltip}
    >
      {entry.text}
    </span>
  );
}

export default IdeStatusBar;
