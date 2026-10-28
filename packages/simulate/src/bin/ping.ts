import { Win32Api } from 'win32-abi';
import type { Win32CompiledProgram } from '../runtime/programs.js';
import { createConsoleProgramBuilder, dword, qword } from './compiler.js';

const ICMP_PACKET = Uint8Array.from([8, 0, 0, 0, 0x34, 0x12, 1, 0]);

/**
 * Compiles ping.exe as a static Winsock guest program.
 *
 * Target selection, socket calls, branching and output all execute as x64.
 * JS only provides syscall semantics at the DLL/kernel boundary.
 */
export function compilePingExe(): Win32CompiledProgram {
  const program = createConsoleProgramBuilder();
  const { code } = program;
  const invalidTarget = code.createLabel('invalidTarget');
  const unreachable = code.createLabel('unreachable');
  const winsockFailure = code.createLabel('winsockFailure');
  const usage = code.createLabel('usage');
  const cleanup = code.createLabel('cleanup');
  const idle = code.createLabel('idle');
  const done = code.createLabel('done');
  program.text('usage', 'Usage: ping target_name\r\n');
  program.text('pingFormat', '\r\nPinging %s with %d bytes of data:\r\n');
  program.text(
    'replyFormat',
    'Reply from %s: bytes=%d time<1ms TTL=128\r\n\r\n',
  );
  program.text(
    'statisticsFormat',
    'Ping statistics for %s:\r\n' +
      '    Packets: Sent = 1, Received = 1, Lost = 0 (0%% loss),\r\n',
  );
  program.text(
    'blockedFormat',
    'PING: transmit failed. %s is outside the simulated loopback network.\r\n' +
      'Only 127.0.0.0/8 is routable; no host network connection was attempted.\r\n',
  );
  program.text(
    'invalidFormat',
    'Ping request could not find host %s. Please check the name and try again.\r\n',
  );
  program.text(
    'winsockFailure',
    'PING: the simulated Winsock stack could not be initialized.\r\n',
  );
  program.buffer('wsaData', 400);
  program.data(
    'sockaddr',
    Uint8Array.from([2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  );
  program.data('request', ICMP_PACKET);
  program.buffer('reply', 64);
  program.buffer('from', 16);
  program.data('fromLength', Uint8Array.from([16, 0, 0, 0]));

  code.mov('r13', -1n);
  code.mov('r12d', 'ecx');
  code.cmp('ecx', 1);
  code.je(usage);
  code.mov('r14', qword('rdx', 8));

  code.mov('ecx', 0x0202);
  program.dataAddress('rdx', 'wsaData');
  program.invoke(Win32Api.ws2_32.WSAStartup);
  code.test('eax', 'eax');
  code.jne(winsockFailure);

  code.mov('ecx', 2);
  code.mov('edx', 3);
  code.mov('r8d', 1);
  program.invoke(Win32Api.ws2_32.socket);
  code.mov('r13', 'rax');
  code.cmp('rax', -1);
  code.je(winsockFailure);

  code.mov('rcx', 'r14');
  program.invoke(Win32Api.ws2_32.inet_addr);
  code.cmp('eax', -1);
  code.je(invalidTarget);
  program.dataAddress('rbx', 'sockaddr');
  code.mov(dword('rbx', 4), 'eax');

  code.mov('rcx', 'r13');
  program.dataAddress('rdx', 'request');
  program.movR8(ICMP_PACKET.length);
  code.xor('r9', 'r9');
  code.push(16);
  program.dataAddress('rax', 'sockaddr');
  code.push('rax');
  code.sub('rsp', 0x20);
  code.call(Win32Api.ws2_32.sendto);
  code.add('rsp', 0x30);
  code.cmp('eax', -1);
  code.je(unreachable);

  code.mov('rcx', 'r13');
  program.dataAddress('rdx', 'reply');
  program.movR8(64);
  code.xor('r9', 'r9');
  program.dataAddress('rax', 'fromLength');
  code.push('rax');
  program.dataAddress('rax', 'from');
  code.push('rax');
  code.sub('rsp', 0x20);
  code.call(Win32Api.ws2_32.recvfrom);
  code.add('rsp', 0x30);
  code.cmp('eax', -1);
  code.je(unreachable);

  code.call(cleanup);
  code.mov('rdx', 'r14');
  code.mov('r8d', ICMP_PACKET.length);
  program.emitPrintfSymbol('pingFormat');
  code.mov('rdx', 'r14');
  code.mov('r8d', ICMP_PACKET.length);
  program.emitPrintfSymbol('replyFormat');
  code.mov('rdx', 'r14');
  program.emitPrintfSymbol('statisticsFormat');
  code.cmp('r12d', 2);
  code.jbe(done);
  code.bind(idle);
  code.mov('ecx', 1000);
  program.invoke(Win32Api.kernel32.Sleep);
  code.jmp(idle);
  code.bind(done);
  code.xor('eax', 'eax');
  code.ret();

  code.bind(invalidTarget);
  code.call(cleanup);
  code.mov('rdx', 'r14');
  program.emitPrintfSymbol('invalidFormat');
  code.mov('eax', 1);
  code.ret();

  code.bind(unreachable);
  code.call(cleanup);
  code.mov('rdx', 'r14');
  program.emitPrintfSymbol('blockedFormat');
  code.mov('eax', 1);
  code.ret();

  code.bind(winsockFailure);
  code.call(cleanup);
  program.emitWriteSymbol('winsockFailure');
  code.mov('eax', 1);
  code.ret();

  code.bind(usage);
  program.emitWriteSymbol('usage');
  code.mov('eax', 1);
  code.ret();

  code.bind(cleanup);
  code.mov('rcx', 'r13');
  program.invoke(Win32Api.ws2_32.closesocket);
  program.invoke(Win32Api.ws2_32.WSACleanup);
  code.ret();

  return program.finish('ping.exe');
}
