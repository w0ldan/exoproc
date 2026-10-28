import { type CFunction } from './cfunction.js';
import { type AddressLike } from './pointer.js';
import { resolveAddress } from './ffi.js';
import { CType, normalizeType, type CCallResult } from './types.js';
import {
  type ICallableMemoryAccessor,
  type ISyncCallableMemoryAccessor,
} from './iaccessor.js';
import {
  AbstractMemoryAccessor,
  AbstractSyncMemoryAccessor,
  LocalMemoryAccessor,
  RemoteMemoryAccessor,
} from './accessor.js';
import { Kernel32Impl } from './win/kernel32.js';
import { waitAsync, type WaitOutcome } from './waiter.js';

/**
 * Thrown by `RemoteCallableMemoryAccessor.call()` when the remote thread
 * doesn't signal `'signaled'` before `GetExitCodeThread` would otherwise run
 * unconditionally -- on `'timeout'` the thread is still running (its "exit
 * code" would actually be `STILL_ACTIVE`/259, easily mistaken for a real
 * return value), and on `'error'` the wait handle itself went invalid.
 */
export class RemoteCallTimeoutError extends Error {
  constructor(public readonly outcome: 'timeout' | 'error') {
    super(
      `Remote thread call did not complete (waitAsync outcome: ${outcome})`,
    );
    this.name = 'RemoteCallTimeoutError';
  }
}

export abstract class AbstractCallableMemoryAccessor
  extends AbstractMemoryAccessor
  implements ICallableMemoryAccessor
{
  abstract call(func: CFunction, ...args: any[]): Promise<CCallResult>;
}

export abstract class AbstractSyncCallableMemoryAccessor
  extends AbstractSyncMemoryAccessor
  implements ISyncCallableMemoryAccessor
{
  async call(func: CFunction, ...args: any[]): Promise<CCallResult> {
    return this.callSync(func, ...args);
  }

  abstract callSync(func: CFunction, ...args: any[]): CCallResult;
}

export class LocalCallableMemoryAccessor
  extends LocalMemoryAccessor
  implements ISyncCallableMemoryAccessor
{
  callSync(func: CFunction, ...args: any[]): CCallResult {
    if (func && (func as any).localMachineCode) {
      return (func as any).localMachineCode(...args);
    }
    return func(...args);
  }

  async call(func: CFunction, ...args: any[]): Promise<CCallResult> {
    return this.callSync(func, ...args);
  }
}

export const localCallableMemoryAccessor = new LocalCallableMemoryAccessor();

export class RemoteCallableMemoryAccessor
  extends RemoteMemoryAccessor
  implements ISyncCallableMemoryAccessor
{
  protected readonly kernel32 = Kernel32Impl;
  protected readonly waitTimeout: number;

  constructor(
    processId: number,
    options: {
      handle?: AddressLike;
      access?: number;
      inheritHandle?: boolean;
      closeHandle?: boolean;
      waitTimeout?: number;
    } = {},
  ) {
    super(processId, options);
    this.waitTimeout = options.waitTimeout ?? 5000;
  }

  callSync(func: CFunction, ...args: any[]): CCallResult {
    if (
      typeof (func as any).shouldCloneForAccessor === 'function' &&
      (func as any).shouldCloneForAccessor(this)
    ) {
      const addr = this.machineCodeSync(func as any);
      func = (func as any).cloneForAddress(addr);
    }
    const returns = func.returns;
    const normRet = normalizeType(returns);
    if (
      [
        'i8',
        'u8',
        'i16',
        'u16',
        'i32',
        'u32',
        'bool',
        'ptr',
        'cstring',
        'cwstring',
      ].indexOf(normRet) === -1 &&
      returns !== 'void'
    ) {
      throw new Error(
        `RemoteProcessMemoryAccessor.callSync: Unsupported return type '${returns}'. Only 32-bit scalars, pointers, or void are supported.`,
      );
    }

    const startAddress = func.ptr;
    const parameter = args.length === 0 ? null : resolveAddress(args[0]);
    const threadIdBuffer = Buffer.alloc(4);
    const thread = this.kernel32.CreateRemoteThread(
      this.handle,
      null,
      1048576,
      startAddress,
      parameter,
      0,
      threadIdBuffer,
    );
    if (!thread) {
      throw new Error(`CreateRemoteThread failed for ${String(startAddress)}`);
    }

    try {
      this.kernel32.WaitForSingleObject(thread, this.waitTimeout);
      const exitCode = Buffer.alloc(4);
      if (!this.kernel32.GetExitCodeThread(thread, exitCode)) {
        throw new Error('GetExitCodeThread failed');
      }

      const code = exitCode.readUInt32LE(0);
      if (returns === CType.void || returns === 'void') {
        return undefined;
      }
      if (normRet === 'bool') {
        return code !== 0;
      }
      if (
        normRet === 'ptr' ||
        normRet === 'cstring' ||
        normRet === 'cwstring'
      ) {
        return BigInt(code);
      }
      return code;
    } finally {
      this.kernel32.CloseHandle(thread);
    }
  }

  async call(func: CFunction, ...args: any[]): Promise<CCallResult> {
    if (
      typeof (func as any).shouldCloneForAccessor === 'function' &&
      (func as any).shouldCloneForAccessor(this)
    ) {
      const addr = await this.machineCode(func as any);
      func = (func as any).cloneForAddress(addr);
    }
    const returns = func.returns;
    const normRet = normalizeType(returns);
    if (
      [
        'i8',
        'u8',
        'i16',
        'u16',
        'i32',
        'u32',
        'bool',
        'ptr',
        'cstring',
        'cwstring',
      ].indexOf(normRet) === -1 &&
      returns !== 'void'
    ) {
      throw new Error(
        `RemoteProcessMemoryAccessor.call: Unsupported return type '${returns}'. Only 32-bit scalars, pointers, or void are supported.`,
      );
    }

    const startAddress = func.ptr;
    const parameter = args.length === 0 ? null : resolveAddress(args[0]);
    const threadIdBuffer = Buffer.alloc(4);
    const thread = this.kernel32.CreateRemoteThread(
      this.handle,
      null,
      1048576,
      startAddress,
      parameter,
      0,
      threadIdBuffer,
    );
    if (!thread) {
      throw new Error(`CreateRemoteThread failed for ${String(startAddress)}`);
    }

    try {
      const outcome: WaitOutcome = await waitAsync(
        BigInt(resolveAddress(thread)),
        this.waitTimeout,
      );
      if (outcome !== 'signaled') {
        throw new RemoteCallTimeoutError(outcome);
      }
      const exitCode = Buffer.alloc(4);
      const got = this.kernel32.GetExitCodeThread(thread, exitCode);
      if (!got) {
        throw new Error('GetExitCodeThread failed');
      }

      const code = exitCode.readUInt32LE(0);
      if (returns === CType.void || returns === 'void') {
        return undefined;
      }
      if (normRet === 'bool') {
        return code !== 0;
      }
      if (
        normRet === 'ptr' ||
        normRet === 'cstring' ||
        normRet === 'cwstring'
      ) {
        return BigInt(code);
      }
      return code;
    } finally {
      this.kernel32.CloseHandle(thread);
    }
  }
}

// Backwards-compatible alias
export const RemoteProcessMemoryAccessor = RemoteCallableMemoryAccessor;
