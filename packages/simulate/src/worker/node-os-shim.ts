import { getBoundWin64Process } from '../runtime/bun-ffi.js';

/**
 * Minimal `node:os` replacement for code running in a simulated worker.
 * The C compiler and FFI pipeline use `tmpdir()` for scratch files; no other
 * operating-system queries are needed here.
 */
export function tmpdir(): string {
  const process = getBoundWin64Process();
  const environment = process.environment;
  const configured =
    environment.get('TEMP') ?? environment.get('TMP') ?? 'C:\\Windows\\Temp';
  const normalized = process.machine.fileSystem.normalize(
    configured,
    process.currentDirectory,
  );
  // `writeFileSync`'s target directory must exist in the simulated VFS the
  // same way a real Windows install already has `%TEMP%` created for it.
  process.machine.fileSystem.createDirectory(normalized);
  return normalized;
}

export function platform(): string {
  return 'win32';
}

export function homedir(): string {
  const process = getBoundWin64Process();
  return process.environment.get('USERPROFILE') ?? 'C:\\Users\\Serkan';
}

export function release(): string {
  return '10.0.19045';
}

export function type(): string {
  return 'Windows_NT';
}

export function arch(): string {
  return 'x64';
}

export function hostname(): string {
  return 'EXOPROC';
}

export function endianness(): 'LE' {
  return 'LE';
}

export function totalmem(): number {
  return 8 * 1024 * 1024 * 1024;
}

export function freemem(): number {
  return 4 * 1024 * 1024 * 1024;
}

export function cpus(): Array<{
  model: string;
  speed: number;
  times: { user: number; nice: number; sys: number; idle: number; irq: number };
}> {
  return [
    {
      model: 'Exoproc Virtual CPU',
      speed: 3000,
      times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
    },
  ];
}

export const EOL = '\r\n';

const os = {
  tmpdir,
  platform,
  homedir,
  release,
  type,
  arch,
  hostname,
  endianness,
  totalmem,
  freemem,
  cpus,
  EOL,
};

export default os;
