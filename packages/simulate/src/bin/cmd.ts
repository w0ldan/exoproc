import { Win32Api } from 'win32-abi';
import type { Win32CompiledProgram } from '../runtime/programs.js';
import { STD_INPUT_HANDLE, STD_OUTPUT_HANDLE } from '../runtime/types.js';
import { qword, Win32ProgramBuilder, type X64Register64 } from './compiler.js';

export const CMD_EXIT_REQUEST = 0x45584954;

const CMD_BANNER =
  'Microsoft Windows [Version 10.0.19045.4046]\r\n' +
  '(c) Microsoft Corporation. All rights reserved.\r\n\r\n';
const CMD_LAUNCH_ERROR_SUFFIX =
  "' is not recognized as an internal or external command,\r\n" +
  'operable program or batch file.\r\n';

/**
 * Compiles cmd.exe itself.
 *
 * The resulting guest program uses its inherited standard handles, renders
 * the prompt, blocks in ReadFile and launches every submitted line through
 * CreateProcessA.
 */
export function compileCmdExe(): Win32CompiledProgram {
  const program = new Win32ProgramBuilder();
  const { code } = program;
  const textLength = (value: string) => new TextEncoder().encode(value).length;
  const address = (register: X64Register64, symbol: string) =>
    program.dataAddress(register, symbol);
  const commandLoop = code.createLabel('commandLoop');
  const commandSucceeded = code.createLabel('commandSucceeded');
  const write = code.createLabel('write');
  const writePrompt = code.createLabel('writePrompt');
  const readCommand = code.createLabel('readCommand');
  const createProcess = code.createLabel('createProcess');
  const skipWait = code.createLabel('skipWait');
  const writeLaunchError = code.createLabel('writeLaunchError');

  program.text('banner', CMD_BANNER);
  program.text('prompt', '>');
  program.text('errorPrefix', "'");
  program.text('errorSuffix', CMD_LAUNCH_ERROR_SUFFIX);
  program.buffer('input', 4096);
  program.buffer('readCount', 8);
  program.buffer('writtenCount', 8);
  program.buffer('currentDirectory', 260);
  program.buffer('processInformation', 24);
  program.buffer('childExitCode', 4);

  code.mov('ecx', STD_OUTPUT_HANDLE);
  program.invoke(Win32Api.kernel32.GetStdHandle);
  code.mov('r15', 'rax');
  code.mov('ecx', STD_INPUT_HANDLE);
  program.invoke(Win32Api.kernel32.GetStdHandle);
  code.mov('r14', 'rax');

  address('rdx', 'banner');
  code.mov('r8', textLength(CMD_BANNER));
  code.call(write);

  code.bind(commandLoop);
  code.call(writePrompt);
  code.call(readCommand);
  code.call(createProcess);
  code.test('rax', 'rax');
  code.jne(commandSucceeded);
  code.call(writeLaunchError);

  code.bind(commandSucceeded);
  code.jmp(commandLoop);

  code.bind(write);
  code.mov('rcx', 'r15');
  address('r9', 'writtenCount');
  code.push(0);
  code.sub('rsp', 0x20);
  code.call(Win32Api.kernel32.WriteFile);
  code.add('rsp', 0x28);
  code.ret();

  code.bind(writePrompt);
  code.mov('ecx', 260);
  address('rdx', 'currentDirectory');
  code.sub('rsp', 0x20);
  code.call(Win32Api.kernel32.GetCurrentDirectoryA);
  code.add('rsp', 0x20);
  code.mov('r8', 'rax');
  address('rdx', 'currentDirectory');
  code.call(write);
  address('rdx', 'prompt');
  code.mov('r8', 1);
  code.call(write);
  code.ret();

  code.bind(readCommand);
  code.mov('rcx', 'r14');
  address('rdx', 'input');
  code.mov('r8', 4095);
  address('r9', 'readCount');
  code.push(0);
  code.sub('rsp', 0x20);
  code.call(Win32Api.kernel32.ReadFile);
  code.add('rsp', 0x28);
  code.ret();

  code.bind(createProcess);
  code.xor('rcx', 'rcx');
  address('rdx', 'input');
  code.xor('r8', 'r8');
  code.xor('r9', 'r9');
  address('rax', 'processInformation');
  code.push('rax');
  code.push(0);
  code.push(0);
  code.push(0);
  code.push(0);
  code.push(1);
  code.sub('rsp', 0x20);
  code.call(Win32Api.kernel32.CreateProcessA);
  code.add('rsp', 0x50);
  code.test('eax', 'eax');
  code.je(skipWait);

  // Foreground child: block until it exits, same as real cmd.exe waiting
  // for anything that isn't launched with `start`. Without this, cmd.exe
  // would keep reading/prompting concurrently with a child that also reads
  // console input (e.g. a nested `cmd`), and both would race over the same
  // screen and input queue.
  address('rax', 'processInformation');
  code.mov('rcx', qword('rax'));
  code.mov('edx', 0xffffffff);
  program.invoke(Win32Api.kernel32.WaitForSingleObject);

  address('rax', 'processInformation');
  code.mov('rcx', qword('rax'));
  address('rdx', 'childExitCode');
  program.invoke(Win32Api.kernel32.GetExitCodeProcess);

  address('rax', 'processInformation');
  code.mov('rcx', qword('rax'));
  program.invoke(Win32Api.kernel32.CloseHandle);

  address('rax', 'processInformation');
  code.mov('rcx', qword('rax', 8));
  program.invoke(Win32Api.kernel32.CloseHandle);

  code.mov('eax', 1);
  code.ret();

  code.bind(skipWait);
  code.xor('eax', 'eax');
  code.ret();

  code.bind(writeLaunchError);
  address('rdx', 'errorPrefix');
  code.mov('r8', 1);
  code.call(write);
  address('rax', 'readCount');
  code.mov('r8', qword('rax'));
  code.sub('r8', 2);
  address('rdx', 'input');
  code.call(write);
  address('rdx', 'errorSuffix');
  code.mov('r8', textLength(CMD_LAUNCH_ERROR_SUFFIX));
  code.call(write);
  code.ret();

  return program.finish('cmd.exe');
}
