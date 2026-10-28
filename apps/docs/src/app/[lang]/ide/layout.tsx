'use client';

import { useMemo, useSyncExternalStore, type ReactNode } from 'react';
import {
  ServicesProvider,
  type ServiceRegistration,
} from '@/platform/instantiation/browser/instantiationService';
import {
  ExplorerService,
  IExplorerService,
} from '@/workbench/services/explorer/IExplorerService';
import {
  EditorService,
  IEditorService,
} from '@/workbench/services/editor/IEditorService';
import {
  ITerminalService,
  TerminalService,
} from '@/workbench/services/terminal/ITerminalService';
import {
  IDebugService,
  DebugService,
} from '@/workbench/services/debug/IDebugService';
import {
  IStatusbarService,
  StatusbarService,
} from '@/workbench/services/statusbar/IStatusbarService';
import {
  FileService,
  IFileService,
} from '@/workbench/services/files/IFileService';
import {
  ISnapshotService,
  SnapshotService,
} from '@/workbench/services/snapshots/ISnapshotService';
import {
  IOutputService,
  OutputService,
} from '@/workbench/services/output/IOutputService';
import {
  ICommandService,
  CommandService,
} from '@/platform/commands/common/commands';
import {
  IKeybindingService,
  KeybindingService,
} from '@/platform/keybinding/common/keybinding';
import { getExoprocApi } from '@/shell/renderer/bootstrap';
import { IdeStatusBar } from '@/components/ide/IdeStatusBar';
import { CommandPalette } from '@/components/ide/CommandPalette';
import '@/workbench/contrib';

/**
 * Scoped to `/ide/*` only -- workbench services (and the persistent status
 * bar they back, VS Code-style footer, always mounted, switches to the
 * debug-session style while `Win64Debugger` is attached) have no business
 * on regular docs pages.
 *
 * Sizing matters here: this is the one place in the tree that owns a hard
 * `h-dvh`. `IdeWorkbench` fills whatever's left after the status bar via
 * `h-full`, not its own `h-dvh` -- stacking two
 * independent `h-dvh` claims (one here, one in the page) would overflow the
 * viewport by the status bar's height and produce a page-level scrollbar.
 *
 * `FileService` now depends on `window.exoproc` (`getExoprocApi()`), which
 * throws when called during SSR -- `bootstrapShell()` spawns a real Worker,
 * something the server has no notion of. Building `registrations` inside a
 * plain `useMemo` therefore crashed the very first server-rendered request,
 * since Next.js still executes a client component's `useMemo` calls while
 * producing its initial HTML, unlike `useEffect`, which never runs on the
 * server. This entire subtree is inherently client-only anyway (Worker,
 * IndexedDB-backed snapshot storage -- nothing here has a meaningful
 * server-rendered form), so it is gated behind `useSyncExternalStore`'s
 * server/client snapshot split (the same technique already used in
 * `IdeStatusBar`/`IdeExplorer` for this exact class of problem): the
 * server and the first client paint both render `false` (identical
 * output, no hydration mismatch), and only the second client render
 * -- which React guarantees runs after hydration -- sees `true` and
 * boots the real shell. No effect-driven `setState` needed, so this
 * sidesteps the "no setState in an effect body" lint rule rather than
 * suppressing it.
 */
export default function IdeLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );

  const registrations = useMemo<
    readonly ServiceRegistration[] | undefined
  >(() => {
    if (!mounted) return undefined;
    const api = getExoprocApi();
    const fileService = new FileService(api);
    const commandService = new CommandService();
    return [
      { id: IFileService, instance: fileService },
      { id: IExplorerService, instance: new ExplorerService(fileService) },
      { id: IEditorService, instance: new EditorService(fileService) },
      { id: ITerminalService, instance: new TerminalService(api) },
      { id: IDebugService, instance: new DebugService() },
      { id: IStatusbarService, instance: new StatusbarService() },
      { id: ISnapshotService, instance: new SnapshotService(api) },
      { id: IOutputService, instance: new OutputService() },
      { id: ICommandService, instance: commandService },
      {
        id: IKeybindingService,
        instance: new KeybindingService(commandService),
      },
    ];
  }, [mounted]);

  if (!registrations) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[#1e1e1e] text-sm text-[#8c8c8c]">
        Exoproc IDE yükleniyor…
      </div>
    );
  }

  return (
    <ServicesProvider registrations={registrations}>
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
        <div className="min-h-0 flex-1">{children}</div>
        <IdeStatusBar />
      </div>
      <CommandPalette />
    </ServicesProvider>
  );
}
