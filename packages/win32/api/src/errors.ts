import { ExoprocError } from 'exoproc-utils';
import type { NativePointer } from 'bun-xffi';

// ── Base ──────────────────────────────────────────────────────────────────────

abstract class BaseError extends ExoprocError {
  constructor(
    message: string,
    options?: { data?: unknown; code?: string; cause?: Error },
  ) {
    super(message, options);
  }
}

// ── Handle errors ─────────────────────────────────────────────────────────────

/**
 * Base class for all handle-related errors.
 */
export class HandleError extends BaseError {}

/**
 * Thrown when an invalid handle is provided to a constructor.
 */
export class InvalidHandleError extends HandleError {
  constructor() {
    super('Invalid handle');
  }
}

// ── Process errors ────────────────────────────────────────────────────────────

/**
 * Base class for all process-related errors.
 */
export class ProcessError extends BaseError {}

// ── Thread errors ─────────────────────────────────────────────────────────────

/**
 * Base class for all thread-related errors.
 */
export class ThreadError extends BaseError {}

/**
 * Thrown when an operation is attempted on a closed thread handle.
 */
export class ThreadClosedError extends ThreadError {
  constructor() {
    super('Thread handle is closed');
  }
}

/**
 * Thrown when OpenThread fails for a given thread ID.
 */
export class ThreadOpenError extends ThreadError {
  public readonly tid: number;

  constructor(tid: number) {
    super(`Failed to open thread ${tid}`);
    this.tid = tid;
  }
}

/**
 * Thrown when CreateThread fails.
 */
export class CreateLocalThreadError extends ThreadError {
  public readonly address: NativePointer;

  constructor(address: NativePointer) {
    super(`CreateThread failed at ${address.toString()}`);
    this.address = address;
  }
}

/**
 * Thrown when SuspendThread returns an error sentinel (0xFFFFFFFF).
 */
export class SuspendThreadError extends ThreadError {
  constructor() {
    super('SuspendThread failed');
  }
}

/**
 * Thrown when ResumeThread returns an error sentinel (0xFFFFFFFF).
 */
export class ResumeThreadError extends ThreadError {
  constructor() {
    super('ResumeThread failed');
  }
}

/**
 * Thrown when GetThreadContext fails.
 */
export class GetContextError extends ThreadError {
  constructor() {
    super('GetThreadContext failed');
  }
}

/**
 * Thrown when SetThreadContext fails.
 */
export class SetContextError extends ThreadError {
  constructor() {
    super('SetThreadContext failed');
  }
}

/**
 * Thrown when GetExitCodeThread fails.
 */
export class GetExitCodeError extends ThreadError {
  constructor() {
    super('GetExitCodeThread failed');
  }
}

/**
 * Thrown when TerminateThread fails.
 */
export class TerminateThreadError extends ThreadError {
  constructor() {
    super('TerminateThread failed');
  }
}

// ── Module errors ─────────────────────────────────────────────────────────────

/**
 * Base class for all module-related errors.
 */
export class ModuleError extends BaseError {}

/**
 * Thrown when an operation is attempted on a closed module handle.
 */
export class ModuleClosedError extends ModuleError {
  constructor() {
    super('Module handle is closed');
  }
}

/**
 * Thrown when GetModuleHandle cannot find the requested module.
 */
export class ModuleNotFoundError extends ModuleError {
  public readonly moduleName: string;

  constructor(moduleName: string) {
    super(`Failed to get module handle for ${moduleName}`);
    this.moduleName = moduleName;
  }
}

/**
 * Thrown when GetModuleInformation fails.
 */
export class ModuleInfoError extends ModuleError {
  public readonly moduleName: string;

  constructor(moduleName: string) {
    super(`Failed to get module information for ${moduleName}`);
    this.moduleName = moduleName;
  }
}

/**
 * Thrown when GetProcAddress cannot find the requested export.
 */
export class ProcAddressError extends ModuleError {
  public readonly procName: string;

  constructor(procName: string) {
    super(`Failed to get proc address for ${procName}`);
    this.procName = procName;
  }
}

export class ProcessClosedError extends ProcessError {
  constructor() {
    super('Process handle is closed');
  }
}

/**
 * Thrown when OpenProcess fails for a given PID.
 */
export class ProcessOpenError extends ProcessError {
  constructor(public readonly pid: number) {
    super(`Failed to open process ${pid}`);
  }
}

/**
 * Thrown when CreateRemoteThread fails.
 */
export class CreateThreadError extends ProcessError {
  constructor(public readonly address: NativePointer) {
    super(`CreateRemoteThread failed at ${address.toString()}`);
  }
}

// ── Snapshot errors ───────────────────────────────────────────────────────────

/**
 * Base class for all snapshot-related errors.
 */
export class SnapshotError extends BaseError {}

/**
 * Thrown when the user iterates a snapshot type that was not requested in flags.
 */
export class InvalidSnapshotFlagError extends SnapshotError {
  public readonly requiredFlag: string;

  constructor(requiredFlag: string) {
    super(`Snapshot was not created with ${requiredFlag} flag`);
    this.requiredFlag = requiredFlag;
  }
}
