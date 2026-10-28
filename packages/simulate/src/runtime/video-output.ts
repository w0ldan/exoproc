export interface Win32VideoOutputOptions {
  readonly columns?: number;
  readonly rows?: number;
}

export interface Win32VideoWriteOptions {
  readonly processedOutput?: boolean;
}

export interface Win32VideoCursor {
  readonly column: number;
  readonly row: number;
}

export type Win32VideoOutputListener = (output: Win32VideoOutput) => void;

const ASCII_SPACE = 0x20;
const ASCII_REPLACEMENT = 0x3f;

/**
 * 16-color text-mode attribute bits, matching the real Win32 console API
 * (`SetConsoleTextAttribute` et al.) -- foreground in the low nibble,
 * background in the high nibble, each a 3-bit RGB index plus an intensity
 * bit. Not a WORD's full `COMMON_LVB_*` surface (reverse video, underline,
 * DBCS leading/trailing byte) -- just the 16-color part.
 */
export const FOREGROUND_BLUE = 0x01;
export const FOREGROUND_GREEN = 0x02;
export const FOREGROUND_RED = 0x04;
export const FOREGROUND_INTENSITY = 0x08;
export const BACKGROUND_BLUE = 0x10;
export const BACKGROUND_GREEN = 0x20;
export const BACKGROUND_RED = 0x40;
export const BACKGROUND_INTENSITY = 0x80;

/** Light gray on black -- the real console's default screen attribute. */
export const DEFAULT_CONSOLE_ATTRIBUTE =
  FOREGROUND_RED | FOREGROUND_GREEN | FOREGROUND_BLUE;

/**
 * Fixed-size ASCII text-mode framebuffer.
 *
 * The buffer is the display state: it does not retain an unbounded console
 * transcript. Writes update cells at the cursor, wrap at the configured width
 * and scroll the framebuffer when the cursor passes the final row.
 */
export class Win32VideoOutput {
  public readonly columns: number;
  public readonly rows: number;
  private readonly cells: Uint8Array;
  private readonly attributes: Uint8Array;
  private currentAttribute = DEFAULT_CONSOLE_ATTRIBUTE;
  private cursorColumn = 0;
  private cursorRow = 0;
  private readonly listeners = new Set<Win32VideoOutputListener>();
  private mutationDepth = 0;
  private mutationPending = false;
  private currentRevision = 0;

  constructor(options: Win32VideoOutputOptions = {}) {
    this.columns = options.columns ?? 80;
    this.rows = options.rows ?? 25;
    if (
      !Number.isSafeInteger(this.columns) ||
      this.columns <= 0 ||
      !Number.isSafeInteger(this.rows) ||
      this.rows <= 0
    ) {
      throw new RangeError(
        `Invalid text mode dimensions: ${this.columns}x${this.rows}`,
      );
    }
    this.cells = new Uint8Array(this.columns * this.rows);
    this.cells.fill(ASCII_SPACE);
    this.attributes = new Uint8Array(this.columns * this.rows);
    this.attributes.fill(DEFAULT_CONSOLE_ATTRIBUTE);
  }

  public get cursor(): Win32VideoCursor {
    return {
      column: this.cursorColumn,
      row: this.cursorRow,
    };
  }

  /** The attribute new character writes are stamped with (`SetConsoleTextAttribute`). */
  public get attribute(): number {
    return this.currentAttribute;
  }

  /** Sets the pen color for future writes; does not touch existing cells. */
  public setAttribute(attribute: number): void {
    this.currentAttribute = attribute & 0xff;
  }

  public get revision(): number {
    return this.currentRevision;
  }

