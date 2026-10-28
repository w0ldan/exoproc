import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { enterSimulatedProcess } from '../../packages/simulate/dist/worker/enter-simulated-process.js';
import { Win32CommandPrompt } from '../../packages/simulate/dist/index.js';

describe('Workspace File System Binding & Node Execution', () => {
  it('starts in the bound project root and exposes it to node', async () => {
    const handle = enterSimulatedProcess({ pid: 'host' });
    try {
      const machine = handle.machine;
      const commandPrompt = new Win32CommandPrompt(machine);

      assert.equal(
        commandPrompt.process.currentDirectory,
        'C:\\Users\\Serkan\\Workspace',
      );
      commandPrompt.execute(
        `node -e "console.log(require('fs').readdirSync('.').includes('package.json'))"`,
      );
      if (machine.nodeHostBridge) {
        await machine.nodeHostBridge.waitForPending();
      }

      assert.match(commandPrompt.screenText, /true/);
    } finally {
      handle.restore();
    }
  });
});
