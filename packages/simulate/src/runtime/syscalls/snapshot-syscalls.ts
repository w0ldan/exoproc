import type { Win64Machine, Win64Process } from '../win64-machine.js';
import type { Win64AddressSpace } from '../address-space.js';
import type {
  Win64SnapshotObject,
  Win64SnapshotProcessEntry,
  Win64SnapshotThreadEntry,
  Win64SnapshotModuleEntry,
} from '../types.js';

export const encodeUtf16LE = (str: string, maxBytes: number): Uint8Array => {
  const result = new Uint8Array(maxBytes);
  const len = Math.min(str.length, Math.floor((maxBytes - 2) / 2));
  for (let i = 0; i < len; i++) {
    const code = str.charCodeAt(i);
    result[i * 2] = code & 0xff;
    result[i * 2 + 1] = (code >> 8) & 0xff;
  }
  return result;
};

export const encodeAnsi = (str: string, maxBytes: number): Uint8Array => {
  const result = new Uint8Array(maxBytes);
  const len = Math.min(str.length, maxBytes - 1);
  for (let i = 0; i < len; i++) {
    result[i] = str.charCodeAt(i) & 0xff;
  }
  return result;
};

export const writeProcessEntry32W = (
  memory: Win64AddressSpace,
  address: bigint,
  entry: Win64SnapshotProcessEntry,
): void => {
  const data = new Uint8Array(568);
  const view = new DataView(data.buffer);
  view.setUint32(0, 568, true);
  view.setUint32(4, 0, true);
  view.setUint32(8, entry.pid, true);
  view.setUint32(12, 0, true);
  view.setBigUint64(16, 0n, true);
  view.setUint32(24, 0, true);
  view.setUint32(28, entry.threadsCount, true);
  view.setUint32(32, entry.parentPid, true);
  view.setInt32(36, 8, true);
  view.setUint32(40, 0, true);
  data.set(encodeUtf16LE(entry.name, 520), 44);
  memory.write(address, data);
};

export const writeProcessEntry32A = (
  memory: Win64AddressSpace,
  address: bigint,
  entry: Win64SnapshotProcessEntry,
): void => {
  const data = new Uint8Array(304);
  const view = new DataView(data.buffer);
  view.setUint32(0, 304, true);
  view.setUint32(4, 0, true);
  view.setUint32(8, entry.pid, true);
  view.setUint32(12, 0, true);
  view.setBigUint64(16, 0n, true);
  view.setUint32(24, 0, true);
  view.setUint32(28, entry.threadsCount, true);
  view.setUint32(32, entry.parentPid, true);
  view.setInt32(36, 8, true);
  view.setUint32(40, 0, true);
  data.set(encodeAnsi(entry.name, 260), 44);
  memory.write(address, data);
};

export const writeThreadEntry32 = (
  memory: Win64AddressSpace,
  address: bigint,
  entry: Win64SnapshotThreadEntry,
): void => {
  const data = new Uint8Array(28);
  const view = new DataView(data.buffer);
  view.setUint32(0, 28, true);
  view.setUint32(4, 0, true);
  view.setUint32(8, entry.tid, true);
  view.setUint32(12, entry.ownerPid, true);
  view.setInt32(16, entry.basePriority, true);
  view.setInt32(20, 0, true);
  view.setUint32(24, 0, true);
  memory.write(address, data);
};

export const writeModuleEntry32W = (
  memory: Win64AddressSpace,
  address: bigint,
  entry: Win64SnapshotModuleEntry,
  pid: number,
): void => {
  const data = new Uint8Array(1080);
  const view = new DataView(data.buffer);
  view.setUint32(0, 1080, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, pid, true);
  view.setUint32(12, 0xffff, true);
  view.setUint32(16, 0xffff, true);
  view.setUint32(20, 0, true);
  view.setBigUint64(24, entry.base, true);
  view.setUint32(32, entry.size, true);
  view.setUint32(36, 0, true);
  view.setBigUint64(40, entry.base, true);
  data.set(encodeUtf16LE(entry.name, 512), 48);
  data.set(encodeUtf16LE(entry.path, 520), 560);
  memory.write(address, data);
};

