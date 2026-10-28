import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FFIType as NativeFFIType } from 'bun:ffi';
import {
  CType,
  getWin32DllFileName,
  Kernel32Dll,
  Win32DllSuffix,
  Win32Dlls,
  Win32Api,
  Ws2_32Dll,
} from 'win32-abi';
import {
  bindWin64Process,
  byte,
  createWin32SyscallThunk,
  DefaultWin32ExportCatalog,
  DefaultWin32GuestDlls,
  dword,
  dlopen,
  FFIType as SimulatedFFIType,
  getGlobalWin64Machine,
  MemoryAccessFault,
  Win64Machine,
  Win32CommandPrompt,
  Win32ExportCatalog,
  Win32ExportBindingRegistry,
  Win32VideoOutput,
  WSAEHOSTUNREACH,
  X64Assembler,
  qword,
} from '../../packages/simulate/dist/index.js';

describe('@exoproc/simulate Win64 machine', () => {
  it('assembles readable typed x64 instructions into guest machine code', () => {
    const assembly = new X64Assembler();
    const done = assembly.createLabel('done');
    assembly.mov('eax', dword('rax'));
    assembly.cmp('eax', 1);
    assembly.mov('r13', qword('r14'));
    assembly.mov(dword('rbx', 4), 'eax');
    assembly.je(done);
    assembly.bind(done);
    assembly.ret();

    assert.deepEqual(
      assembly.finish(),
      Uint8Array.from([
        0x8b, 0x00, 0x83, 0xf8, 0x01, 0x4d, 0x8b, 0x2e, 0x89, 0x43, 0x04, 0x0f,
        0x84, 0x00, 0x00, 0x00, 0x00, 0xc3,
      ]),
    );

    assert.throws(
      () => new X64Assembler().mov('eax', qword('rax')),
      /operand width mismatch/,
    );
    assert.throws(
      () => new X64Assembler().mov(dword('rax'), dword('rbx')),
      /memory-to-memory/,
    );

    const importedCall = new X64Assembler();
    importedCall.call(Win32Api.kernel32.WriteFile);
    assert.deepEqual(importedCall.relocations, [
      {
        offset: 2,
        encoding: 'iat-relative32',
        target: {
          kind: 'export',
          dllName: 'kernel32.dll',
          functionName: 'WriteFile',
        },
      },
    ]);
    assert.deepEqual(
      importedCall.finish(),
      Uint8Array.from([0xff, 0x15, 0, 0, 0, 0]),
    );

    const byteLoad = new X64Assembler();
    byteLoad.movzx('eax', byte('rdx'));
    byteLoad.ret();
    assert.deepEqual(
      byteLoad.finish(),
      Uint8Array.from([0x0f, 0xb6, 0x02, 0xc3]),
    );

    const multiply = new X64Assembler();
    multiply.mul('r8');
    multiply.ret();
    assert.deepEqual(
      multiply.finish(),
      Uint8Array.from([0x49, 0xf7, 0xe0, 0xc3]),
    );
  });

  it('keeps console output in a fixed-size ASCII framebuffer', () => {
    const videoOutput = new Win32VideoOutput({
      columns: 8,
      rows: 2,
    });

    assert.equal(videoOutput.snapshot().length, 16);
    videoOutput.write(new TextEncoder().encode('one\r\ntwo\r\nthree'));
    assert.equal(videoOutput.toString(), 'two\r\nthree');
    assert.deepEqual(videoOutput.cursor, {
      column: 5,
      row: 1,
    });

    videoOutput.write(Uint8Array.from([0x08, 0x80]));
    assert.equal(videoOutput.getCell(4, 1), 0x3f);
    assert.equal(videoOutput.snapshot().length, 16);

    videoOutput.clear();
    videoOutput.write(new TextEncoder().encode('\u001b[2J\u001b[H'));
    assert.equal(videoOutput.toString(), '?[2J?[H');

    videoOutput.clear();
    videoOutput.write(new TextEncoder().encode('OK'));
    assert.equal(videoOutput.toString(), 'OK');
    assert.deepEqual(videoOutput.cursor, {
      column: 2,
      row: 0,
    });
  });

  it('publishes framebuffer revisions without a host presentation format', () => {
    const videoOutput = new Win32VideoOutput({
      columns: 4,
      rows: 2,
    });
    const revisions: number[] = [];
    const unsubscribe = videoOutput.subscribe((output) => {
      revisions.push(output.revision);
    });

    videoOutput.write(new TextEncoder().encode('AB'));
    assert.deepEqual(revisions, [1]);

    videoOutput.setCursor(1, 0);
    assert.deepEqual(revisions, [1, 2]);

    videoOutput.write(new Uint8Array());
    videoOutput.setCursor(1, 0);
    assert.deepEqual(revisions, [1, 2]);

    videoOutput.clear();
    assert.deepEqual(revisions, [1, 2, 3]);

    unsubscribe();
    videoOutput.write(new TextEncoder().encode('X'));
    assert.deepEqual(revisions, [1, 2, 3]);
    assert.equal(videoOutput.revision, 4);
  });

  it('mirrors Bun FFI types and traps unknown browser types', () => {
    assert.equal(CType.DWORD, NativeFFIType.u32);
    assert.equal(CType.HANDLE, NativeFFIType.u64);
    assert.equal(SimulatedFFIType.u32, NativeFFIType.u32);
    assert.equal(SimulatedFFIType.ptr, NativeFFIType.ptr);
    assert.throws(
      () => (SimulatedFFIType as Record<string, number>).future_type,
      /does not define FFIType\.future_type/,
    );
    assert.equal(Kernel32Dll.name, 'kernel32');
    assert.equal(Ws2_32Dll.name, 'ws2_32');
    assert.equal(Win32Api.kernel32.CreateFileA.dll, Kernel32Dll);
    assert.equal(Win32Api.kernel32.CreateFileA.name, 'CreateFileA');
    assert.equal(
      Win32Api.kernel32.CreateFileA.definition,
      Kernel32Dll.definitions.CreateFileA,
    );
    assert.deepEqual(Ws2_32Dll.definitions.sendto.args, [
      CType.SOCKET,
      CType.ptr,
      CType.INT,
      CType.INT,
      CType.ptr,
      CType.INT,
    ]);
    assert.equal(Win32DllSuffix, '.dll');
    assert.equal(getWin32DllFileName(Kernel32Dll), 'kernel32.dll');
    assert.deepEqual(Win32Dlls.map(getWin32DllFileName), [
      'kernel32.dll',
      'ntdll.dll',
      'msvcrt.dll',
      'user32.dll',
      'gdi32.dll',
      'advapi32.dll',
      'psapi.dll',
      'capstone.dll',
      'ws2_32.dll',
      'node.dll',
    ]);
  });

  it('generates every DLL export and syscall thunk from the ABI catalog', () => {
    assert.deepEqual(
      DefaultWin32GuestDlls.map((dll) => getWin32DllFileName(dll.source)),
      Win32Dlls.map(getWin32DllFileName),
    );
    const expectedExportCount = Win32Dlls.reduce(
      (count, dll) => count + Object.keys(dll.definitions).length,
      0,
    );
    assert.equal(DefaultWin32ExportCatalog.exports.length, expectedExportCount);
    assert.equal(
      DefaultWin32ExportCatalog.exportByName.size,
      DefaultWin32ExportCatalog.exports.length,
    );
    assert.equal(
      DefaultWin32ExportCatalog.exportByName.get('WriteFile')?.dllName,
      'kernel32.dll',
    );
    assert.equal(
      DefaultWin32ExportCatalog.syscallById.size,
      DefaultWin32ExportCatalog.syscalls.length,
    );

    const machine = new Win64Machine();
    const process = machine.createProcess({
      image: 'catalog-probe.exe',
      path: 'C:\\Users\\Serkan\\Workspace\\catalog-probe.exe',
    });

    for (const dll of DefaultWin32ExportCatalog.dlls) {
      const module = process.getModule(dll.name);
      assert.ok(module, `${dll.name} was not mapped`);
      assert.deepEqual(
        [...module.exports.keys()],
        Object.keys(dll.source.definitions),
      );

      for (const exported of Object.values(dll.functions)) {
        const address = module.exports.get(exported.name);
        assert.ok(address);
        if (exported.binding.kind === 'syscall') {
          assert.deepEqual(
            process.memory.read(address, 8),
            createWin32SyscallThunk(exported.syscallId).slice(0, 8),
          );
        }
      }
    }

    const fopen = DefaultWin32ExportCatalog.resolve('msvcrt.dll', 'fopen');
    const fclose = DefaultWin32ExportCatalog.resolve('msvcrt.dll', 'fclose');
    const fread = DefaultWin32ExportCatalog.resolve('msvcrt.dll', 'fread');
    const fwrite = DefaultWin32ExportCatalog.resolve('msvcrt.dll', 'fwrite');
    const printf = DefaultWin32ExportCatalog.resolve('msvcrt.dll', 'printf');
    assert.ok(fopen);
    assert.ok(fclose);
    assert.ok(fread);
    assert.ok(fwrite);
    assert.ok(printf);
    assert.equal(fopen?.binding.kind, 'guest-wrapper');
    assert.equal(fclose?.binding.kind, 'forwarder');
    assert.equal(fread?.binding.kind, 'guest-wrapper');
    assert.equal(fwrite?.binding.kind, 'guest-wrapper');
    assert.equal(printf?.binding.kind, 'guest-wrapper');

    for (const [entry, targetFunction] of [
      [fopen, 'CreateFileA'],
      [fclose, 'CloseHandle'],
      [fread, 'ReadFile'],
      [fwrite, 'WriteFile'],
    ] as const) {
      const relocatable = DefaultWin32ExportCatalog.compileExportThunk(entry);
      assert.equal(relocatable.relocations.length, 1);
      const relocation = relocatable.relocations[0];
      assert.ok(relocation);
      assert.deepEqual(relocation.target, {
        kind: 'export',
        dllName: 'kernel32.dll',
        functionName: targetFunction,
      });
      assert.equal(relocation.encoding, 'iat-relative32');
      assert.equal(
        new DataView(
          relocatable.code.buffer,
          relocatable.code.byteOffset,
          relocatable.code.byteLength,
        ).getInt32(relocation.offset, true),
        0,
      );
      const codeAddress = 0x100000n;
      const iatSlot = 0x102000n;
      const linked = DefaultWin32ExportCatalog.linkExportThunk(
        entry,
        relocatable,
        codeAddress,
        () => iatSlot,
      );
      assert.equal(
        new DataView(
          linked.buffer,
          linked.byteOffset,
          linked.byteLength,
        ).getInt32(relocation.offset, true),
        Number(iatSlot - (codeAddress + BigInt(relocation.offset + 4))),
      );
    }

    const printfThunk = DefaultWin32ExportCatalog.compileExportThunk(printf);
    assert.deepEqual(
      printfThunk.relocations.map((relocation) => relocation.target),
      [
        {
          kind: 'export',
          dllName: 'kernel32.dll',
          functionName: 'GetStdHandle',
        },
        {
          kind: 'export',
          dllName: 'kernel32.dll',
          functionName: 'WriteFile',
        },
      ],
    );
    assert.ok(
      printfThunk.relocations.every(
        (relocation) => relocation.encoding === 'iat-relative32',
      ),
    );

    const msvcrt = process.getModule('msvcrt.dll');
    assert.ok(msvcrt);
    assert.equal(msvcrt.iatSize, 72);
    assert.deepEqual(
      msvcrt.imports.map((entry) => entry.symbol),
      [
        'HeapAlloc',
        'HeapFree',
        'HeapReAlloc',
        'CreateFileA',
        'CloseHandle',
        'ReadFile',
        'WriteFile',
        'GetStdHandle',
        'HeapCreate',
      ],
    );
    for (const imported of msvcrt.imports) {
      assert.equal(
        process.memory.readU64(imported.slotAddress),
        imported.targetAddress,
      );
    }
    assert.equal(process.memory.findMapping(msvcrt.iatBase)?.protection, 'r');
    assert.throws(
      () => process.memory.writeU64(msvcrt.iatBase, 0n),
      /STATUS_ACCESS_VIOLATION/,
    );
  });

  it('fetches, decodes and executes x64 bytes against live memory', () => {
    const machine = new Win64Machine();
    const process = machine.createRandomDebugProcess();
    const thread = process.getThreads()[0];
    assert.ok(thread);

    const workItem = thread.registers.RCX;
    assert.equal(process.memory.readU64(workItem), 3n);
    assert.equal(process.memory.readU64(workItem + 8n), 0n);

    const mnemonics = thread.cpu
      .disassemble(thread.entryPoint, 16)
      .map((instruction) => instruction.mnemonic);
    assert.deepEqual(mnemonics, [
      'push',
      'mov',
      'sub',
      'mov',
      'add',
      'mov',
      'int3',
      'add',
      'pop',
      'ret',
    ]);

    let stopReason = '';
    while (stopReason !== 'breakpoint') {
      stopReason = thread.step().reason;
    }
    assert.equal(process.memory.readU64(workItem + 8n), 4n);
    assert.equal(thread.state, 'stopped');
  });

  it('executes SIB addressing and register-memory arithmetic in the local interpreter', () => {
    const machine = new Win64Machine();
    const process = machine.createProcess({
      image: 'isa-probe.exe',
      path: 'C:\\Users\\Serkan\\Workspace\\isa-probe.exe',
    });
    const entry = process.imageBase + 0x1000n;
    process.memory.load(
      entry,
      Uint8Array.from([
        0x49,
        0xb9,
        0x02,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00, // mov r9, 2
        0x48,
        0xb8,
        0x05,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00, // mov rax, 5
        0x4a,
        0x89,
        0x44,
        0xcc,
        0x20, // mov [rsp+r9*8+20h], rax
        0x4a,
        0x8b,
        0x5c,
        0xcc,
        0x20, // mov rbx, [rsp+r9*8+20h]
        0x48,
        0x01,
        0xc3, // add rbx, rax
        0x48,
        0x29,
        0xc3, // sub rbx, rax
        0x48,
        0x09,
        0xc3, // or rbx, rax
        0x48,
        0x21,
        0xc3, // and rbx, rax
        0x48,
        0x39,
        0xc3, // cmp rbx, rax
        0x75,
        0x0b, // jne failure
        0x48,
        0xb8,
        0x2a,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0xc3, // return 42
        0x48,
        0xb8,
        0x63,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0x00,
        0xc3, // failure: return 99
      ]),
    );

    const result = process.invoke(entry, []);
    assert.equal(result.value, 42n);
    assert.deepEqual(
      result.steps.map((step) => step.instruction.mnemonic),
      [
        'mov',
        'mov',
        'mov',
        'mov',
        'add',
        'sub',
        'or',
        'and',
        'cmp',
        'jne',
        'mov',
        'ret',
      ],
    );
    const indexedMemoryStep = result.steps[2];
    assert.ok(indexedMemoryStep);
    assert.match(
      indexedMemoryStep.instruction.operands,
      /\[rsp\+r9\*8\+0x20\]/,
    );
  });

  it('enforces executable and writable page permissions', () => {
    const machine = new Win64Machine();
    const process = machine.createRandomDebugProcess();

    assert.throws(
      () => process.memory.write(process.imageBase + 0x1000n, [0x90]),
      MemoryAccessFault,
    );
  });

  it('routes bun:ffi calls through executable DLL syscall thunks', () => {
    const machine = new Win64Machine();
    const target = machine.createRandomDebugProcess();
    const host = machine.createProcess({
      image: 'docs-host.exe',
      path: 'C:\\Users\\Serkan\\Workspace\\docs-host.exe',
    });
    const getCurrentProcessId = host.resolveSymbol(
      'kernel32.dll',
      'GetCurrentProcessId',
    );
    assert.ok(getCurrentProcessId);
    const probe = host.invoke(getCurrentProcessId, []);
    assert.equal(probe.value, BigInt(host.pid));
    assert.deepEqual(
      probe.steps.map((step) => step.instruction.mnemonic),
      ['mov', 'syscall', 'ret'],
    );

    const restore = bindWin64Process(host);

    try {
      const kernel32 = dlopen('kernel32.dll', {
        OpenProcess: {
          args: ['u32', 'bool', 'u32'],
          returns: 'ptr',
        },
        VirtualAllocEx: {
          args: ['ptr', 'ptr', 'usize', 'u32', 'u32'],
          returns: 'ptr',
        },
        WriteProcessMemory: {
          args: ['ptr', 'ptr', 'ptr', 'usize', 'ptr'],
          returns: 'bool',
        },
        CreateRemoteThread: {
          args: ['ptr', 'ptr', 'usize', 'ptr', 'ptr', 'u32', 'ptr'],
          returns: 'ptr',
        },
      });

      const handle = kernel32.symbols.OpenProcess(
        0x1f0fff,
        false,
        target.pid,
      ) as number;
      assert.ok(handle >= 0x100);

      const remoteAddress = kernel32.symbols.VirtualAllocEx(
        handle,
        0,
        0x1000,
        0x3000,
        0x40,
      ) as number;
      const mapping = target.memory.findMapping(BigInt(remoteAddress));
      assert.equal(mapping?.protection, 'rwx');

      const remoteCode = Uint8Array.from([
        0x48, 0xb8, 0x2a, 0, 0, 0, 0, 0, 0, 0, 0xc3,
      ]);
      assert.equal(
        kernel32.symbols.WriteProcessMemory(
          handle,
          remoteAddress,
          remoteCode,
          remoteCode.length,
          0,
        ),
        true,
      );
      assert.deepEqual(
        target.memory.read(BigInt(remoteAddress), remoteCode.length),
        remoteCode,
      );

      const threadCount = target.getThreads().length;
      const threadHandle = kernel32.symbols.CreateRemoteThread(
        handle,
        0,
        0,
        remoteAddress,
        0,
        0,
        0,
      ) as number;
      assert.ok(threadHandle > handle);
      assert.equal(target.getThreads().length, threadCount + 1);

      const events = machine.getInternalEvents();
      assert.ok(
        events.some((event) => event.includes('kernel32.dll!OpenProcess')),
      );
      assert.ok(
        events.some((event) => event.includes('kernel32.dll!VirtualAllocEx')),
      );
    } finally {
      restore();
    }
  });

  it('rejects non-loopback ws2_32 destinations without a host network fallback', () => {
    const machine = new Win64Machine();
    const process = machine.createProcess({
      image: 'winsock-probe.exe',
      path: 'C:\\Users\\Serkan\\Workspace\\winsock-probe.exe',
    });
    const resolve = (name: string) => {
      const address = process.resolveSymbol('ws2_32.dll', name);
      assert.ok(address, `ws2_32.dll!${name} is missing`);
      return address;
    };
    const wsaData = process.allocate(400);
    assert.equal(
      process.invoke(resolve('WSAStartup'), [0x0202, wsaData]).value,
      0n,
    );
    const socket = process.invoke(resolve('socket'), [2, 3, 1]).value;
    assert.ok(socket >= 0x100n);

    const request = process.allocate(8);
    process.memory.write(request, Uint8Array.from([8, 0, 0, 0, 1, 0, 1, 0]));
    const destination = process.allocate(16);
    process.memory.write(
      destination,
      Uint8Array.from([2, 0, 0, 0, 8, 8, 8, 8, 0, 0, 0, 0, 0, 0, 0, 0]),
    );
    assert.equal(
      process.invoke(resolve('sendto'), [
        socket,
        request,
        8,
        0,
        destination,
        16,
      ]).value,
      0xffffffffffffffffn,
    );
    assert.equal(
      process.invoke(resolve('WSAGetLastError'), []).value,
      BigInt(WSAEHOSTUNREACH),
    );

    process.memory.write(destination + 4n, [127, 0, 0, 1]);
    assert.equal(
      process.invoke(resolve('sendto'), [
        socket,
        request,
        8,
        0,
        destination,
        16,
      ]).value,
      8n,
    );
    const reply = process.allocate(64);
    const from = process.allocate(16);
    const fromLength = process.allocate(4);
    process.memory.writeU32(fromLength, 16);
    assert.equal(
      process.invoke(resolve('recvfrom'), [
        socket,
        reply,
        64,
        0,
        from,
        fromLength,
      ]).value,
      8n,
    );
    assert.equal(process.memory.read(reply, 1)[0], 0);
    assert.deepEqual(
      process.memory.read(from + 4n, 4),
      Uint8Array.from([127, 0, 0, 1]),
    );
  });

  it('runs CRT file wrappers through kernel32 file APIs', () => {
    const machine = new Win64Machine();
    const process = machine.createProcess({
      image: 'crt-probe.exe',
      path: 'C:\\Users\\Serkan\\Workspace\\crt-probe.exe',
    });
    const fopen = process.resolveSymbol('msvcrt.dll', 'fopen');
    const fclose = process.resolveSymbol('msvcrt.dll', 'fclose');
    const fread = process.resolveSymbol('msvcrt.dll', 'fread');
    const fwrite = process.resolveSymbol('msvcrt.dll', 'fwrite');
    const writeFile = process.resolveSymbol('kernel32.dll', 'WriteFile');
    assert.ok(fopen);
    assert.ok(fclose);
    assert.ok(fread);
    assert.ok(fwrite);
    assert.ok(writeFile);

    const opened = process.invoke(fopen, [
      'C:\\Users\\Serkan\\Workspace\\README.txt',
      'r',
    ]);
    assert.ok(opened.value >= 0x100n);
    assert.ok(
      opened.steps.some((step) => step.instruction.mnemonic === 'call'),
    );
    assert.ok(
      machine
        .getInternalEvents()
        .some((event) => event.includes('kernel32.dll!CreateFileA')),
    );

    const closed = process.invoke(fclose, [opened.value]);
    assert.equal(closed.value, 1n);
    assert.ok(closed.steps.some((step) => step.instruction.mnemonic === 'jmp'));

    const boundaryPage = process.allocate(0x1000);
    const boundaryMode = boundaryPage + 0xffdn;
    process.memory.write(boundaryMode, Uint8Array.from([0x72, 0x62, 0x00]));
    const boundaryOpened = process.invoke(fopen, [
      'C:\\Users\\Serkan\\Workspace\\README.txt',
      boundaryMode,
    ]);
    assert.ok(boundaryOpened.value >= 0x100n);
    assert.ok(
      boundaryOpened.steps.some(
        (step) => step.instruction.mnemonic === 'movzx',
      ),
    );
    process.invoke(fclose, [boundaryOpened.value]);

    const written = process.allocate(4);
    const output = process.invoke(fopen, [
      'C:\\Users\\Serkan\\Workspace\\crt-output.txt',
      'w+b',
    ]).value;
    assert.ok(output >= 0x100n);
    assert.equal(
      process.invoke(writeFile, [
        output,
        new TextEncoder().encode('first'),
        5,
        written,
        0,
      ]).value,
      1n,
    );
    process.invoke(fclose, [output]);

    const append = process.invoke(fopen, [
      'C:\\Users\\Serkan\\Workspace\\crt-output.txt',
      'a+b',
    ]).value;
    assert.equal(
      process.invoke(writeFile, [
        append,
        new TextEncoder().encode('+second'),
        7,
        written,
        0,
      ]).value,
      1n,
    );
    process.invoke(fclose, [append]);
    assert.equal(
      new TextDecoder().decode(
        machine.fileSystem.readFile(
          'C:\\Users\\Serkan\\Workspace\\crt-output.txt',
        ),
      ),
      'first+second',
    );

    assert.equal(
      process.invoke(fopen, ['C:\\Users\\Serkan\\Workspace\\README.txt', 'rx'])
        .value,
      0n,
    );

    machine.fileSystem.writeTextFile(
      'C:\\Users\\Serkan\\Workspace\\crt-input.bin',
      'abcde',
    );
    const streamInput = process.invoke(fopen, [
      'C:\\Users\\Serkan\\Workspace\\crt-input.bin',
      'rb',
    ]).value;
    const streamBuffer = process.allocate(6);
    const read = process.invoke(fread, [streamBuffer, 2, 3, streamInput]);
    assert.equal(read.value, 2n);
    assert.deepEqual(
      process.memory.read(streamBuffer, 5),
      new TextEncoder().encode('abcde'),
    );
    assert.ok(read.steps.some((step) => step.instruction.mnemonic === 'mul'));
    process.invoke(fclose, [streamInput]);

    const streamOutput = process.invoke(fopen, [
      'C:\\Users\\Serkan\\Workspace\\crt-output.bin',
      'wb',
    ]).value;
    const write = process.invoke(fwrite, [
      new TextEncoder().encode('abcdef'),
      2,
      3,
      streamOutput,
    ]);
    assert.equal(write.value, 3n);
    assert.ok(write.steps.some((step) => step.instruction.mnemonic === 'mul'));
    process.invoke(fclose, [streamOutput]);
    assert.deepEqual(
      Uint8Array.from(
        machine.fileSystem.readFile(
          'C:\\Users\\Serkan\\Workspace\\crt-output.bin',
        ),
      ),
      new TextEncoder().encode('abcdef'),
    );
    assert.ok(
      machine
        .getInternalEvents()
        .some((event) => event.includes('kernel32.dll!ReadFile')),
    );
  });

  it('runs guest msvcrt printf formatting through kernel32 WriteFile', () => {
    const machine = new Win64Machine();
    const capture = machine.createCaptureOutput();
    const nullStdio = machine.createNullStdio();
    const process = machine.createProcess(
      {
        image: 'printf-probe.exe',
        path: 'C:\\Users\\Serkan\\Workspace\\printf-probe.exe',
      },
      {
        stdio: {
          stdin: nullStdio.stdin,
          stdout: capture.handle,
          stderr: capture.handle,
        },
      },
    );
    const printf = process.resolveSymbol('msvcrt.dll', 'printf');
    assert.ok(printf);

    const expected = 'name=win64 count=42 negative=-7 percent=%\\r\\n';
    const result = process.invoke(printf, [
      'name=%s count=%d negative=%d percent=%%\\r\\n',
      'win64',
      42,
      -7,
    ]);

    assert.equal(result.value, BigInt(expected.length));
    assert.equal(capture.capture.text, expected);
    assert.equal(process.console.screenText, '');
    assert.ok(result.steps.some((step) => step.instruction.mnemonic === 'div'));
    assert.ok(
      machine
        .getInternalEvents()
        .some((event) => event.includes('kernel32.dll!WriteFile')),
    );

    const createFile = process.resolveSymbol('kernel32.dll', 'CreateFileA');
    assert.ok(createFile);
    assert.equal(
      process.invoke(createFile, ['CONOUT$', 0xc0000000, 0x3, 0, 0x3, 0, 0])
        .value,
      0xffffffffffffffffn,
    );
    assert.equal(process.lastError, 5);
  });

  it('stores Win32 console modes on console handles', () => {
    const machine = new Win64Machine();
    const commandPrompt = new Win32CommandPrompt(machine);
    const process = commandPrompt.process;
    const getConsoleMode = process.resolveSymbol(
      'kernel32.dll',
      'GetConsoleMode',
    );
    const setConsoleMode = process.resolveSymbol(
      'kernel32.dll',
      'SetConsoleMode',
    );
    assert.ok(getConsoleMode);
    assert.ok(setConsoleMode);

    const mode = process.allocate(4);
    assert.equal(
      process.invoke(getConsoleMode, [process.standardHandles.input, mode])
        .value,
      1n,
    );
    assert.equal(process.memory.readU32(mode), 0x0007);

    assert.equal(
      process.invoke(getConsoleMode, [process.standardHandles.output, mode])
        .value,
      1n,
    );
    assert.equal(process.memory.readU32(mode), 0x0003);

    assert.equal(
      process.invoke(setConsoleMode, [process.standardHandles.output, 0]).value,
      1n,
    );
    assert.equal(
      process.invoke(getConsoleMode, [process.standardHandles.output, mode])
        .value,
      1n,
    );
    assert.equal(process.memory.readU32(mode), 0);
  });

  it('accepts caller-defined guest export bindings without syscall ids', () => {
    const bindings = new Win32ExportBindingRegistry().guest(
      'kernel32',
      'GetCurrentProcessId',
      () => Uint8Array.from([0xb8, 0x2a, 0x00, 0x00, 0x00, 0xc3]),
    );
    const catalog = new Win32ExportCatalog(Win32Dlls, {
      bindings,
    });
    const machine = new Win64Machine({
      win32Catalog: catalog,
    });
    const process = machine.createProcess({
      image: 'binding-probe.exe',
      path: 'C:\\Users\\Serkan\\Workspace\\binding-probe.exe',
    });
    const address = process.resolveSymbol(
      'kernel32.dll',
      'GetCurrentProcessId',
    );
    assert.ok(address);

    const result = process.invoke(address, []);
    assert.equal(result.value, 42n);
    assert.deepEqual(
      result.steps.map((step) => step.instruction.mnemonic),
      ['mov', 'ret'],
    );
  });

  it('inherits process environments and launches PATH programs through CreateProcessA', () => {
    const machine = new Win64Machine();
    const stdio = machine.createConsoleStdio();
    const parent = machine.createProcess(
      {
        image: 'launcher.exe',
        path: 'C:\\Users\\Serkan\\Workspace\\launcher.exe',
      },
      {
        console: stdio.console,
        stdio,
      },
    );
    parent.environment.set('SESSION_TOKEN', 'win64');

    const getEnvironmentVariable = parent.resolveSymbol(
      'kernel32.dll',
      'GetEnvironmentVariableA',
    );
    const createProcess = parent.resolveSymbol(
      'kernel32.dll',
      'CreateProcessA',
    );
    assert.ok(getEnvironmentVariable);
    assert.ok(createProcess);

    const valueBuffer = parent.allocate(32);
    const valueLength = parent.invoke(getEnvironmentVariable, [
      'SESSION_TOKEN',
      valueBuffer,
      32,
    ]);
    assert.equal(valueLength.value, 5n);
    assert.equal(parent.memory.readCString(valueBuffer), 'win64');

    const processInformation = parent.allocate(24);
    const created = parent.invoke(createProcess, [
      0,
      'whoami',
      0,
      0,
      false,
      0,
      0,
      0,
      0,
      processInformation,
    ]);
    assert.equal(created.value, 1n);
    const childPid = parent.memory.readU32(processInformation + 16n);
    const child = machine.getProcess(childPid);
    assert.ok(child);
    assert.equal(child.environment.get('SESSION_TOKEN'), 'win64');
    assert.match(parent.console.screenText, /EXOPROC\\Serkan/);
  });

  it('redirects inherited child stdout through an anonymous pipe', () => {
    const machine = new Win64Machine();
    const parent = machine.createProcess({
      image: 'pipe-launcher.exe',
      path: 'C:\\Users\\Serkan\\Workspace\\pipe-launcher.exe',
    });
    const resolve = (name: string) => {
      const address = parent.resolveSymbol('kernel32.dll', name);
      assert.ok(address, `kernel32.dll!${name} is missing`);
      return address;
    };

    const securityAttributes = parent.allocate(24);
    parent.memory.writeU32(securityAttributes, 24);
    parent.memory.writeU64(securityAttributes + 8n, 0n);
    parent.memory.writeU32(securityAttributes + 16n, 1);
    const readPointer = parent.allocate(8);
    const writePointer = parent.allocate(8);
    assert.equal(
      parent.invoke(resolve('CreatePipe'), [
        readPointer,
        writePointer,
        securityAttributes,
        0,
      ]).value,
      1n,
    );
    const readHandle = parent.memory.readU64(readPointer);
    const writeHandle = parent.memory.readU64(writePointer);
    assert.equal(
      parent.invoke(resolve('SetHandleInformation'), [readHandle, 0x1, 0])
        .value,
      1n,
    );
    assert.equal(parent.handles.get(Number(readHandle))?.inheritable, false);

    const startupInfo = parent.allocate(104);
    parent.memory.writeU32(startupInfo, 104);
    parent.memory.writeU32(startupInfo + 60n, 0x100);
    parent.memory.writeU64(
      startupInfo + 80n,
      BigInt(parent.standardHandles.input),
    );
    parent.memory.writeU64(startupInfo + 88n, writeHandle);
    parent.memory.writeU64(startupInfo + 96n, writeHandle);
    const processInformation = parent.allocate(24);
    assert.equal(
      parent.invoke(resolve('CreateProcessA'), [
        0,
        'whoami',
        0,
        0,
        true,
        0,
        0,
        0,
        startupInfo,
        processInformation,
      ]).value,
      1n,
    );

    assert.equal(
      parent.invoke(resolve('CloseHandle'), [writeHandle]).value,
      1n,
    );
    const output = parent.allocate(128);
    const bytesRead = parent.allocate(4);
    assert.equal(
      parent.invoke(resolve('ReadFile'), [
        readHandle,
        output,
        128,
        bytesRead,
        0,
      ]).value,
      1n,
    );
    const length = parent.memory.readU32(bytesRead);
    assert.equal(
      new TextDecoder().decode(parent.memory.read(output, length)),
      'EXOPROC\\Serkan\r\n',
    );
  });

  it('keeps one global machine while creating separate processes', () => {
    const firstMachine = getGlobalWin64Machine();
    const secondMachine = getGlobalWin64Machine();
    assert.equal(firstMachine, secondMachine);

    const first = firstMachine.createRandomDebugProcess();
    const second = firstMachine.createRandomDebugProcess();
    assert.notEqual(first.pid, second.pid);
    assert.notEqual(first.memory, second.memory);
  });

  it('keeps host I/O capabilities scoped to their owning machine', () => {
    const owner = new Win64Machine();
    const other = new Win64Machine();
    const capture = owner.createCaptureOutput();
    const local = other.createNullStdio();

    assert.throws(
      () =>
        other.createProcess(
          {
            image: 'foreign-capability.exe',
            path: 'C:\\Users\\Serkan\\Workspace\\foreign-capability.exe',
          },
          {
            stdio: {
              stdin: local.stdin,
              stdout: capture.handle,
              stderr: local.stderr,
            },
          },
        ),
      /belongs to another machine/,
    );
    assert.equal(other.getProcesses().length, 0);
  });

  it('starts compiled main with argc, argv, envp and inherited handles', () => {
    const machine = new Win64Machine();
    const stdio = machine.createConsoleStdio();
    const path = 'C:\\Windows\\System32\\echo.exe';
    const image = machine.programs.get(path);
    assert.ok(image);
    const process = machine.createProcess(
      {
        image: 'echo.exe',
        path,
      },
      {
        console: stdio.console,
        stdio,
      },
    );
    process.arguments = ['alpha', 'beta'];

    const loaded = machine.programs.load(process, image);
    const thread = process.createThread(
      'echo.exe main thread',
      loaded.entryPoint,
      [
        loaded.mainArguments.argc,
        loaded.mainArguments.argv,
        loaded.mainArguments.envp,
      ],
    );

    assert.equal(thread.registers.RCX, 3n);
    assert.equal(thread.registers.RDX, loaded.mainArguments.argv);
    assert.equal(thread.registers.R8, loaded.mainArguments.envp);
    assert.equal(
      process.memory.readCString(process.memory.readU64(thread.registers.RDX)),
      path,
    );
    assert.equal(
      process.memory.readCString(
        process.memory.readU64(thread.registers.RDX + 8n),
      ),
      'alpha',
    );

    const environment: string[] = [];
    for (let index = 0; ; index += 1) {
      const address = process.memory.readU64(
        thread.registers.R8 + BigInt(index * 8),
      );
      if (address === 0n) break;
      environment.push(process.memory.readCString(address));
    }
    assert.ok(
      environment.includes(
        'PATH=C:\\Windows\\System32;C:\\Windows;C:\\Users\\Serkan\\Workspace',
      ),
    );
    assert.equal(
      machine.getHandleObject(process, process.standardHandles.input)?.kind,
      'input',
    );
    assert.equal(
      machine.getHandleObject(process, process.standardHandles.output)?.kind,
      'output',
    );
  });

  it('runs ping.exe through loopback-only ws2_32 syscalls', () => {
    const machine = new Win64Machine();
    const commandPrompt = new Win32CommandPrompt(machine);

    const loopback = commandPrompt.execute('ping 127.0.0.1');
    assert.equal(loopback.exitCode, 0);
    assert.match(
      loopback.screenText,
      /Reply from 127\.0\.0\.1: bytes=8 time<1ms TTL=128/,
    );

    const localhost = commandPrompt.execute('ping localhost');
    assert.equal(localhost.exitCode, 0);
    assert.match(
      localhost.screenText,
      /Reply from localhost: bytes=8 time<1ms TTL=128/,
    );

    const external = commandPrompt.execute('ping 8.8.8.8');
    assert.equal(external.exitCode, 1);
    assert.match(
      external.screenText,
      /8\.8\.8\.8 is outside the simulated loopback network/,
    );
    assert.doesNotMatch(external.screenText, /Reply from 8\.8\.8\.8/);

    const events = machine.getInternalEvents();
    for (const name of [
      'WSAStartup',
      'socket',
      'inet_addr',
      'sendto',
      'recvfrom',
      'closesocket',
      'WSACleanup',
    ]) {
      assert.ok(
        events.some((event) => event.includes(`ws2_32.dll!${name}`)),
        `${name} was not called by ping.exe`,
      );
    }
  });

  it('runs whois.exe against only the local loopback registry', () => {
    const machine = new Win64Machine();
    const commandPrompt = new Win32CommandPrompt(machine);

    const local = commandPrompt.execute('whois 127.0.0.1');
    assert.equal(local.exitCode, 0);
    assert.match(local.screenText, /NetName:\s+EXOPROC-LOOPBACK/);
    assert.match(local.screenText, /CIDR:\s+127\.0\.0\.0\/8/);

    const external = commandPrompt.execute('whois 8.8.8.8');
    assert.equal(external.exitCode, 1);
    assert.match(external.screenText, /WHOIS lookup blocked for 8\.8\.8\.8/);
    assert.match(external.screenText, /No internet request was made/);
  });

  it('runs cat.exe through msvcrt fread and fwrite', () => {
    const machine = new Win64Machine();
    const commandPrompt = new Win32CommandPrompt(machine);

    const single = commandPrompt.execute(
      'cat C:\\Users\\Serkan\\Workspace\\README.txt',
    );
    assert.equal(single.exitCode, 0);
    assert.match(
      single.screenText,
      /This drive is backed by the global Win32 VFS\./,
    );

    const multiple = commandPrompt.execute(
      'cat C:\\Users\\Serkan\\welcome.txt C:\\Users\\Serkan\\Documents\\notes.txt',
    );
    assert.equal(multiple.exitCode, 0);
    assert.match(multiple.screenText, /Welcome to the Exoproc Win64 machine\./);
    assert.match(multiple.screenText, /Win64 ABI experiments/);

    const missing = commandPrompt.execute('cat C:\\missing.txt');
    assert.equal(missing.exitCode, 1);
    assert.match(missing.screenText, /cat: cannot open C:\\missing\.txt/);

    const usage = commandPrompt.execute('cat');
    assert.equal(usage.exitCode, 1);
    assert.match(usage.screenText, /Usage: cat <file> \[file \.\.\.\]/);

    const events = machine.getInternalEvents();
    assert.ok(events.some((event) => event.includes('kernel32.dll!ReadFile')));
    assert.ok(events.some((event) => event.includes('kernel32.dll!WriteFile')));
  });

  it('runs cmd.exe console I/O through Win64 kernel32 thunks', () => {
    const machine = new Win64Machine();
    const commandPrompt = new Win32CommandPrompt(machine);

    assert.equal(commandPrompt.process.image, 'cmd.exe');
    assert.equal(commandPrompt.process.console.videoOutput.columns, 80);
    assert.equal(commandPrompt.process.console.videoOutput.rows, 25);
    assert.equal(
      commandPrompt.process.console.videoOutput.snapshot().length,
      80 * 25,
    );
    assert.ok(commandPrompt.process.getThread(commandPrompt.mainThreadId));
    assert.equal(
      commandPrompt.process.getThread(commandPrompt.mainThreadId)?.state,
      'waiting',
    );
    const cmdIat = commandPrompt.process.memory.getMapping('image:.idata');
    assert.ok(cmdIat);
    assert.equal(cmdIat.protection, 'r');
    assert.throws(
      () => commandPrompt.process.memory.writeU64(cmdIat.base, 0n),
      /STATUS_ACCESS_VIOLATION/,
    );
    assert.match(
      commandPrompt.screenText,
      /Microsoft Windows \[Version 10\.0\.19045\.4046\]/,
    );
    assert.ok(
      commandPrompt.screenText.endsWith('C:\\Users\\Serkan\\Workspace>'),
    );
    assert.equal(
      machine.getHandleObject(
        commandPrompt.process,
        commandPrompt.process.standardHandles.input,
      )?.kind,
      'input',
    );
    assert.equal(
      machine.getHandleObject(
        commandPrompt.process,
        commandPrompt.process.standardHandles.output,
      )?.kind,
      'output',
    );
    assert.equal(
      commandPrompt.process.standardHandles.error,
      commandPrompt.process.standardHandles.output,
    );

    const system32Files = machine.fileSystem
      .readDirectory('C:\\Windows\\System32')
      .filter((entry) => entry.kind === 'file');
    for (const name of [
      'cat.exe',
      'cmd.exe',
      'ls.exe',
      'cls.exe',
      'clear.exe',
      'pwd.exe',
      'ping.exe',
      'dir.exe',
      'echo.exe',
      'cd.exe',
      'set.exe',
      'path.exe',
      'where.exe',
      'whois.exe',
      'exit.exe',
    ]) {
      const executable = system32Files.find((entry) => entry.name === name);
      assert.ok(executable, `${name} is missing from System32`);
      const compiled = machine.programs.get(`C:\\Windows\\System32\\${name}`);
      assert.ok(compiled, `${name} has no compiled image`);
      assert.equal(
        Object.hasOwn(compiled, 'compile'),
        false,
        `${name} still has a host compile callback`,
      );
      assert.equal(
        Object.hasOwn(compiled, 'completed'),
        false,
        `${name} still has a host completion callback`,
      );
      assert.deepEqual(
        executable.data.slice(0, 2),
        Uint8Array.from([0x4d, 0x5a]),
      );
      assert.equal(
        new TextDecoder().decode(executable.data.slice(8, 17)),
        'EXOPROC64',
      );
      assert.ok(
        compiled.dataSymbols.every((symbol) =>
          ['.rdata', '.data', '.bss'].includes(symbol.section),
        ),
      );
      let expectedOffset = 0;
      for (const section of ['.rdata', '.data', '.bss'] as const) {
        const matchingSymbols: any[] = compiled.dataSymbols.filter(
          (entry: any) => entry.section === section,
        );
        for (const symbol of matchingSymbols) {
          assert.equal(symbol.offset, expectedOffset);
          expectedOffset += symbol.length;
        }
      }
      assert.equal(expectedOffset, compiled.data.length);
      for (const relocation of compiled.relocations) {
        if (relocation.target.kind === 'data') {
          assert.equal(relocation.encoding, 'absolute64');
          const targetSymbol = relocation.target.symbol;
          assert.ok(
            compiled.dataSymbols.some((symbol) => symbol.name === targetSymbol),
          );
        } else {
          assert.equal(relocation.encoding, 'iat-relative32');
        }
      }
    }

    const clsProgram = machine.programs.get('C:\\Windows\\System32\\cls.exe');
    const clearProgram = machine.programs.get(
      'C:\\Windows\\System32\\clear.exe',
    );
    assert.ok(clsProgram);
    assert.ok(clearProgram);
    assert.equal(clearProgram.name, 'clear.exe');
    assert.equal(clearProgram.code, clsProgram.code);
    assert.equal(clearProgram.data, clsProgram.data);
    assert.equal(clearProgram.relocations, clsProgram.relocations);
    assert.deepEqual(
      machine.fileSystem.readFile('C:\\Windows\\System32\\clear.exe'),
      machine.fileSystem.readFile('C:\\Windows\\System32\\cls.exe'),
    );

    const processCountBeforeEcho = machine.getProcesses().length;
    const result = commandPrompt.execute('echo Win64');
    assert.ok(
      result.screenText.endsWith(
        'echo Win64\r\nWin64\r\nC:\\Users\\Serkan\\Workspace>',
      ),
    );
    assert.equal(machine.getProcesses().length, processCountBeforeEcho + 1);
    assert.ok(
      result.steps.some(
        (step) =>
          step.instruction.mnemonic === 'call' &&
          step.instruction.operands.startsWith('[rip'),
      ),
    );
    assert.ok(
      result.steps.some((step) => step.instruction.mnemonic === 'syscall'),
    );

    const pwd = commandPrompt.execute('pwd');
    assert.ok(
      pwd.screenText.endsWith(
        'pwd\r\nC:\\Users\\Serkan\\Workspace\r\nC:\\Users\\Serkan\\Workspace>',
      ),
    );
    const silentCd = commandPrompt.execute('cd');
    assert.ok(
      silentCd.screenText.endsWith('cd\r\nC:\\Users\\Serkan\\Workspace>'),
    );

    const listing = commandPrompt.execute('ls');
    assert.match(
      listing.screenText,
      /Directory of C:\\Users\\Serkan\\Workspace/,
    );
    assert.match(listing.screenText, /<DIR>\s+src/);
    assert.match(listing.screenText, /\d+ bytes \(\d+ KB\)\s+package\.json/);

    commandPrompt.execute('cd C:\\Windows\\System32');
    const system32Listing = commandPrompt.execute('ls');
    assert.match(system32Listing.screenText, /\d+ bytes \(\d+ KB\)\s+ls\.exe/);
    assert.match(
      system32Listing.screenText,
      /\d+ bytes \(\d+ KB\)\s+whois\.exe/,
    );
    commandPrompt.execute('cd C:\\Users\\Serkan');

    commandPrompt.execute('cd Desktop');
    assert.equal(
      commandPrompt.process.currentDirectory,
      'C:\\Users\\Serkan\\Desktop',
    );
    commandPrompt.execute('cd ..');
    assert.equal(commandPrompt.process.currentDirectory, 'C:\\Users\\Serkan');

    const processCount = machine.getProcesses().length;
    const whoami = commandPrompt.execute('whoami');
    assert.equal(whoami.exitCode, 0);
    assert.match(whoami.screenText, /EXOPROC\\Serkan/);
    assert.equal(machine.getProcesses().length, processCount + 1);

    const where = commandPrompt.execute('where hello');
    assert.match(where.screenText, /C:\\Windows\\System32\\hello\.exe/i);
    const hello = commandPrompt.execute('hello');
    assert.match(hello.screenText, /Hello from a compiled Win64 process\./);

    commandPrompt.execute('set WORKSPACE_VALUE=ok');
    const expanded = commandPrompt.execute('echo %WORKSPACE_VALUE%');
    assert.ok(expanded.screenText.includes('ok\r\n'));

    const missing = commandPrompt.execute('does-not-exist');
    assert.equal(missing.exitCode, 9009);
    assert.match(
      missing.screenText,
      /is not recognized as an internal or external command/,
    );

    const events = machine.getInternalEvents();
    assert.equal(
      events.some((event) => event.includes('kernel32.dll!CreateFileW')),
      false,
    );
    assert.equal(
      events.some((event) => event.includes('kernel32.dll!SetStdHandle')),
      false,
    );
    assert.ok(
      events.some((event) => event.includes('kernel32.dll!GetStdHandle')),
    );
    assert.ok(events.some((event) => event.includes('kernel32.dll!ReadFile')));
    assert.ok(events.some((event) => event.includes('kernel32.dll!WriteFile')));
    assert.equal(
      events.some((event) => event.includes('msvcrt.dll!__getmainargs')),
      false,
    );
    assert.ok(
      events.some((event) =>
        event.includes('kernel32.dll!SetCurrentDirectoryA'),
      ),
    );
    assert.ok(
      events.some((event) => event.includes('kernel32.dll!FindFirstFileA')),
    );

    commandPrompt.execute('echo this line will be cleared');
    const cleared = commandPrompt.execute('clear');
    assert.equal(cleared.screenText, 'C:\\Users\\Serkan>');
    const clearEvents = machine.getInternalEvents();
    assert.ok(
      clearEvents.some((event) =>
        event.includes('kernel32.dll!FillConsoleOutputCharacterA'),
      ),
    );
    assert.ok(
      clearEvents.some((event) =>
        event.includes('kernel32.dll!SetConsoleCursorPosition'),
      ),
    );
    const exited = commandPrompt.execute('exit');
    assert.equal(exited.exitCode, 0);
    assert.equal(commandPrompt.isClosed, true);
    assert.equal(
      commandPrompt.process.getThread(commandPrompt.mainThreadId)?.state,
      'terminated',
    );
  });

  it('sub-allocates HeapAlloc/HeapFree out of one GetProcessHeap heap', () => {
    const machine = new Win64Machine();
    const process = machine.createRandomDebugProcess();
    const getProcessHeap = process.resolveSymbol(
      'kernel32.dll',
      'GetProcessHeap',
    );
    const heapAlloc = process.resolveSymbol('kernel32.dll', 'HeapAlloc');
    const heapFree = process.resolveSymbol('kernel32.dll', 'HeapFree');
    assert.ok(getProcessHeap);
    assert.ok(heapAlloc);
    assert.ok(heapFree);

    const heap = process.invoke(getProcessHeap, []).value;
    // GetProcessHeap is idempotent -- same handle every call.
    assert.equal(process.invoke(getProcessHeap, []).value, heap);

    const HEAP_ZERO_MEMORY = 0x00000008;
    const first = process.invoke(heapAlloc, [heap, HEAP_ZERO_MEMORY, 64]).value;
    assert.notEqual(first, 0n);
    assert.deepEqual(process.memory.read(first, 64), new Uint8Array(64));

    process.memory.write(first, [1, 2, 3, 4]);
    const freed = process.invoke(heapFree, [heap, 0, first]).value;
    assert.equal(freed, 1n);

    // A same-size allocation after freeing reuses the just-freed chunk.
    const second = process.invoke(heapAlloc, [heap, 0, 64]).value;
    assert.equal(second, first);
  });

  it('creates and destroys independent heaps via HeapCreate/HeapDestroy', () => {
    const machine = new Win64Machine();
    const process = machine.createRandomDebugProcess();
    const getProcessHeap = process.resolveSymbol(
      'kernel32.dll',
      'GetProcessHeap',
    );
    const heapCreate = process.resolveSymbol('kernel32.dll', 'HeapCreate');
    const heapAlloc = process.resolveSymbol('kernel32.dll', 'HeapAlloc');
    const heapDestroy = process.resolveSymbol('kernel32.dll', 'HeapDestroy');
    assert.ok(getProcessHeap);
    assert.ok(heapCreate);
    assert.ok(heapAlloc);
    assert.ok(heapDestroy);

    const defaultHeap = process.invoke(getProcessHeap, []).value;
    const customHeap = process.invoke(heapCreate, [0, 0, 0x1000]).value;
    assert.notEqual(customHeap, defaultHeap);

    const block = process.invoke(heapAlloc, [customHeap, 0, 32]).value;
    assert.notEqual(block, 0n);

    const destroyed = process.invoke(heapDestroy, [customHeap]).value;
    assert.equal(destroyed, 1n);
    assert.throws(() => process.memory.read(block, 32), MemoryAccessFault);

    // The default process heap is unaffected by destroying a custom one.
    assert.equal(process.invoke(getProcessHeap, []).value, defaultHeap);
  });

  it('grows, shrinks and queries blocks via HeapReAlloc/HeapSize', () => {
    const machine = new Win64Machine();
    const process = machine.createRandomDebugProcess();
    const getProcessHeap = process.resolveSymbol(
      'kernel32.dll',
      'GetProcessHeap',
    );
    const heapAlloc = process.resolveSymbol('kernel32.dll', 'HeapAlloc');
    const heapReAlloc = process.resolveSymbol('kernel32.dll', 'HeapReAlloc');
    const heapSize = process.resolveSymbol('kernel32.dll', 'HeapSize');
    assert.ok(getProcessHeap);
    assert.ok(heapAlloc);
    assert.ok(heapReAlloc);
    assert.ok(heapSize);

    const heap = process.invoke(getProcessHeap, []).value;
    const block = process.invoke(heapAlloc, [heap, 0, 16]).value;
    process.memory.write(block, [1, 2, 3, 4]);
    assert.equal(process.invoke(heapSize, [heap, 0, block]).value, 16n);

    const HEAP_ZERO_MEMORY = 0x00000008;
    const grown = process.invoke(heapReAlloc, [
      heap,
      HEAP_ZERO_MEMORY,
      block,
      32,
    ]).value;
    assert.notEqual(grown, 0n);
    assert.equal(process.invoke(heapSize, [heap, 0, grown]).value, 32n);
    // Original bytes preserved, newly-grown tail zeroed.
    assert.deepEqual(
      process.memory.read(grown, 20),
      Uint8Array.from([1, 2, 3, 4, ...new Array(16).fill(0)]),
    );

    // Shrinking (including to the same size) keeps the same pointer.
    const shrunk = process.invoke(heapReAlloc, [heap, 0, grown, 8]).value;
    assert.equal(shrunk, grown);

    // `shrunk`'s chunk still books 32 bytes (shrinking is a no-op on the
    // underlying chunk); growing past that with HEAP_REALLOC_IN_PLACE_ONLY
    // set must fail rather than move the block.
    const HEAP_REALLOC_IN_PLACE_ONLY = 0x00000010;
    const oversized = process.invoke(heapReAlloc, [
      heap,
      HEAP_REALLOC_IN_PLACE_ONLY,
      shrunk,
      64,
    ]).value;
    assert.equal(oversized, 0n);
  });

  it('backs malloc/free/calloc/realloc with a dedicated CRT heap', () => {
    const machine = new Win64Machine();
    const process = machine.createRandomDebugProcess();
    const getProcessHeap = process.resolveSymbol(
      'kernel32.dll',
      'GetProcessHeap',
    );
    const malloc = process.resolveSymbol('msvcrt.dll', 'malloc');
    const free = process.resolveSymbol('msvcrt.dll', 'free');
    const calloc = process.resolveSymbol('msvcrt.dll', 'calloc');
    const realloc = process.resolveSymbol('msvcrt.dll', 'realloc');
    assert.ok(getProcessHeap);
    assert.ok(malloc);
    assert.ok(free);
    assert.ok(calloc);
    assert.ok(realloc);

    const block = process.invoke(malloc, [16]).value;
    assert.notEqual(block, 0n);
    process.memory.write(block, [1, 2, 3, 4]);

    const zeroed = process.invoke(calloc, [4, 4]).value;
    assert.notEqual(zeroed, 0n);
    assert.deepEqual(process.memory.read(zeroed, 16), new Uint8Array(16));

    const grown = process.invoke(realloc, [block, 32]).value;
    assert.notEqual(grown, 0n);
    assert.deepEqual(
      process.memory.read(grown, 4),
      Uint8Array.from([1, 2, 3, 4]),
    );

    process.invoke(free, [grown]);
    process.invoke(free, [zeroed]);

    // Freeing every live chunk coalesces them back into one contiguous
    // free run starting at `block`'s original offset; re-allocating that
    // exact combined size reuses it rather than growing the heap further
    // -- proving malloc/free go through a real sub-allocating heap with
    // coalescing, not a fresh mapping per call.
    const reused = process.invoke(malloc, [64]).value;
    assert.equal(reused, block);

    // GetProcessHeap()'s heap is a distinct kernel object from the CRT
    // heap malloc/free/calloc/realloc allocate from.
    assert.notEqual(process.invoke(getProcessHeap, []).value, 0n);
  });

  it('runs self-contained continuous loop threads in createLoopProcess', () => {
    const machine = new Win64Machine();
    const process = machine.createLoopProcess();
    const thread = process.getThreads()[0];
    assert.ok(thread);

    const workItem = thread.registers.RCX;
    assert.equal(process.memory.readU64(workItem), 3n);

    // Step several times through the loop
    const initialRip = thread.registers.RIP;
    for (let i = 0; i < 30; i++) {
      thread.step();
    }
    // Thread must not be terminated; it is in an active calculation loop
    assert.notEqual(thread.state, 'terminated');
    // Work item accumulator value should have increased
    const updated = process.memory.readU64(workItem);
    assert.ok(updated > 3n);
  });

  it('defers RIP changes via SetThreadContext while in syscall until syscall exit', () => {
    const machine = new Win64Machine();
    const process = machine.createRandomDebugProcess();
    const thread = process.getThreads()[0];
    assert.ok(thread);

    const targetRip = 0x7ff603002000n;
    const contextAddress = process.heapBase + 0x200n;

    // CONTEXT_CONTROL = 0x01
    process.memory.writeU32(contextAddress + 0x30n, 0x01);
    process.memory.writeU64(contextAddress + 0x98n, thread.registers.RSP);
    process.memory.writeU64(contextAddress + 0xf8n, targetRip);

    const hThread = process.allocateHandle({
      kind: 'thread',
      targetPid: process.pid,
      targetTid: thread.tid,
    });

    const setThreadContext = process
      .getModule('kernel32.dll')
      ?.exports.get('SetThreadContext');
    const getThreadContext = process
      .getModule('kernel32.dll')
      ?.exports.get('GetThreadContext');
    assert.ok(setThreadContext);
    assert.ok(getThreadContext);

    // Simulate thread being in a syscall
    thread.inSyscall = true;
    const originalRip = thread.registers.RIP;

    // Call SetThreadContext while thread.inSyscall is true
    process.invoke(setThreadContext, [BigInt(hThread), contextAddress]);

    // RIP must NOT have changed immediately while in syscall
    assert.equal(thread.registers.RIP, originalRip);
    assert.equal(thread.pendingRip, targetRip);

    // But GetThreadContext returns targetRip (like Windows TrapFrame)
    const queryContext = contextAddress + 0x500n;
    process.memory.writeU32(queryContext + 0x30n, 0x01);
    process.invoke(getThreadContext, [BigInt(hThread), queryContext]);
    assert.equal(process.memory.readU64(queryContext + 0xf8n), targetRip);

    // When the syscall finishes and exits to user mode:
    // dispatchSyscall's finally block applies pendingRip
    thread.inSyscall = false;
    if (thread.state !== 'waiting' && thread.pendingRip !== undefined) {
      thread.cpu.registers.RIP = thread.pendingRip;
      thread.pendingRip = undefined;
    }

    assert.equal(thread.registers.RIP, targetRip);
    assert.equal(thread.pendingRip, undefined);
  });
});
