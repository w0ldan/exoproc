import type {
  Win64Machine,
  Win64Process,
  Win64Thread,
} from '../win64-machine.js';

export const resolveThreadHandle = (
  machine: Win64Machine,
  process: Win64Process,
  rawHandle: bigint,
  callingThread?: Win64Thread,
): Win64Thread | undefined => {
  if (rawHandle === -2n || rawHandle === 0xfffffffffffffffen) {
    return callingThread;
  }
  const handle = process.handles.get(Number(rawHandle));
  const object = handle ? machine.getKernelObject(handle.objectId) : undefined;
  if (!handle || !object || object.kind !== 'thread') return undefined;
  return machine.getProcess(object.targetPid)?.getThread(object.targetTid);
};

export function registerThreadSyscalls(machine: Win64Machine): void {
  machine.registerHandler(
    'kernel32.dll',
    'GetCurrentThread',
    () => 0xfffffffffffffffen,
  );

  machine.registerHandler(
    'kernel32.dll',
    'GetCurrentThreadId',
    (_process, thread) => BigInt(thread.tid),
  );

  machine.registerHandler('kernel32.dll', 'ExitThread', (_process, thread) => {
    thread.state = 'terminated';
    return 0n;
  });

  machine.registerHandler(
    'kernel32.dll',
    'OpenThread',
    (process, _thread, registers) => {
      const tid = Number(registers.R8);
      for (const targetProcess of machine.getProcesses()) {
        const targetThread = targetProcess.getThread(tid);
        if (targetThread) {
          process.lastError = 0;
          return BigInt(
            process.allocateHandle({
              kind: 'thread',
              targetPid: targetProcess.pid,
              targetTid: targetThread.tid,
            }),
          );
        }
      }
      process.lastError = 87; // ERROR_INVALID_PARAMETER
      return 0n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'GetThreadId',
    (process, thread, registers) => {
      const target = resolveThreadHandle(
        machine,
        process,
        registers.RCX,
        thread,
      );
      if (!target) {
        process.lastError = 6; // ERROR_INVALID_HANDLE
        return 0n;
      }
      process.lastError = 0;
      return BigInt(target.tid);
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'SuspendThread',
    (process, thread, registers) => {
      const target = resolveThreadHandle(
        machine,
        process,
        registers.RCX,
        thread,
      );
      if (!target) {
        process.lastError = 6;
        return 0xffffffffn;
      }
      const previousCount = target.suspendCount;
      target.suspendCount += 1;
      return BigInt(previousCount);
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'ResumeThread',
    (process, thread, registers) => {
      const target = resolveThreadHandle(
        machine,
        process,
        registers.RCX,
        thread,
      );
      if (!target) {
        process.lastError = 6;
        return 0xffffffffn;
      }
      const previousCount = target.suspendCount;
      if (target.suspendCount > 0) target.suspendCount -= 1;
      if (target.suspendCount === 0) {
        machine.scheduler.enqueue(target);
        machine.pumpScheduler();
      }
      return BigInt(previousCount);
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'GetThreadContext',
    (process, thread, registers) => {
      const target = resolveThreadHandle(
        machine,
        process,
        registers.RCX,
        thread,
      );
      const lpContext = registers.RDX;
      if (!target || lpContext === 0n) {
        process.lastError = !target ? 6 : 87;
        return 0n;
      }
      const contextFlags = process.memory.readU32(lpContext + 0x30n);
      // CONTEXT_CONTROL: RSP, RIP, RFLAGS
      if ((contextFlags & 0x01) !== 0) {
        process.memory.writeU64(lpContext + 0x98n, target.cpu.registers.RSP);
        process.memory.writeU64(
          lpContext + 0xf8n,
          target.pendingRip ?? target.cpu.registers.RIP,
        );
        process.memory.writeU32(
          lpContext + 0x44n,
          Number(target.cpu.registers.RFLAGS & 0xffffffffn),
        );
      }
      // CONTEXT_INTEGER: RAX, RCX, RDX, RBX, RBP, RSI, RDI, R8-R15
      if ((contextFlags & 0x02) !== 0) {
        process.memory.writeU64(lpContext + 0x78n, target.cpu.registers.RAX);
        process.memory.writeU64(lpContext + 0x80n, target.cpu.registers.RCX);
        process.memory.writeU64(lpContext + 0x88n, target.cpu.registers.RDX);
        process.memory.writeU64(lpContext + 0x90n, target.cpu.registers.RBX);
        process.memory.writeU64(lpContext + 0xa0n, target.cpu.registers.RBP);
        process.memory.writeU64(lpContext + 0xa8n, target.cpu.registers.RSI);
        process.memory.writeU64(lpContext + 0xb0n, target.cpu.registers.RDI);
        process.memory.writeU64(lpContext + 0xb8n, target.cpu.registers.R8);
        process.memory.writeU64(lpContext + 0xc0n, target.cpu.registers.R9);
        process.memory.writeU64(lpContext + 0xc8n, target.cpu.registers.R10);
        process.memory.writeU64(lpContext + 0xd0n, target.cpu.registers.R11);
        process.memory.writeU64(lpContext + 0xd8n, target.cpu.registers.R12);
        process.memory.writeU64(lpContext + 0xe0n, target.cpu.registers.R13);
        process.memory.writeU64(lpContext + 0xe8n, target.cpu.registers.R14);
        process.memory.writeU64(lpContext + 0xf0n, target.cpu.registers.R15);
      }
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'SetThreadContext',
    (process, thread, registers) => {
      const target = resolveThreadHandle(
        machine,
        process,
        registers.RCX,
        thread,
      );
      const lpContext = registers.RDX;
      if (!target || lpContext === 0n) {
        process.lastError = !target ? 6 : 87;
        return 0n;
      }
      const contextFlags = process.memory.readU32(lpContext + 0x30n);
      // CONTEXT_CONTROL: RSP, RIP, RFLAGS
      if ((contextFlags & 0x01) !== 0) {
        target.cpu.registers.RSP = process.memory.readU64(lpContext + 0x98n);
        const nextRip = process.memory.readU64(lpContext + 0xf8n);
        if (target.inSyscall || target.state === 'waiting') {
          target.pendingRip = nextRip;
        } else {
          target.cpu.registers.RIP = nextRip;
        }
        target.cpu.registers.RFLAGS = BigInt(
          process.memory.readU32(lpContext + 0x44n),
        );
      }
      // CONTEXT_INTEGER: RAX, RCX, RDX, RBX, RBP, RSI, RDI, R8-R15
      if ((contextFlags & 0x02) !== 0) {
        target.cpu.registers.RAX = process.memory.readU64(lpContext + 0x78n);
        target.cpu.registers.RCX = process.memory.readU64(lpContext + 0x80n);
        target.cpu.registers.RDX = process.memory.readU64(lpContext + 0x88n);
        target.cpu.registers.RBX = process.memory.readU64(lpContext + 0x90n);
        target.cpu.registers.RBP = process.memory.readU64(lpContext + 0xa0n);
        target.cpu.registers.RSI = process.memory.readU64(lpContext + 0xa8n);
        target.cpu.registers.RDI = process.memory.readU64(lpContext + 0xb0n);
        target.cpu.registers.R8 = process.memory.readU64(lpContext + 0xb8n);
        target.cpu.registers.R9 = process.memory.readU64(lpContext + 0xc0n);
        target.cpu.registers.R10 = process.memory.readU64(lpContext + 0xc8n);
        target.cpu.registers.R11 = process.memory.readU64(lpContext + 0xd0n);
        target.cpu.registers.R12 = process.memory.readU64(lpContext + 0xd8n);
        target.cpu.registers.R13 = process.memory.readU64(lpContext + 0xe0n);
        target.cpu.registers.R14 = process.memory.readU64(lpContext + 0xe8n);
        target.cpu.registers.R15 = process.memory.readU64(lpContext + 0xf0n);
      }
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'GetExitCodeThread',
    (process, thread, registers) => {
      const target = resolveThreadHandle(
        machine,
        process,
        registers.RCX,
        thread,
      );
      if (!target) {
        process.lastError = 6;
        return 0n;
      }
      if (registers.RDX !== 0n) {
        process.memory.writeU32(
          registers.RDX,
          target.state === 'terminated' ? 0 : 259, // 259 = STILL_ACTIVE
        );
      }
      process.lastError = 0;
      return 1n;
    },
  );
}
