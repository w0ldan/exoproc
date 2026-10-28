import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Win64Machine } from '../../packages/simulate/src/runtime/win64-machine.js';
import { finalizeWorkerProcess } from '../../packages/simulate/src/worker/lifecycle.js';

/**
 * `finalizeWorkerProcess` is what a worker entry script must call on its
 * own simulated process before it lets itself close. Without it, closing the
 * JS worker leaves the simulated `Win64Process` with no
 * `exitCode`, an un-signaled process/thread handles, and an un-emptied
 * handle table, exactly as if a real process's host thread vanished
 * without it ever exiting. This proves the helper actually drives that
 * real finalization path (`Win64Machine.terminateProcess`).
 */
describe('finalizeWorkerProcess', () => {
  it('sets exitCode, signals waiters, and closes handles exactly once', () => {
    const machine = new Win64Machine();
    const process = machine.createProcess(
      {
        image: 'lifecycle-test.exe',
        path: 'C:\\Users\\Serkan\\Workspace\\lifecycle-test.exe',
      },
      { stdio: machine.createNullStdio() },
    );

    const processHandleObjectId = machine.createKernelObject({
      kind: 'process',
      targetPid: process.pid,
    });
    const waiterProcess = machine.createProcess(
      {
        image: 'waiter.exe',
        path: 'C:\\Users\\Serkan\\Workspace\\waiter.exe',
      },
      { stdio: machine.createNullStdio() },
    );
    const waiterHandle = waiterProcess.attachObject(
      processHandleObjectId,
      0,
      false,
    );

    assert.equal(process.exitCode, undefined);
    assert.equal(
      machine.isObjectSignaled(machine.getKernelObject(processHandleObjectId)!),
      false,
    );

    const result = finalizeWorkerProcess(process, 7);

    assert.equal(result, true);
    assert.equal(process.exitCode, 7);
    assert.equal(process.handles.size, 0);
    assert.equal(
      machine.isObjectSignaled(machine.getKernelObject(processHandleObjectId)!),
      true,
    );
    assert.ok(waiterProcess.handles.has(waiterHandle));

    // Real `TerminateProcess`/`ExitProcess` semantics: finalizing an
    // already-exited process is a no-op, not a second signal storm.
    assert.equal(finalizeWorkerProcess(process, 99), false);
    assert.equal(process.exitCode, 7);
  });
});
