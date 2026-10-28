'use client';

import {
  ContinueIcon,
  RunToCursorIcon,
  StepIntoIcon,
  StepOutIcon,
  StepOverIcon,
  TOOL_BUTTON_CLASS,
} from './chrome';
import { hex } from './format';
import type { DebugSession } from './useDebugSession';

export interface DebugToolbarProps {
  session: DebugSession;
  tid: number;
  selectedAddress?: bigint;
}

export function DebugToolbar({
  session,
  tid,
  selectedAddress,
}: DebugToolbarProps) {
  const {
    process,
    canRun,
    continueExecution,
    stepOver,
    stepInto,
    stepOut,
    runToCursor,
  } = session;

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#2d2d2d] bg-[#252526] px-3 py-1.5">
      <div className="flex min-w-0 flex-col">
        <strong className="truncate text-xs text-[#cccccc]">
          {process?.image ?? '…'}!thread_entry
        </strong>
        <span className="font-mono text-[0.65rem] text-[#858585]">
          PID {process?.pid ?? '…'} / TID {tid}
        </span>
      </div>

      <div className="mx-1 h-6 w-px bg-[#3c3c3c]" />

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={!canRun}
          onClick={continueExecution}
          title="Devam et — Continue (F5)"
          className={`${TOOL_BUTTON_CLASS} text-[#89d185]`}
        >
          <ContinueIcon />
          Devam
        </button>
        <button
          type="button"
          disabled={!canRun}
          onClick={stepOver}
          title="Üzerinden atla — Step Over (F10)"
          className={`${TOOL_BUTTON_CLASS} text-[#75beff]`}
        >
          <StepOverIcon />
          Üzerinden atla
        </button>
        <button
          type="button"
          disabled={!canRun}
          onClick={stepInto}
          title="İçine gir — Step Into (F11)"
          className={`${TOOL_BUTTON_CLASS} text-[#75beff]`}
        >
          <StepIntoIcon />
          İçine gir
        </button>
        <button
          type="button"
          disabled={!canRun}
          onClick={stepOut}
          title="Fonksiyondan çık — Step Out (Shift+F11)"
          className={`${TOOL_BUTTON_CLASS} text-[#75beff]`}
        >
          <StepOutIcon />
          Dışına çık
        </button>
        <button
          type="button"
          disabled={!canRun || selectedAddress === undefined}
          onClick={() => {
            if (selectedAddress !== undefined) runToCursor(selectedAddress);
          }}
          title={
            selectedAddress === undefined
              ? 'Önce disassembly üzerinde bir satır seçin — Run to Cursor (Ctrl+F10)'
              : `${hex(selectedAddress)} adresine kadar çalıştır — Run to Cursor (Ctrl+F10)`
          }
          className={`${TOOL_BUTTON_CLASS} text-[#dcdcaa]`}
        >
          <RunToCursorIcon />
          İmlece kadar
        </button>
      </div>
    </div>
  );
}
