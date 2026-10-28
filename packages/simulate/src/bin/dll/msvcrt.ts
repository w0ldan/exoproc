import { MsvcrtDll, Win32Api, type Win32FunctionReference } from 'win32-abi';
import type { Win32ExportBindingRegistry } from '../../runtime/win32-dlls.js';
import { STD_OUTPUT_HANDLE } from '../../runtime/types.js';
import { byte, dword, qword, X64Assembler } from '../compiler.js';
import type { Win32GuestDllSource } from './types.js';

function compileFopen() {
  const code = new X64Assembler();
  const readMode = code.createLabel('readMode');
  const writeMode = code.createLabel('writeMode');
  const appendMode = code.createLabel('appendMode');
  const initializeFlags = code.createLabel('initializeFlags');
  const scanMode = code.createLabel('scanMode');
  const plusFlag = code.createLabel('plusFlag');
  const exclusiveFlag = code.createLabel('exclusiveFlag');
  const advanceMode = code.createLabel('advanceMode');
  const configure = code.createLabel('configure');
  const configureRead = code.createLabel('configureRead');
  const readOnly = code.createLabel('readOnly');
  const readArguments = code.createLabel('readArguments');
  const configureWrite = code.createLabel('configureWrite');
  const writeOnly = code.createLabel('writeOnly');
  const createAlways = code.createLabel('createAlways');
  const writeArguments = code.createLabel('writeArguments');
  const configureAppend = code.createLabel('configureAppend');
  const appendOnly = code.createLabel('appendOnly');
  const appendArguments = code.createLabel('appendArguments');
  const open = code.createLabel('open');
  const returnResult = code.createLabel('returnResult');
  const invalidMode = code.createLabel('invalidMode');

  code.mov('r10', 'rcx');
  code.mov('r9', 'rdx');
  code.movzx('eax', byte('r9'));
  code.cmp('eax', 0x72); // r
  code.je(readMode);
  code.cmp('eax', 0x77); // w
  code.je(writeMode);
  code.cmp('eax', 0x61); // a
  code.je(appendMode);
  code.jmp(invalidMode);

  code.bind(readMode);
  code.xor('edx', 'edx');
  code.jmp(initializeFlags);

  code.bind(writeMode);
  code.mov('edx', 1);
  code.jmp(initializeFlags);

  code.bind(appendMode);
  code.mov('edx', 2);

  code.bind(initializeFlags);
  code.xor('r8d', 'r8d');
  code.xor('r11d', 'r11d');
  code.add('r9', 1);

  code.bind(scanMode);
  code.movzx('eax', byte('r9'));
  code.test('eax', 'eax');
  code.je(configure);
  code.cmp('eax', 0x2b); // +
  code.je(plusFlag);
  code.cmp('eax', 0x62); // b
  code.je(advanceMode);
  code.cmp('eax', 0x74); // t
  code.je(advanceMode);
  code.cmp('eax', 0x78); // x
  code.je(exclusiveFlag);
  code.jmp(invalidMode);

  code.bind(plusFlag);
  code.mov('r8d', 1);
  code.jmp(advanceMode);

  code.bind(exclusiveFlag);
  code.mov('r11d', 1);

  code.bind(advanceMode);
  code.add('r9', 1);
  code.jmp(scanMode);

  code.bind(configure);
  code.cmp('edx', 0);
  code.je(configureRead);
  code.cmp('edx', 1);
  code.je(configureWrite);
  code.jmp(configureAppend);

  code.bind(configureRead);
  code.cmp('r11d', 0);
  code.jne(invalidMode);
  code.cmp('r8d', 0);
  code.je(readOnly);
  code.mov('edx', 0xc0000000);
  code.jmp(readArguments);

  code.bind(readOnly);
  code.mov('edx', 0x80000000);

  code.bind(readArguments);
  code.mov('r8d', 1);
  code.mov('r11d', 3);
  code.jmp(open);

  code.bind(configureWrite);
  code.cmp('r8d', 0);
  code.je(writeOnly);
  code.mov('edx', 0xc0000000);
  code.jmp(writeArguments);

  code.bind(writeOnly);
  code.mov('edx', 0x40000000);

  code.bind(writeArguments);
  code.mov('r8d', 0);
  code.cmp('r11d', 0);
  code.je(createAlways);
  code.mov('r11d', 1);
  code.jmp(open);

  code.bind(createAlways);
  code.mov('r11d', 2);
  code.jmp(open);

  code.bind(configureAppend);
  code.cmp('r11d', 0);
  code.jne(invalidMode);
  code.cmp('r8d', 0);
  code.je(appendOnly);
  code.mov('edx', 0xc0000004);
  code.jmp(appendArguments);

  code.bind(appendOnly);
  code.mov('edx', 0x40000004);

  code.bind(appendArguments);
  code.mov('r8d', 1);
  code.mov('r11d', 4);

  code.bind(open);
  code.mov('rcx', 'r10');
  code.xor('r9', 'r9');
  code.push(0);
  code.push(0x80);
  code.push('r11');
  code.sub('rsp', 0x20);
  code.call(Win32Api.kernel32.CreateFileA);
  code.add('rsp', 0x38);
  code.cmp('rax', -1);
  code.jneShort(returnResult);
  code.xor('eax', 'eax');

  code.bind(returnResult);
  code.ret();

  code.bind(invalidMode);
  code.xor('eax', 'eax');
  code.ret();
  return {
    code: code.finish(),
    relocations: code.relocations,
  };
}

