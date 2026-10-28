import { Win32Api } from 'win32-abi';
import type { Win32CompiledProgram } from '../runtime/programs.js';
import { createConsoleProgramBuilder, qword } from './compiler.js';

export function compilePathExe(): Win32CompiledProgram {
  const program = createConsoleProgramBuilder();
  const { code } = program;
  const showPath = code.createLabel('showPath');
  const failure = code.createLabel('failure');
  program.text('pathName', 'PATH', true);
  program.text('pathPrefix', 'PATH=');
  program.text('newline', '\r\n');
  program.buffer('pathValue', 4096);

  code.cmp('ecx', 1);
  code.je(showPath);
  code.mov('rax', 'rdx');
  code.mov('rdx', qword('rax', 8));
  program.dataAddress('rcx', 'pathName');
  program.invoke(Win32Api.kernel32.SetEnvironmentVariableA);
  code.test('eax', 'eax');
  code.je(failure);
  code.xor('eax', 'eax');
  code.ret();

  code.bind(showPath);
  program.dataAddress('rcx', 'pathName');
  program.dataAddress('rdx', 'pathValue');
  program.movR8(4096);
  program.invoke(Win32Api.kernel32.GetEnvironmentVariableA);
  code.mov('r13', 'rax');
  program.emitWriteSymbol('pathPrefix');
  code.mov('r8', 'r13');
  program.dataAddress('rdx', 'pathValue');
  program.emitWriteRegisters();
  program.emitWriteSymbol('newline');
  code.xor('eax', 'eax');
  code.ret();

  code.bind(failure);
  code.mov('eax', 1);
  code.ret();
  return program.finish('path.exe');
}
