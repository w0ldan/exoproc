'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { useService } from '@/platform/instantiation/browser/instantiationService';
import {
  IOutputService,
  type OutputChannelId,
} from '@/workbench/services/output/IOutputService';
import type { DebugSessionValue } from '@/components/debugger/DebugSessionScope';
import { MemoryPanel, TracePanel } from '@/components/debugger/panels';
import { IdeTerminalPanel, type IdeTerminalHandle } from './IdeTerminalPanel';
import { useIdeTranslation } from '@/lib/ide-i18n';

export interface IdeBottomPanelProps {
  readonly terminalRef: RefObject<IdeTerminalHandle | null>;
  readonly debugSession?: DebugSessionValue;
  readonly lang?: string;
}

type BottomTab = 'terminal' | 'debug' | 'output' | 'memory' | 'trace';

/**
 * The bottom panel below the editor, tabbed like VS Code's own (Terminal /
 * Debug Console / Output / Memory / Trace) -- previously just a bare terminal.
 */
export function IdeBottomPanel({
  terminalRef,
  debugSession,
  lang: explicitLang,
}: IdeBottomPanelProps) {
  const [activeTab, setActiveTab] = useState<BottomTab>('terminal');
  const { lang, t } = useIdeTranslation(explicitLang);

  const tabs: ReadonlyArray<{ id: BottomTab; label: string }> = [
    { id: 'terminal', label: t.bottomPanel.terminal },
    { id: 'debug', label: t.bottomPanel.debugLogs },
    { id: 'output', label: t.bottomPanel.output },
    ...(debugSession
      ? [
          { id: 'memory' as const, label: t.bottomPanel.memory },
          { id: 'trace' as const, label: t.bottomPanel.trace },
        ]
      : []),
  ];

  return (
    <div className="flex h-full flex-col border-t border-[#2b2b2b] bg-[#181818]">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-[#2b2b2b] px-2 text-[11px]">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`h-full border-b px-2.5 uppercase tracking-wide ${
              activeTab === tab.id
                ? 'border-b-[#007acc] text-white font-semibold'
                : 'border-b-transparent text-[#9d9d9d] hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <div className={activeTab === 'terminal' ? 'h-full' : 'hidden h-full'}>
          <IdeTerminalPanel ref={terminalRef} />
        </div>
        <div className={activeTab === 'debug' ? 'h-full' : 'hidden h-full'}>
          <OutputLogView
            channel="debug"
            lang={lang}
            emptyText={t.bottomPanel.noLogs}
          />
        </div>
        <div className={activeTab === 'output' ? 'h-full' : 'hidden h-full'}>
          <OutputLogView
            channel="output"
            lang={lang}
            emptyText={t.bottomPanel.noLogs}
          />
        </div>
        {debugSession ? (
          <>
            <div
              className={
                activeTab === 'memory'
                  ? 'h-full overflow-y-auto bg-[#1e1e1e]'
                  : 'hidden h-full'
              }
            >
              <MemoryPanel session={debugSession.session} />
            </div>
            <div
              className={
                activeTab === 'trace'
                  ? 'h-full overflow-y-auto bg-[#1e1e1e]'
                  : 'hidden h-full'
              }
            >
              <TracePanel session={debugSession.session} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function OutputLogView({
  channel,
  lang,
  emptyText,
}: {
  readonly channel: OutputChannelId;
  readonly lang: string;
  readonly emptyText: string;
}) {
  const outputService = useService(IOutputService);
  const lines = useSyncExternalStore(
    (onStoreChange) =>
      outputService.onDidAppend((changedChannel) => {
        if (changedChannel === channel) onStoreChange();
      }).dispose,
    () => outputService.getLines(channel),
    () => outputService.getLines(channel),
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const dateLocale = lang === 'tr' ? 'tr-TR' : 'en-US';

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto px-3 py-2 font-mono text-xs"
    >
      {lines.length === 0 ? (
        <p className="text-[#6b6b6b]">{emptyText}</p>
      ) : (
        lines.map((line) => (
          <div
            key={line.id}
            className={
              line.tone === 'error'
                ? 'text-red-300'
                : line.tone === 'success'
                  ? 'text-emerald-300'
                  : 'text-[#cccccc]'
            }
          >
            <span className="mr-2 text-[#6b6b6b]">
              {new Date(line.timestamp).toLocaleTimeString(dateLocale)}
            </span>
            {line.text}
          </div>
        ))
      )}
    </div>
  );
}
