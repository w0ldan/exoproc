import {
  Kernel32Impl,
  PROCESSENTRY32W_SIZE,
  MODULEENTRY32W_SIZE,
  THREADENTRY32_SIZE,
  HEAPLIST32_SIZE,
  HEAPENTRY32_SIZE,
  ToolhelpSnapshotFlag,
} from 'bun-xffi';
type HANDLE = bigint;
import { decodeStringW } from './decoding.js';
import { Handle } from './handle.js';
import { InvalidSnapshotFlagError } from './errors.js';

/**
 * High-level data class representing a Process from a Snapshot.
 */
export class ProcessEntry {
  public readonly pid: number;
  public readonly parentPid: number;
  public readonly threadCount: number;
  public readonly name: string;

  constructor(
    pid: number,
    parentPid: number,
    threadCount: number,
    name: string,
  ) {
    this.pid = pid;
    this.parentPid = parentPid;
    this.threadCount = threadCount;
    this.name = name;
  }
}

/**
 * High-level data class representing a Module from a Snapshot.
 */
export class ModuleEntry {
  public readonly name: string;
  public readonly path: string;
  public readonly baseAddress: bigint;
  public readonly size: number;
  public readonly handle: HANDLE;

  constructor(
    name: string,
    path: string,
    baseAddress: bigint,
    size: number,
    handle: HANDLE,
  ) {
    this.name = name;
    this.path = path;
    this.baseAddress = baseAddress;
    this.size = size;
    this.handle = handle;
  }
}

/**
 * High-level data class representing a Thread from a Snapshot.
 */
export class ThreadEntry {
  public readonly tid: number;
  public readonly ownerPid: number;
  public readonly basePriority: number;

  constructor(tid: number, ownerPid: number, basePriority: number) {
    this.tid = tid;
    this.ownerPid = ownerPid;
    this.basePriority = basePriority;
  }
}

/**
 * A handle to a Toolhelp32 Snapshot.
 */
export class ToolhelpSnapshot extends Handle {
  public readonly flags: ToolhelpSnapshotFlag;
  public readonly pid: number;

  /**
   * Creates a snapshot of the specified processes, as well as the heaps, modules, and threads used by these processes.
   * @param flags Snapshot flags (e.g. ToolhelpSnapshotFlag.SNAPPROCESS)
   * @param pid Process ID to create a snapshot of (0 for all processes for SNAPPROCESS/SNAPTHREAD)
   */
  constructor(flags: ToolhelpSnapshotFlag, pid: number = 0) {
    const handleRaw = Kernel32Impl.CreateToolhelp32Snapshot(flags, pid);
    super(handleRaw, false);
    this.flags = flags;
    this.pid = pid;
  }

  /**
   * Retrieves information about the first process encountered in a system snapshot.
   * Continuing to iterate gets all processes.
   */
  *getProcesses(): Generator<ProcessEntry> {
    if (
      !(this.flags & ToolhelpSnapshotFlag.SNAPPROCESS) &&
      !(this.flags & ToolhelpSnapshotFlag.SNAPALL)
    ) {
      throw new InvalidSnapshotFlagError('SNAPPROCESS');
    }
    if (!this.isValid()) return;

    const size = PROCESSENTRY32W_SIZE;
    const buf = Buffer.alloc(size as number);
    buf.writeUInt32LE(size as number, 0); // dwSize is at offset 0

    const success = Kernel32Impl.Process32FirstW(this.rawHandle, buf);

    if (!success) return;

    do {
      // Manual read from buffer (x64 offsets)
      // dwSize: 0
      // cntUsage: 4
      // th32ProcessID: 8
      // (pad): 12
      // th32DefaultHeapID: 16
      // th32ModuleID: 24
      // cntThreads: 28
      // th32ParentProcessID: 32
      // pcPriClassBase: 36
      // dwFlags: 40
      // szExeFile: 44

      const pid = buf.readUInt32LE(8);
      const parentPid = buf.readUInt32LE(32);
      const threadCount = buf.readUInt32LE(28);
      const nameBuf = buf.subarray(44, 44 + 520); // MAX_PATH * 2

      // CreateToolhelp32Snapshot ignores pid for SNAPPROCESS, filter here
      if (this.pid !== 0 && pid !== this.pid) {
        buf.writeUInt32LE(size as number, 0);
        continue;
      }

      yield new ProcessEntry(
        pid,
        parentPid,
        threadCount,
        decodeStringW(nameBuf),
      );

      // Reset size before next call
      buf.writeUInt32LE(size as number, 0);
    } while (Kernel32Impl.Process32NextW(this.rawHandle, buf));
  }

