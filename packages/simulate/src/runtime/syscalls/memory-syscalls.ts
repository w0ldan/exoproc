import type { Win64Machine, Win64Process } from '../win64-machine.js';
import type { Win64AddressSpace } from '../address-space.js';
import type { MemoryProtection } from '../types.js';

export const DEFAULT_HEAP_CAPACITY = 0x100000;
export const HEAP_ZERO_MEMORY = 0x00000008;
export const HEAP_REALLOC_IN_PLACE_ONLY = 0x00000010;

export const protectionFromWin32 = (value: bigint): MemoryProtection => {
  const numeric = Number(value & 0xffffffffn);
  if ((numeric & 0x40) !== 0) return 'rwx';
  if ((numeric & 0x20) !== 0) return 'rx';
  if ((numeric & 0x04) !== 0) return 'rw';
  return 'r';
};

export const PROTECTION_TO_WIN32 = {
  r: 0x02n, // PAGE_READONLY
  rw: 0x04n, // PAGE_READWRITE
  rx: 0x20n, // PAGE_EXECUTE_READ
  rwx: 0x40n, // PAGE_EXECUTE_READWRITE
} as const;

export const MEM_FREE = 0x10000n;
export const MEM_COMMIT = 0x1000n;
export const MEM_PRIVATE = 0x20000n;
export const ALLOCATION_GRANULARITY = 0x10000n;

export const writeMemoryBasicInformation = (
  target: Win64Process,
  lpBuffer: bigint,
  baseAddress: bigint,
  allocationBase: bigint,
  allocationProtect: bigint,
  regionSize: bigint,
  state: bigint,
  protect: bigint,
  type: bigint,
): void => {
  // MEMORY_BASIC_INFORMATION layout (48 bytes, 8-byte aligned): ptr,
  // ptr, DWORD, WORD, [6 bytes pad], usize, DWORD, DWORD, DWORD.
  const view = new DataView(new ArrayBuffer(48));
  view.setBigUint64(0, baseAddress, true);
  view.setBigUint64(8, allocationBase, true);
  view.setUint32(16, Number(allocationProtect & 0xffffffffn), true);
  view.setUint16(20, 0, true); // PartitionId
  view.setBigUint64(24, regionSize, true);
  view.setUint32(32, Number(state & 0xffffffffn), true);
  view.setUint32(36, Number(protect & 0xffffffffn), true);
  view.setUint32(40, Number(type & 0xffffffffn), true);
  target.memory.write(lpBuffer, new Uint8Array(view.buffer));
};

export const queryRegionFor = (
  process: Win64Process,
  memory: Win64AddressSpace,
  lpAddress: bigint,
  lpBuffer: bigint,
): bigint => {
  if (lpBuffer === 0n) {
    process.lastError = 87;
    return 0n;
  }
  const mapping = memory.findMapping(lpAddress);
  if (mapping) {
    const protect = PROTECTION_TO_WIN32[mapping.protection];
    writeMemoryBasicInformation(
      process,
      lpBuffer,
      mapping.base,
      mapping.base,
      protect,
      BigInt(mapping.size),
      MEM_COMMIT,
      protect,
      MEM_PRIVATE,
    );
    process.lastError = 0;
    return 48n;
  }
  // MEM_FREE region: align down to allocation granularity and report
  // the gap to the next mapping (or one granularity unit if nothing
  // follows). This matches the real OS behavior closely enough that
  // memory scanners find existing allocations without false negatives.
  const aligned = lpAddress - (lpAddress % ALLOCATION_GRANULARITY);
  const nextMapping = memory
    .getMappings()
    .find((candidate) => candidate.base > aligned);
  const regionEnd = nextMapping
    ? nextMapping.base
    : aligned + ALLOCATION_GRANULARITY;
  writeMemoryBasicInformation(
    process,
    lpBuffer,
    aligned,
    aligned,
    0n,
    regionEnd - aligned,
    MEM_FREE,
    0x01n, // PAGE_NOACCESS
    0n,
  );
  process.lastError = 0;
  return 48n;
};

