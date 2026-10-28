import { createApi, type ExoprocApi } from '../preload/api';
import { exposeBridge, isBridgeExposed } from '../preload/bridge';
import { ShellConnection } from './ipc';

/**
 * Spawns the main process and wires the bridge. Idempotent and
 * lazy: the first caller boots the worker, everyone after it gets the
 * same connection, and nothing happens at all during SSR.
 *
 * `new URL('../main/main.ts', import.meta.url)` is what lets the bundler
 * emit `main.ts` as a separate worker chunk -- the specifier must stay
 * statically analyzable, so it cannot be lifted into a variable.
 */

let connection: ShellConnection | undefined;

export function bootstrapShell(): ShellConnection {
  if (typeof window === 'undefined') {
    throw new Error('The application shell can only be started in a browser.');
  }
  if (connection) return connection;

  const worker = new Worker(new URL('../main/main.ts', import.meta.url), {
    type: 'module',
    name: 'exoproc-main',
  });

  connection = new ShellConnection(worker);
  if (!isBridgeExposed()) exposeBridge(createApi(connection));
  return connection;
}

/** Resolves once the main process is serving. Boots it if needed. */
export function whenShellReady(): Promise<void> {
  return bootstrapShell().whenReady();
}

/**
 * The one blessed way for a workbench service to obtain `window.exoproc`:
 * boots the shell if this is the first call, then returns the bridge.
 * Services take this as a constructor parameter rather than reaching for
 * the global themselves, so their dependency on the shell is visible at
 * the call site instead of hidden inside the class.
 */
export function getExoprocApi(): ExoprocApi {
  bootstrapShell();
  return window.exoproc;
}

/** Tears the main process down. Intended for tests and hot reloads. */
export function disposeShell(): void {
  connection?.dispose();
  connection = undefined;
}