/**
 * Builds fread/fwrite as CRT-side Win64 wrappers.
 *
 * FILE* is represented by the Win32 handle returned by fopen. The wrappers
 * retain the C element-count contract while the actual I/O crosses into the
 * JS kernel exclusively through ReadFile/WriteFile.
 */
function compileStreamIo(target: Win32FunctionReference) {
  const code = new X64Assembler();
  const noElements = code.createLabel('noElements');
  const done = code.createLabel('done');

  // Entry: RCX=buffer, RDX=element size, R8=element count, R9=FILE*.
  // rbp-32 receives ReadFile/WriteFile's DWORD byte count.
  code.push('rbp');
  code.mov('rbp', 'rsp');
  code.push('r12');
  code.push('r13');
  code.push('r14');
  code.sub('rsp', 0x20);
  code.mov('r12', 'rcx');
  code.mov('r13', 'rdx');
  code.mov('r14', 'r9');

  code.test('r13', 'r13');
  code.je(noElements);
  code.test('r8', 'r8');
  code.je(noElements);

  // ReadFile/WriteFile take a DWORD length. Reject an overflowing size_t
  // multiplication rather than truncating it into a different operation.
  code.mov('rax', 'r13');
  code.mul('r8');
  code.test('rdx', 'rdx');
  code.jne(noElements);
  code.mov('r10', 'rax');
  code.mov('r11', 0xffffffffn);
  code.and('r10', 'r11');
  code.cmp('r10', 'rax');
  code.jne(noElements);

  code.mov('rcx', 'r14');
  code.mov('rdx', 'r12');
  code.mov('r8', 'rax');
  code.lea('r9', qword('rbp', -32));
  code.push(0);
  code.sub('rsp', 0x20);
  code.call(target);
  code.add('rsp', 0x28);
  code.test('eax', 'eax');
  code.je(noElements);

  // C returns the number of complete elements, not the number of bytes.
  code.mov('eax', dword('rbp', -32));
  code.xor('edx', 'edx');
  code.div('r13');
  code.jmp(done);

  code.bind(noElements);
  code.xor('eax', 'eax');

  code.bind(done);
  code.add('rsp', 0x20);
  code.pop('r14');
  code.pop('r13');
  code.pop('r12');
  code.pop('rbp');
  code.ret();
  return {
    code: code.finish(),
    relocations: code.relocations,
  };
}

