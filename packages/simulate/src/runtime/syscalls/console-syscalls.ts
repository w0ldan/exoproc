import type { Win64Machine, Win64Process } from '../win64-machine.js';
import { Win32Console } from '../console.js';

export const resolveConsoleHandle = (
  machine: Win64Machine,
  process: Win64Process,
  rawHandle: bigint,
) => {
  const object = machine.getHandleObject(process, rawHandle);
  if (
    (object?.kind === 'input' || object?.kind === 'output') &&
    object.device instanceof Win32Console
  ) {
    return {
      console: object.device,
      direction: object.kind,
    } as const;
  }
  return undefined;
};

export function registerConsoleSyscalls(machine: Win64Machine): void {
  const standardHandleSelector = (value: bigint) =>
    Number(BigInt.asIntN(32, value));

  machine.registerHandler(
    'kernel32.dll',
    'GetStdHandle',
    (process, _thread, registers) =>
      BigInt(process.getStandardHandle(standardHandleSelector(registers.RCX))),
  );

  machine.registerHandler(
    'kernel32.dll',
    'SetStdHandle',
    (process, _thread, registers) => {
      const changed = process.setStandardHandle(
        standardHandleSelector(registers.RCX),
        Number(registers.RDX),
      );
      process.lastError = changed ? 0 : 6;
      return changed ? 1n : 0n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'GetConsoleMode',
    (process, _thread, registers) => {
      const resolved = resolveConsoleHandle(machine, process, registers.RCX);
      if (!resolved || registers.RDX === 0n) {
        process.lastError = 6;
        return 0n;
      }
      process.memory.writeU32(
        registers.RDX,
        resolved.direction === 'input'
          ? resolved.console.inputMode
          : resolved.console.outputMode,
      );
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'SetConsoleMode',
    (process, _thread, registers) => {
      const resolved = resolveConsoleHandle(machine, process, registers.RCX);
      if (!resolved) {
        process.lastError = 6;
        return 0n;
      }
      const mode = Number(registers.RDX) >>> 0;
      if (resolved.direction === 'input') {
        resolved.console.inputMode = mode;
      } else {
        resolved.console.outputMode = mode;
      }
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'FillConsoleOutputCharacterA',
    (process, _thread, registers) => {
      const resolved = resolveConsoleHandle(machine, process, registers.RCX);
      if (!resolved || resolved.direction !== 'output') {
        process.lastError = 6;
        return 0n;
      }
      const coordinate = Number(registers.R9) >>> 0;
      const column = coordinate & 0xffff;
      const row = (coordinate >>> 16) & 0xffff;
      if (
        column >= resolved.console.videoOutput.columns ||
        row >= resolved.console.videoOutput.rows
      ) {
        process.lastError = 87;
        return 0n;
      }
      const written = resolved.console.videoOutput.fill(
        Number(registers.RDX) & 0xff,
        Number(registers.R8),
        column,
        row,
      );
      const writtenPointer = process.memory.readU64(registers.RSP + 0x28n);
      if (writtenPointer !== 0n) {
        process.memory.writeU32(writtenPointer, written);
      }
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'FillConsoleOutputAttribute',
    (process, _thread, registers) => {
      const resolved = resolveConsoleHandle(machine, process, registers.RCX);
      if (!resolved || resolved.direction !== 'output') {
        process.lastError = 6;
        return 0n;
      }
      const coordinate = Number(registers.R9) >>> 0;
      const column = coordinate & 0xffff;
      const row = (coordinate >>> 16) & 0xffff;
      if (
        column >= resolved.console.videoOutput.columns ||
        row >= resolved.console.videoOutput.rows
      ) {
        process.lastError = 87;
        return 0n;
      }
      const written = resolved.console.videoOutput.fillAttribute(
        Number(registers.RDX) & 0xff,
        Number(registers.R8),
        column,
        row,
      );
      const writtenPointer = process.memory.readU64(registers.RSP + 0x28n);
      if (writtenPointer !== 0n) {
        process.memory.writeU32(writtenPointer, written);
      }
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'SetConsoleTextAttribute',
    (process, _thread, registers) => {
      const resolved = resolveConsoleHandle(machine, process, registers.RCX);
      if (!resolved || resolved.direction !== 'output') {
        process.lastError = 6;
        return 0n;
      }
      resolved.console.videoOutput.setAttribute(Number(registers.RDX));
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'SetConsoleCursorPosition',
    (process, _thread, registers) => {
      const resolved = resolveConsoleHandle(machine, process, registers.RCX);
      if (!resolved || resolved.direction !== 'output') {
        process.lastError = 6;
        return 0n;
      }
      const coordinate = Number(registers.RDX) >>> 0;
      const column = coordinate & 0xffff;
      const row = (coordinate >>> 16) & 0xffff;
      if (
        column >= resolved.console.videoOutput.columns ||
        row >= resolved.console.videoOutput.rows
      ) {
        process.lastError = 87;
        return 0n;
      }
      resolved.console.videoOutput.setCursor(column, row);
      process.lastError = 0;
      return 1n;
    },
  );
}
