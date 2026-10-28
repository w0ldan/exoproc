import { Win32Api } from 'win32-abi';
import type { Win32CompiledProgram } from '../runtime/programs.js';
import { createConsoleProgramBuilder, qword } from './compiler.js';

export function compileSetExe(): Win32CompiledProgram {
  const program = createConsoleProgramBuilder();
  const { code } = program;
  const usage = code.createLabel('usage');
  program.text('usage', 'Usage: set NAME=VALUE\r\n');

  code.cmp('ecx', 1);
  code.je(usage);
  code.mov('rax', 'rdx');
  code.mov('rcx', qword('rax', 8));
  program.invoke(Win32Api.msvcrt._putenv);
  code.ret();

  code.bind(usage);
  program.emitWriteSymbol('usage');
  code.mov('eax', 1);
  code.ret();
  return program.finish('set.exe');
}
