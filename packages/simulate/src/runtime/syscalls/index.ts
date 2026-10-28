import type { Win64Machine } from '../win64-machine.js';
import { registerSocketSyscalls } from './socket-syscalls.js';
import { registerSnapshotSyscalls } from './snapshot-syscalls.js';
import { registerThreadSyscalls } from './thread-syscalls.js';
import { registerFileSyscalls } from './file-syscalls.js';
import { registerConsoleSyscalls } from './console-syscalls.js';
import { registerMemorySyscalls } from './memory-syscalls.js';
import { registerProcessSyscalls } from './process-syscalls.js';

export function registerAllSyscalls(machine: Win64Machine): void {
  registerProcessSyscalls(machine);
  registerMemorySyscalls(machine);
  registerConsoleSyscalls(machine);
  registerFileSyscalls(machine);
  registerThreadSyscalls(machine);
  registerSnapshotSyscalls(machine);
  registerSocketSyscalls(machine);
}

export * from './socket-syscalls.js';
export * from './snapshot-syscalls.js';
export * from './thread-syscalls.js';
export * from './file-syscalls.js';
export * from './console-syscalls.js';
export * from './memory-syscalls.js';
export * from './process-syscalls.js';
