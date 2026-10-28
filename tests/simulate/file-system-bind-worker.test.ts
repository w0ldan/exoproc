import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

interface WorkerReport {
  readonly ok: boolean;
  readonly error?: string;
  readonly containsRealSource?: boolean;
  readonly length?: number;
}

/**
 * End-to-end proof of `Win32FileSystem.bindFolder`: a normal build produces
 * compiled `.js` files on the host filesystem; a worker enters the simulation,
 * binds that output directory to a simulated path, and reads a compiled file
 * through the simulated `node:fs` implementation. The target file remains a
 * regular host file and is not bundled into the worker.
 */
describe('Win32FileSystem folder binds: real compiled dist/ through a simulated path', () => {
  it('reads a real dist/worker/lifecycle.js file via a bound simulated path, inside a Worker', async () => {
    const fixturePath = path.resolve(
      moduleDirectory,
      'fixtures/bind-real-dist-entry.ts',
    );
    const worker = new Worker(new URL(`file://${fixturePath}`).href);

    const report = await new Promise<WorkerReport>((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(
          new Error('bind-real-dist-entry worker did not report back in time'),
        );
      }, 15000);
      worker.addEventListener('message', (event) => {
        clearTimeout(timeout);
        resolve(event.data as WorkerReport);
      });
      worker.addEventListener('error', (event) => {
        clearTimeout(timeout);
        reject(
          (event as ErrorEvent).error ??
            new Error((event as ErrorEvent).message ?? 'worker error'),
        );
      });
    });
    worker.terminate();

    assert.equal(report.ok, true, report.error ?? 'expected ok: true');
    assert.equal(report.containsRealSource, true);
    assert.ok((report.length ?? 0) > 0);
  });
});
