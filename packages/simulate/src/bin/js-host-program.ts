import { Win32Api } from 'win32-abi';
import type { Win32CompiledProgram } from '../runtime/programs.js';
import { createConsoleProgramBuilder } from './compiler.js';

/**
 * Compiles a minimal Win64 console program whose entire body is the same
 * three `node.dll` calls `node.exe` itself makes (`createJSProcess` ->
 * `enterJSProcess` -> `terminateJSProcess`, see `node.ts`), but without
 * `node.exe`'s own argv-parsing/copying prologue -- this program never
 * reads its own incoming registers at all, it always enters with
 * `argc=0`/`argv=NULL`.
 *
 * The point is a *named*, real, running guest process as a vehicle for
 * host-registered JS work, keyed by image name rather than by "is this
 * literally node.exe running a script": a host can call
 * `machine.registerHandler('node.dll', 'enterJSProcess', handler)` and
 * have `handler` branch on `process.image` to decide what to actually do
 * for `enterJSProcess('exoproc-ide.exe', ...)` versus
 * `enterJSProcess('node.exe', ...)` -- both are real processes reaching
 * the same syscall, dispatched differently by whoever installed the
 * handler. This program is that vehicle for any image name that isn't
 * `node.exe` itself.
 */
export function compileJsHostProgram(imageName: string): Win32CompiledProgram {
  const program = createConsoleProgramBuilder();
  const { code } = program;

  program.invoke(Win32Api.node.createJSProcess);
  code.mov('r12', 'rax'); // r12 = hProcess

  code.mov('rcx', 'r12'); // RCX = hProcess
  code.xor('edx', 'edx'); // RDX = argc = 0
  code.xor('r8', 'r8'); // R8 = argv = NULL
  program.invoke(Win32Api.node.enterJSProcess);
  code.mov('r13d', 'eax'); // r13d = exitCode

  code.mov('rcx', 'r12'); // RCX = hProcess
  code.mov('rdx', 'r13'); // RDX = exitCode
  program.invoke(Win32Api.node.terminateJSProcess);

  code.mov('eax', 'r13d');
  code.ret();

  return program.finish(imageName);
}
