import { Win32Api } from 'win32-abi';
import type { Win32CompiledProgram } from '../runtime/programs.js';
import { createConsoleProgramBuilder, qword } from './compiler.js';

export function compileWhoisExe(): Win32CompiledProgram {
  const program = createConsoleProgramBuilder();
  const { code } = program;
  const blocked = code.createLabel('blocked');
  const invalid = code.createLabel('invalid');
  const usage = code.createLabel('usage');
  const writeArgument = code.createLabel('writeArgument');
  program.text('usage', 'Usage: whois address\r\n');
  program.text(
    'localRecord',
    'NetRange:       127.0.0.0 - 127.255.255.255\r\n' +
      'CIDR:           127.0.0.0/8\r\n' +
      'NetName:        EXOPROC-LOOPBACK\r\n' +
      'NetType:        Simulated Loopback\r\n' +
      'Query:          ',
  );
  program.text('blockedPrefix', 'WHOIS lookup blocked for ');
  program.text(
    'blockedSuffix',
    '.\r\nOnly the simulated 127.0.0.0/8 registry is available.\r\n' +
      'No internet request was made.\r\n',
  );
  program.text('invalidPrefix', 'WHOIS lookup failed: ');
  program.text('invalidSuffix', ' is not a local IPv4 address.\r\n');
  program.text('newline', '\r\n');

  code.cmp('ecx', 1);
  code.je(usage);
  code.mov('rax', 'rdx');
  code.mov('r14', qword('rax', 8));

  code.mov('rcx', 'r14');
  program.invoke(Win32Api.ws2_32.inet_addr);
  code.cmp('eax', -1);
  code.je(invalid);
  code.cmp('eax', 0x0100007f);
  code.jne(blocked);

  program.emitWriteSymbol('localRecord');
  code.call(writeArgument);
  program.emitWriteSymbol('newline');
  code.xor('eax', 'eax');
  code.ret();

  code.bind(blocked);
  program.emitWriteSymbol('blockedPrefix');
  code.call(writeArgument);
  program.emitWriteSymbol('blockedSuffix');
  code.mov('eax', 1);
  code.ret();

  code.bind(invalid);
  program.emitWriteSymbol('invalidPrefix');
  code.call(writeArgument);
  program.emitWriteSymbol('invalidSuffix');
  code.mov('eax', 1);
  code.ret();

  code.bind(usage);
  program.emitWriteSymbol('usage');
  code.mov('eax', 1);
  code.ret();

  code.bind(writeArgument);
  code.mov('rcx', 'r14');
  program.invoke(Win32Api.msvcrt.strlen);
  code.mov('r8', 'rax');
  code.mov('rdx', 'r14');
  program.emitWriteRegisters();
  code.ret();

  return program.finish('whois.exe');
}
