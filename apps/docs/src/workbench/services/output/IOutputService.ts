import { Emitter, type Event } from '@/base/common/event';
import { createDecorator } from '@/platform/instantiation/common/instantiation';

export type OutputChannelId = 'debug' | 'output';
export type OutputLineTone = 'info' | 'success' | 'error';

export interface OutputLine {
  readonly id: number;
  readonly text: string;
  readonly tone: OutputLineTone;
  readonly timestamp: number;
}

/**
 * Backs the IDE's bottom-panel "Debug Logs" and "Output" tabs -- VS Code's
 * `IOutputService`/debug console, thinned to two fixed channels rather than
 * a dynamic per-extension registry, since that's all this workbench has:
 * `useDebugSession`'s own status messages (attach, step, breakpoints,
 * errors -- see `DebugSessionMount`) feed `'debug'`, and app-level
 * events the user wants a persistent trail for (snapshot restore, zip
 * import) feed `'output'`.
 */
export interface IOutputService {
  append(channel: OutputChannelId, text: string, tone?: OutputLineTone): void;
  getLines(channel: OutputChannelId): readonly OutputLine[];
  readonly onDidAppend: Event<OutputChannelId>;
}

export const IOutputService = createDecorator<IOutputService>('outputService');

export class OutputService implements IOutputService {
  private readonly lines = new Map<OutputChannelId, OutputLine[]>();
  // Same reasoning as `StatusbarService.snapshot`: `useSyncExternalStore`
  // needs a stable reference when nothing changed for that channel.
  private readonly snapshots = new Map<
    OutputChannelId,
    readonly OutputLine[]
  >();
  private nextId = 0;
  private readonly appendEmitter = new Emitter<OutputChannelId>();

  public readonly onDidAppend = this.appendEmitter.event;

  public append(
    channel: OutputChannelId,
    text: string,
    tone: OutputLineTone = 'info',
  ): void {
    const list = this.lines.get(channel) ?? [];
    list.push({ id: this.nextId++, text, tone, timestamp: Date.now() });
    this.lines.set(channel, list);
    this.snapshots.delete(channel);
    this.appendEmitter.fire(channel);
  }

  public getLines(channel: OutputChannelId): readonly OutputLine[] {
    let snapshot = this.snapshots.get(channel);
    if (!snapshot) {
      snapshot = [...(this.lines.get(channel) ?? [])];
      this.snapshots.set(channel, snapshot);
    }
    return snapshot;
  }
}
