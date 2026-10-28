import { Win32Api } from 'win32-abi';
import type { Win32CompiledProgram } from '../runtime/programs.js';
import { createConsoleProgramBuilder, qword } from './compiler.js';

const MAX_ARGS = 256;

/**
 * Compiles `node.exe` as a thin Win64 console program that delegates
 * process creation, execution, and termination to `node.dll` exports:
 *  1. `node.dll!createJSProcess` -> returns hProcess handle
 *  2. `node.dll!enterJSProcess` -> runs JS worker runtime, returns exitCode
 *  3. `node.dll!terminateJSProcess` -> cleans up process handle
 */
export function compileNodeExe(): Win32CompiledProgram {
  const program = createConsoleProgramBuilder();
  const { code } = program;

  const usage = code.createLabel('usage');
  const copyArgLoop = code.createLabel('copyArgLoop');
  const copyArgDone = code.createLabel('copyArgDone');
  const argsFit = code.createLabel('argsFit');
  const runNode = code.createLabel('runNode');

  program.text('usage', 'Usage: node [-e <code> | <script.js>] [args...]\r\n');
  program.buffer('args', MAX_ARGS * 8);

  code.cmp('ecx', 1);
  code.je(usage);

  // ecx = argc, rdx = argv
  code.mov('r15d', 'ecx'); // r15d = argc
  code.mov('r14', 'rdx'); // r14 = argv pointer
  program.dataAddress('rbx', 'args'); // rbx = args array buffer

  // Copy argv pointers into our args buffer
  code.mov('r10d', 'r15d');
  code.cmp('r10d', MAX_ARGS);
  code.jbe(argsFit);
  code.mov('r10d', MAX_ARGS);
  code.bind(argsFit);
  code.xor('r11d', 'r11d');
  code.mov('r8', 'r14');
  code.mov('r12', 'rbx');
  code.bind(copyArgLoop);
  code.cmp('r11d', 'r10d');
  code.jae(copyArgDone);
  code.mov('rax', qword('r8'));
  code.mov(qword('r12'), 'rax');
  code.add('r8', 8);
  code.add('r12', 8);
  code.add('r11d', 1);
  code.jmp(copyArgLoop);

  code.bind(copyArgDone);
  // 1. Create JS process handle via node.dll!createJSProcess
  code.bind(runNode);
  program.invoke(Win32Api.node.createJSProcess);
  code.mov('r12', 'rax'); // r12 = hProcess

  // 2. Enter JS process via node.dll!enterJSProcess(hProcess, argc, argv)
  code.mov('rcx', 'r12'); // RCX = hProcess
  code.mov('rdx', 'r15'); // RDX = argc
  code.mov('r8', 'rbx'); // R8 = argv array base
  program.invoke(Win32Api.node.enterJSProcess);
  code.mov('r13d', 'eax'); // r13d = exitCode

  // 3. Terminate JS process via node.dll!terminateJSProcess(hProcess, exitCode)
  code.mov('rcx', 'r12'); // RCX = hProcess
  code.mov('rdx', 'r13'); // RDX = exitCode
  program.invoke(Win32Api.node.terminateJSProcess);

  // Return exitCode in EAX
  code.mov('eax', 'r13d');
  code.ret();

  code.bind(usage);
  program.emitWriteSymbol('usage');
  code.mov('eax', 9);
  code.ret();

  return program.finish('node.exe');
}
