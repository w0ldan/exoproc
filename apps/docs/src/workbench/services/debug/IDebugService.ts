import { Emitter, type Event } from '@/base/common/event';
import { createDecorator } from '@/platform/instantiation/common/instantiation';

export interface DebugSessionSummary {
  readonly stateDotClass: string;
  readonly stateLabel: string;
  readonly messageText: string;
  readonly messageTone: 'info' | 'success' | 'error';
  readonly suspendCount: number;
  readonly rip: string;
  readonly image: string;
  readonly pid: number;
  readonly tid: number;
}

/**
 * Analogue of VS Code's `IDebugService` (`state`/`getModel()` /
 * `onDidChangeState`), scoped to what this workbench actually needs: a
 * single published session summary, so anything outside the debugger view
 * itself (right now just `IdeStatusBar`) can know whether a debug session
 * is active without importing debugger internals. `Win64Debugger` is the
 * sole publisher -- it calls `publishSession()` on mount/update and
 * `publishSession(undefined)` on unmount. This wraps the *client-side*
 * `getGlobalWin64Machine()` (see `IdeDebugger.tsx`), deliberately distinct
 * from the server-side `ideMachine` that `IExplorerService`/`IEditorService`/
 * `ITerminalService` use -- see the plan notes on why these stay separate.
 */
export interface IDebugService {
  readonly currentSession: DebugSessionSummary | undefined;
  readonly isDebugging: boolean;
  publishSession(summary: DebugSessionSummary | undefined): void;
  readonly onDidChangeSession: Event<DebugSessionSummary | undefined>;
}

export const IDebugService = createDecorator<IDebugService>('debugService');

export class DebugService implements IDebugService {
  private session: DebugSessionSummary | undefined;
  private readonly changeEmitter = new Emitter<
    DebugSessionSummary | undefined
  >();

  public readonly onDidChangeSession = this.changeEmitter.event;

  public get currentSession(): DebugSessionSummary | undefined {
    return this.session;
  }

  public get isDebugging(): boolean {
    return this.session !== undefined;
  }

  public publishSession(summary: DebugSessionSummary | undefined): void {
    this.session = summary;
    this.changeEmitter.fire(summary);
  }
}
