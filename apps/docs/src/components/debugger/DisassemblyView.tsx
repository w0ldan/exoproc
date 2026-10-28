'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef } from 'react';
import type { OnMount } from '@monaco-editor/react';
import {
  GHOST_BUTTON_CLASS,
  INPUT_CLASS,
  PanelTab,
  TargetIcon,
} from './chrome';
import { LINE_HEIGHT, byteHex, hex } from './format';
import { defineDebuggerTheme, registerNasmLanguage } from './nasm';
import type { DebugSession } from './useDebugSession';

const MonacoEditor = dynamic(
  () => import('@monaco-editor/react').then((mod) => mod.Editor),
  {
    ssr: false,
  },
);

type Editor = Parameters<OnMount>[0];
type Monaco = Parameters<OnMount>[1];

export interface DisassemblyViewProps {
  session: DebugSession;
  selectedAddress?: bigint;
  onSelectAddress: (address: bigint) => void;
}

export function DisassemblyView({
  session,
  selectedAddress,
  onSelectAddress,
}: DisassemblyViewProps) {
  const {
    disassembly,
    disassemblyError,
    monacoText,
    ripLine,
    lineToAddress,
    breakpoints,
    toggleBreakpoint,
    runToCursor,
    gotoDisassembly,
    instructionAt,
    anchor,
    returnToRip,
  } = session;

  const editorRef = useRef<Editor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<ReturnType<
    Editor['createDecorationsCollection']
  > | null>(null);
  const byteViewerRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);
  const gotoInputRef = useRef<HTMLInputElement>(null);

  /**
   * Monaco actions are registered once on mount, so they must not close over
   * this render's handlers -- they read the live ones through this ref.
   */
  const commandsRef = useRef({
    lineToAddress,
    toggleBreakpoint,
    runToCursor,
    gotoDisassembly,
    instructionAt,
    onSelectAddress,
  });
  useEffect(() => {
    commandsRef.current = {
      lineToAddress,
      toggleBreakpoint,
      runToCursor,
      gotoDisassembly,
      instructionAt,
      onSelectAddress,
    };
  });

  /* ---------- scroll sync between the byte column and Monaco ---------- */
  const handleMonacoScroll = useCallback(() => {
    if (syncingRef.current) return;
    const editor = editorRef.current;
    const viewer = byteViewerRef.current;
    if (!editor || !viewer) return;
    syncingRef.current = true;
    viewer.scrollTop = editor.getScrollTop();
    syncingRef.current = false;
  }, []);

  const handleByteViewerScroll: React.UIEventHandler<HTMLDivElement> =
    useCallback((event) => {
      if (syncingRef.current) return;
      const editor = editorRef.current;
      if (!editor) return;
      syncingRef.current = true;
      editor.setScrollTop((event.target as HTMLDivElement).scrollTop);
      syncingRef.current = false;
    }, []);

  /* ---------- decorations ---------- */
  const updateDecorations = useCallback(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const decorations: Parameters<Editor['createDecorationsCollection']>[0] =
      [];

    if (ripLine !== undefined) {
      decorations.push({
        range: new monaco.Range(ripLine, 1, ripLine, 1),
        options: {
          isWholeLine: true,
          className: 'debugger-rip-line',
          glyphMarginClassName: 'debugger-rip-glyph',
        },
      });
    }

    for (const [lineNumber, address] of lineToAddress) {
      if (breakpoints.has(address)) {
        decorations.push({
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: {
            isWholeLine: true,
            glyphMarginClassName: 'debugger-breakpoint-glyph',
            className: lineNumber === ripLine ? 'debugger-rip-line' : '',
          },
        });
      }
      if (
        selectedAddress !== undefined &&
        address === selectedAddress &&
        lineNumber !== ripLine
      ) {
        decorations.push({
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: { isWholeLine: true, className: 'debugger-cursor-line' },
        });
      }
    }

    decorationsRef.current?.clear();
    decorationsRef.current = editor.createDecorationsCollection(decorations);

    if (ripLine !== undefined && anchor === undefined) {
      editor.revealLineInCenterIfOutsideViewport(ripLine);
    }
  }, [ripLine, breakpoints, lineToAddress, selectedAddress, anchor]);

  useEffect(() => {
    updateDecorations();
  }, [updateDecorations, monacoText]);

  const handleEditorMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      registerNasmLanguage(monaco);
      defineDebuggerTheme(monaco);
      editor.updateOptions({ theme: 'debugger-dark' });

      editor.onDidScrollChange(() => handleMonacoScroll());

      editor.onMouseDown((event) => {
        const lineNumber = event.target.position?.lineNumber;
        if (lineNumber === undefined) return;
        const address = commandsRef.current.lineToAddress.get(lineNumber);
        if (address === undefined) return;
        if (
          event.target.type ===
            monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
          event.target.type ===
            monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
        ) {
          commandsRef.current.toggleBreakpoint(address);
          return;
        }
        commandsRef.current.onSelectAddress(address);
      });

      /** `addAction`'s callback hands back an `ICodeEditor`, not the standalone editor. */
      const addressAtCursor = (target: {
        getPosition(): { lineNumber: number } | null;
      }) => {
        const lineNumber = target.getPosition()?.lineNumber;
        if (lineNumber === undefined) return undefined;
        return commandsRef.current.lineToAddress.get(lineNumber);
      };

      editor.addAction({
        id: 'exoproc.runToCursor',
        label: 'İmlece kadar çalıştır',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F10],
        contextMenuGroupId: 'exoproc',
        contextMenuOrder: 1,
        run: (target) => {
          const address = addressAtCursor(target);
          if (address !== undefined) commandsRef.current.runToCursor(address);
        },
      });

      editor.addAction({
        id: 'exoproc.toggleBreakpoint',
        label: 'Breakpoint aç/kapat',
        keybindings: [monaco.KeyCode.F9],
        contextMenuGroupId: 'exoproc',
        contextMenuOrder: 2,
        run: (target) => {
          const address = addressAtCursor(target);
          if (address !== undefined)
            commandsRef.current.toggleBreakpoint(address);
        },
      });

      editor.addAction({
        id: 'exoproc.followBranchTarget',
        label: 'Dallanma hedefine git',
        contextMenuGroupId: 'exoproc',
        contextMenuOrder: 3,
        run: (target) => {
          const address = addressAtCursor(target);
          if (address === undefined) return;
          const branchTarget =
            commandsRef.current.instructionAt(address)?.branchTarget;
          if (branchTarget !== undefined)
            commandsRef.current.gotoDisassembly(branchTarget);
        },
      });

      updateDecorations();
    },
    [handleMonacoScroll, updateDecorations],
  );

  const submitGoto = () => {
    const value = gotoInputRef.current?.value ?? '';
    if (value.trim()) gotoDisassembly(value);
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      {/* Disassembly navigation strip */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#2d2d2d] bg-[#252526] px-3 py-1.5">
        <span className="font-mono text-[0.65rem] font-semibold tracking-wide text-[#858585] uppercase">
          Disassembly adresi
        </span>
        <input
          ref={gotoInputRef}
          defaultValue=""
          spellCheck={false}
          placeholder="0x140001000"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submitGoto();
            }
          }}
          className={`${INPUT_CLASS} w-44`}
        />
        <button
          type="button"
          onClick={submitGoto}
          className={GHOST_BUTTON_CLASS}
        >
          Git
        </button>
        <button
          type="button"
          onClick={returnToRip}
          disabled={anchor === undefined}
          className={GHOST_BUTTON_CLASS}
          title="Disassembly'i tekrar RIP'i takip edecek şekilde ayarla"
        >
          RIP&apos;e dön
        </button>
        {anchor !== undefined && (
          <span className="font-mono text-[0.65rem] text-amber-400">
            Sabitlenmiş: {hex(anchor)} — RIP takip edilmiyor
          </span>
        )}
        {selectedAddress !== undefined && (
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[0.65rem] text-[#858585]">
            <TargetIcon />
            <span>İmleç: {hex(selectedAddress)}</span>
          </span>
        )}
      </div>

      {disassemblyError && (
        <div className="shrink-0 border-b border-[#2d2d2d] bg-red-950/40 px-3 py-1.5 font-mono text-[0.68rem] text-red-300">
          {disassemblyError}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Byte viewer -- fixed width left panel */}
        <div className="flex w-[220px] shrink-0 flex-col border-r border-[#2d2d2d] bg-[#1a1a1a]">
          {/* Panel tab -- not a file tab */}
          <div className="flex shrink-0 items-end border-b border-[#2d2d2d] bg-[#252526]">
            <PanelTab label="Bytes" active />
          </div>
          <div
            ref={byteViewerRef}
            onScroll={handleByteViewerScroll}
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden font-mono text-xs"
            style={{ lineHeight: `${LINE_HEIGHT}px` }}
          >
            {disassembly.map((instruction, index) => {
              const isRip = ripLine !== undefined && index + 1 === ripLine;
              const isBreakpoint = breakpoints.has(instruction.address);
              const isSelected = selectedAddress === instruction.address;
              return (
                <button
                  key={`${instruction.address.toString()}:${index}`}
                  type="button"
                  onClick={() => onSelectAddress(instruction.address)}
                  className={`flex w-full cursor-pointer whitespace-nowrap px-2 text-left ${
                    isRip
                      ? 'bg-[rgba(255,200,50,0.12)]'
                      : isSelected
                        ? 'bg-[rgba(0,122,204,0.12)]'
                        : ''
                  } ${isBreakpoint && !isRip ? 'bg-red-500/5' : ''}`}
                  style={{
                    height: LINE_HEIGHT,
                    lineHeight: `${LINE_HEIGHT}px`,
                  }}
                >
                  <code className="mr-3 text-[#858585]">
                    {hex(instruction.address)}
                  </code>
                  <code className="text-[#cccccc]">
                    {Array.from(instruction.bytes, byteHex).join(' ')}
                  </code>
                </button>
              );
            })}
          </div>
        </div>

        {/* Monaco code panel -- nasm syntax highlighted */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Panel tab -- not a file tab */}
          <div className="flex shrink-0 items-end border-b border-[#2d2d2d] bg-[#252526]">
            <PanelTab label="Disassembly" active />
            <span className="ml-auto px-3 py-1.5 font-mono text-[0.65rem] text-[#858585]">
              x86-64 interpreter
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <MonacoEditor
              height="100%"
              theme="vs-dark"
              language="nasm"
              value={monacoText}
              onMount={handleEditorMount}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                lineHeight: LINE_HEIGHT,
                fontFamily:
                  "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
                lineNumbers: 'off',
                glyphMargin: true,
                folding: false,
                lineDecorationsWidth: 0,
                scrollBeyondLastLine: false,
                renderLineHighlight: 'none',
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                overviewRulerBorder: false,
                scrollbar: { vertical: 'auto', horizontal: 'auto' },
                wordWrap: 'off',
                contextmenu: true,
                domReadOnly: true,
                cursorStyle: 'line-thin',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