export const writeModuleEntry32A = (
  memory: Win64AddressSpace,
  address: bigint,
  entry: Win64SnapshotModuleEntry,
  pid: number,
): void => {
  const data = new Uint8Array(564);
  const view = new DataView(data.buffer);
  view.setUint32(0, 564, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, pid, true);
  view.setUint32(12, 0xffff, true);
  view.setUint32(16, 0xffff, true);
  view.setUint32(20, 0, true);
  view.setBigUint64(24, entry.base, true);
  view.setUint32(32, entry.size, true);
  view.setUint32(36, 0, true);
  view.setBigUint64(40, entry.base, true);
  data.set(encodeAnsi(entry.name, 256), 48);
  data.set(encodeAnsi(entry.path, 260), 304);
  memory.write(address, data);
};

export const resolveSnapshot = (
  machine: Win64Machine,
  process: Win64Process,
  rawHandle: bigint,
): Win64SnapshotObject | undefined => {
  const handle = process.handles.get(Number(rawHandle));
  const object = handle ? machine.getKernelObject(handle.objectId) : undefined;
  return object?.kind === 'snapshot' ? object : undefined;
};

export function registerSnapshotSyscalls(machine: Win64Machine): void {
  machine.registerHandler(
    'kernel32.dll',
    'CreateToolhelp32Snapshot',
    (process, _thread, registers) => {
      const flags = Number(registers.RCX);
      const targetPid = Number(
        registers.RDX === 0n ? BigInt(process.pid) : registers.RDX,
      );
      const processes: Win64SnapshotProcessEntry[] = [];
      const threads: Win64SnapshotThreadEntry[] = [];
      const modules: Win64SnapshotModuleEntry[] = [];

      // TH32CS_SNAPPROCESS = 0x00000002
      if ((flags & 0x02) !== 0 || (flags & 0x0f) === 0x0f) {
        for (const p of machine.getProcesses()) {
          processes.push({
            pid: p.pid,
            parentPid: p.parentPid ?? 0,
            threadsCount: p.threads.size,
            name: p.name,
          });
        }
      }

      // TH32CS_SNAPTHREAD = 0x00000004
      if ((flags & 0x04) !== 0 || (flags & 0x0f) === 0x0f) {
        for (const p of machine.getProcesses()) {
          for (const t of p.threads.values()) {
            threads.push({
              tid: t.tid,
              ownerPid: p.pid,
              basePriority: 8,
            });
          }
        }
      }

      // TH32CS_SNAPMODULE = 0x00000008, TH32CS_SNAPMODULE32 = 0x00000010
      if (
        (flags & 0x08) !== 0 ||
        (flags & 0x10) !== 0 ||
        (flags & 0x0f) === 0x0f
      ) {
        const modProcess = machine.getProcess(targetPid);
        if (modProcess) {
          for (const m of modProcess.modules) {
            modules.push({
              base: m.base,
              size: m.size,
              name: m.name,
              path: m.name.includes('\\')
                ? m.name
                : `C:\\Windows\\System32\\${m.name}`,
            });
          }
        }
      }

      process.lastError = 0;
      return BigInt(
        process.allocateHandle({
          kind: 'snapshot',
          flags,
          pid: targetPid,
          processPosition: 0,
          processes,
          threadPosition: 0,
          threads,
          modulePosition: 0,
          modules,
        }),
      );
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'Process32FirstW',
    (process, _thread, registers) => {
      const snap = resolveSnapshot(machine, process, registers.RCX);
      if (!snap || snap.processes.length === 0) {
        process.lastError = snap ? 18 : 6;
        return 0n;
      }
      snap.processPosition = 0;
      writeProcessEntry32W(process.memory, registers.RDX, snap.processes[0]!);
      snap.processPosition = 1;
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'Process32NextW',
    (process, _thread, registers) => {
      const snap = resolveSnapshot(machine, process, registers.RCX);
      if (!snap || snap.processPosition >= snap.processes.length) {
        process.lastError = snap ? 18 : 6;
        return 0n;
      }
      writeProcessEntry32W(
        process.memory,
        registers.RDX,
        snap.processes[snap.processPosition++]!,
      );
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'Process32First',
    (process, _thread, registers) => {
      const snap = resolveSnapshot(machine, process, registers.RCX);
      if (!snap || snap.processes.length === 0) {
        process.lastError = snap ? 18 : 6;
        return 0n;
      }
      snap.processPosition = 0;
      writeProcessEntry32A(process.memory, registers.RDX, snap.processes[0]!);
      snap.processPosition = 1;
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'Process32Next',
    (process, _thread, registers) => {
      const snap = resolveSnapshot(machine, process, registers.RCX);
      if (!snap || snap.processPosition >= snap.processes.length) {
        process.lastError = snap ? 18 : 6;
        return 0n;
      }
      writeProcessEntry32A(
        process.memory,
        registers.RDX,
        snap.processes[snap.processPosition++]!,
      );
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'Thread32First',
    (process, _thread, registers) => {
      const snap = resolveSnapshot(machine, process, registers.RCX);
      if (!snap || snap.threads.length === 0) {
        process.lastError = snap ? 18 : 6;
        return 0n;
      }
      snap.threadPosition = 0;
      writeThreadEntry32(process.memory, registers.RDX, snap.threads[0]!);
      snap.threadPosition = 1;
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'Thread32Next',
    (process, _thread, registers) => {
      const snap = resolveSnapshot(machine, process, registers.RCX);
      if (!snap || snap.threadPosition >= snap.threads.length) {
        process.lastError = snap ? 18 : 6;
        return 0n;
      }
      writeThreadEntry32(
        process.memory,
        registers.RDX,
        snap.threads[snap.threadPosition++]!,
      );
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'Module32FirstW',
    (process, _thread, registers) => {
      const snap = resolveSnapshot(machine, process, registers.RCX);
      if (!snap || snap.modules.length === 0) {
        process.lastError = snap ? 18 : 6;
        return 0n;
      }
      snap.modulePosition = 0;
      writeModuleEntry32W(
        process.memory,
        registers.RDX,
        snap.modules[0]!,
        snap.pid,
      );
      snap.modulePosition = 1;
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'Module32NextW',
    (process, _thread, registers) => {
      const snap = resolveSnapshot(machine, process, registers.RCX);
      if (!snap || snap.modulePosition >= snap.modules.length) {
        process.lastError = snap ? 18 : 6;
        return 0n;
      }
      writeModuleEntry32W(
        process.memory,
        registers.RDX,
        snap.modules[snap.modulePosition++]!,
        snap.pid,
      );
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'Module32First',
    (process, _thread, registers) => {
      const snap = resolveSnapshot(machine, process, registers.RCX);
      if (!snap || snap.modules.length === 0) {
        process.lastError = snap ? 18 : 6;
        return 0n;
      }
      snap.modulePosition = 0;
      writeModuleEntry32A(
        process.memory,
        registers.RDX,
        snap.modules[0]!,
        snap.pid,
      );
      snap.modulePosition = 1;
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'Module32Next',
    (process, _thread, registers) => {
      const snap = resolveSnapshot(machine, process, registers.RCX);
      if (!snap || snap.modulePosition >= snap.modules.length) {
        process.lastError = snap ? 18 : 6;
        return 0n;
      }
      writeModuleEntry32A(
        process.memory,
        registers.RDX,
        snap.modules[snap.modulePosition++]!,
        snap.pid,
      );
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'psapi.dll',
    'GetModuleInformation',
    (process, _thread, registers) => {
      const target = machine.resolveTargetProcess(process, registers.RCX);
      if (!target) {
        process.lastError = 6; // ERROR_INVALID_HANDLE
        return 0n;
      }
      if (registers.R8 === 0n || registers.R9 < 24n) {
        process.lastError = 87; // ERROR_INVALID_PARAMETER
        return 0n;
      }
      const module = target.modules.find(
        (candidate) => candidate.base === registers.RDX,
      );
      if (!module) {
        process.lastError = 126; // ERROR_MOD_NOT_FOUND
        return 0n;
      }

      // MODULEINFO on Win64: lpBaseOfDll@0, SizeOfImage@8,
      // 4 bytes of alignment, EntryPoint@16.
      process.memory.writeU64(registers.R8, module.base);
      process.memory.writeU32(registers.R8 + 8n, module.size);
      process.memory.writeU32(registers.R8 + 12n, 0);
      process.memory.writeU64(registers.R8 + 16n, module.base);
      process.lastError = 0;
      return 1n;
    },
  );
}
