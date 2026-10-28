import {
  Win32VideoOutput,
  type Win32VideoOutputOptions,
  type Win32VideoOutputSnapshot,
} from './video-output.js';
import type { Win32InputDevice, Win32OutputDevice } from './types.js';

export const ENABLE_PROCESSED_INPUT = 0x0001;
export const ENABLE_LINE_INPUT = 0x0002;
export const ENABLE_ECHO_INPUT = 0x0004;
export const ENABLE_PROCESSED_OUTPUT = 0x0001;
export const ENABLE_WRAP_AT_EOL_OUTPUT = 0x0002;

export class Win32CaptureOutput implements Win32OutputDevice {
  private bytes: number[] = [];

  public write(bytes: Uint8Array): number {
    this.bytes.push(...bytes);
    return bytes.length;
  }

  public snapshot(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  public get text(): string {
    return new TextDecoder().decode(this.snapshot());
  }

  public drainText(): string {
    const text = this.text;
    this.bytes = [];
    return text;
  }

  public clear(): void {
    this.bytes = [];
  }
}

export class Win32NullOutput implements Win32OutputDevice {
  public write(bytes: Uint8Array): number {
    return bytes.length;
  }
}

export class Win32NullInput implements Win32InputDevice {
  public readonly hasInput = false;

  public read(_maxBytes: number): Uint8Array {
    return new Uint8Array();
  }
}

/**
 * Console character device owned by the JS kernel.
 *
 * Win64 can only reach this object when the TS kernel installs capabilities
 * for its input and output sides into a process handle table.
 */
export class Win32Console {
  public readonly videoOutput: Win32VideoOutput;
  public inputMode =
    ENABLE_PROCESSED_INPUT | ENABLE_LINE_INPUT | ENABLE_ECHO_INPUT;
  public outputMode = ENABLE_PROCESSED_OUTPUT | ENABLE_WRAP_AT_EOL_OUTPUT;
  private input = new Uint8Array(0);
  private pendingHostBytes: number[] = [];

  constructor(options: Win32VideoOutputOptions = {}) {
    this.videoOutput = new Win32VideoOutput(options);
  }

  public get screenText(): string {
    return this.videoOutput.toString();
  }

  public get hasInput(): boolean {
    return this.input.length > 0;
  }

  public write(bytes: Uint8Array): number {
    this.videoOutput.write(bytes, {
      processedOutput: (this.outputMode & ENABLE_PROCESSED_OUTPUT) !== 0,
    });
    this.pendingHostBytes.push(...bytes);
    return bytes.length;
  }

  public queueInput(text: string, echo = true): void {
    const bytes = new TextEncoder().encode(text);
    const queued = new Uint8Array(this.input.length + bytes.length);
    queued.set(this.input);
    queued.set(bytes, this.input.length);
    this.input = queued;
    if (echo) {
      this.write(bytes);
    }
  }

  public read(maxBytes: number): Uint8Array {
    const length = Math.max(0, Math.min(maxBytes, this.input.length));
    const result = this.input.slice(0, length);
    this.input = this.input.slice(length);
    return result;
  }

  public clear(): void {
    this.videoOutput.clear();
  }

  /**
   * Raw console writes since the previous drain. Used only when the host
   * output is redirected instead of attached to a console screen.
   */
  public drainHostText(): string {
    const bytes = Uint8Array.from(this.pendingHostBytes);
    this.pendingHostBytes = [];
    return new TextDecoder().decode(bytes);
  }

  public snapshotState(): Win32ConsoleSnapshot {
    return {
      videoOutput: this.videoOutput.snapshotState(),
      inputMode: this.inputMode,
      outputMode: this.outputMode,
      pendingInput: this.input.slice(),
      pendingHostBytes: [...this.pendingHostBytes],
    };
  }

  /**
   * Applies a snapshot's state onto this already-constructed instance --
   * used when the console already exists and is `readonly` on its owner
   * (`Win64Machine.screen`), so a fresh instance can't simply replace it.
   * The video output's dimensions must already match (both are fixed at
   * construction); this never resizes.
   */
  public restoreState(state: Win32ConsoleSnapshot): void {
    this.videoOutput.restoreState(state.videoOutput);
    this.inputMode = state.inputMode;
    this.outputMode = state.outputMode;
    this.input = state.pendingInput.slice();
    this.pendingHostBytes = [...state.pendingHostBytes];
  }

  /** Constructs a fresh `Win32Console` (matching the snapshot's screen dimensions) with its state already restored -- used for a process's own `console`, which (unlike `Win64Machine.screen`) is freshly created per restored process. */
  public static restore(state: Win32ConsoleSnapshot): Win32Console {
    const console = new Win32Console({
      columns: state.videoOutput.columns,
      rows: state.videoOutput.rows,
    });
    console.restoreState(state);
    return console;
  }
}

export interface Win32ConsoleSnapshot {
  readonly videoOutput: Win32VideoOutputSnapshot;
  readonly inputMode: number;
  readonly outputMode: number;
  readonly pendingInput: Uint8Array;
  readonly pendingHostBytes: readonly number[];
}
