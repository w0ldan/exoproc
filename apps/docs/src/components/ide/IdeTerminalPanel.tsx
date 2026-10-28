'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useService } from '@/platform/instantiation/browser/instantiationService';
import {
  ITerminalService,
  type ITerminalSession,
} from '@/workbench/services/terminal/ITerminalService';

export interface IdeTerminalHandle {
  /** Sends a command line to the shell exactly as if the user typed it. */
  runCommand(line: string): void;
}

const KEY_BACKSPACE = '\x7f';
const KEY_ENTER = '\r';
const KEY_CTRL_C = '\x03';

/**
 * Thin xterm.js view over an `ITerminalSession` (see `ITerminalService`) --
 * owns only the DOM/keystroke-buffering side of the terminal; session
 * lifecycle, the shell IPC channel, and echo de-duplication all live in
 * the service now.
 *
 * Deliberately does not reuse `components/debugger/Terminal.tsx`'s
 * `TerminalPanel`: that one requests `terminal.create({ presenter: true })`
 * instead of `ITerminalService.createSession()`, since its full-fidelity
 * screen-buffer rendering (see its own doc comment) has no use for -- and
 * would actively conflict with -- this service's `pendingEcho` de-dup
 * logic, which is built for the plain `drainHostText()` byte-queue model.
 */
export const IdeTerminalPanel = forwardRef<IdeTerminalHandle>(
  function IdeTerminalPanel(_props, ref) {
    const terminalService = useService(ITerminalService);
    const containerRef = useRef<HTMLDivElement>(null);
    const lineBufferRef = useRef('');
    const sessionRef = useRef<ITerminalSession | undefined>(undefined);

    useImperativeHandle(ref, () => ({
      runCommand(line: string) {
        lineBufferRef.current = '';
        sessionRef.current?.sendLine(line);
      },
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      let disposed = false;
      let term: XTerm | undefined;
      let session: ITerminalSession | undefined;
      let writeSubscription: { dispose(): void } | undefined;
      let closeSubscription: { dispose(): void } | undefined;

      // Both `createSession()` (an IPC round trip now) and the xterm
      // module import are async -- wait for both before wiring anything,
      // rather than racing a synchronous session against an async import
      // the way the pre-shell version could.
      void Promise.all([
        import('@xterm/xterm').then(({ Terminal }) => Terminal),
        terminalService.createSession(),
      ]).then(([Terminal, createdSession]) => {
        if (disposed) {
          createdSession.dispose();
          return;
        }
        session = createdSession;
        sessionRef.current = createdSession;

        term = new Terminal({
          cols: 100,
          rows: 24,
          fontFamily:
            "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
          fontSize: 12,
          theme: {
            background: '#181818',
            foreground: '#cccccc',
            cursor: '#cccccc',
          },
          convertEol: true,
          disableStdin: false,
          cursorBlink: true,
        });
        term.open(container);
        term.write(createdSession.initialOutput);

        term.onData((data) => {
          if (data === KEY_CTRL_C) {
            // No true guest-side interrupt semantics in the simulated
            // engine -- this only discards what hasn't been submitted yet.
            lineBufferRef.current = '';
            term?.write('^C\r\n');
            return;
          }

          if (data === KEY_ENTER) {
            const line = lineBufferRef.current;
            lineBufferRef.current = '';
            // No local `\r\n` here: the session's own echo of this line
            // already carries the trailing newline, right before the
            // command's real output (see ITerminalService's de-dup logic).
            createdSession.sendLine(line);
            return;
          }

          if (data === KEY_BACKSPACE) {
            if (lineBufferRef.current.length === 0) return;
            lineBufferRef.current = lineBufferRef.current.slice(0, -1);
            term?.write('\b \b');
            return;
          }

          if (data.length === 1 && data.charCodeAt(0) < 0x20) return;

          lineBufferRef.current += data;
          term?.write(data);
        });

        writeSubscription = createdSession.onDidWrite((chunk) =>
          term?.write(chunk),
        );
        closeSubscription = createdSession.onDidClose(() => {
          term?.write('\r\n[oturum kapandı]\r\n');
        });
      });

      return () => {
        disposed = true;
        writeSubscription?.dispose();
        closeSubscription?.dispose();
        session?.dispose();
        sessionRef.current = undefined;
        term?.dispose();
      };
    }, [terminalService]);

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#181818] p-2">
        <div ref={containerRef} className="min-h-0 flex-1" />
      </div>
    );
  },
);

export default IdeTerminalPanel;