  /**
   * Retrieves information about the first module associated with a process.
   */
  *getModules(): Generator<ModuleEntry> {
    if (
      !(this.flags & ToolhelpSnapshotFlag.SNAPMODULE) &&
      !(this.flags & ToolhelpSnapshotFlag.SNAPMODULE32) &&
      !(this.flags & ToolhelpSnapshotFlag.SNAPALL)
    ) {
      throw new InvalidSnapshotFlagError('SNAPMODULE or SNAPMODULE32');
    }
    if (!this.isValid()) return;

    const size = MODULEENTRY32W_SIZE;
    const buf = Buffer.alloc(size as number);
    buf.writeUInt32LE(size as number, 0); // dwSize is at offset 0

    const success = Kernel32Impl.Module32FirstW(this.rawHandle, buf);

    if (!success) return;

    do {
      // Manual read from buffer (x64 offsets)
      // dwSize: 0
      // th32ModuleID: 4
      // th32ProcessID: 8
      // GlblcntUsage: 12
      // ProccntUsage: 16
      // (pad to 8-byte-align the modBaseAddr pointer): 20
      // modBaseAddr: 24 (uint64)
      // modBaseSize: 32 (uint32)
      // (pad to 8-byte-align the hModule pointer): 36
      // hModule: 40 (uint64)
      // szModule: 48 (256 * 2)
      // szExePath: 560 (260 * 2)

      const baseAddress = buf.readBigUInt64LE(24);
      const sizeOfModule = buf.readUInt32LE(32);
      const hModule = buf.readBigUInt64LE(40);
      const nameBuf = buf.subarray(48, 48 + 512);
      const pathBuf = buf.subarray(560, 560 + 520);

      yield new ModuleEntry(
        decodeStringW(nameBuf),
        decodeStringW(pathBuf),
        baseAddress,
        sizeOfModule,
        hModule as unknown as HANDLE,
      );

      buf.writeUInt32LE(size as number, 0);
    } while (Kernel32Impl.Module32NextW(this.rawHandle, buf));
  }

  /**
   * Retrieves information about the first thread of any process encountered in a system snapshot.
   */
  *getThreads(): Generator<ThreadEntry> {
    if (
      !(this.flags & ToolhelpSnapshotFlag.SNAPTHREAD) &&
      !(this.flags & ToolhelpSnapshotFlag.SNAPALL)
    ) {
      throw new InvalidSnapshotFlagError('SNAPTHREAD');
    }
    if (!this.isValid()) return;

    const size = THREADENTRY32_SIZE;
    const buf = Buffer.alloc(size as number);
    buf.writeUInt32LE(size as number, 0); // dwSize is at offset 0

    const success = Kernel32Impl.Thread32First(this.rawHandle, buf);

    if (!success) return;

    do {
      // Manual read from buffer (x64 offsets)
      // dwSize: 0
      // cntUsage: 4
      // th32ThreadID: 8
      // th32OwnerProcessID: 12
      // tpBasePri: 16
      // tpDeltaPri: 20
      // dwFlags: 24

      const tid = buf.readUInt32LE(8);
      const ownerPid = buf.readUInt32LE(12);
      const basePri = buf.readUInt32LE(16);

      // CreateToolhelp32Snapshot ignores pid for SNAPTHREAD, filter here
      if (this.pid !== 0 && ownerPid !== this.pid) {
        buf.writeUInt32LE(size as number, 0);
        continue;
      }

      yield new ThreadEntry(tid, ownerPid, basePri);

      buf.writeUInt32LE(size as number, 0);
    } while (Kernel32Impl.Thread32Next(this.rawHandle, buf));
  }

