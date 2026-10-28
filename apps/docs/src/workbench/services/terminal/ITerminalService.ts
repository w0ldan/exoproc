import { Emitter, type Event } from '@/base/common/event';
import { createDecorator } from '@/platform/instantiation/common/instantiation';
import type { ExoprocApi } from '@/shell/preload/api';

/**
 * One `cmd.exe` session over `window.exoproc.terminal` (see `shell/main/
 * modules/terminal.ts`, which wraps `Win32CommandPrompt`). Previously an
 * `EventSource` against `/api/ide/terminal/stream` with input POSTed to
 * `/api/ide/terminal/input`; same mechanism, shell IPC instead of SSE now
 * that the engine runs in a Worker rather than behind a Next.js API route.
 *
 * `initialOutput` is a plain property, not folded into `onDidWrite` --
 * `createSession()` is async (the underlying `terminal.create()` is an
 * IPC round trip), so by the time a caller's `await` resolves and it gets
 * around to subscribing to `onDidWrite`, a *pushed* banner would already
 * have been missed. Reading it directly has no such race (see
 * `TerminalSessionInfo.initialOutput`'s own doc comment for why the main
 * process hands it back this way in the first place).
 *
 * `onDidWrite` emits already de-duplicated text (see the echo-suppression
 * comment on `sendLine`) -- consumers (`IdeTerminalPanel`) just need to
 * pipe it straight into xterm.
 */
export interface ITerminalSession {
  readonly initialOutput: string;
  readonly onDidWrite: Event<string>;
  readonly onDidClose: Event<void>;
  /** Sends a line to the shell exactly as if the user typed it and pressed Enter. */
  sendLine(line: string): void;
  dispose(): void;
}

/**
 * Analogue of VS Code's `ITerminalService` (`createTerminal()`). This
 * workbench only ever has one terminal instance live at a time (the panel
 * below the editor), but the service boundary is the same shape VS Code
 * uses for N terminals, so adding a terminal picker/multiple sessions later
 * doesn't require touching `IdeTerminalPanel`'s view logic.
 */
export interface ITerminalService {
  createSession(): Promise<ITerminalSession>;
}

export const ITerminalService =
  createDecorator<ITerminalService>('terminalService');

class TerminalSession implements ITerminalSession {
  // `Win32CommandPrompt.execute()` echoes the whole submitted line itself
  // (as the very start of what it writes to the console) -- without this
  // queue, that engine-side echo and xterm's own per-keystroke local echo
  // (done by the view, not here) would double up. Each sent line's exact
  // text is queued here and stripped off the front of the next incoming
  // chunk(s), FIFO, since a line can arrive split across more than one
  // `onData` push, or several lines can be in flight.
  private readonly pendingEcho: string[] = [];
  private readonly writeEmitter = new Emitter<string>();
  private readonly closeEmitter = new Emitter<void>();
  private readonly unsubscribeData: () => void;
  private readonly unsubscribeClose: () => void;
  private disposed = false;

  public readonly onDidWrite = this.writeEmitter.event;
  public readonly onDidClose = this.closeEmitter.event;
  public readonly initialOutput: string;

  public constructor(
    private readonly api: ExoprocApi,
    private readonly sessionId: string,
    initialOutput: string,
  ) {
    this.initialOutput = initialOutput;
    this.unsubscribeData = api.terminal.onData((event) => {
      if (event.sessionId !== sessionId) return;
      this.consume(event.chunk);
    });
    this.unsubscribeClose = api.terminal.onClose((event) => {
      if (event.sessionId !== sessionId) return;
      this.closeEmitter.fire();
    });
  }

  public sendLine(line: string): void {
    this.pendingEcho.push(line);
    void this.api.terminal.sendLine(this.sessionId, line);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeData();
    this.unsubscribeClose();
    void this.api.terminal.dispose(this.sessionId);
    this.writeEmitter.dispose();
    this.closeEmitter.dispose();
  }

  private consume(chunk: string): void {
    let remaining = chunk;
    while (remaining && this.pendingEcho.length > 0) {
      const expected = this.pendingEcho[0]!;
      if (remaining.startsWith(expected)) {
        this.pendingEcho.shift();
        remaining = remaining.slice(expected.length);
      } else if (expected.startsWith(remaining)) {
        this.pendingEcho[0] = expected.slice(remaining.length);
        remaining = '';
      } else {
        // Unexpected divergence -- don't drop output, just stop trying to
        // de-duplicate any further echoes for this chunk.
        this.pendingEcho.length = 0;
        break;
      }
    }
    if (remaining) this.writeEmitter.fire(remaining);
  }
}

export class TerminalService implements ITerminalService {
  public constructor(private readonly api: ExoprocApi) {}

  public async createSession(): Promise<ITerminalSession> {
    const info = await this.api.terminal.create();
    return new TerminalSession(this.api, info.id, info.initialOutput);
  }
}
