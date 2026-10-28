import readline from 'node:readline';
import type { HostConsoleScreen } from './console-screen-presenter.js';

/**
 * Bun/Node host bridge for an attached console window.
 *
 * Cursor control is delegated to the runtime's cross-platform console API.
 * No host escape-sequence format leaks into the simulated screen buffer.
 */
export class NodeConsoleScreen implements HostConsoleScreen {
  constructor(private readonly output: NodeJS.WritableStream) {}

  public clear(): void {
    readline.cursorTo(this.output, 0, 0);
    readline.clearScreenDown(this.output);
  }

  public setCursor(column: number, row: number): void {
    readline.cursorTo(this.output, column, row);
  }

  public write(text: string): void {
    this.output.write(text);
  }
}
