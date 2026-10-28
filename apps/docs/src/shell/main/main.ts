/// <reference lib="webworker" />

/**
 * Main-process entry point. Runs inside a Web Worker, off the UI thread.
 *
 * This is the only place in the application that is permitted to reach
 * for the simulation engine (see the `no-restricted-imports` boundary in
 * `eslint.config.mjs`). Everything above it -- every service, every
 * component -- sees only the typed surface exposed on `window.exoproc`
 * and cannot tell what is behind it.
 *
 * Every IPC handler this app serves is registered as a side effect of
 * spawning `exoproc-ide.exe` -- a real compiled guest program (see
 * `modules/js-host-programs.ts`) that "is" this running IDE for as long
 * as this Worker lives, the same way `node.exe` is a real guest program
 * for running scripts. Nothing above this file can tell the difference:
 * `getMachine()` and `bootExoprocIdeProcess()` both run synchronously, so
 * every handler is registered before `startIpc()` ever processes a
 * message.
 */

import { startIpc, signalReady } from './ipc';
import {
  bootExoprocIdeProcess,
  registerJsHostPrograms,
} from './modules/js-host-programs';
import { getMachine } from './modules/machine';

// Imported for its side effect: fails the build if the wire contract and
// the engine's own types have drifted apart.
import './modules/conformance';

registerJsHostPrograms();
bootExoprocIdeProcess(getMachine());

startIpc();
signalReady();
