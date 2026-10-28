import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  Win64Machine,
  Win32CommandPrompt,
} from '../../packages/simulate/dist/index.js';

const waitForNodeBridge = async (machine: Win64Machine): Promise<void> => {
  if (machine.nodeHostBridge) {
    await machine.nodeHostBridge.waitForPending();
  }
};

const runNodeCommand = async (
  commandLine: string,
  machine: Win64Machine,
): Promise<CommandExecutionResultLike> => {
  const commandPrompt = new Win32CommandPrompt(machine);
  commandPrompt.execute(commandLine);
  await waitForNodeBridge(machine);
  return {
    exitCode: commandPrompt.process.lastChildExitCode,
    screenText: commandPrompt.screenText,
  };
};

interface CommandExecutionResultLike {
  readonly exitCode: number;
  readonly screenText: string;
}

describe('@exoproc/simulate node builtin', () => {
  it('runs an inline `node -e` script through the host bridge', async () => {
    const machine = new Win64Machine();
    const result = await runNodeCommand(
      'node -e "console.log(\'hello\'); process.exit(0)"',
      machine,
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.screenText, /hello/);
  });

  it('executes a script file stored on the simulated filesystem', async () => {
    const machine = new Win64Machine();
    machine.fileSystem.writeTextFile(
      'C:\\Users\\Serkan\\Documents\\hello.js',
      "console.log('from-file');\n",
    );
    const result = await runNodeCommand(
      'node C:\\Users\\Serkan\\Documents\\hello.js',
      machine,
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.screenText, /from-file/);
  });

  it('runs an async script that awaits a microtask', async () => {
    const machine = new Win64Machine();
    const result = await runNodeCommand(
      'node -e "await Promise.resolve(42); console.log(42)"',
      machine,
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.screenText, /\b42\b/);
  });

  it('propagates a non-zero process.exit code to the simulated caller', async () => {
    const machine = new Win64Machine();
    const result = await runNodeCommand('node -e "process.exit(7)"', machine);
    assert.equal(result.exitCode, 7);
  });

  it('routes console.error output through the simulated stderr handle', async () => {
    const machine = new Win64Machine();
    const result = await runNodeCommand(
      'node -e "console.error(\'boom\'); process.exit(0)"',
      machine,
    );
    assert.equal(result.exitCode, 0);
    assert.match(result.screenText, /boom/);
  });
});
