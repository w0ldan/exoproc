import {
  Win64Machine,
  type Win64Process,
  type Win64Thread,
} from 'win32-simulate';
import { MachineChannel } from '../../common/channels';
import { ipc } from '../ipc';
import { registerNodeSyscalls } from './node-syscalls';
import { toProcessSnapshotDto } from './snapshot';

/**
 * Owns the simulated machine.
 *
 * This module -- and the sibling modules that import from it -- is the
 * only part of the browser-side application that touches the simulation
 * engine at all. Everything above the boundary sees process and thread
 * *snapshots*, never the objects themselves, so there is no path by
 * which a live engine object can reach the UI.
 *
 * Constructed directly (`new Win64Machine(...)`) rather than through
 * `getGlobalWin64Machine()`, specifically to pass `enableNodeHostBridge:
 * false`: that bridge spawns a real `node:worker_threads` worker on a
 * real Node.js host, something no browser context (Worker or not) can
 * ever provide. `registerNodeSyscalls` (see `node-syscalls.ts`) installs
 * this app's own browser-native replacement for the three `node.dll`
 * syscalls that bridge would otherwise have owned, so `node.exe` -- a
 * real compiled guest program, installed regardless of the disabled
 * bridge -- works correctly for *any* guest-initiated launch, not just
 * commands typed into one terminal. This divergence from the shared
 * accessor is safe: `getGlobalWin64Machine()` is itself realm-scoped (a
 * `globalThis` key), so this Worker never shared that singleton with
 * anything outside it to begin with.
 */

let machine: Win64Machine | undefined;

export function getMachine(): Win64Machine {
  if (!machine) {
    machine = new Win64Machine({ enableNodeHostBridge: false });
    registerNodeSyscalls(machine);
  }
  return machine;
}

/**
 * Swaps the singleton for a `Win64Machine.restore()`-produced instance
 * (VM snapshot restore, see `vm-snapshots.ts`). The caller is responsible
 * for reattaching everything the engine's own `restore()` deliberately
 * leaves out -- `node.dll` syscalls, the workspace root (reset to a
 * location guaranteed to exist in the restored filesystem), and the
 * `exoproc-ide.exe` boot check (`vm-snapshot-reattach.ts`).
 */
export function replaceMachine(next: Win64Machine): void {
  machine = next;
}

/** Throws rather than returning `undefined`: a bad pid is a caller bug. */
export function requireProcess(pid: number): Win64Process {
  const found = getMachine().getProcess(pid);
  if (!found) throw new Error(`No process with pid ${pid}.`);
  return found;
}

export function requireThread(pid: number, tid: number): Win64Thread {
  const found = requireProcess(pid).getThread(tid);
  if (!found) throw new Error(`No thread ${tid} in process ${pid}.`);
  return found;
}

/** Lets other modules announce a spawn/exit without owning the channel. */
export function notifyProcessesChanged(): void {
  ipc.send(MachineChannel.onDidChangeProcesses, undefined);
}

export function registerMachineHandlers(): void {
  ipc.handle(MachineChannel.listProcesses, () =>
    getMachine().getProcesses().map(toProcessSnapshotDto),
  );

  ipc.handle(MachineChannel.getProcess, (pid: number) => {
    const found = getMachine().getProcess(pid);
    return found ? toProcessSnapshotDto(found) : undefined;
  });

  ipc.handle(MachineChannel.createDemoProcess, () => {
    const created = getMachine().createLoopProcess();
    notifyProcessesChanged();
    return toProcessSnapshotDto(created);
  });
}
