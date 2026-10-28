import { Win32Api } from 'win32-abi';
import type { Win32CompiledProgram } from '../runtime/programs.js';
import { STD_OUTPUT_HANDLE } from '../runtime/types.js';
import { createConsoleProgramBuilder, qword } from './compiler.js';

const CAT_BUFFER_SIZE = 4096;

/**
 * Compiles cat.exe as a Win64 program.
 *
 * File contents flow through msvcrt fopen/fread/fwrite/fclose. The program
 * never reaches into the virtual filesystem or video output directly.
 */
export function compileCatExe(): Win32CompiledProgram {
  const program = createConsoleProgramBuilder();
  const { code } = program;
  const fileLoop = code.createLabel('fileLoop');
  const readLoop = code.createLabel('readLoop');
  const closeFile = code.createLabel('closeFile');
  const openFailed = code.createLabel('openFailed');
  const usage = code.createLabel('usage');
  const success = code.createLabel('success');

  program.text('readMode', 'rb');
  program.text('usage', 'Usage: cat <file> [file ...]\r\n');
  program.text('openError', 'cat: cannot open %s\r\n');
  program.buffer('buffer', CAT_BUFFER_SIZE);

  // main(argc, argv, envp): retain argv[1..] and the inherited stdout handle.
  code.cmp('ecx', 1);
  code.je(usage);
  code.mov('eax', 'ecx');
  code.sub('eax', 1);
  code.mov('r15', 'rax');
  code.mov('r14', 'rdx');
  code.add('r14', 8);
  code.mov('ecx', STD_OUTPUT_HANDLE);
  program.invoke(Win32Api.kernel32.GetStdHandle);
  code.mov('r12', 'rax');

  code.bind(fileLoop);
  code.mov('r13', qword('r14'));
  code.mov('rcx', 'r13');
  program.dataAddress('rdx', 'readMode');
  program.invoke(Win32Api.msvcrt.fopen);
  code.mov('rbx', 'rax');
  code.test('rax', 'rax');
  code.je(openFailed);

  code.bind(readLoop);
  program.dataAddress('rcx', 'buffer');
  code.mov('rdx', 1);
  code.mov('r8', CAT_BUFFER_SIZE);
  code.mov('r9', 'rbx');
  program.invoke(Win32Api.msvcrt.fread);
  code.test('rax', 'rax');
  code.je(closeFile);

  code.mov('r8', 'rax');
  program.dataAddress('rcx', 'buffer');
  code.mov('rdx', 1);
  code.mov('r9', 'r12');
  program.invoke(Win32Api.msvcrt.fwrite);
  code.jmp(readLoop);

  code.bind(closeFile);
  code.mov('rcx', 'rbx');
  program.invoke(Win32Api.msvcrt.fclose);
  code.sub('r15', 1);
  code.cmp('r15', 0);
  code.je(success);
  code.add('r14', 8);
  code.jmp(fileLoop);

  code.bind(openFailed);
  program.dataAddress('rcx', 'openError');
  code.mov('rdx', 'r13');
  program.invoke(Win32Api.msvcrt.printf);
  code.mov('eax', 1);
  code.ret();

  code.bind(usage);
  program.emitWriteSymbol('usage');
  code.mov('eax', 1);
  code.ret();

  code.bind(success);
  code.xor('eax', 'eax');
  code.ret();

  return program.finish('cat.exe');
}
