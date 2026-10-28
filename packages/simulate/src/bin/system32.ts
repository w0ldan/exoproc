import type { Win32ProgramRegistry } from '../runtime/programs.js';
import { compileCatExe } from './cat.js';
import { compileCdExe } from './cd.js';
import { compileClsExe } from './cls.js';
import { compileConsoleProgram } from './compiler.js';
import { CMD_EXIT_REQUEST, compileCmdExe } from './cmd.js';
import { compileEchoExe } from './echo.js';
import { compileLsExe } from './ls.js';
import { compileNodeExe } from './node.js';
import { compilePathExe } from './path.js';
import { compilePingExe } from './ping.js';
import { compilePwdExe } from './pwd.js';
import { compileSetExe } from './set.js';
import { compileWhereExe } from './where.js';
import { compileWhoisExe } from './whois.js';

const SYSTEM32 = 'C:\\Windows\\System32';

/**
 * Optional syscall id for the host `NodeHostBridge` -- when provided,
 * `node.exe` is installed in system32 so the simulated CommandPrompt
 * can launch it. The id is allocated by the bridge at host setup
 * time; pass `undefined` (the default) to skip `node.exe` entirely
 * (e.g. in tests that don't need a working node bridge).
 */
export interface InstallDefaultWin32ProgramsOptions {
  readonly nodeSyscallId?: number;
}

/**
 * Installs already-compiled executable images into the virtual filesystem.
 * Command behavior must not be implemented in this manifest.
 */
export function installDefaultWin32Programs(
  registry: Win32ProgramRegistry,
  username = 'Serkan',
  _options: InstallDefaultWin32ProgramsOptions = {},
): void {
  registry.install(`${SYSTEM32}\\cmd.exe`, compileCmdExe());
  registry.install(`${SYSTEM32}\\cat.exe`, compileCatExe());
  registry.install(`${SYSTEM32}\\dir.exe`, compileLsExe('dir.exe'));
  registry.install(`${SYSTEM32}\\ls.exe`, compileLsExe());
  registry.install(`${SYSTEM32}\\pwd.exe`, compilePwdExe());
  registry.install(`${SYSTEM32}\\cls.exe`, compileClsExe());
  registry.installAlias(`${SYSTEM32}\\clear.exe`, `${SYSTEM32}\\cls.exe`);
  registry.install(`${SYSTEM32}\\ping.exe`, compilePingExe());
  registry.install(`${SYSTEM32}\\cd.exe`, compileCdExe());
  registry.install(`${SYSTEM32}\\chdir.exe`, compileCdExe('chdir.exe'));
  registry.install(`${SYSTEM32}\\whois.exe`, compileWhoisExe());
  registry.install(`${SYSTEM32}\\echo.exe`, compileEchoExe());
  registry.install(`${SYSTEM32}\\set.exe`, compileSetExe());
  registry.install(`${SYSTEM32}\\path.exe`, compilePathExe());
  registry.install(`${SYSTEM32}\\where.exe`, compileWhereExe());
  registry.install(`${SYSTEM32}\\node.exe`, compileNodeExe());
  registry.install(
    `${SYSTEM32}\\ver.exe`,
    compileConsoleProgram(
      'ver.exe',
      '\r\nMicrosoft Windows [Version 10.0.19045.4046]\r\n\r\n',
    ),
  );
  registry.install(
    `${SYSTEM32}\\help.exe`,
    compileConsoleProgram(
      'help.exe',
      'Compiled commands: CAT, CD, CHDIR, CLEAR, CLS, DIR, ECHO, EXIT, HELP, HOSTNAME, LS, NODE, PATH, PING, PWD, SET, VER, WHERE, WHOAMI, WHOIS\r\n',
    ),
  );
  registry.install(
    `${SYSTEM32}\\exit.exe`,
    compileConsoleProgram('exit.exe', '', CMD_EXIT_REQUEST),
  );
  registry.install(
    `${SYSTEM32}\\whoami.exe`,
    compileConsoleProgram('whoami.exe', `EXOPROC\\${username}\r\n`),
  );
  registry.install(
    `${SYSTEM32}\\hostname.exe`,
    compileConsoleProgram('hostname.exe', 'EXOPROC-WIN64\r\n'),
  );
  registry.install(
    `${SYSTEM32}\\hello.exe`,
    compileConsoleProgram(
      'hello.exe',
      'Hello from a compiled Win64 process.\r\n',
    ),
  );
}
