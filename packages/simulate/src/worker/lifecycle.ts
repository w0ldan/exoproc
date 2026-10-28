import type { Win64Process } from '../runtime/win64-machine.js';

/**
 * Finalizes the simulated process the same way a real Windows process exit
 * would -- sets `process.exitCode`, signals every waiter on every handle to
 * this process or one of its threads, and closes its handle table (see
 * `Win64Machine.terminateProcess`/`finalizeProcessExit`). Returns `false` if
 * the process was already gone or had already exited.
 *
 * A worker entry script must call this immediately before it finishes with
 * its simulated process, typically in a `finally` block around the entry
 * body. Closing the worker afterward ensures the worker exits because the
 * simulated process exited, not the other way around.
 *
 * This is **not** wired to the host calling `worker.terminate()` on the
 * Worker itself, because it structurally cannot be: that call is the
 * JS-Worker equivalent of `kill -9` on the OS thread backing it -- once the
 * host tears it down, no code in the worker (this function included) ever
 * runs again, exactly like a real OS process killed out from under it
 * rather than exiting on its own. A graceful simulated exit is only
 * observable when the worker chooses to finish and exit by itself; if a
 * host needs to force-stop a worker, that is equivalent to `Win64Machine.
 * terminateProcess` being called from *outside* (a real `TerminateProcess`),
 * which this function is not a substitute for.
 */
export function finalizeWorkerProcess(
  process: Win64Process,
  exitCode = 0,
): boolean {
  return process.machine.terminateProcess(process.pid, exitCode);
}