  /**
   * Observes committed framebuffer mutations. A multi-byte write is published
   * as one change, including writes containing processed console controls.
   */
  public subscribe(listener: Win32VideoOutputListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public write(
    bytes: Uint8Array,
    options: Win32VideoWriteOptions = {},
  ): number {
    const processedOutput = options.processedOutput ?? true;
    this.beginMutation();
    try {
      for (let index = 0; index < bytes.length; index += 1) {
        const byte = bytes[index] ?? 0;
        if (!processedOutput) {
          this.put(byte >= 0x20 && byte <= 0x7e ? byte : ASCII_REPLACEMENT);
          continue;
        }

        switch (byte) {
          case 0x08:
            this.backspace();
            break;
          case 0x09:
            this.tab();
            break;
          case 0x0a:
            this.lineFeed();
            break;
          case 0x0d:
            if (this.cursorColumn !== 0) {
              this.cursorColumn = 0;
              this.markChanged();
            }
            break;
          default:
            this.put(byte >= 0x20 && byte <= 0x7e ? byte : ASCII_REPLACEMENT);
        }
      }
    } finally {
      this.endMutation();
    }
    return bytes.length;
  }

  public clear(): void {
    this.beginMutation();
    try {
      if (
        this.cursorColumn !== 0 ||
        this.cursorRow !== 0 ||
        this.cells.some((cell) => cell !== ASCII_SPACE) ||
        this.attributes.some(
          (attribute) => attribute !== DEFAULT_CONSOLE_ATTRIBUTE,
        )
      ) {
        this.cells.fill(ASCII_SPACE);
        this.attributes.fill(DEFAULT_CONSOLE_ATTRIBUTE);
        this.currentAttribute = DEFAULT_CONSOLE_ATTRIBUTE;
        this.cursorColumn = 0;
        this.cursorRow = 0;
        this.markChanged();
      }
    } finally {
      this.endMutation();
    }
  }

  public setCursor(column: number, row: number): void {
    const nextColumn = Math.max(
      0,
      Math.min(this.columns - 1, Math.trunc(column)),
    );
    const nextRow = Math.max(0, Math.min(this.rows - 1, Math.trunc(row)));
    if (nextColumn === this.cursorColumn && nextRow === this.cursorRow) {
      return;
    }
    this.cursorColumn = nextColumn;
    this.cursorRow = nextRow;
    this.markChanged();
  }

  public fill(byte: number, length: number, column = 0, row = 0): number {
    const startColumn = Math.trunc(column);
    const startRow = Math.trunc(row);
    if (
      startColumn < 0 ||
      startColumn >= this.columns ||
      startRow < 0 ||
      startRow >= this.rows
    ) {
      return 0;
    }
    const start = startRow * this.columns + startColumn;
    const available = Math.max(0, this.cells.length - start);
    const written = Math.min(available, Math.max(0, Math.trunc(length)));
    if (written === 0) return 0;

    const value = byte >= 0x20 && byte <= 0x7e ? byte : ASCII_REPLACEMENT;
    if (
      !this.cells
        .subarray(start, start + written)
        .some((cell) => cell !== value)
    ) {
      return written;
    }
    this.beginMutation();
    try {
      this.cells.fill(value, start, start + written);
      this.markChanged();
    } finally {
      this.endMutation();
    }
    return written;
  }

  /**
   * Fills a run of cells' attributes without touching their characters --
   * the real `FillConsoleOutputAttribute` semantics, distinct from `fill()`.
   */
  public fillAttribute(
    attribute: number,
    length: number,
    column = 0,
    row = 0,
  ): number {
    const startColumn = Math.trunc(column);
    const startRow = Math.trunc(row);
    if (
      startColumn < 0 ||
      startColumn >= this.columns ||
      startRow < 0 ||
      startRow >= this.rows
    ) {
      return 0;
    }
    const start = startRow * this.columns + startColumn;
    const available = Math.max(0, this.attributes.length - start);
    const written = Math.min(available, Math.max(0, Math.trunc(length)));
    if (written === 0) return 0;

    const value = attribute & 0xff;
    if (
      !this.attributes
        .subarray(start, start + written)
        .some((existing) => existing !== value)
    ) {
      return written;
    }
    this.beginMutation();
    try {
      this.attributes.fill(value, start, start + written);
      this.markChanged();
    } finally {
      this.endMutation();
    }
    return written;
  }

  public getCell(column: number, row: number): number {
    if (column < 0 || column >= this.columns || row < 0 || row >= this.rows) {
      throw new RangeError(
        `Video cell is outside ${this.columns}x${this.rows}: ${column},${row}`,
      );
    }
    return this.cells[row * this.columns + column] ?? ASCII_SPACE;
  }

  public getCellAttribute(column: number, row: number): number {
    if (column < 0 || column >= this.columns || row < 0 || row >= this.rows) {
      throw new RangeError(
        `Video cell is outside ${this.columns}x${this.rows}: ${column},${row}`,
      );
    }
    return (
      this.attributes[row * this.columns + column] ?? DEFAULT_CONSOLE_ATTRIBUTE
    );
  }

  public snapshot(): Uint8Array {
    return this.cells.slice();
  }

  public snapshotAttributes(): Uint8Array {
    return this.attributes.slice();
  }

  /**
   * Human-readable viewport. Storage remains fixed-size; only trailing spaces
   * and empty rows are omitted from this convenience representation.
   */
  public toString(): string {
    const lines = this.lines(true);
    while (lines.length > 0 && lines.at(-1) === '') {
      lines.pop();
    }
    return lines.join('\r\n');
  }

  private lines(trimRight: boolean): string[] {
    const lines: string[] = [];
    for (let row = 0; row < this.rows; row += 1) {
      const start = row * this.columns;
      const decoded = new TextDecoder().decode(
        this.cells.subarray(start, start + this.columns),
      );
      lines.push(trimRight ? decoded.replace(/ +$/g, '') : decoded);
    }
    return lines;
  }

  private put(byte: number): void {
    const offset = this.cursorRow * this.columns + this.cursorColumn;
    this.cells[offset] = byte;
    this.attributes[offset] = this.currentAttribute;
    this.cursorColumn += 1;
    this.markChanged();
    if (this.cursorColumn >= this.columns) {
      this.cursorColumn = 0;
      this.lineFeed();
    }
  }

  private lineFeed(): void {
    this.cursorRow += 1;
    this.markChanged();
    if (this.cursorRow >= this.rows) {
      this.scroll();
      this.cursorRow = this.rows - 1;
    }
  }

  private backspace(): void {
    if (this.cursorColumn > 0) {
      this.cursorColumn -= 1;
      this.markChanged();
    } else if (this.cursorRow > 0) {
      this.cursorRow -= 1;
      this.cursorColumn = this.columns - 1;
      this.markChanged();
    }
  }

  private tab(): void {
    const nextStop = Math.floor(this.cursorColumn / 8 + 1) * 8;
    const spaces = Math.max(1, nextStop - this.cursorColumn);
    for (let index = 0; index < spaces; index += 1) {
      this.put(ASCII_SPACE);
    }
  }

  private scroll(): void {
    const rowSize = this.columns;
    this.cells.copyWithin(0, rowSize);
    this.cells.fill(ASCII_SPACE, this.cells.length - rowSize);
    this.attributes.copyWithin(0, rowSize);
    this.attributes.fill(
      DEFAULT_CONSOLE_ATTRIBUTE,
      this.attributes.length - rowSize,
    );
  }

  private beginMutation(): void {
    this.mutationDepth += 1;
  }

  private markChanged(): void {
    this.mutationPending = true;
    this.publishChange();
  }

  private endMutation(): void {
    this.mutationDepth -= 1;
    this.publishChange();
  }

  private publishChange(): void {
    if (this.mutationDepth !== 0 || !this.mutationPending) return;

    this.mutationPending = false;
    this.currentRevision += 1;
    for (const listener of [...this.listeners]) {
      listener(this);
    }
  }

  /** `listeners`/`currentRevision`/mutation-depth bookkeeping are deliberately excluded -- they're a live host UI subscription (`Win32VideoOutput.subscribe`), never guest-observable state; the host must re-subscribe after a restore. */
  public snapshotState(): Win32VideoOutputSnapshot {
    return {
      columns: this.columns,
      rows: this.rows,
      cells: this.snapshot(),
      attributes: this.snapshotAttributes(),
      cursorColumn: this.cursorColumn,
      cursorRow: this.cursorRow,
      currentAttribute: this.currentAttribute,
    };
  }

  /** Caller must have already constructed this instance with matching `{columns, rows}` -- both are `readonly`. */
  public restoreState(state: Win32VideoOutputSnapshot): void {
    this.cells.set(state.cells);
    this.attributes.set(state.attributes);
    this.cursorColumn = state.cursorColumn;
    this.cursorRow = state.cursorRow;
    this.currentAttribute = state.currentAttribute;
  }
}

export interface Win32VideoOutputSnapshot {
  readonly columns: number;
  readonly rows: number;
  readonly cells: Uint8Array;
  readonly attributes: Uint8Array;
  readonly cursorColumn: number;
  readonly cursorRow: number;
  readonly currentAttribute: number;
}
