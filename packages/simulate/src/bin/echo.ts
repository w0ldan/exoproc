import { Win32Api } from 'win32-abi';
import type { Win32CompiledProgram } from '../runtime/programs.js';
import { createConsoleProgramBuilder, qword } from './compiler.js';

export function compileEchoExe(): Win32CompiledProgram {
  const program = createConsoleProgramBuilder();
  const { code } = program;
  const argumentLoop = code.createLabel('argumentLoop');
  const done = code.createLabel('done');
  program.text('space', ' ');
  program.text('newline', '\r\n');

  code.mov('eax', 'ecx');
  code.sub('eax', 1);
  code.mov('r15', 'rax');
  code.cmp('r15', 0);
  code.je(done);
  code.mov('r14', 'rdx');
  code.add('r14', 8);

  code.bind(argumentLoop);
  code.mov('r13', qword('r14'));
  code.mov('rcx', 'r13');
  program.invoke(Win32Api.msvcrt.strlen);
  code.mov('r8', 'rax');
  code.mov('rdx', 'r13');
  program.emitWriteRegisters();
  code.sub('r15', 1);
  code.cmp('r15', 0);
  code.je(done);
  program.emitWriteSymbol('space');
  code.add('r14', 8);
  code.jmp(argumentLoop);

  code.bind(done);
  program.emitWriteSymbol('newline');
  code.xor('eax', 'eax');
  code.ret();
  return program.finish('echo.exe');
}
