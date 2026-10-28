import { Win32CommandPrompt } from '../src/runtime/command-prompt.js';

async function runCommandInSimulate(): Promise<void> {
  const args = process.argv.slice(2);
  const commandLine = args.join(' ');

  if (!commandLine) {
    console.error('Usage: bun scripts/run-cmd.ts <command>');
    console.error('Example: bun scripts/run-cmd.ts "node README.md"');
    process.exit(1);
  }

  const commandPrompt = new Win32CommandPrompt();
  commandPrompt.execute(commandLine);

  if (commandPrompt.nodeHostBridge) {
    await commandPrompt.nodeHostBridge.waitForPending();
  }

  const text = commandPrompt.process.console.drainHostText();
  if (text) {
    process.stdout.write(text);
  }
  process.exit(commandPrompt.process.lastChildExitCode);
}

runCommandInSimulate().catch((error) => {
  console.error('Simulation execution error:', error);
  process.exit(1);
});
