import type { KernelHandler, Win64Machine } from '../win64-machine.js';
import type { X64Registers } from '../types.js';
import { encodeWin32String } from './file-syscalls.js';

export function registerProcessSyscalls(machine: Win64Machine): void {
  machine.registerHandler('kernel32.dll', 'GetLastError', (process) =>
    BigInt(process.lastError),
  );

  machine.registerHandler(
    'advapi32.dll',
    'OpenProcessToken',
    (process, _thread, registers) => {
      const processHandle = registers.RCX;
      const tokenHandlePointer = registers.R8;
      const target =
        processHandle === 0xffffffffffffffffn ||
        processHandle === BigInt.asUintN(64, -1n)
          ? process
          : machine.getHandleObject(process, processHandle)?.kind === 'process'
            ? machine.getProcess(
                (
                  machine.getHandleObject(process, processHandle) as {
                    targetPid: number;
                  }
                ).targetPid,
              )
            : undefined;
      if (!target) {
        process.lastError = 87;
        return 0n;
      }
      const tokenObjectId = machine.createKernelObject({
        kind: 'token',
        owningPid: target.pid,
        accessMask: Number(registers.RDX & 0xffffffffn),
      });
      if (tokenHandlePointer !== 0n) {
        process.memory.writeU64(tokenHandlePointer, BigInt(tokenObjectId));
      }
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'advapi32.dll',
    'CreateRestrictedToken',
    (process, _thread, registers) => {
      const newTokenHandlePointer = registers.R9;
      const tokenObjectId = machine.createKernelObject({
        kind: 'token',
        owningPid: process.pid,
        accessMask: 0,
      });
      if (newTokenHandlePointer !== 0n) {
        process.memory.writeU64(newTokenHandlePointer, BigInt(tokenObjectId));
      }
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'advapi32.dll',
    'CreateProcessAsUserA',
    (process, thread, registers) => {
      const shifted: X64Registers = {
        ...registers,
        RCX: registers.RDX,
        RDX: registers.R8,
        R8: registers.R9,
        R9: process.memory.readU64(registers.RSP + 0x28n),
      };
      const tail = [
        process.memory.readU64(registers.RSP + 0x30n),
        process.memory.readU64(registers.RSP + 0x38n),
        process.memory.readU64(registers.RSP + 0x40n),
        process.memory.readU64(registers.RSP + 0x48n),
        process.memory.readU64(registers.RSP + 0x50n),
        process.memory.readU64(registers.RSP + 0x58n),
      ];
      for (let i = 0; i < tail.length; i++) {
        process.memory.writeU64(registers.RSP + BigInt(0x28 + i * 8), tail[i]!);
      }
      return machine.createProcessFromKernel(process, thread, shifted, false);
    },
  );

  machine.registerHandler('kernel32.dll', 'GetCurrentProcessId', (process) =>
    BigInt(process.pid),
  );

  machine.registerHandler(
    'kernel32.dll',
    'GetCurrentProcess',
    () => 0xffffffffffffffffn,
  );

  const getEnvironmentVariable =
    (wide: boolean): KernelHandler =>
    (process, _thread, registers) => {
      const name = wide
        ? process.memory.readWideCString(registers.RCX)
        : process.memory.readCString(registers.RCX);
      const value = process.environment.get(name);
      if (value === undefined) {
        process.lastError = 203;
        return 0n;
      }
      const capacity = Number(registers.R8);
      if (capacity <= value.length) {
        return BigInt(value.length + 1);
      }
      process.memory.write(registers.RDX, encodeWin32String(value, wide));
      process.lastError = 0;
      return BigInt(value.length);
    };

  const setEnvironmentVariable =
    (wide: boolean): KernelHandler =>
    (process, _thread, registers) => {
      const name = wide
        ? process.memory.readWideCString(registers.RCX)
        : process.memory.readCString(registers.RCX);
      if (!name.includes('=') && name.length > 0) {
        if (registers.RDX === 0n) {
          process.environment.delete(name);
        } else {
          const value = wide
            ? process.memory.readWideCString(registers.RDX)
            : process.memory.readCString(registers.RDX);
          process.environment.set(name, value);
        }
        process.lastError = 0;
        return 1n;
      }
      process.lastError = 87;
      return 0n;
    };

  machine.registerHandler(
    'kernel32.dll',
    'GetEnvironmentVariableA',
    getEnvironmentVariable(false),
  );
  machine.registerHandler(
    'kernel32.dll',
    'GetEnvironmentVariableW',
    getEnvironmentVariable(true),
  );
  machine.registerHandler(
    'kernel32.dll',
    'SetEnvironmentVariableA',
    setEnvironmentVariable(false),
  );
  machine.registerHandler(
    'kernel32.dll',
    'SetEnvironmentVariableW',
    setEnvironmentVariable(true),
  );

  machine.registerHandler(
    'kernel32.dll',
    'CreateProcessA',
    (process, thread, registers) =>
      machine.createProcessFromKernel(process, thread, registers, false),
  );
  machine.registerHandler(
    'kernel32.dll',
    'CreateProcessW',
    (process, thread, registers) =>
      machine.createProcessFromKernel(process, thread, registers, true),
  );

  machine.registerHandler(
    'kernel32.dll',
    'WaitForSingleObject',
    (process, thread, registers) => {
      const handle = process.handles.get(Number(registers.RCX));
      const object = handle
        ? machine.getKernelObject(handle.objectId)
        : undefined;
      if (!handle || !object) {
        process.lastError = 6;
        return 0xffffffffn;
      }
      if (machine.isObjectSignaled(object)) return 0n; // WAIT_OBJECT_0
      thread.state = 'waiting';
      machine.scheduler.blockOnObject(thread, handle.objectId);
      registers.RIP -= 7n;
      return 0n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'GetExitCodeProcess',
    (process, _thread, registers) => {
      const handle = process.handles.get(Number(registers.RCX));
      const object = handle
        ? machine.getKernelObject(handle.objectId)
        : undefined;
      if (!handle || !object || object.kind !== 'process') {
        process.lastError = 6;
        return 0n;
      }
      const target = machine.getProcess(object.targetPid);
      const exitCode = target?.exitCode;
      if (registers.RDX !== 0n) {
        process.memory.writeU32(registers.RDX, exitCode ?? 259);
      }
      if (exitCode !== undefined) {
        process.lastChildExitCode = exitCode;
      }
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'Sleep',
    (_process, thread, registers) => {
      const milliseconds = Number(registers.RCX & 0xffffffffn);
      if (milliseconds > 0) {
        thread.state = 'waiting';
        machine.scheduler.blockOnTimer(thread, milliseconds);
      }
      return 0n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'ExitProcess',
    (process, _thread, registers) => {
      const exitCode = registers.RCX & 0xffffffffn;
      machine.finalizeProcessExit(process, Number(exitCode));
      return exitCode;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'TerminateProcess',
    (process, _thread, registers) => {
      const target = machine.resolveTargetProcess(process, registers.RCX);
      if (!target) {
        process.lastError = 6;
        return 0n;
      }
      machine.terminateProcess(target.pid, Number(registers.RDX & 0xffffffffn));
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'OpenProcess',
    (process, _thread, registers) => {
      const target = machine.getProcess(Number(registers.R8));
      if (!target) {
        process.lastError = 87;
        return 0n;
      }
      return BigInt(
        process.allocateHandle({
          kind: 'process',
          targetPid: target.pid,
        }),
      );
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'CreateRemoteThread',
    (process, _thread, registers) => {
      const target = machine.resolveTargetProcess(process, registers.RCX);
      if (!target) {
        process.lastError = 6;
        return 0n;
      }
      const parameter = process.memory.readU64(registers.RSP + 0x28n);
      const remoteThread = target.createThread(
        `Remote thread from PID ${process.pid}`,
        registers.R9,
        parameter,
      );
      return BigInt(
        process.allocateHandle({
          kind: 'thread',
          targetPid: target.pid,
          targetTid: remoteThread.tid,
        }),
      );
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'CloseHandle',
    (process, _thread, registers) => {
      const handleValue = Number(registers.RCX);
      const handle = process.handles.get(handleValue);
      const closed = process.closeHandle(handleValue);
      if (closed && handle) {
        machine.scheduler.signalObject(handle.objectId);
        machine.pumpScheduler();
      }
      return closed ? 1n : 0n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'GetModuleHandleA',
    (process, _thread, registers) =>
      machine.moduleHandle(process, process.memory.readCString(registers.RCX)),
  );
  machine.registerHandler(
    'kernel32.dll',
    'GetModuleHandleW',
    (process, _thread, registers) =>
      machine.moduleHandle(
        process,
        process.memory.readWideCString(registers.RCX),
      ),
  );
  machine.registerHandler(
    'kernel32.dll',
    'LoadLibraryA',
    (process, _thread, registers) =>
      machine.moduleHandle(process, process.memory.readCString(registers.RCX)),
  );
  machine.registerHandler(
    'kernel32.dll',
    'LoadLibraryW',
    (process, _thread, registers) =>
      machine.moduleHandle(
        process,
        process.memory.readWideCString(registers.RCX),
      ),
  );
  machine.registerHandler(
    'kernel32.dll',
    'GetProcAddress',
    (process, _thread, registers) => {
      const module = process.modules.find(
        (candidate) => candidate.base === registers.RCX,
      );
      const name = process.memory.readCString(registers.RDX);
      return module?.exports.get(name) ?? 0n;
    },
  );

  machine.registerHandler(
    'msvcrt.dll',
    '__getmainargs',
    (process, _thread, registers) => {
      const mainArguments = process.mainArguments;
      if (!mainArguments) {
        process.lastError = 87;
        return -1n;
      }
      process.memory.writeU32(registers.RCX, Number(mainArguments.argc));
      process.memory.writeU64(registers.RDX, mainArguments.argv);
      if (registers.R8 !== 0n) {
        process.memory.writeU64(registers.R8, mainArguments.envp);
      }
      return 0n;
    },
  );

  machine.registerHandler(
    'msvcrt.dll',
    '_putenv',
    (process, _thread, registers) => {
      const expression = process.memory.readCString(registers.RCX);
      const separator = expression.indexOf('=');
      if (separator <= 0) return -1n;
      const name = expression.slice(0, separator);
      const value = expression.slice(separator + 1);
      if (value) process.environment.set(name, value);
      else process.environment.delete(name);
      return 0n;
    },
  );
}