function compileFread() {
  return compileStreamIo(Win32Api.kernel32.ReadFile);
}

function compileFwrite() {
  return compileStreamIo(Win32Api.kernel32.WriteFile);
}

/**
 * `int abs(int x)` -- the sign test is an unsigned compare against
 * 0x80000000 (this assembler/CPU only implements unsigned and zero-flag
 * conditional jumps): a negative int is exactly an unsigned value
 * >= 0x80000000.
 */
function compileAbs() {
  const code = new X64Assembler();
  const done = code.createLabel('done');

  code.mov('eax', 'ecx');
  code.cmp('eax', 0x80000000);
  code.jb(done);
  code.neg('eax');

  code.bind(done);
  code.ret();
  return {
    code: code.finish(),
    relocations: code.relocations,
  };
}

const HEAP_ZERO_MEMORY = 0x00000008;

/**
 * Loads msvcrt's CRT heap handle (set up by `compileDllMain`) into RCX --
 * the register every `HeapAlloc`/`HeapFree`/`HeapReAlloc` call needs it in.
 */
function loadCrtHeapIntoRcx(code: X64Assembler): void {
  code.movAddress('rcx', { kind: 'module-globals', dllName: 'msvcrt.dll' });
  code.mov('rcx', qword('rcx'));
}

/**
 * msvcrt's `DllMain(HINSTANCE hinstDLL, DWORD fdwReason, LPVOID lpvReserved)`.
 *
 * On `DLL_PROCESS_ATTACH` it creates a dedicated CRT heap via a genuine
 * `HeapCreate` call and stores the handle in msvcrt's private globals page,
 * so `malloc`/`free`/`calloc`/`realloc` never need a host-side JS shortcut.
 */
function compileDllMain() {
  const code = new X64Assembler();
  const skip = code.createLabel('skip');

  code.cmp('edx', 1); // DLL_PROCESS_ATTACH
  code.jne(skip);

  code.xor('ecx', 'ecx');
  code.xor('edx', 'edx');
  code.xor('r8d', 'r8d');
  code.sub('rsp', 0x28);
  code.call(Win32Api.kernel32.HeapCreate);
  code.add('rsp', 0x28);
  code.movAddress('rcx', { kind: 'module-globals', dllName: 'msvcrt.dll' });
  code.mov(qword('rcx'), 'rax');

  code.bind(skip);
  code.mov('eax', 1); // TRUE
  code.ret();
  return {
    code: code.finish(),
    relocations: code.relocations,
  };
}

function compileMalloc() {
  const code = new X64Assembler();
  code.mov('r10', 'rcx'); // size
  loadCrtHeapIntoRcx(code);
  code.xor('edx', 'edx');
  code.mov('r8', 'r10');
  code.sub('rsp', 0x28);
  code.call(Win32Api.kernel32.HeapAlloc);
  code.add('rsp', 0x28);
  code.ret();
  return {
    code: code.finish(),
    relocations: code.relocations,
  };
}

function compileFree() {
  const code = new X64Assembler();
  code.mov('r10', 'rcx'); // ptr
  loadCrtHeapIntoRcx(code);
  code.xor('edx', 'edx');
  code.mov('r8', 'r10');
  code.sub('rsp', 0x28);
  code.call(Win32Api.kernel32.HeapFree);
  code.add('rsp', 0x28);
  code.ret();
  return {
    code: code.finish(),
    relocations: code.relocations,
  };
}

function compileCalloc() {
  const code = new X64Assembler();
  const allocate = code.createLabel('allocate');

  code.mov('rax', 'rcx'); // num
  code.mul('rdx'); // rax:rdx = num * size; rdx != 0 means the product overflowed 64 bits
  code.mov('r11', 'rax'); // total size
  code.test('rdx', 'rdx');
  code.je(allocate);
  code.xor('eax', 'eax'); // overflow: return NULL, matching real CRT calloc
  code.ret();

  code.bind(allocate);
  loadCrtHeapIntoRcx(code);
  code.mov('edx', HEAP_ZERO_MEMORY);
  code.mov('r8', 'r11');
  code.sub('rsp', 0x28);
  code.call(Win32Api.kernel32.HeapAlloc);
  code.add('rsp', 0x28);
  code.ret();
  return {
    code: code.finish(),
    relocations: code.relocations,
  };
}

