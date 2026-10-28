import { Emitter, type Disposable, type Event } from '@/base/common/event';
import { createDecorator } from '@/platform/instantiation/common/instantiation';

export type StatusbarEntryTone = 'info' | 'error';
export type StatusbarAlignment = 'left' | 'right';

export interface StatusbarEntry {
  readonly text: string;
  readonly tooltip?: string;
  readonly tone?: StatusbarEntryTone;
  readonly alignment: StatusbarAlignment;
  /** Lower sorts closer to the outer edge, matching VS Code's priority convention. */
  readonly priority: number;
}

export interface StatusbarEntryHandle extends StatusbarEntry {
  readonly id: string;
}

/**
 * Analogue of VS Code's `vs/workbench/services/statusbar/browser/
 * statusbar.ts` `IStatusbarService.addEntry()`. A generic multi-item
 * registry -- any feature can publish a status bar item without the
 * status bar component knowing about that feature. Replaces the previous
 * single-slot `IdeStatusBarContext` (`debugStatus` only).
 */
export interface IStatusbarService {
  addEntry(id: string, entry: StatusbarEntry): Disposable;
  getEntries(): readonly StatusbarEntryHandle[];
  readonly onDidChange: Event<void>;
}

export const IStatusbarService =
  createDecorator<IStatusbarService>('statusbarService');

export class StatusbarService implements IStatusbarService {
  private readonly entries = new Map<string, StatusbarEntry>();
  private readonly changeEmitter = new Emitter<void>();
  // `useSyncExternalStore` requires a stable (Object.is-equal) reference
  // between calls when nothing changed -- recomputing a fresh array on
  // every `getEntries()` call breaks that and triggers React's "getSnapshot
  // should be cached" infinite-loop guard. Cached here, invalidated only
  // when entries actually change.
  private snapshot: readonly StatusbarEntryHandle[] | undefined;

  public readonly onDidChange = this.changeEmitter.event;

  public addEntry(id: string, entry: StatusbarEntry): Disposable {
    this.entries.set(id, entry);
    this.snapshot = undefined;
    this.changeEmitter.fire();
    return {
      dispose: () => {
        if (!this.entries.delete(id)) return;
        this.snapshot = undefined;
        this.changeEmitter.fire();
      },
    };
  }

  public getEntries(): readonly StatusbarEntryHandle[] {
    if (!this.snapshot) {
      this.snapshot = [...this.entries.entries()]
        .map(([id, entry]) => ({ id, ...entry }))
        .sort((left, right) => left.priority - right.priority);
    }
    return this.snapshot;
  }
}
