import readline from 'node:readline';
import { Win32CommandPrompt } from '../src/runtime/command-prompt.js';
import { ConsoleScreenPresenter } from '../src/host/console-screen-presenter.js';
import { NodeConsoleScreen } from '../src/host/node-console-screen.js';

interface HostConsoleInput extends NodeJS.ReadableStream {
  setRawMode?: (enabled: boolean) => unknown;
}

interface HostConsoleOutput extends NodeJS.WritableStream {
  cursorTo?: unknown;
  clearScreenDown?: unknown;
}

export interface CommandPromptCLIOptions {
  readonly clearOnStart?: boolean;
}

export function startCommandPromptCLI(
  options: CommandPromptCLIOptions = {},
): void {
  const commandPrompt = new Win32CommandPrompt();
  const hostInput = process.stdin as unknown as HostConsoleInput;
  const hostOutput = process.stdout as unknown as HostConsoleOutput;
  const hasAttachedHostConsole =
    typeof hostInput.setRawMode === 'function' &&
    typeof hostOutput.cursorTo === 'function' &&
    typeof hostOutput.clearScreenDown === 'function';
  const replaceHostScreen =
    hasAttachedHostConsole && (options.clearOnStart ?? true);
  const screenPresenter = replaceHostScreen
    ? new ConsoleScreenPresenter(
        commandPrompt.process.console.videoOutput,
        new NodeConsoleScreen(hostOutput),
      )
    : undefined;
  const renderVideoOutput = () => {
    if (screenPresenter) {
      screenPresenter.present();
      commandPrompt.process.console.drainHostText();
      return;
    }
    hostOutput.write(commandPrompt.process.console.drainHostText());
  };
  renderVideoOutput();
  const stopRendering = screenPresenter
    ? commandPrompt.process.console.videoOutput.subscribe(renderVideoOutput)
    : () => {};

  const lineInput = readline.createInterface(
    hostInput,
    hostOutput,
    undefined,
    hasAttachedHostConsole,
  );

  lineInput.on('line', (line) => {
    commandPrompt.execute(line);
    if (!screenPresenter) renderVideoOutput();
    if (commandPrompt.isClosed) lineInput.close();
  });

  lineInput.on('SIGINT', () => {
    hostOutput.write('\r\n');
    lineInput.close();
  });

  lineInput.on('close', () => {
    stopRendering();
    if (screenPresenter) commandPrompt.process.console.drainHostText();
    if (hasAttachedHostConsole) hostOutput.write('\r\n');
  });
}

/**
 * Compatibility alias for callers of the previous CLI entry point.
 */
export const startVirtualOSCLI = startCommandPromptCLI;

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    const commandPrompt = new Win32CommandPrompt();
    const result = commandPrompt.execute(args.join(' '));
    const drain = () => {
      const text = commandPrompt.process.console.drainHostText();
      if (text) process.stdout.write(text);
    };
    drain();
    if (commandPrompt.nodeHostBridge) {
      commandPrompt.nodeHostBridge.waitForPending().then(() => {
        drain();
        process.exit(result.exitCode);
      });
    } else {
      process.exit(result.exitCode);
    }
  } else {
    startCommandPromptCLI();
  }
}