function compileRealloc() {
  const code = new X64Assembler();
  const noPointer = code.createLabel('noPointer');
  const noSize = code.createLabel('noSize');
  const done = code.createLabel('done');

  code.mov('r10', 'rcx'); // ptr
  code.mov('r11', 'rdx'); // newSize
  code.test('r10', 'r10');
  code.je(noPointer);
  code.test('r11', 'r11');
  code.je(noSize);

  // HeapReAlloc(heap, 0, ptr, newSize)
  loadCrtHeapIntoRcx(code);
  code.xor('edx', 'edx');
  code.mov('r8', 'r10');
  code.mov('r9', 'r11');
  code.sub('rsp', 0x28);
  code.call(Win32Api.kernel32.HeapReAlloc);
  code.add('rsp', 0x28);
  code.jmp(done);

  code.bind(noPointer);
  // realloc(NULL, size) behaves like malloc(size)
  loadCrtHeapIntoRcx(code);
  code.xor('edx', 'edx');
  code.mov('r8', 'r11');
  code.sub('rsp', 0x28);
  code.call(Win32Api.kernel32.HeapAlloc);
  code.add('rsp', 0x28);
  code.jmp(done);

  code.bind(noSize);
  // realloc(ptr, 0) behaves like free(ptr), returning NULL
  loadCrtHeapIntoRcx(code);
  code.xor('edx', 'edx');
  code.mov('r8', 'r10');
  code.sub('rsp', 0x28);
  code.call(Win32Api.kernel32.HeapFree);
  code.add('rsp', 0x28);
  code.xor('eax', 'eax');

  code.bind(done);
  code.ret();
  return {
    code: code.finish(),
    relocations: code.relocations,
  };
}

/**
 * Compiles a small, genuine Win64 printf implementation into msvcrt.dll.
 *
 * The formatter itself is x64 guest code. It parses `%s`, `%d` and `%%`,
 * then reaches the JS kernel only through kernel32!WriteFile's IAT slot.
 */