export function registerMemorySyscalls(machine: Win64Machine): void {
  machine.registerHandler(
    'kernel32.dll',
    'VirtualAlloc',
    (process, _thread, registers) =>
      process.allocate(
        Number(registers.RDX || 0x1000n),
        protectionFromWin32(registers.R9 || 0x04n),
        registers.RCX,
      ),
  );

  machine.registerHandler(
    'kernel32.dll',
    'VirtualFree',
    (process, _thread, registers) => {
      // MEM_RELEASE (0x8000) releases the whole region based at RCX;
      // MEM_DECOMMIT is accepted as a no-op (this simulator doesn't
      // track decommitted sub-regions).
      const freed =
        (registers.R8 & 0x8000n) !== 0n ? process.free(registers.RCX) : true;
      process.lastError = freed ? 0 : 87; // ERROR_INVALID_PARAMETER
      return freed ? 1n : 0n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'VirtualFreeEx',
    (process, _thread, registers) => {
      const target = machine.resolveTargetProcess(process, registers.RCX);
      if (!target) {
        process.lastError = 6;
        return 0n;
      }
      const address = registers.RDX;
      const freeType = Number(registers.R9 & 0xffffffffn);
      const freed = (freeType & 0x8000) !== 0 ? target.free(address) : true;
      process.lastError = freed ? 0 : 87;
      return freed ? 1n : 0n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'VirtualProtectEx',
    (process, _thread, registers) => {
      const target = machine.resolveTargetProcess(process, registers.RCX);
      if (!target) {
        process.lastError = 6;
        return 0n;
      }
      const address = registers.RDX;
      const newProtect = protectionFromWin32(registers.R8);
      // 5th arg (lpflOldProtect pointer) lives on the stack: the
      // caller pushed it at RSP+0x28 (after the 4 register-arg shadow
      // space + return address).
      const oldProtectPointer = process.memory.readU64(registers.RSP + 0x28n);
      const mapping = target.memory.findMapping(address);
      if (!mapping) {
        process.lastError = 87;
        return 0n;
      }
      mapping.protection = newProtect;
      if (oldProtectPointer !== 0n) {
        process.memory.writeU32(
          oldProtectPointer,
          Number(PROTECTION_TO_WIN32[mapping.protection]),
        );
      }
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'VirtualQuery',
    (process, _thread, registers) =>
      queryRegionFor(process, process.memory, registers.RCX, registers.RDX),
  );

  machine.registerHandler(
    'kernel32.dll',
    'VirtualQueryEx',
    (process, _thread, registers) => {
      const target = machine.resolveTargetProcess(process, registers.RCX);
      if (!target) {
        process.lastError = 6;
        return 0n;
      }
      return queryRegionFor(
        process,
        target.memory,
        registers.RDX,
        registers.R8,
      );
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'VirtualProtect',
    (process, _thread, registers) => {
      const handle = process.handles.get(Number(registers.RCX));
      const target = machine.resolveTargetProcess(
        process,
        registers.RCX === 0xffffffffffffffffn ? 0n : registers.RCX,
      );
      // Fall back to the current process when RCX is a pseudo-handle
      // (-1). The real Win32 API doesn't accept process handles here,
      // but the call shape from a guest uses this idiom for the current
      // process.
      const memory = target?.memory ?? process.memory;
      const newProtect = protectionFromWin32(registers.R8);
      const oldProtectPointer = registers.R9;
      const size = Number(registers.RDX);
      const address = registers.RCX;
      const mapping = memory.findMapping(address);
      if (!mapping) {
        process.lastError = 87;
        return 0n;
      }
      mapping.protection = newProtect;
      // CoW-backed mappings (DLL globals) have a private page table,
      // but protection is tracked on the mapping itself here for
      // completeness -- a single-process simulator has no other
      // consumers to enforce against.
      if (oldProtectPointer !== 0n) {
        process.memory.writeU32(
          oldProtectPointer,
          Number(PROTECTION_TO_WIN32[mapping.protection]),
        );
      }
      process.lastError = 0;
      void handle;
      void size;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'VirtualAllocEx',
    (process, _thread, registers) => {
      const target = machine.resolveTargetProcess(process, registers.RCX);
      if (!target) {
        process.lastError = 6;
        return 0n;
      }
      return target.allocate(
        Number(registers.R8 || 0x1000n),
        protectionFromWin32(
          process.memory.readU64(registers.RSP + 0x28n) || 0x04n,
        ),
        registers.RDX,
        `VirtualAllocEx from PID ${process.pid}`,
      );
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'WriteProcessMemory',
    (process, _thread, registers) => {
      const target = machine.resolveTargetProcess(process, registers.RCX);
      if (!target) {
        process.lastError = 6;
        return 0n;
      }
      const size = Number(registers.R9);
      const bytes = process.memory.read(registers.R8, size);
      target.memory.write(registers.RDX, bytes);
      const writtenPointer = process.memory.readU64(registers.RSP + 0x28n);
      if (writtenPointer !== 0n) {
        process.memory.writeU64(writtenPointer, BigInt(size));
      }
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'ReadProcessMemory',
    (process, _thread, registers) => {
      const target = machine.resolveTargetProcess(process, registers.RCX);
      if (!target) {
        process.lastError = 6;
        return 0n;
      }
      const size = Number(registers.R9);
      const bytes = target.memory.read(registers.RDX, size);
      process.memory.write(registers.R8, bytes);
      const bytesReadPointer = process.memory.readU64(registers.RSP + 0x28n);
      if (bytesReadPointer !== 0n) {
        process.memory.writeU64(bytesReadPointer, BigInt(bytes.byteLength));
      }
      process.lastError = 0;
      return 1n;
    },
  );

  machine.registerHandler('kernel32.dll', 'GetProcessHeap', (process) => {
    process.defaultHeapObjectId ??= machine.createHeap(
      process,
      DEFAULT_HEAP_CAPACITY,
    );
    return BigInt(process.defaultHeapObjectId);
  });

  machine.registerHandler(
    'kernel32.dll',
    'HeapCreate',
    (process, _thread, registers) => {
      const maximumSize = Number(registers.R8);
      const initialSize = Number(registers.RDX);
      const capacity =
        maximumSize > 0
          ? maximumSize
          : Math.max(initialSize, DEFAULT_HEAP_CAPACITY);
      return BigInt(machine.createHeap(process, capacity));
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'HeapDestroy',
    (process, _thread, registers) => {
      const objectId = Number(registers.RCX);
      return machine.destroyHeap(process, objectId) ? 1n : 0n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'HeapAlloc',
    (process, _thread, registers) => {
      const heap = machine.resolveHeap(registers.RCX);
      if (!heap) {
        process.lastError = 87; // ERROR_INVALID_PARAMETER
        return 0n;
      }
      const size = Number(registers.R8);
      const offset = heap.alloc(size);
      if (offset === undefined) {
        process.lastError = 8; // ERROR_NOT_ENOUGH_MEMORY
        return 0n;
      }
      const pointer = heap.base + BigInt(offset);
      if ((registers.RDX & BigInt(HEAP_ZERO_MEMORY)) !== 0n) {
        process.memory.write(pointer, new Uint8Array(size));
      }
      process.lastError = 0;
      return pointer;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'HeapFree',
    (process, _thread, registers) => {
      const heap = machine.resolveHeap(registers.RCX);
      if (!heap) return 0n;
      if (registers.R8 === 0n) return 1n;
      const freed = heap.free(Number(registers.R8 - heap.base));
      if (!freed) process.lastError = 87; // ERROR_INVALID_PARAMETER
      return freed ? 1n : 0n;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'HeapReAlloc',
    (process, _thread, registers) => {
      const heap = machine.resolveHeap(registers.RCX);
      if (!heap) {
        process.lastError = 87; // ERROR_INVALID_PARAMETER
        return 0n;
      }
      const pointer = registers.R8;
      const oldOffset = Number(pointer - heap.base);
      const oldSize = heap.sizeOf(oldOffset);
      if (oldSize === undefined) {
        process.lastError = 87;
        return 0n;
      }
      const newSize = Number(registers.R9);
      if (newSize <= oldSize) return pointer;

      if (registers.RDX & BigInt(HEAP_REALLOC_IN_PLACE_ONLY)) {
        process.lastError = 8; // ERROR_NOT_ENOUGH_MEMORY
        return 0n;
      }
      const newOffset = heap.alloc(newSize);
      if (newOffset === undefined) {
        process.lastError = 8;
        return 0n;
      }
      const newPointer = heap.base + BigInt(newOffset);
      process.memory.write(newPointer, process.memory.read(pointer, oldSize));
      if ((registers.RDX & BigInt(HEAP_ZERO_MEMORY)) !== 0n) {
        process.memory.write(
          newPointer + BigInt(oldSize),
          new Uint8Array(newSize - oldSize),
        );
      }
      heap.free(oldOffset);
      return newPointer;
    },
  );

  machine.registerHandler(
    'kernel32.dll',
    'HeapSize',
    (_process, _thread, registers) => {
      const heap = machine.resolveHeap(registers.RCX);
      if (!heap) return 0xffffffffffffffffn;
      const size = heap.sizeOf(Number(registers.R8 - heap.base));
      return size === undefined ? 0xffffffffffffffffn : BigInt(size);
    },
  );

  machine.registerHandler(
    'msvcrt.dll',
    'strlen',
    (process, _thread, registers) =>
      BigInt(process.memory.readCString(registers.RCX).length),
  );

  machine.registerHandler(
    'msvcrt.dll',
    'memcpy',
    (process, _thread, registers) => {
      const destination = registers.RCX;
      const source = registers.RDX;
      const length = Number(registers.R8 & 0xffffffffffffffffn);
      if (length <= 0) return destination;
      try {
        const bytes = process.memory.read(source, length);
        process.memory.write(destination, bytes);
        return destination;
      } catch {
        process.lastError = 13;
        return 0n;
      }
    },
  );
}
