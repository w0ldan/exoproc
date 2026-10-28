import type {
  KernelHandler,
  Win64Machine,
  Win64Process,
} from '../win64-machine.js';

export const GENERIC_READ = 0x80000000;
export const GENERIC_WRITE = 0x40000000;

export const encodeWin32String = (value: string, wide: boolean): Uint8Array => {
  if (!wide) {
    return new TextEncoder().encode(`${value}\0`);
  }
  const result = new Uint8Array((value.length + 1) * 2);
  const view = new DataView(result.buffer);
  for (let i = 0; i < value.length; i++) {
    view.setUint16(i * 2, value.charCodeAt(i), true);
  }
  return result;
};

export const writeFindData = (
  process: Win64Process,
  address: bigint,
  entry: {
    name: string;
    directory: boolean;
    size: number;
  },
): void => {
  const data = new Uint8Array(320);
  const view = new DataView(data.buffer);
  view.setUint32(0, entry.directory ? 0x10 : 0x80, true);
  view.setUint32(28, Math.floor(entry.size / 0x100000000), true);
  view.setUint32(32, entry.size >>> 0, true);
  data.set(new TextEncoder().encode(`${entry.name}\0`).slice(0, 260), 44);
  process.memory.write(address, data);
};

export function registerFileSyscalls(machine: Win64Machine): void {
  machine.registerHandler(
    'kernel32.dll',
    'CreatePipe',
    (process, _thread, registers) => {
      if (registers.RCX === 0n || registers.RDX === 0n) {
        process.lastError = 87;
        return 0n;
      }
      const securityAttributes = registers.R8;
      const inheritable =
        securityAttributes !== 0n &&
        process.memory.readU32(securityAttributes + 16n) !== 0;
      const objectId = machine.createKernelObject({
        kind: 'pipe',
        bytes: [],
      });
      const readHandle = process.attachObject(
        objectId,
        GENERIC_READ,
        inheritable,
      );
      const writeHandle = process.attachObject(
        objectId,
        GENERIC_WRITE,
        inheritable,
      );
      process.memory.writeU64(registers.RCX, BigInt(readHandle));
      process.memory.writeU64(registers.RDX, BigInt(writeHandle));
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'SetHandleInformation',
    (process, _thread, registers) => {
      const handle = process.handles.get(Number(registers.RCX));
      if (!handle) {
        process.lastError = 6;
        return 0n;
      }
      const mask = Number(registers.RDX);
      const flags = Number(registers.R8);
      if ((mask & 0x1) !== 0) {
        handle.inheritable = (flags & 0x1) !== 0;
      }
      process.lastError = 0;
      return 1n;
    },
  );

  const createFile =
    (wide: boolean): KernelHandler =>
    (process, _thread, registers) => {
      const requestedPath = wide
        ? process.memory.readWideCString(registers.RCX)
        : process.memory.readCString(registers.RCX);
      const securityAttributes = registers.R9;
      const inheritable =
        securityAttributes !== 0n &&
        process.memory.readU32(securityAttributes + 16n) !== 0;
      const device = requestedPath.toUpperCase();
      if (device === 'CONIN$' || device === 'CONOUT$') {
        // Console devices are host capabilities, not forgeable VFS paths.
        process.lastError = 5;
        return 0xffffffffffffffffn;
      }

      const fileSystem = process.machine.fileSystem;
      const path = fileSystem.normalize(
        requestedPath,
        process.currentDirectory,
      );
      const existing = fileSystem.getEntry(path);
      const creationDisposition = Number(
        process.memory.readU64(registers.RSP + 0x28n),
      );
      const canCreate =
        creationDisposition === 1 ||
        creationDisposition === 2 ||
        creationDisposition === 4;
      const mustExist = creationDisposition === 3 || creationDisposition === 5;

      if (existing?.kind === 'directory') {
        process.lastError = 5;
        return 0xffffffffffffffffn;
      }
      if (creationDisposition === 1 && existing) {
        process.lastError = 80;
        return 0xffffffffffffffffn;
      }
      if (!existing && mustExist) {
        process.lastError = 2;
        return 0xffffffffffffffffn;
      }
      if (!existing && !canCreate) {
        process.lastError = 87;
        return 0xffffffffffffffffn;
      }
      if (!existing || creationDisposition === 2 || creationDisposition === 5) {
        try {
          fileSystem.writeFile(path, new Uint8Array());
        } catch {
          process.lastError = 3;
          return 0xffffffffffffffffn;
        }
      }
      process.lastError = 0;
      const file = fileSystem.getEntry(path);
      const append = (Number(registers.RDX) & 0x00000004) !== 0;
      return BigInt(
        process.allocateHandle(
          {
            kind: 'file',
            path,
            position: append && file?.kind === 'file' ? file.data.length : 0,
          },
          {
            access: Number(registers.RDX),
            inheritable,
          },
        ),
      );
    };

  machine.registerHandler('kernel32.dll', 'CreateFileA', createFile(false));
  machine.registerHandler('kernel32.dll', 'CreateFileW', createFile(true));

  machine.registerHandler(
    'kernel32.dll',
    'WriteFile',
    (process, _thread, registers) => {
      const handle = process.handles.get(Number(registers.RCX));
      const object = handle
        ? machine.getKernelObject(handle.objectId)
        : undefined;
      if (!handle || !object || (handle.access & GENERIC_WRITE) === 0) {
        process.lastError = 6;
        return 0n;
      }
      const requested = Number(registers.R8);
      const bytes = process.memory.read(registers.RDX, requested);
      let written: number;
      if (object.kind === 'output') {
        written = object.device.write(bytes);
      } else if (object.kind === 'pipe') {
        object.bytes.push(...bytes);
        written = bytes.length;
        machine.scheduler.signalObject(handle.objectId);
        machine.pumpScheduler();
      } else if (object.kind === 'file') {
        written = process.machine.fileSystem.writeFileAt(
          object.path,
          object.position,
          bytes,
        );
        object.position += written;
      } else {
        process.lastError = 6;
        return 0n;
      }
      if (registers.R9 !== 0n) {
        process.memory.writeU32(registers.R9, written);
      }
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'ReadFile',
    (process, thread, registers) => {
      const handle = process.handles.get(Number(registers.RCX));
      const object = handle
        ? machine.getKernelObject(handle.objectId)
        : undefined;
      if (!handle || !object || (handle.access & GENERIC_READ) === 0) {
        process.lastError = 6;
        return 0n;
      }
      let bytes: Uint8Array;
      if (object.kind === 'pipe') {
        const length = Math.min(Number(registers.R8), object.bytes.length);
        if (length === 0 && machine.hasOpenPipeWriter(handle.objectId)) {
          thread.state = 'waiting';
          machine.scheduler.blockOnObject(thread, handle.objectId);
          registers.RIP -= 7n;
          return 0n;
        }
        bytes = Uint8Array.from(object.bytes.splice(0, length));
      } else if (object.kind === 'input') {
        if (!object.device.hasInput && object.blocking) {
          thread.state = 'waiting';
          machine.scheduler.blockOnObject(thread, handle.objectId);
          registers.RIP -= 7n;
          return 0n;
        }
        bytes = object.device.read(Number(registers.R8));
      } else if (object.kind === 'file') {
        bytes = process.machine.fileSystem.readFile(
          object.path,
          object.position,
          Number(registers.R8),
        );
        object.position += bytes.length;
      } else {
        process.lastError = 6;
        return 0n;
      }
      if (bytes.length > 0) {
        process.memory.write(registers.RDX, bytes);
      }
      if (object.kind === 'input' && bytes.length < Number(registers.R8)) {
        process.memory.write(registers.RDX + BigInt(bytes.length), [0]);
      }
      if (registers.R9 !== 0n) {
        process.memory.writeU32(registers.R9, bytes.length);
      }
      process.lastError = 0;
      return 1n;
    },
  );

  const getCurrentDirectory =
    (wide: boolean): KernelHandler =>
    (process, _thread, registers) => {
      const bytes = encodeWin32String(process.currentDirectory, wide);
      const characters = process.currentDirectory.length;
      const capacity = Number(registers.RCX);
      if (capacity <= characters) {
        return BigInt(characters + 1);
      }
      process.memory.write(registers.RDX, bytes);
      return BigInt(characters);
    };

  const setCurrentDirectory =
    (wide: boolean): KernelHandler =>
    (process, _thread, registers) => {
      const path = wide
        ? process.memory.readWideCString(registers.RCX)
        : process.memory.readCString(registers.RCX);
      const directory = process.machine.fileSystem.getEntry(
        path,
        process.currentDirectory,
      );
      if (!directory || directory.kind !== 'directory') {
        process.lastError = 3;
        return 0n;
      }
      process.currentDirectory = directory.path;
      process.lastError = 0;
      return 1n;
    };

  machine.registerHandler(
    'kernel32.dll',
    'GetCurrentDirectoryA',
    getCurrentDirectory(false),
  );
  machine.registerHandler(
    'kernel32.dll',
    'GetCurrentDirectoryW',
    getCurrentDirectory(true),
  );
  machine.registerHandler(
    'kernel32.dll',
    'SetCurrentDirectoryA',
    setCurrentDirectory(false),
  );
  machine.registerHandler(
    'kernel32.dll',
    'SetCurrentDirectoryW',
    setCurrentDirectory(true),
  );

  machine.registerHandler(
    'kernel32.dll',
    'FindFirstFileA',
    (process, _thread, registers) => {
      const requested = process.memory
        .readCString(registers.RCX)
        .replace(/[\\/]?\*.*$/u, '');
      const directory = process.machine.fileSystem.getEntry(
        requested || '.',
        process.currentDirectory,
      );
      if (!directory || directory.kind !== 'directory') {
        process.lastError = 3;
        return 0xffffffffffffffffn;
      }
      const entries = process.machine.fileSystem
        .readDirectory(directory.path)
        .map((entry) => ({
          name: entry.name,
          directory: entry.kind === 'directory',
          size: entry.kind === 'file' ? entry.data.length : 0,
        }));
      const firstEntry = entries[0];
      if (!firstEntry) {
        process.lastError = 18;
        return 0xffffffffffffffffn;
      }
      writeFindData(process, registers.RDX, firstEntry);
      process.lastError = 0;
      return BigInt(
        process.allocateHandle({
          kind: 'find',
          position: 1,
          findEntries: entries,
        }),
      );
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'FindNextFileA',
    (process, _thread, registers) => {
      const object = machine.getHandleObject(process, registers.RCX);
      if (object?.kind !== 'find') {
        process.lastError = 6;
        return 0n;
      }
      const index = object.position;
      const entry = object.findEntries[index];
      if (!entry) {
        process.lastError = 18;
        return 0n;
      }
      writeFindData(process, registers.RDX, entry);
      object.position = index + 1;
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'FindClose',
    (process, _thread, registers) => {
      const handle = process.handles.get(Number(registers.RCX));
      const object = handle
        ? machine.getKernelObject(handle.objectId)
        : undefined;
      if (!handle || object?.kind !== 'find') {
        process.lastError = 6;
        return 0n;
      }
      process.handles.delete(handle.value);
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'SearchPathA',
    (process, _thread, registers) => {
      const executable = process.memory.readCString(registers.RDX);
      const extension =
        registers.R8 === 0n ? '' : process.memory.readCString(registers.R8);
      const candidate =
        executable.includes('.') || !extension
          ? executable
          : `${executable}${extension}`;
      const resolution = process.environment.resolveExecutable(
        process.machine.fileSystem,
        candidate,
        process.currentDirectory,
      );
      if (!resolution) {
        process.lastError = 2;
        return 0n;
      }
      const capacity = Number(registers.R9);
      const output = process.memory.readU64(registers.RSP + 0x28n);
      const filePart = process.memory.readU64(registers.RSP + 0x30n);
      if (capacity <= resolution.path.length) {
        return BigInt(resolution.path.length + 1);
      }
      process.memory.write(
        output,
        new TextEncoder().encode(`${resolution.path}\0`),
      );
      if (filePart !== 0n) {
        const separator = Math.max(
          resolution.path.lastIndexOf('\\'),
          resolution.path.lastIndexOf('/'),
        );
        process.memory.writeU64(filePart, output + BigInt(separator + 1));
      }
      process.lastError = 0;
      return BigInt(resolution.path.length);
    },
  );
}
