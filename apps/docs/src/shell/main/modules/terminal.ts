import {
  ConsoleScreenPresenter,
  Win32CommandPrompt,
  type HostConsoleScreen,
} from 'win32-simulate';
import {
  TerminalChannel,
  type TerminalCreateOptions,
} from '../../common/channels';
import { ipc } from '../ipc';
import { getMachine } from './machine';

/**
 * `cmd.exe` sessions, one `Win32CommandPrompt` per `create()` call.
 *
 * Ported from the pre-shell server implementation
 * (`src/lib/server/ide-terminal-sessions.ts` + its SSE route), same
 * mechanism, different transport: that version polled
 * `process.console.drainHostText()` on a 60ms interval and pushed chunks
 * over an SSE stream; this one polls the same way and pushes over
 * `ipc.send` instead.
 *
 * `node <script>` command lines are **not** special-cased here -- they go
 * through `execute()` exactly like any other command. `node.exe` is a
 * real compiled guest program (see `node-syscalls.ts`, registered by
 * `machine.ts`), so `cmd.exe`'s normal PATH/System32 resolution finds and
 * runs it the same way it finds `cls`/`dir`/anything else; the syscalls it
 * calls into (`node.dll!createJSProcess`/`enterJSProcess`/
 * `terminateJSProcess`) are what actually run the script, browser-side.
 */

const POLL_INTERVAL_MS = 60;

interface TerminalSession {
  readonly prompt: Win32CommandPrompt;
  readonly interval: ReturnType<typeof setInterval>;
  readonly unsubscribeVideo?: () => void;
}

const sessions = new Map<string, TerminalSession>();

function requireSession(sessionId: string): TerminalSession {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`No terminal session "${sessionId}".`);
  return session;
}

function closeSession(sessionId: string, session: TerminalSession): void {
  clearInterval(session.interval);
  session.unsubscribeVideo?.();
  sessions.delete(sessionId);
  ipc.send(TerminalChannel.onClose, { sessionId });
}

/**
 * Forces every live `cmd.exe` session to visibly close, rather than
 * silently orphaning it against a `Win64Machine` a VM snapshot restore is
 * about to discard (`vm-snapshots.ts`) -- without this, a session's poll
 * `setInterval` would keep calling methods on a `Win32CommandPrompt`/
 * `Win64Process` graph belonging to the discarded machine forever. Reuses
 * `closeSession` so `IdeTerminalPanel.tsx` renders the existing
 * "[oturum kapandı]" state -- no renderer-side change needed.
 */
export function closeAllTerminalSessions(): void {
  for (const [sessionId, session] of sessions) closeSession(sessionId, session);
}

/**
 * Accumulates `ConsoleScreenPresenter`'s ANSI output into a string instead
 * of drawing it anywhere -- the exact same role `XtermConsoleScreen` used
 * to play client-side (see the pre-shell `components/debugger/Terminal.tsx`),
 * just running in the worker now so the wire format stays a plain text
 * chunk, identical to the `drainHostText()` path.
 */
class BufferedAnsiScreen implements HostConsoleScreen {
  private buffer = '';

  public clear(): void {
    this.buffer += '\x1b[H\x1b[2J';
  }

  public setCursor(column: number, row: number): void {
    this.buffer += `\x1b[${row + 1};${column + 1}H`;
  }

  public write(text: string): void {
    this.buffer += text;
  }

  public drain(): string {
    const drained = this.buffer;
    this.buffer = '';
    return drained;
  }
}

export function registerTerminalHandlers(): void {
  ipc.handle(TerminalChannel.create, (options?: TerminalCreateOptions) => {
    const sessionId = crypto.randomUUID();
    const prompt = new Win32CommandPrompt(getMachine());

    if (options?.presenter) {
      const screen = new BufferedAnsiScreen();
      const presenter = new ConsoleScreenPresenter(
        prompt.process.console.videoOutput,
        screen,
      );
      presenter.present();
      // First `present()` is the initial full-screen draw -- returned
      // inline for the same race-avoidance reason the plain model
      // returns its own `initialOutput` inline (see `TerminalSessionInfo`).
      const initialOutput = screen.drain();

      const unsubscribeVideo = prompt.process.console.videoOutput.subscribe(
        () => {
          presenter.present();
          const chunk = screen.drain();
          if (chunk) ipc.send(TerminalChannel.onData, { sessionId, chunk });
        },
      );
      const interval = setInterval(() => {
        if (prompt.isClosed) closeSession(sessionId, requireSession(sessionId));
      }, POLL_INTERVAL_MS);

      sessions.set(sessionId, { prompt, interval, unsubscribeVideo });
      return { id: sessionId, initialOutput };
    }

    // Returned inline rather than pushed through `onData` -- see
    // `TerminalSessionInfo.initialOutput` for why a push here would race
    // any caller that (reasonably) subscribes only after `create()`
    // resolves.
    const initialOutput = prompt.process.console.drainHostText();

    const interval = setInterval(() => {
      const chunk = prompt.process.console.drainHostText();
      if (chunk) ipc.send(TerminalChannel.onData, { sessionId, chunk });
      if (prompt.isClosed) closeSession(sessionId, requireSession(sessionId));
    }, POLL_INTERVAL_MS);

    sessions.set(sessionId, { prompt, interval });
    return { id: sessionId, initialOutput };
  });

  ipc.handle(TerminalChannel.sendLine, (sessionId: string, line: string) => {
    requireSession(sessionId).prompt.execute(line);
  });

  ipc.handle(TerminalChannel.dispose, (sessionId: string) => {
    const session = sessions.get(sessionId);
    if (!session) return;
    clearInterval(session.interval);
    sessions.delete(sessionId);
  });
}
