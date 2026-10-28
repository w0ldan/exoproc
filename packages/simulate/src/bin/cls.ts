import type { Win32CompiledProgram } from '../runtime/programs.js';
import { STD_OUTPUT_HANDLE } from '../runtime/types.js';
import { Win32Api } from 'win32-abi';
import { createConsoleProgramBuilder, qword } from './compiler.js';

export function compileClsExe(): Win32CompiledProgram {
  const program = createConsoleProgramBuilder();
  const { code } = program;
  program.buffer('written', 4);

  code.push('rbx');
  code.mov('ecx', STD_OUTPUT_HANDLE);
  program.invoke(Win32Api.kernel32.GetStdHandle);
  code.mov('rbx', 'rax');

  code.mov('rcx', 'rbx');
  code.mov('edx', 0x20);
  code.mov('r8d', 0xffffffff);
  code.mov('r9d', 0);
  program.dataAddress('rax', 'written');
  code.sub('rsp', 0x30);
  code.mov(qword('rsp', 0x20), 'rax');
  code.call(Win32Api.kernel32.FillConsoleOutputCharacterA);
  code.add('rsp', 0x30);

  code.mov('rcx', 'rbx');
  code.mov('edx', 0);
  program.invoke(Win32Api.kernel32.SetConsoleCursorPosition);

  code.mov('eax', 0);
  code.pop('rbx');
  code.ret();
  return program.finish('cls.exe');
}
