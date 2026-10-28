import {
  DEFAULT_CONSOLE_ATTRIBUTE,
  Win32VideoOutput,
} from '../runtime/video-output.js';

const ASCII_SPACE = 0x20;

/**
 * Host-side drawing surface. This is deliberately smaller than any platform
 * API so the simulated Windows console buffer does not depend on the host
 * presentation mechanism.
 */
export interface HostConsoleScreen {
  clear(): void;
  setCursor(column: number, row: number): void;
  write(text: string): void;
}

/**
 * Windows attribute byte (4-bit background, 4-bit foreground, each a 3-bit
 * RGB index plus intensity) as an ANSI SGR escape sequence. Real terminals
 * (a TTY via `NodeConsoleScreen`, xterm.js) already interpret SGR codes, so
 * embedding them in the text handed to `HostConsoleScreen.write()` renders
 * correctly on both without teaching `HostConsoleScreen` a new capability --
 * this is purely how the *host* chooses to represent an attribute byte, not
 * something that leaks into the simulated framebuffer itself.
 */
function ansiSgrForAttribute(attribute: number): string {
  // Windows RGB bit order is B,G,R (bit0=Blue); ANSI's is R,G,B (bit0=Red).
  const toAnsiIndex = (bits: number) =>
    ((bits & 0b100) >> 2) | (bits & 0b010) | ((bits & 0b001) << 2);
  const foregroundIndex = toAnsiIndex(attribute & 0x07);
  const foregroundBright = (attribute & 0x08) !== 0;
  const foregroundCode = (foregroundBright ? 90 : 30) + foregroundIndex;
  const backgroundBits = (attribute >> 4) & 0x0f;
  // Plain black (bg=0, not intensified) is cmd's default background. Render
  // it as the host terminal's own default (SGR 49) instead of painting an
  // explicit black rectangle over the user's terminal theme/transparency --
  // only a genuinely non-default background gets an explicit color.
  const backgroundCode =
    backgroundBits === 0
      ? 49
      : (backgroundBits & 0x08 ? 100 : 40) + toAnsiIndex(backgroundBits & 0x07);
  return `\x1b[0;${foregroundCode};${backgroundCode}m`;
}

/**
 * Presents a Windows console framebuffer through a host drawing surface.
 *
 * The first presentation clears the host screen. Later revisions update only
 * changed cell spans (character or attribute) and finally synchronize the
 * visible cursor.
 */
export class ConsoleScreenPresenter {
  private previousCells?: Uint8Array;
  private previousAttributes?: Uint8Array;
  private previousCursorColumn = -1;
  private previousCursorRow = -1;
  private lastEmittedAttribute?: number;

  constructor(
    private readonly videoOutput: Win32VideoOutput,
    private readonly hostScreen: HostConsoleScreen,
  ) {}

  public present(): void {
    const cells = this.videoOutput.snapshot();
    const attributes = this.videoOutput.snapshotAttributes();
    const cursor = this.videoOutput.cursor;
    const firstPresentation = !this.previousCells;
    const previousCells =
      this.previousCells ??
      new Uint8Array(this.videoOutput.columns * this.videoOutput.rows).fill(
        ASCII_SPACE,
      );
    const previousAttributes =
      this.previousAttributes ??
      new Uint8Array(this.videoOutput.columns * this.videoOutput.rows).fill(
        DEFAULT_CONSOLE_ATTRIBUTE,
      );

    if (firstPresentation) {
      this.hostScreen.clear();
      this.lastEmittedAttribute = undefined;
    }

    let cellsChanged = false;
    for (let row = 0; row < this.videoOutput.rows; row += 1) {
      const rowOffset = row * this.videoOutput.columns;
      let firstChangedColumn = -1;
      let lastChangedColumn = -1;

      for (let column = 0; column < this.videoOutput.columns; column += 1) {
        const offset = rowOffset + column;
        if (
          cells[offset] === previousCells[offset] &&
          attributes[offset] === previousAttributes[offset]
        ) {
          continue;
        }
        if (firstChangedColumn < 0) firstChangedColumn = column;
        lastChangedColumn = column;
      }

      if (firstChangedColumn < 0) continue;
      cellsChanged = true;
      this.hostScreen.setCursor(firstChangedColumn, row);

      let segment = '';
      for (
        let column = firstChangedColumn;
        column <= lastChangedColumn;
        column += 1
      ) {
        const offset = rowOffset + column;
        const attribute = attributes[offset] ?? DEFAULT_CONSOLE_ATTRIBUTE;
        if (attribute !== this.lastEmittedAttribute) {
          segment += ansiSgrForAttribute(attribute);
          this.lastEmittedAttribute = attribute;
        }
        segment += String.fromCharCode(cells[offset] ?? ASCII_SPACE);
      }
      this.hostScreen.write(segment);
    }

    if (
      firstPresentation ||
      cellsChanged ||
      cursor.column !== this.previousCursorColumn ||
      cursor.row !== this.previousCursorRow
    ) {
      this.hostScreen.setCursor(cursor.column, cursor.row);
    }

    this.previousCells = cells;
    this.previousAttributes = attributes;
    this.previousCursorColumn = cursor.column;
    this.previousCursorRow = cursor.row;
  }

  public reset(): void {
    this.previousCells = undefined;
    this.previousAttributes = undefined;
    this.previousCursorColumn = -1;
    this.previousCursorRow = -1;
    this.lastEmittedAttribute = undefined;
  }
}
