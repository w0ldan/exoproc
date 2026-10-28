import { Win32Api } from 'win32-abi';
import type { Win32CompiledProgram } from '../runtime/programs.js';
import { createConsoleProgramBuilder } from './compiler.js';

export function compilePwdExe(): Win32CompiledProgram {
  const program = createConsoleProgramBuilder();
  const { code } = program;
  program.buffer('currentDirectory', 260);
  program.text('newline', '\r\n');

  code.mov('ecx', 260);
  program.dataAddress('rdx', 'currentDirectory');
  program.invoke(Win32Api.kernel32.GetCurrentDirectoryA);
  code.mov('r8', 'rax');
  program.dataAddress('rdx', 'currentDirectory');
  program.emitWriteRegisters();
  program.emitWriteSymbol('newline');
  code.xor('eax', 'eax');
  code.ret();

  return program.finish('pwd.exe');
}
