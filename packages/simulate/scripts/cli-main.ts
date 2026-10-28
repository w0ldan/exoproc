import { Win32CommandPrompt } from '../src/runtime/command-prompt.js';
import { startCommandPromptCLI } from './cli.js';

const args = process.argv.slice(2);
if (args.length === 0) {
  startCommandPromptCLI();
} else {
  const commandPrompt = new Win32CommandPrompt();
  commandPrompt.execute(args.join(' '));
  const drain = () => {
    const text = commandPrompt.process.console.drainHostText();
    if (text) process.stdout.write(text);
  };
  drain();
  if (commandPrompt.nodeHostBridge) {
    await commandPrompt.nodeHostBridge.waitForPending();
    drain();
  }
  process.exit(commandPrompt.process.lastChildExitCode);
}
