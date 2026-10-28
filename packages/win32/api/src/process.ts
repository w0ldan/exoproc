import { log } from './logger.js';
import {
  NativePointer,
  RemoteMemoryAccessor,
  localMemoryAccessor,
  resolveAddress,
  type ISyncMemoryAccessor,
} from 'bun-xffi';
import { Thread } from './thread.js';
import {
  Kernel32Impl,
  ProcessAccess,
  ThreadCreationFlags,
  type SecurityAttributes,
  ToolhelpSnapshotFlag,
} from 'bun-xffi';
type HANDLE = bigint;
type SIZE_T = bigint;

import { Handle } from './handle.js';
import {
  ProcessClosedError,
  ProcessOpenError,
  CreateThreadError,
} from './errors.js';

import { ToolhelpSnapshot } from './snapshot.js';

function getProcessLog() {
  return log.add('Process');
}

const processLog = {
  info: (m: string, d?: unknown) => getProcessLog().info(m, d),
  warn: (m: string, d?: unknown) => getProcessLog().warn(m, d),
  debug: (m: string, d?: unknown) => getProcessLog().debug(m, d),
  error: (m: string, d?: unknown) => getProcessLog().error(m, d),
  fatal: (m: string, d?: unknown) => getProcessLog().fatal(m, d),
  trace: (m: string, d?: unknown) => getProcessLog().trace(m, d),
};

export class Process extends Handle {
  public readonly pid: number;
  public readonly memory: ISyncMemoryAccessor;

  constructor(handle: HANDLE, pid?: number, checkValid: boolean = true) {
    super(handle, checkValid);
    this.pid = pid ?? Kernel32Impl.GetProcessId(handle);
    this.memory = new RemoteMemoryAccessor(this.pid, {
      handle: this.rawHandle as any,
    });
  }

  static open(pid: number, access: number = ProcessAccess.ALL_ACCESS): Process {
    processLog.debug(`Opening process ${pid} with access ${access}`);
    const handle = Kernel32Impl.OpenProcess(access, 0, pid);
    if (!handle) {
      processLog.warn(`Failed to open process ${pid}`);
      throw new ProcessOpenError(pid);
    }
    return new Process(handle, pid);
  }

  override toString(): string {
    if (!this.isValid()) return `Process(${this.pid})[Closed]`;
    return `Process(${this.pid})[${super.toString()}]`;
  }

  createThread(
    startAddress: NativePointer,
    parameter: NativePointer | null = null,
    stackSize: SIZE_T = 0n as SIZE_T,
    flags: ThreadCreationFlags | number = ThreadCreationFlags.IMMEDIATE,
    attributes: SecurityAttributes | null = null,
  ): Thread {
    if (!this.isValid()) throw new ProcessClosedError();
    processLog.debug(
      `Creating remote thread at ${startAddress.toString()} in ${this}`,
    );
    const handle = Kernel32Impl.CreateRemoteThread(
      this.rawHandle,
      attributes,
      stackSize,
      resolveAddress(startAddress),
      parameter ? resolveAddress(parameter) : null,
      flags,
      null,
    );
    if (!handle) {
      throw new CreateThreadError(startAddress);
    }
    return new Thread(handle);
  }

  getThreadIds(): number[] {
    const snapshot = new ToolhelpSnapshot(
      ToolhelpSnapshotFlag.SNAPTHREAD,
      this.pid,
    );
    const ids: number[] = [];
    for (const thread of snapshot.getThreads()) {
      ids.push(thread.tid);
    }
    snapshot.close();
    return ids;
  }

  is64Bit(): boolean {
    if (!this.isValid()) throw new ProcessClosedError();
    const wow64Buf = Buffer.alloc(4);
    const success = Kernel32Impl.IsWow64Process(this.rawHandle, wow64Buf);
    if (!success) {
      processLog.warn(`IsWow64Process failed for process ${this.pid}`);
      return true;
    }
    return wow64Buf.readUInt32LE(0) === 0;
  }

  static current(): CurrentProcess {
    return currentProcess;
  }
}

export class CurrentProcess extends Process {
  public override readonly memory: ISyncMemoryAccessor = localMemoryAccessor;

  constructor() {
    super(
      Kernel32Impl.GetCurrentProcess(),
      Kernel32Impl.GetCurrentProcessId(),
      false,
    );
  }

  override createThread(
    startAddress: NativePointer,
    parameter?: NativePointer | null,
    stackSize: SIZE_T = 0n as SIZE_T,
    flags?: ThreadCreationFlags | number,
    attributes?: SecurityAttributes | null,
  ): Thread {
    return Thread.create(
      startAddress,
      parameter ?? null,
      stackSize,
      flags,
      attributes,
    );
  }

  override isValid(): boolean {
    return true;
  }

  override close() {}
}

let _currentProcess: CurrentProcess | undefined;
export function getCurrentProcess(): CurrentProcess {
  if (!_currentProcess) {
    _currentProcess = new CurrentProcess();
  }
  return _currentProcess;
}
export const currentProcess: CurrentProcess = new Proxy({} as CurrentProcess, {
  get(_target, prop, receiver) {
    return Reflect.get(getCurrentProcess(), prop, receiver);
  },
  set(_target, prop, value, receiver) {
    return Reflect.set(getCurrentProcess(), prop, value, receiver);
  },
});
