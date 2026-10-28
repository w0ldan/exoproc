import { Win32Api } from 'win32-abi';
import type { Win32CompiledProgram } from '../runtime/programs.js';
import { createConsoleProgramBuilder, qword } from './compiler.js';

export function compileWhereExe(): Win32CompiledProgram {
  const program = createConsoleProgramBuilder();
  const { code } = program;
  const notFound = code.createLabel('notFound');
  const usage = code.createLabel('usage');
  program.text('usage', 'Usage: where command\r\n');
  program.text(
    'notFound',
    'INFO: Could not find files for the given pattern(s).\r\n',
  );
  program.text('newline', '\r\n');
  program.buffer('result', 4096);

  code.cmp('ecx', 1);
  code.je(usage);
  code.mov('rax', 'rdx');
  code.mov('rdx', qword('rax', 8));
  code.xor('rcx', 'rcx');
  code.xor('r8', 'r8');
  code.mov('r9d', 4096);
  code.push(0);
  program.dataAddress('rax', 'result');
  code.push('rax');
  code.sub('rsp', 0x20);
  code.call(Win32Api.kernel32.SearchPathA);
  code.add('rsp', 0x30);
  code.test('eax', 'eax');
  code.je(notFound);
  code.mov('r8', 'rax');
  program.dataAddress('rdx', 'result');
  program.emitWriteRegisters();
  program.emitWriteSymbol('newline');
  code.xor('eax', 'eax');
  code.ret();

  code.bind(notFound);
  program.emitWriteSymbol('notFound');
  code.mov('eax', 1);
  code.ret();

  code.bind(usage);
  program.emitWriteSymbol('usage');
  code.mov('eax', 1);
  code.ret();
  return program.finish('where.exe');
}
