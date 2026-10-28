import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Win64Machine } from '../../packages/simulate/dist/runtime/win64-machine.js';
import {
  FFIType,
  bindWin64Process,
  dlopen,
} from '../../packages/simulate/dist/runtime/bun-ffi.js';

describe('Thread Context, Snapshot & Gadget Stubs', () => {
  it('manipulates thread context via GetThreadContext and SetThreadContext', () => {
    const machine = new Win64Machine();
    const process = machine.createProcess(
      {
        image: 'test-host.exe',
        path: 'C:\\Users\\Serkan\\Workspace\\test-host.exe',
      },
      { stdio: machine.createNullStdio() },
    );
    const workerThread = process.createThread(
      'Worker',
      0x00007ff600002000n,
      0x1000n,
    );

    const restore = bindWin64Process(process);
    try {
      const kernel32 = dlopen('kernel32', {
        GetCurrentThread: { args: [], returns: FFIType.u64 },
        GetCurrentThreadId: { args: [], returns: FFIType.u32 },
        OpenThread: {
          args: [FFIType.u32, FFIType.bool, FFIType.u32],
          returns: FFIType.u64,
        },
        GetThreadId: { args: [FFIType.u64], returns: FFIType.u32 },
        SuspendThread: { args: [FFIType.u64], returns: FFIType.u32 },
        ResumeThread: { args: [FFIType.u64], returns: FFIType.u32 },
        GetThreadContext: {
          args: [FFIType.u64, FFIType.ptr],
          returns: FFIType.bool,
        },
        SetThreadContext: {
          args: [FFIType.u64, FFIType.ptr],
          returns: FFIType.bool,
        },
        CloseHandle: { args: [FFIType.u64], returns: FFIType.bool },
      });

      // Test OpenThread and GetThreadId
      const hThread = kernel32.symbols.OpenThread!(
        0x1fffff,
        false,
        workerThread.tid,
      );
      assert.notEqual(hThread, 0n);
      const tid = kernel32.symbols.GetThreadId!(hThread);
      assert.equal(tid, workerThread.tid);

      // Pseudo-handle GetCurrentThread (-2n)
      const currentPseudo = kernel32.symbols.GetCurrentThread!();
      assert.equal(currentPseudo, 0xfffffffffffffffen);
      const currentTid = Number(kernel32.symbols.GetThreadId!(currentPseudo));
      assert.ok(currentTid > 0);

      // CONTEXT struct is 1232 bytes, ContextFlags at 0x30
      const contextBuf = Buffer.alloc(1232);
      // CONTEXT_CONTROL (0x100001) | CONTEXT_INTEGER (0x100002) = 0x100003
      contextBuf.writeUInt32LE(0x00100003, 0x30);

      // Read context
      const getOk = kernel32.symbols.GetThreadContext!(hThread, contextBuf);
      assert.ok(getOk);

      // Verify RIP is entry point
      const readRip = contextBuf.readBigUInt64LE(0xf8);
      assert.equal(readRip, 0x00007ff600002000n);

      // Modify RIP, RSP and RAX via SetThreadContext
      contextBuf.writeBigUInt64LE(0x00007ff600005555n, 0xf8); // RIP
      contextBuf.writeBigUInt64LE(0x0000000000123456n, 0x98); // RSP
      contextBuf.writeBigUInt64LE(0xdeadbeefcafebaben, 0x78); // RAX

      const setOk = kernel32.symbols.SetThreadContext!(hThread, contextBuf);
      assert.ok(setOk);

      assert.equal(workerThread.cpu.registers.RIP, 0x00007ff600005555n);
      assert.equal(workerThread.cpu.registers.RSP, 0x0000000000123456n);
      assert.equal(workerThread.cpu.registers.RAX, 0xdeadbeefcafebaben);

      kernel32.symbols.CloseHandle!(hThread);
    } finally {
      restore();
    }
  });

  it('enumerates processes, threads, and modules via Toolhelp32 snapshot', () => {
    const machine = new Win64Machine();
    const proc1 = machine.createProcess(
      {
        image: 'parent.exe',
        path: 'C:\\Users\\Serkan\\Workspace\\parent.exe',
      },
      { stdio: machine.createNullStdio() },
    );
    proc1.createThread('Main', 0x1000n, 0x1000n);
    const proc2 = machine.createProcess(
      {
        image: 'child.exe',
        path: 'C:\\Users\\Serkan\\Workspace\\child.exe',
      },
      { stdio: machine.createNullStdio() },
    );
    proc2.createThread('Worker1', 0x1000n, 0x1000n);

    const restore = bindWin64Process(proc1);
    try {
      const kernel32 = dlopen('kernel32', {
        CreateToolhelp32Snapshot: {
          args: [FFIType.u32, FFIType.u32],
          returns: FFIType.u64,
        },
        Process32FirstW: {
          args: [FFIType.u64, FFIType.ptr],
          returns: FFIType.bool,
        },
        Process32NextW: {
          args: [FFIType.u64, FFIType.ptr],
          returns: FFIType.bool,
        },
        Thread32First: {
          args: [FFIType.u64, FFIType.ptr],
          returns: FFIType.bool,
        },
        Thread32Next: {
          args: [FFIType.u64, FFIType.ptr],
          returns: FFIType.bool,
        },
        Module32FirstW: {
          args: [FFIType.u64, FFIType.ptr],
          returns: FFIType.bool,
        },
        Module32NextW: {
          args: [FFIType.u64, FFIType.ptr],
          returns: FFIType.bool,
        },
        CloseHandle: { args: [FFIType.u64], returns: FFIType.bool },
      });

      // TH32CS_SNAPALL = 0x0000001f
      const snapHandle = kernel32.symbols.CreateToolhelp32Snapshot!(0x1f, 0);
      assert.notEqual(snapHandle, 0n);

      // Iterate processes
      const procBuf = Buffer.alloc(568);
      const foundProcesses: { pid: number; name: string }[] = [];
      let ok = kernel32.symbols.Process32FirstW!(snapHandle, procBuf);
      while (ok) {
        const pid = procBuf.readUInt32LE(8);
        const nameRaw = procBuf.subarray(44, 44 + 520);
        const name = nameRaw.toString('utf16le').replace(/\0.*$/u, '');
        foundProcesses.push({ pid, name });
        ok = kernel32.symbols.Process32NextW!(snapHandle, procBuf);
      }
      assert.ok(foundProcesses.some((p) => p.name === 'parent.exe'));
      assert.ok(foundProcesses.some((p) => p.name === 'child.exe'));

      // Iterate threads
      const threadBuf = Buffer.alloc(28);
      const foundThreads: { tid: number; ownerPid: number }[] = [];
      let tok = kernel32.symbols.Thread32First!(snapHandle, threadBuf);
      while (tok) {
        const tid = threadBuf.readUInt32LE(8);
        const ownerPid = threadBuf.readUInt32LE(12);
        foundThreads.push({ tid, ownerPid });
        tok = kernel32.symbols.Thread32Next!(snapHandle, threadBuf);
      }
      assert.ok(foundThreads.some((t) => t.ownerPid === proc1.pid));
      assert.ok(foundThreads.some((t) => t.ownerPid === proc2.pid));

      // Iterate modules
      const modBuf = Buffer.alloc(1080);
      const foundModules: { name: string; base: bigint }[] = [];
      let mok = kernel32.symbols.Module32FirstW!(snapHandle, modBuf);
      while (mok) {
        const base = modBuf.readBigUInt64LE(24);
        const nameRaw = modBuf.subarray(48, 48 + 512);
        const name = nameRaw.toString('utf16le').replace(/\0.*$/u, '');
        foundModules.push({ name, base });
        mok = kernel32.symbols.Module32NextW!(snapHandle, modBuf);
      }
      assert.ok(
        foundModules.some((m) => m.name.toLowerCase() === 'kernel32.dll'),
      );
      assert.ok(foundModules.some((m) => m.name.toLowerCase() === 'ntdll.dll'));

      kernel32.symbols.CloseHandle!(snapHandle);
    } finally {
      restore();
    }
  });

  it('embeds nthread gadget stubs in kernel32 and ntdll pages', () => {
    const machine = new Win64Machine();
    const process = machine.createProcess(
      {
        image: 'gadget-test.exe',
        path: 'C:\\Users\\Serkan\\Workspace\\gadget-test.exe',
      },
      { stdio: machine.createNullStdio() },
    );

    const kernel32Mod = process.modules.find(
      (m) => m.name.toLowerCase() === 'kernel32.dll',
    );
    assert.ok(kernel32Mod);

    const kernel32Bytes = process.memory.read(
      kernel32Mod.base,
      kernel32Mod.size,
    );

    const findBytes = (needle: number[]): boolean => {
      outer: for (let i = 0; i <= kernel32Bytes.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) {
          if (kernel32Bytes[i + j] !== needle[j]) continue outer;
        }
        return true;
      }
      return false;
    };

    // 'EB FE' - jmp $
    assert.ok(findBytes([0xeb, 0xfe]), 'Should contain EB FE (spin stub)');
    // 'C3' - ret
    assert.ok(findBytes([0xc3]), 'Should contain C3 (ret stub)');
    // '48 83 C4 28 C3' - add rsp, 0x28; ret
    assert.ok(
      findBytes([0x48, 0x83, 0xc4, 0x28, 0xc3]),
      'Should contain add rsp, 28h; ret',
    );
    // '53 C3' - push rbx; ret
    assert.ok(findBytes([0x53, 0xc3]), 'Should contain push rbx; ret');
    // 'FF E3' - jmp rbx
    assert.ok(findBytes([0xff, 0xe3]), 'Should contain jmp rbx');
  });
});
