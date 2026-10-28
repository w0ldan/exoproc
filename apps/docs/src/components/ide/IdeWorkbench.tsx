'use client';

import { useCallback, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Group, Panel, Separator } from 'react-resizable-panels';
import {
  DebugSessionMount,
  type DebugSessionValue,
} from '@/components/debugger/DebugSessionScope';
import { useExplorerView } from './IdeExplorer';
import { useDebuggerView } from './IdeDebugger';
import { useSnapshotsView } from './IdeSnapshots';

export interface IdeWorkbenchProps {
  readonly lang: string;
}

const SEPARATOR_X_CLASS =
  'relative w-1 shrink-0 bg-[#2b2b2b] outline-none transition-colors hover:bg-[#007acc] focus-visible:bg-[#007acc]';

type WorkbenchView = 'explorer' | 'debugger' | 'snapshots';

function parseView(raw: string | null): WorkbenchView {
  return raw === 'debugger' || raw === 'snapshots' ? raw : 'explorer';
}

/**
 * The persistent IDE shell for `/ide`: one activity-bar-driven sidebar and
 * one main content area, both mounted for as long as the route is, with
 * only their *contents* swapping when the active view changes.
 *
 * Explorer/Debugger/Snapshots used to each be their own route
 * (`/ide/explorer`, `/ide/debugger`, `/ide/snapshots`), each declaring its
 * own sidebar+main split from scratch (explorer's a resizable panel,
 * debugger's a fixed-width aside, snapshots' none at all -- its content
 * filled the whole width where the editor should have been). Switching
 * between them was a full Next.js route change: the entire sidebar+main
 * tree unmounted and remounted, which is why the sidebar's width visibly
 * jumped between tabs and why Snapshots looked like it replaced the file
 * editor instead of living beside it.
 *
 * Now the view is tracked as a `?view=` query param on this single route
 * (read here via `useSearchParams`, switched via `IdeActivityBar`'s
 * `<Link>`s -- a search-param-only navigation on the same route does not
 * remount the page). `<Panel id="ide-sidebar">`/`<Panel id="ide-main">`
 * below are declared exactly once and never remount across a view switch,
 * so their resize state persists. Each `use*View()` hook is still called
 * unconditionally every render (Rules of Hooks), which is a feature here:
 * the inactive views' background state (debugger's process-list polling,
 * snapshots' list subscription, explorer's open document) all stay warm,
 * so switching tabs never shows a fetch flash or loses in-progress state.
 *
 * `main` is *always* `explorerView.main` (editor + the tabbed Terminal/
 * Debug Logs/Output panel) now, regardless of `view` -- Debugger no longer
 * owns a separate main area (see `useDebuggerView`'s doc comment): while a
 * process/thread is attached, `useExplorerView` itself swaps the editor
 * pane's content for the read-only disassembly, driven by `debugSession`
 * below rather than by which sidebar tab is active. That's also why
 * attaching a debugger doesn't need `view` to be `'debugger'` at all --
 * switching to Explorer or Snapshots while a session is live still shows
 * the disassembly, exactly the "nothing else should change" behavior asked
 * for.
 *
 * `debugSession` is `useState`, not a route-derived value: `DebugSessionMount`
 * (rendered as an inert trailing sibling below, present only once `pid`/
 * `tid` are in the URL) reports it up via a callback rather than this
 * component reading the URL directly -- see that file's doc comment for
 * why a Context provider wrapping this component was the wrong shape.
 */
export function IdeWorkbench({ lang }: IdeWorkbenchProps) {
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get('view'));
  // `Number(null)` is `0`, not `NaN` -- so a plain `Number(searchParams.get('pid'))`
  // would treat "no pid in the URL at all" as pid 0 and eagerly try to
  // attach the debugger to a real process 0, which doesn't exist (this is
  // exactly what threw "No process with pid 0." from the shell's main
  // process). `Number.isFinite` alone can't tell "absent" from "present
  // and zero" apart after that coercion, so presence has to be checked
  // before parsing.
  const pidParam = searchParams.get('pid');
  const tidParam = searchParams.get('tid');
  const pid = pidParam === null ? NaN : Number(pidParam);
  const tid = tidParam === null ? NaN : Number(tidParam);
  const hasDebugTarget = Number.isFinite(pid) && Number.isFinite(tid);

  const [debugSession, setDebugSession] = useState<DebugSessionValue>();

  const handleSessionChange = useCallback(
    (value: DebugSessionValue | undefined) => {
      setDebugSession((prev) => {
        if (!prev && !value) return prev;
        if (!prev || !value) return value;
        if (
          prev.tid === value.tid &&
          prev.selectedAddress === value.selectedAddress &&
          prev.session.revision === value.session.revision &&
          prev.session.ready === value.session.ready &&
          prev.session.canRun === value.session.canRun &&
          prev.session.suspendCount === value.session.suspendCount &&
          prev.session.stateLabel === value.session.stateLabel &&
          prev.session.rip === value.session.rip &&
          prev.session.message.text === value.session.message.text &&
          prev.session.message.tone === value.session.message.tone &&
          prev.session.process?.pid === value.session.process?.pid &&
          prev.session.process?.image === value.session.process?.image
        ) {
          return prev;
        }
        return value;
      });
    },
    [],
  );

  const activeDebugSession = hasDebugTarget ? debugSession : undefined;

  const explorerView = useExplorerView(lang, activeDebugSession);
  const debuggerView = useDebuggerView(lang, activeDebugSession);
  const snapshotsView = useSnapshotsView(lang);

  const sidebar =
    view === 'debugger'
      ? debuggerView.sidebar
      : view === 'snapshots'
        ? snapshotsView.sidebar
        : explorerView.sidebar;

  return (
    <div className="flex h-full min-h-120 overflow-hidden bg-[#1e1e1e] text-[#cccccc]">
      <Group orientation="horizontal" className="flex min-h-0 min-w-0 flex-1">
        <Panel id="ide-sidebar" defaultSize="20" minSize="12" maxSize="45">
          <aside className="flex h-full flex-col border-r border-[#2b2b2b] bg-[#181818]">
            {sidebar}
          </aside>
        </Panel>

        <Separator className={SEPARATOR_X_CLASS} />

        <Panel id="ide-main" defaultSize="80" minSize="30">
          <main className="flex h-full min-w-0 flex-col bg-[#1e1e1e]">
            {explorerView.main}
          </main>
        </Panel>
      </Group>

      {hasDebugTarget ? (
        <DebugSessionMount
          pid={pid}
          tid={tid}
          key={`${pid}:${tid}`}
          onSessionChange={handleSessionChange}
        />
      ) : null}
    </div>
  );
}

export default IdeWorkbench;
