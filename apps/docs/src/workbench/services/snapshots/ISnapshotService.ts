import { Emitter, type Event } from '@/base/common/event';
import { createDecorator } from '@/platform/instantiation/common/instantiation';
import type { ExoprocApi } from '@/shell/preload/api';
import type { SnapshotMetaDto } from '@/shell/common/channels';

/**
 * Thin wrapper over `window.exoproc.snapshot` (see `shell/main/modules/
 * vm-snapshots.ts`) -- a QEMU-style VM state snapshot manager for the
 * whole simulated machine, including the workspace filesystem (which,
 * unlike an earlier design, does NOT persist on its own -- a snapshot is
 * the only save point, see `shell/main/modules/workspace.ts`'s doc
 * comment). Snapshots are always created manually, never automatically.
 */
export interface ISnapshotService {
  list(): Promise<readonly SnapshotMetaDto[]>;
  create(name: string): Promise<SnapshotMetaDto>;
  restore(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  readonly onDidChangeList: Event<void>;
}

export const ISnapshotService =
  createDecorator<ISnapshotService>('snapshotService');

export class SnapshotService implements ISnapshotService {
  private readonly changeEmitter = new Emitter<void>();
  public readonly onDidChangeList = this.changeEmitter.event;
  private readonly unsubscribe: () => void;

  public constructor(private readonly api: ExoprocApi) {
    this.unsubscribe = api.snapshot.onDidChangeList(() =>
      this.changeEmitter.fire(),
    );
  }

  public list(): Promise<readonly SnapshotMetaDto[]> {
    return this.api.snapshot.list();
  }

  public create(name: string): Promise<SnapshotMetaDto> {
    return this.api.snapshot.create(name);
  }

  public restore(id: string): Promise<void> {
    return this.api.snapshot.restore(id);
  }

  public remove(id: string): Promise<void> {
    return this.api.snapshot.remove(id);
  }

  public dispose(): void {
    this.unsubscribe();
    this.changeEmitter.dispose();
  }
}
