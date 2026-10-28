'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { useService } from '@/platform/instantiation/browser/instantiationService';
import { IDebugService } from '@/workbench/services/debug/IDebugService';
import { IOutputService } from '@/workbench/services/output/IOutputService';
import { DEBUGGER_CSS } from './chrome';
import { useDebugSession, type DebugSession } from './useDebugSession';

export interface DebugSessionValue {
  readonly session: DebugSession;
  readonly tid: number;
  readonly selectedAddress: bigint | undefined;
  readonly onSelectAddress: (address: bigint) => void;
}

/**
 * Mounts exactly one `useDebugSession` for the whole `/ide` workbench and
 * reports its composed value up to `IdeWorkbench`'s `onSessionChange`,
 * instead of a React Context provider wrapping the workbench body.
 *
 * A Context provider was the first design here, but it's wrong for this
 * case specifically: whether a debug target is attached has to flip this
 * component in and out of existence (its underlying `useDebugSession` call
 * eagerly starts a real attach round-trip the moment it's given a pid/tid,
 * so it cannot be mounted unconditionally with placeholder values). A
 * Context *provider* wrapping `IdeWorkbenchBody` would therefore need to
 * conditionally interpose itself above `IdeWorkbenchBody` in the tree --
 * and React remounts a subtree the instant the component type at its
 * parent's slot changes, which would blow away `IdeWorkbenchBody`'s own
 * state (the open file's unsaved draft, the terminal session, ...) on
 * every attach/detach. Rendering this component as an inert, always-safe-
 * to-omit *sibling* at the end of `IdeWorkbenchBody`'s own children (see
 * `IdeWorkbench.tsx`) and lifting its value through a plain callback
 * instead avoids ever changing `IdeWorkbenchBody`'s own position in the
 * tree -- exactly the "nothing else should change" behavior asked for.
 *
 * Also folds in what used to be `Win64Debugger`'s own status-bar
 * publishing and the RIP/breakpoint decoration CSS, now that nothing here
 * mounts the full dockview surface -- see `useDebuggerView`'s doc comment
 * for what's no longer reachable (Memory/Trace/Scanner).
 */
export const DebugSessionMount = memo(function DebugSessionMount({
  pid,
  tid,
  onSessionChange,
}: {
  readonly pid: number;
  readonly tid: number;
  readonly onSessionChange: (value: DebugSessionValue | undefined) => void;
}) {
  const session = useDebugSession({
    pid,
    tid,
    initialMemoryMappingId: 'process-heap',
    initialMemoryAddress: '',
    initialMemoryLength: 128,
  });
  const debugService = useService(IDebugService);
  const outputService = useService(IOutputService);
  const [selectedAddress, setSelectedAddress] = useState<bigint>();

  useEffect(() => {
    if (!session.ready) return;
    debugService.publishSession({
      stateDotClass: session.stateDotClass,
      stateLabel: session.stateLabel,
      messageText: session.message.text,
      messageTone: session.message.tone,
      suspendCount: session.suspendCount,
      rip: session.rip,
      image: session.process?.image ?? '',
      pid,
      tid,
    });
    return () => debugService.publishSession(undefined);
  }, [
    debugService,
    session.ready,
    session.stateDotClass,
    session.stateLabel,
    session.message.text,
    session.message.tone,
    session.suspendCount,
    session.rip,
    session.process?.image,
    pid,
    tid,
  ]);

  // Every status message the session already produces (attach, step,
  // breakpoint hits, memory writes, errors) becomes a line in the "Debug
  // Logs" tab -- there was no persistent log of these before, only the
  // single latest `message` shown in the toolbar.
  const lastLoggedMessageRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastLoggedMessageRef.current === session.message.text) return;
    lastLoggedMessageRef.current = session.message.text;
    outputService.append('debug', session.message.text, session.message.tone);
  }, [session.message.text, session.message.tone, outputService]);

  // Reports the composed value when relevant session state changes,
  // and clears it on unmount only. Guarded with lastEmittedRef to prevent
  // infinite render loops caused by the new object reference returned by
  // useDebugSession on each render.
  const lastEmittedRef = useRef<{
    tid: number;
    selectedAddress?: bigint;
    revision: number;
    ready: boolean;
    canRun: boolean;
    suspendCount: number;
    stateLabel: string;
    rip: string;
    messageText: string;
    messageTone: string;
    image: string;
  } | null>(null);

  useEffect(() => {
    const last = lastEmittedRef.current;
    if (
      last &&
      last.tid === tid &&
      last.selectedAddress === selectedAddress &&
      last.revision === session.revision &&
      last.ready === session.ready &&
      last.canRun === session.canRun &&
      last.suspendCount === session.suspendCount &&
      last.stateLabel === session.stateLabel &&
      last.rip === session.rip &&
      last.messageText === session.message.text &&
      last.messageTone === session.message.tone &&
      last.image === (session.process?.image ?? '')
    ) {
      return;
    }
    lastEmittedRef.current = {
      tid,
      selectedAddress,
      revision: session.revision,
      ready: session.ready,
      canRun: session.canRun,
      suspendCount: session.suspendCount,
      stateLabel: session.stateLabel,
      rip: session.rip,
      messageText: session.message.text,
      messageTone: session.message.tone,
      image: session.process?.image ?? '',
    };
    onSessionChange({
      session,
      tid,
      selectedAddress,
      onSelectAddress: setSelectedAddress,
    });
  }, [onSessionChange, session, tid, selectedAddress]);

  useEffect(() => {
    return () => {
      lastEmittedRef.current = null;
      onSessionChange(undefined);
    };
  }, [onSessionChange]);

  return <style>{DEBUGGER_CSS}</style>;
});
