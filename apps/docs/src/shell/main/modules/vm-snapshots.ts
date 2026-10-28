import { Win64Machine } from 'win32-simulate';
import { SnapshotChannel, type SnapshotMetaDto } from '../../common/channels';
import { ipc } from '../ipc';
import { SnapshotStore } from '../snapshots/snapshot-store';
import { closeAllTerminalSessions } from './terminal';
import { getMachine, notifyProcessesChanged, replaceMachine } from './machine';
import { reattachAfterRestore } from './vm-snapshot-reattach';

/**
 * QEMU-style VM snapshot manager: named, listed, restorable, deletable
 * checkpoints of the whole `Win64Machine` (see that class's `snapshot()`/
 * `restore()`), stored permanently in the browser via `SnapshotStore`
 * (IndexedDB). Snapshot creation is always manual, from the "VM Snapshots"
 * tab -- there is no automatic snapshot-on-close.
 */

let storePromise: Promise<SnapshotStore> | undefined;
function store(): Promise<SnapshotStore> {
  return (storePromise ??= SnapshotStore.open());
}

export function registerSnapshotHandlers(): void {
  ipc.handle(SnapshotChannel.list, async () => (await store()).list());

  ipc.handle(SnapshotChannel.create, async (name: string) => {
    const machine = getMachine();
    const warnings = machine.getSnapshotWarnings();
    const blob = machine.snapshot();
    const meta: SnapshotMetaDto = await (
      await store()
    ).create(name, blob, warnings);
    ipc.send(SnapshotChannel.onDidChangeList, undefined);
    return meta;
  });

  ipc.handle(SnapshotChannel.restore, async (id: string) => {
    const blob = await (await store()).get(id);
    if (!blob) throw new Error(`"${id}" kimlikli snapshot bulunamadı.`);
    // Detach live cmd.exe sessions from the about-to-be-discarded machine
    // BEFORE the swap -- see `closeAllTerminalSessions`'s own doc comment.
    closeAllTerminalSessions();
    const restored = Win64Machine.restore(blob, {
      enableNodeHostBridge: false,
    });
    replaceMachine(restored);
    reattachAfterRestore(restored);
    notifyProcessesChanged();
  });

  ipc.handle(SnapshotChannel.remove, async (id: string) => {
    await (await store()).delete(id);
    ipc.send(SnapshotChannel.onDidChangeList, undefined);
  });
}