function compilePrintf() {
  const code = new X64Assembler();
  const parse = code.createLabel('parse');
  const scanLiteral = code.createLabel('scanLiteral');
  const writeLiteral = code.createLabel('writeLiteral');
  const writeFinalLiteral = code.createLabel('writeFinalLiteral');
  const format = code.createLabel('format');
  const formatString = code.createLabel('formatString');
  const scanString = code.createLabel('scanString');
  const writeString = code.createLabel('writeString');
  const formatDecimal = code.createLabel('formatDecimal');
  const decimalMagnitude = code.createLabel('decimalMagnitude');
  const decimalNonZero = code.createLabel('decimalNonZero');
  const decimalLoop = code.createLabel('decimalLoop');
  const writeDigits = code.createLabel('writeDigits');
  const writeDigit = code.createLabel('writeDigit');
  const formatPercent = code.createLabel('formatPercent');
  const formatUnknown = code.createLabel('formatUnknown');
  const formatTrailingPercent = code.createLabel('formatTrailingPercent');
  const advanceFormat = code.createLabel('advanceFormat');
  const done = code.createLabel('done');
  const selectArgument = code.createLabel('selectArgument');
  const selectSecondArgument = code.createLabel('selectSecondArgument');
  const selectThirdArgument = code.createLabel('selectThirdArgument');
  const argumentSelected = code.createLabel('argumentSelected');
  const noArgument = code.createLabel('noArgument');
  const writeBuffer = code.createLabel('writeBuffer');

  // rbp-64  = WriteFile's DWORD written count
  // rbp-72  = '-'
  // rbp-80  = raw %d argument
  // rbp-88  = decimal digit count
  // rbp-192 = start of the reversed decimal digit buffer
  code.push('rbp');
  code.mov('rbp', 'rsp');
  code.push('rbx');
  code.push('rsi');
  code.push('rdi');
  code.push('r12');
  code.push('r13');
  code.push('r14');
  code.push('r15');
  code.sub('rsp', 0x88);
  code.mov('r12', 'rcx');
  code.mov('r13', 'rdx');
  code.mov('r14', 'r8');
  code.mov('r15', 'r9');
  code.xor('ebx', 'ebx');
  code.xor('esi', 'esi');
  code.mov(qword('rbp', -72), 0x2d);

  code.bind(parse);
  code.movzx('eax', byte('r12'));
  code.test('eax', 'eax');
  code.je(done);
  code.cmp('eax', 0x25);
  code.je(format);
  code.mov('rdi', 'r12');
  code.xor('r8d', 'r8d');

  code.bind(scanLiteral);
  code.movzx('eax', byte('r12'));
  code.test('eax', 'eax');
  code.je(writeFinalLiteral);
  code.cmp('eax', 0x25);
  code.je(writeLiteral);
  code.add('r12', 1);
  code.add('r8', 1);
  code.jmp(scanLiteral);

  code.bind(writeLiteral);
  code.mov('rdx', 'rdi');
  code.call(writeBuffer);
  code.jmp(parse);

  code.bind(writeFinalLiteral);
  code.mov('rdx', 'rdi');
  code.call(writeBuffer);
  code.jmp(done);

  code.bind(format);
  code.add('r12', 1);
  code.movzx('eax', byte('r12'));
  code.test('eax', 'eax');
  code.je(formatTrailingPercent);
  code.cmp('eax', 0x73);
  code.je(formatString);
  code.cmp('eax', 0x64);
  code.je(formatDecimal);
  code.cmp('eax', 0x25);
  code.je(formatPercent);
  code.jmp(formatUnknown);

  code.bind(formatString);
  code.call(selectArgument);
  code.test('rdx', 'rdx');
  code.je(advanceFormat);
  code.mov('rdi', 'rdx');
  code.xor('r8d', 'r8d');

  code.bind(scanString);
  code.movzx('eax', byte('rdi'));
  code.test('eax', 'eax');
  code.je(writeString);
  code.add('rdi', 1);
  code.add('r8', 1);
  code.jmp(scanString);

  code.bind(writeString);
  code.call(writeBuffer);
  code.jmp(advanceFormat);

  code.bind(formatDecimal);
  code.call(selectArgument);
  code.mov(qword('rbp', -80), 'rdx');
  code.mov('eax', 'edx');
  code.mov('ecx', 0x80000000);
  code.test('eax', 'ecx');
  code.je(decimalMagnitude);
  code.lea('rdx', qword('rbp', -72));
  code.mov('r8', 1);
  code.call(writeBuffer);
  code.mov('eax', dword('rbp', -80));
  code.neg('eax');
  code.jmp(decimalNonZero);

  code.bind(decimalMagnitude);
  code.mov('eax', dword('rbp', -80));

  code.bind(decimalNonZero);
  code.lea('rdi', qword('rbp', -192));
  code.mov(qword('rbp', -88), 0);
  code.test('eax', 'eax');
  code.jne(decimalLoop);
  code.mov(qword('rdi'), 0x30);
  code.add('rdi', 8);
  code.mov(qword('rbp', -88), 1);
  code.jmp(writeDigits);

  code.bind(decimalLoop);
  code.xor('edx', 'edx');
  code.mov('ecx', 10);
  code.div('ecx');
  code.add('edx', 0x30);
  code.mov(qword('rdi'), 'rdx');
  code.add('rdi', 8);
  code.add(qword('rbp', -88), 1);
  code.test('eax', 'eax');
  code.jne(decimalLoop);

  code.bind(writeDigits);
  code.cmp(qword('rbp', -88), 0);
  code.jne(writeDigit);
  code.jmp(advanceFormat);

  code.bind(writeDigit);
  code.sub('rdi', 8);
  code.mov('rdx', 'rdi');
  code.mov('r8', 1);
  code.call(writeBuffer);
  code.sub(qword('rbp', -88), 1);
  code.jmp(writeDigits);

  code.bind(formatPercent);
  code.mov('rdx', 'r12');
  code.mov('r8', 1);
  code.call(writeBuffer);
  code.jmp(advanceFormat);

  code.bind(formatUnknown);
  code.lea('rdx', qword('r12', -1));
  code.mov('r8', 1);
  code.call(writeBuffer);
  code.mov('rdx', 'r12');
  code.mov('r8', 1);
  code.call(writeBuffer);
  code.jmp(advanceFormat);

  code.bind(formatTrailingPercent);
  code.lea('rdx', qword('r12', -1));
  code.mov('r8', 1);
  code.call(writeBuffer);
  code.jmp(done);

  code.bind(advanceFormat);
  code.add('r12', 1);
  code.jmp(parse);

  code.bind(done);
  code.mov('eax', 'esi');
  code.add('rsp', 0x88);
  code.pop('r15');
  code.pop('r14');
  code.pop('r13');
  code.pop('r12');
  code.pop('rdi');
  code.pop('rsi');
  code.pop('rbx');
  code.pop('rbp');
  code.ret();

  code.bind(selectArgument);
  code.cmp('ebx', 0);
  code.jne(selectSecondArgument);
  code.mov('rdx', 'r13');
  code.jmp(argumentSelected);

  code.bind(selectSecondArgument);
  code.cmp('ebx', 1);
  code.jne(selectThirdArgument);
  code.mov('rdx', 'r14');
  code.jmp(argumentSelected);

  code.bind(selectThirdArgument);
  code.cmp('ebx', 2);
  code.jne(noArgument);
  code.mov('rdx', 'r15');
  code.jmp(argumentSelected);

  code.bind(noArgument);
  code.xor('edx', 'edx');

  code.bind(argumentSelected);
  code.add('ebx', 1);
  code.ret();

  code.bind(writeBuffer);
  code.add('rsi', 'r8');
  code.push('rdx');
  code.push('r8');
  code.mov('ecx', STD_OUTPUT_HANDLE);
  code.sub('rsp', 0x28);
  code.call(Win32Api.kernel32.GetStdHandle);
  code.add('rsp', 0x28);
  code.pop('r8');
  code.pop('rdx');
  code.mov('rcx', 'rax');
  code.lea('r9', qword('rbp', -64));
  code.push(0);
  code.sub('rsp', 0x20);
  code.call(Win32Api.kernel32.WriteFile);
  code.add('rsp', 0x28);
  code.ret();

  return {
    code: code.finish(),
    relocations: code.relocations,
  };
}

function configureMsvcrt(bindings: Win32ExportBindingRegistry): void {
  bindings
    .guestFunction(Win32Api.msvcrt.abs, compileAbs)
    .guestFunction(Win32Api.msvcrt.fopen, compileFopen)
    .forwardFunction(Win32Api.msvcrt.fclose, Win32Api.kernel32.CloseHandle)
    .guestFunction(Win32Api.msvcrt.fread, compileFread)
    .guestFunction(Win32Api.msvcrt.fwrite, compileFwrite)
    .guestFunction(Win32Api.msvcrt.printf, compilePrintf)
    .guestFunction(Win32Api.msvcrt.malloc, compileMalloc)
    .guestFunction(Win32Api.msvcrt.free, compileFree)
    .guestFunction(Win32Api.msvcrt.calloc, compileCalloc)
    .guestFunction(Win32Api.msvcrt.realloc, compileRealloc);
}

export const MsvcrtGuestDll = {
  source: MsvcrtDll,
  configure: configureMsvcrt,
  dllMain: compileDllMain,
} as const satisfies Win32GuestDllSource;