  /**
   * Retrieves information about the first heap of a specific process.
   */
  *getHeaps(): Generator<HeapListEntry> {
    if (
      !(this.flags & ToolhelpSnapshotFlag.SNAPHEAPLIST) &&
      !(this.flags & ToolhelpSnapshotFlag.SNAPALL)
    ) {
      throw new InvalidSnapshotFlagError('SNAPHEAPLIST');
    }
    if (!this.isValid()) return;

    const size = HEAPLIST32_SIZE;
    const buf = Buffer.alloc(size as number);

    // dwSize in HEAPLIST32 is a SIZE_T (always 8 bytes in 64-bit environment)
    buf.writeBigUInt64LE(BigInt(size as number | bigint), 0);

    const success = Kernel32Impl.Heap32ListFirst(this.rawHandle, buf);

    if (!success) return;

    do {
      // Manual read from buffer (x64 offsets)
      // dwSize: 0
      // th32ProcessID: 8
      // th32HeapID: 16
      // dwFlags: 24

      const heapPid = buf.readUInt32LE(8);
      const heapId = buf.readBigUInt64LE(16);
      const flags = buf.readUInt32LE(24);

      yield new HeapListEntry(heapPid, heapId, flags);
      buf.writeBigUInt64LE(BigInt(size as number | bigint), 0);
    } while (Kernel32Impl.Heap32ListNext(this.rawHandle, buf));
  }

  /**
   * Retrieves information about the heap blocks associated with a specific process and heap.
   * Note: The snapshot must have been created with SNAPHEAPLIST and this iterates blocks using Heap32First/Next.
   */
  *getHeapBlocks(pid: number, heapId: bigint): Generator<HeapEntry> {
    if (
      !(this.flags & ToolhelpSnapshotFlag.SNAPHEAPLIST) &&
      !(this.flags & ToolhelpSnapshotFlag.SNAPALL)
    ) {
      throw new InvalidSnapshotFlagError('SNAPHEAPLIST');
    }
    if (!this.isValid()) return;

    const size = HEAPENTRY32_SIZE;
    const buf = Buffer.alloc(size as number);

    // dwSize in HEAPENTRY32 is a SIZE_T (always 8 bytes in 64-bit environment)
    buf.writeBigUInt64LE(BigInt(size as number | bigint), 0);

    const success = Kernel32Impl.Heap32First(buf, pid, heapId);

    if (!success) return;

    do {
      // Manual read from buffer (x64 offsets)
      // dwSize: 0
      // hHandle: 8
      // dwAddress: 16
      // dwBlockSize: 24
      // dwFlags: 32
      // dwLockCount: 36
      // th32ProcessID: 40
      // th32HeapID: 48

      const hHandle = buf.readBigUInt64LE(8);
      const dwAddress = buf.readBigUInt64LE(16);
      const dwBlockSize = buf.readBigUInt64LE(24);
      const dwFlags = buf.readUInt32LE(32);
      const dwLockCount = buf.readUInt32LE(36);

      yield new HeapEntry(
        hHandle as unknown as HANDLE,
        dwAddress,
        dwBlockSize,
        dwFlags,
        dwLockCount,
      );
      buf.writeBigUInt64LE(BigInt(size as number | bigint), 0);
    } while (Kernel32Impl.Heap32Next(buf));
  }
}

/**
 * High-level data class representing a Heap List Entry from a Snapshot.
 */
export class HeapListEntry {
  public readonly pid: number;
  public readonly heapId: bigint;
  public readonly flags: number;

  constructor(pid: number, heapId: bigint, flags: number) {
    this.pid = pid;
    this.heapId = heapId;
    this.flags = flags;
  }
}

/**
 * High-level data class representing a single block in a Heap.
 */
export class HeapEntry {
  public readonly handle: HANDLE;
  public readonly address: bigint;
  public readonly blockSize: bigint;
  public readonly flags: number;
  public readonly lockCount: number;

  constructor(
    handle: HANDLE,
    address: bigint,
    blockSize: bigint,
    flags: number,
    lockCount: number,
  ) {
    this.handle = handle;
    this.address = address;
    this.blockSize = blockSize;
    this.flags = flags;
    this.lockCount = lockCount;
  }
}
