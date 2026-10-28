import { Win32Api } from 'win32-abi';
import type { Win32CompiledProgram } from '../runtime/programs.js';
import { createConsoleProgramBuilder, qword } from './compiler.js';

export function compileCdExe(name = 'cd.exe'): Win32CompiledProgram {
  const program = createConsoleProgramBuilder();
  const { code } = program;
  const success = code.createLabel('success');
  program.text('notFound', 'The system cannot find the path specified.\r\n');

  code.cmp('ecx', 1);
  code.je(success);

  code.mov('rax', 'rdx');
  code.mov('rcx', qword('rax', 8));
  program.invoke(Win32Api.kernel32.SetCurrentDirectoryA);
  code.test('eax', 'eax');
  code.jne(success);
  program.emitWriteSymbol('notFound');
  code.mov('eax', 1);
  code.ret();

  code.bind(success);
  code.xor('eax', 'eax');
  code.ret();

  return program.finish(name);
}
