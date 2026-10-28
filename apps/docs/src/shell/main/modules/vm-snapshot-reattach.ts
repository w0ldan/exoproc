import { type Win64Machine } from 'win32-simulate';
import { bootExoprocIdeProcess } from './js-host-programs';
import { registerNodeSyscalls } from './node-syscalls';
import { initializeWorkspace } from './workspace';

const EXOPROC_IDE_IMAGE = 'exoproc-ide.exe';

/**
 * Everything `apps/docs` owns that `Win64Machine.restore()` deliberately
 * leaves for the host to reattach (see `Win64Machine.snapshot()`'s own doc
 * comment for the full "must never be serialized" list): the `node.dll`
 * syscall handlers, the workspace root, and -- conditionally --
 * `exoproc-ide.exe` itself. `fileSystem` content itself needs no
 * reattaching at all -- it came back from the snapshot directly (see
 * `Win32FileSystem.restoreState`) -- only the app-level "which absolute
 * path is the workspace root pointed at" state `workspace.ts` tracks
 * separately needs resetting, since the path selected before the restore
 * may not exist in the just-restored filesystem.
 *
 * Must NEVER call `registerJsHostPrograms()`/any `registerXHandlers()`
 * again: `ipc.handle()` throws on a duplicate channel registration ("a
 * bug, not a merge" -- see `shell/main/ipc.ts`), and every one of this
 * app's IPC handlers was already registered exactly once, synchronously,
 * at the Worker's original `main.ts` boot -- restoring the machine
 * singleton has no bearing on that separate, still-live registry at all.
 */
export function reattachAfterRestore(machine: Win64Machine): void {
  // Fresh registration against the NEW machine's own (private) syscall
  // handler map -- unrelated to `ipc.handle`'s registry, safe and required
  // every time a machine is (re)constructed.
  registerNodeSyscalls(machine);

  initializeWorkspace();

  // The snapshot's own `exoproc-ide.exe` process (if the machine that was
  // snapshotted had already booted one -- which it always has, in any real
  // session) survives `Win64Machine.restore()` as perfectly ordinary
  // process/thread data -- nothing in `snapshot()` special-cases it. Its
  // thread's park state (parked inside `enterJSProcess` on a
  // `nodeInvocation` kernel object) is faithfully reconstructed too, but is
  // permanently inert from this point on: nothing will ever call
  // `terminateJSProcess`/resolve that specific object again -- the real
  // "IDE is alive" responsibility was never tied to that process object,
  // it's tied to this Worker's own `ipc.handle` registry, untouched by any
  // of this. Booting a second one would just be redundant clutter in the
  // Debugger's process list, not a correctness issue -- this check exists
  // purely to avoid that clutter.
  const alreadyBooted = machine
    .getProcesses()
    .some((process) => process.image.toLowerCase() === EXOPROC_IDE_IMAGE);
  if (!alreadyBooted) {
    bootExoprocIdeProcess(machine);
  }
}
