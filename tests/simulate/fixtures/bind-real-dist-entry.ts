/**
 * Runs inside a real worker and imports the simulator's compiled modules
 * directly, without bundling the target file.
 *
 * Demonstrates `Win32FileSystem.bindFolder`: after a host directory containing
 * compiled output is bound to a simulated path prefix, the simulated
 * filesystem shim transparently reads a real `.js` file through that path.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enterSimulatedProcess } from '../../../packages/simulate/dist/worker/enter-simulated-process.js';
import { finalizeWorkerProcess } from '../../../packages/simulate/dist/worker/lifecycle.js';
import { readFileSync } from '../../../packages/simulate/dist/worker/node-fs-shim.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const distDirectory = path.resolve(
  moduleDirectory,
  '../../../packages/simulate/dist',
);

const { process, restore } = enterSimulatedProcess({ pid: 'fabricated' });
void restore;

try {
  process.machine.fileSystem.bindFolder('C:\\SimBind', distDirectory);

  const content = readFileSync(
    'C:\\SimBind\\worker\\lifecycle.js',
    'utf8',
  ) as string;

  postMessage({
    ok: true,
    containsRealSource: content.includes('finalizeWorkerProcess'),
    length: content.length,
  });
} catch (error) {
  postMessage({
    ok: false,
    error:
      error instanceof Error
        ? `${error.message}\n${error.stack}`
        : String(error),
  });
} finally {
  finalizeWorkerProcess(process, 0);
  (globalThis as { close?: () => void }).close?.();
}
