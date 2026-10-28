import { compileJsHostProgram, type Win64Machine } from 'win32-simulate';
import { registerAppHandlers } from '../lifecycle';
import { registerDebugHandlers } from './debug';
import { registerFsHandlers } from './fs';
import { registerMachineHandlers } from './machine';
import { registerMemoryHandlers } from './memory';
import { registerJsHostProgram, readArgv } from './node-syscalls';
import { runNodeEval, runNodeScript } from './node-runner';
import { registerScanHandlers } from './scan';
import { registerTerminalHandlers } from './terminal';
import { registerSnapshotHandlers } from './vm-snapshots';
import { initializeWorkspace, registerWorkspaceHandlers } from './workspace';

const EXOPROC_IDE_IMAGE = 'exoproc-ide.exe';
const ENCODER = new TextEncoder();

/**
 * Registers the two named JS-backed guest programs this app relies on
 * (see `node-syscalls.ts` for the generic `enterJSProcess` dispatch
 * machinery both are reached through):
 *
 * - `node.exe` -- runs a script (or, with `-e`, an inline snippet) through
 *   `node-runner.ts`'s browser ES-module runner, reached because
 *   `node.exe` is a real compiled guest program and this is what its own
 *   `enterJSProcess` call resolves to.
 * - `exoproc-ide.exe` -- not a script at all. Its callback's entire job
 *   is registering every IPC handler this app serves (`shell/main/main.ts`
 *   spawns it once at boot instead of calling each `registerXHandlers()`
 *   directly) -- see `bootExoprocIdeProcess` for why that's safe to rely
 *   on synchronously despite the callback itself being async -- plus
 *   `initializeWorkspace()` to set the default workspace root (purely
 *   synchronous now that the filesystem has no async host-bind setup to
 *   wait on -- see that function's own doc comment for why nothing here
 *   auto-persists across a reload anymore).
 */
export function registerJsHostPrograms(): void {
  registerJsHostProgram('node.exe', async (process, argc, argvPointer) => {
    const args = readArgv(process, argvPointer, argc).slice(1);
    const write = (text: string) => process.console.write(ENCODER.encode(text));

    if (args[0] === '-e') {
      const code = parseEvalArgument(args[1]);
      if (code === undefined) {
        write("node: '-e' bir argüman gerektirir.\r\n");
        return { exitCode: 1 };
      }
      return runNodeEval(code, write, process);
    }

    const scriptArgument = args[0];
    if (!scriptArgument) {
      write('node: çalıştırılacak betik verilmedi.\r\n');
      return { exitCode: 1 };
    }
    return runNodeScript(scriptArgument, write, process);
  });

  registerJsHostProgram(EXOPROC_IDE_IMAGE, async () => {
    registerAppHandlers();
    registerMachineHandlers();
    registerDebugHandlers();
    registerMemoryHandlers();
    registerScanHandlers();
    registerWorkspaceHandlers();
    registerFsHandlers();
    registerTerminalHandlers();
    registerSnapshotHandlers();
    initializeWorkspace();
    // Never resolves: `exoproc-ide.exe` represents the running IDE itself
    // for as long as this Worker is alive, not a command that finishes.
    // Its guest thread stays parked -- a real, inspectable, permanently
    // "running" process in `machine.getProcesses()` -- rather than
    // reaching `ExitProcess` the moment registration is done.
    return new Promise<never>(() => {});
  });
}

/** Mirrors `NodeHostBridge`'s own `-e` handling: strip one layer of matching quotes, then unescape `\"`/`\'`. */
function parseEvalArgument(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let code = raw;
  if (
    (code.startsWith("'") && code.endsWith("'")) ||
    (code.startsWith('"') && code.endsWith('"'))
  ) {
    code = code.slice(1, -1);
  }
  return code.replace(/\\+"/g, '"').replace(/\\+'/g, "'");
}

/**
 * Compiles and spawns `exoproc-ide.exe`, driving it synchronously up to
 * its own parking point inside `enterJSProcess`.
 *
 * This is safe to treat as "every handler is registered by the time this
 * returns" even though the registered callback above is `async`: the
 * callback function's body runs synchronously the moment `enterJSProcess`
 * invokes it (JS only defers a function's *return value* -- wrapping it
 * in a Promise -- never the synchronous statements before its first
 * `await`/`return`), and this callback has no `await` before its
 * `registerXHandlers()` calls. Only the callback's own eventual
 * *resolution* is deferred to a microtask, and here it never resolves at
 * all, so nothing downstream ever depends on that.
 */
export function bootExoprocIdeProcess(machine: Win64Machine): void {
  const program = compileJsHostProgram(EXOPROC_IDE_IMAGE);
  const process = machine.createProcess({
    image: EXOPROC_IDE_IMAGE,
    path: `C:\\Windows\\System32\\${EXOPROC_IDE_IMAGE}`,
  });
  const loaded = machine.programs.load(process, program);
  const thread = process.createThread(
    `${EXOPROC_IDE_IMAGE} main thread`,
    loaded.entryPoint,
  );
  machine.scheduler.enqueue(thread);
  machine.pumpScheduler();
}
