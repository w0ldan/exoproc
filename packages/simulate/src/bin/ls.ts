import { Win32Api } from 'win32-abi';
import type { Win32CompiledProgram } from '../runtime/programs.js';
import { createConsoleProgramBuilder, dword, qword } from './compiler.js';

export function compileLsExe(name = 'ls.exe'): Win32CompiledProgram {
  const program = createConsoleProgramBuilder();
  const { code } = program;
  const useDefaultPath = code.createLabel('useDefaultPath');
  const pathReady = code.createLabel('pathReady');
  const entryLoop = code.createLabel('entryLoop');
  const fileEntry = code.createLabel('fileEntry');
  const nextEntry = code.createLabel('nextEntry');
  const notFound = code.createLabel('notFound');
  program.buffer('currentDirectory', 260);
  program.text('header', ' Directory of ');
  program.text('directoryFormat', '<DIR>          %s\r\n');
  program.text('fileFormat', '               %d bytes (%d KB)  %s\r\n');
  program.text('newline', '\r\n');
  program.text('notFound', 'The system cannot find the path specified.\r\n');
  // WIN32_FIND_DATAA: cFileName begins at byte 44.
  program.buffer('findData', 44);
  program.buffer('findName', 260);
  program.buffer('findTail', 16);

  code.cmp('ecx', 1);
  code.je(useDefaultPath);
  code.mov('r14', qword('rdx', 8));
  code.jmp(pathReady);

  code.bind(useDefaultPath);
  code.mov('ecx', 260);
  program.dataAddress('rdx', 'currentDirectory');
  program.invoke(Win32Api.kernel32.GetCurrentDirectoryA);
  program.dataAddress('r14', 'currentDirectory');

  code.bind(pathReady);
  program.emitWriteSymbol('header');
  code.mov('rcx', 'r14');
  program.invoke(Win32Api.msvcrt.strlen);
  code.mov('r8', 'rax');
  code.mov('rdx', 'r14');
  program.emitWriteRegisters();
  program.emitWriteSymbol('newline');

  code.mov('rcx', 'r14');
  program.dataAddress('rdx', 'findData');
  program.invoke(Win32Api.kernel32.FindFirstFileA);
  code.mov('r13', 'rax');
  code.cmp('rax', -1);
  code.je(notFound);

  code.bind(entryLoop);
  program.dataAddress('rax', 'findData');
  code.mov('eax', dword('rax'));
  code.mov('ecx', 0x10);
  code.test('eax', 'ecx');
  code.je(fileEntry);
  program.dataAddress('rcx', 'directoryFormat');
  program.dataAddress('rdx', 'findName');
  program.invoke(Win32Api.msvcrt.printf);
  code.jmp(nextEntry);

  code.bind(fileEntry);
  // WIN32_FIND_DATAA.nFileSizeLow is at byte 32. Keep the exact byte
  // count and derive a human-readable KiB value rounded up to the next KiB.
  program.dataAddress('rax', 'findData');
  code.mov('r10d', dword('rax', 32));
  code.mov('eax', 'r10d');
  code.add('eax', 1023);
  code.xor('edx', 'edx');
  code.mov('ecx', 1024);
  code.div('ecx');
  code.mov('r8d', 'eax');
  code.mov('edx', 'r10d');
  program.dataAddress('r9', 'findName');
  program.dataAddress('rcx', 'fileFormat');
  program.invoke(Win32Api.msvcrt.printf);

  code.bind(nextEntry);
  code.mov('rcx', 'r13');
  program.dataAddress('rdx', 'findData');
  program.invoke(Win32Api.kernel32.FindNextFileA);
  code.test('eax', 'eax');
  code.jne(entryLoop);

  code.mov('rcx', 'r13');
  program.invoke(Win32Api.kernel32.FindClose);
  code.xor('eax', 'eax');
  code.ret();

  code.bind(notFound);
  program.emitWriteSymbol('notFound');
  code.mov('eax', 1);
  code.ret();

  return program.finish(name);
}
