import { Win64Machine, type Win64Process } from '../runtime/win64-machine.js';
import { bindWin64Process } from '../runtime/bun-ffi.js';
import { installProcessShim } from './process-shim.js';

export interface EnterSimulatedProcessOptions {
  /** Reuse an existing machine (e.g. `getGlobalWin64Machine()`) instead of
   * booting a fresh, private one. */
  readonly machine?: Win64Machine;
  readonly image?: string;
  readonly path?: string;
  /** Whether to expose the simulated pid/environment through host globals. */
  readonly installProcessGlobals?: boolean;
  /**
   * `'host'`: the simulated process is registered under the current host
   * process's own `process.pid`. The host enters the simulation as itself,
   * with no worker realm isolating the two. FFI, filesystem, and environment
   * operations routed through the installed shims all target this simulated
   * process through the caller's own globals.
   *
   * `'fabricated'`: the simulated process gets its own PID from the
   * machine's normal allocator, unrelated to whatever real OS process
   * happens to be running the JS that called this (a Worker's own thread,
   * say) -- the current behavior every worker entry script used before this
   * function existed.
   *
   * There is no default: call sites must say which they mean.
   */
  readonly pid: 'host' | 'fabricated';
}

export interface EnterSimulatedProcessHandle {
  readonly machine: Win64Machine;
  readonly process: Win64Process;
  /** Restores the host `process.pid`/`process.env` and unbinds the active FFI
   * process context. Does not remove the `Win64Process` from the
   * machine -- leaving a simulated process around after "exiting" it is
   * harmless bookkeeping, the same way a real process stays in a process
   * list's history until something reaps it. */
  restore(): void;
}

/**
 * Bootstraps code that uses the simulator's process and FFI facilities:
 * create (or reuse) a `Win64Machine`, register a `Win64Process` for the
 * calling context, bind the FFI bridge, and install ambient
 * `process.pid`/`process.env` shims. The simulated Windows process remains
 * consistent in either supported execution mode:
 *
 *  - **inside a Worker** (`pid: 'fabricated'`): the Worker's own realm is
 *    the isolation boundary -- nothing outside it is affected, so the
 *    simulated process can have any PID the machine likes.
 *  - **directly in the calling process, no Worker at all** (`pid: 'host'`):
 *    there is no separate realm to contain the effect of overriding
 *    `process.env`, so this makes the simulated process *be* the real,
 *    currently-running process (same PID) rather than pretending a
 *    fabricated second process exists alongside it. This lets in-process
 *    callers use the simulator without introducing a worker boundary.
 *
 * A static top-level import of any module that captures process or FFI state
 * must not precede this call because it would be evaluated first. Enter the
 * simulated process, then dynamically import the dependent module.
 */
export function enterSimulatedProcess(
  options: EnterSimulatedProcessOptions,
): EnterSimulatedProcessHandle {
  const machine = options.machine ?? new Win64Machine();
  const image = options.image ?? 'node.exe';
  const path = options.path ?? `C:\\Program Files\\nodejs\\${image}`;

  const process = machine.createProcess(
    { image, path },
    {
      stdio: machine.createNullStdio(),
      pid: options.pid === 'host' ? globalThis.process.pid : undefined,
    },
  );

  const processShim =
    options.installProcessGlobals === false
      ? undefined
      : installProcessShim(process);
  const restoreFfi = bindWin64Process(process);

  return {
    machine,
    process,
    restore: () => {
      restoreFfi();
      processShim?.restore();
    },
  };
}
