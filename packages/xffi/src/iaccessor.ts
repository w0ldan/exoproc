import type {
  MemoryFreeType,
  MemoryProtection,
  MemoryState,
} from './win/defines.js';
import type { CFunction } from './cfunction.js';
import type { AddressLike, NativeMemory } from './pointer.js';
import type { MemoryBasicInformation } from './win/structs.js';
import type { CCallResult } from './types.js';
import type { Pattern } from './win/scanner.js';
import type { CMachineCode } from './cmachinecode.js';

export interface AllocNearOptions {
  /** Max distance (bytes) from `target` to search in either direction. Default: ~2GB (5-byte JMP reach). */
  maxDistance?: bigint;
  protection?: MemoryProtection;
}

/**
 * Interface representing asynchronous memory operations.
 * Designed for network-based, WebSocket-based, or async driver-level memory access.
 */
export interface IMemoryAccessor {
  readonly isLocal: boolean;
  readonly processId: number;
  enableDebug(): void;
  disableDebug(): void;
  read(address: AddressLike, size: number, offset?: number): Promise<Buffer>;
  write(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset?: number,
  ): Promise<number>;
  alloc(
    size: number,
    address?: AddressLike | null,
    protection?: MemoryProtection,
    allocationType?: MemoryState,
  ): Promise<AddressLike>;
  /**
   * Finds and commits a free region within reach of a 5-byte relative JMP from
   * `target` (default +/-~2GB), by walking `query()` results outward from
   * `target` in both directions -- the same strategy MinHook uses to place
   * trampolines close enough for a short jump instead of a 14-byte absolute one.
   */
  allocNear(
    target: AddressLike,
    size: number,
    options?: AllocNearOptions,
  ): Promise<AddressLike>;
  free(
    address: AddressLike,
    size?: number,
    freeType?: MemoryFreeType,
  ): Promise<boolean>;
  protect(
    address: AddressLike,
    size: number,
    newProtect: MemoryProtection,
  ): Promise<MemoryProtection>;
  query(address: AddressLike): Promise<MemoryBasicInformation>;
  readInt8(address: AddressLike, offset?: number): Promise<number>;
  readUInt8(address: AddressLike, offset?: number): Promise<number>;
  readInt16(address: AddressLike, offset?: number): Promise<number>;
  readUInt16(address: AddressLike, offset?: number): Promise<number>;
  readInt32(address: AddressLike, offset?: number): Promise<number>;
  readUInt32(address: AddressLike, offset?: number): Promise<number>;
  readInt64(address: AddressLike, offset?: number): Promise<bigint>;
  readUInt64(address: AddressLike, offset?: number): Promise<bigint>;
  readFloat(address: AddressLike, offset?: number): Promise<number>;
  readDouble(address: AddressLike, offset?: number): Promise<number>;
  readPointer(address: AddressLike, offset?: number): Promise<number>;
  writeInt8(
    address: AddressLike,
    value: number,
    offset?: number,
  ): Promise<number>;
  writeUInt8(
    address: AddressLike,
    value: number,
    offset?: number,
  ): Promise<number>;
  writeInt16(
    address: AddressLike,
    value: number,
    offset?: number,
  ): Promise<number>;
  writeUInt16(
    address: AddressLike,
    value: number,
    offset?: number,
  ): Promise<number>;
  writeInt32(
    address: AddressLike,
    value: number,
    offset?: number,
  ): Promise<number>;
  writeUInt32(
    address: AddressLike,
    value: number,
    offset?: number,
  ): Promise<number>;
  writeInt64(
    address: AddressLike,
    value: bigint | number,
    offset?: number,
  ): Promise<number>;
  writeUInt64(
    address: AddressLike,
    value: bigint | number,
    offset?: number,
  ): Promise<number>;
  writeFloat(
    address: AddressLike,
    value: number,
    offset?: number,
  ): Promise<number>;
  writeDouble(
    address: AddressLike,
    value: number,
    offset?: number,
  ): Promise<number>;
  writePointer(
    address: AddressLike,
    value: number | bigint,
    offset?: number,
  ): Promise<number>;
  scan(
    address: AddressLike,
    size: number,
    pattern: Pattern | string,
  ): AsyncGenerator<NativeMemory>;
  machineCode(machineCode: CMachineCode): Promise<number>;
  run?<T>(fn: () => Promise<T> | T): Promise<T>;
}

/**
 * Interface representing standard memory operations.
 * Allows decoupling of in-process memory from cross-process memory access.
 */
export interface ISyncMemoryAccessor extends IMemoryAccessor {
  readSync(address: AddressLike, size: number, offset?: number): Buffer;
  writeSync(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset?: number,
  ): number;
  allocSync(
    size: number,
    address?: AddressLike | null,
    protection?: MemoryProtection,
    allocationType?: MemoryState,
  ): AddressLike;
  /** Synchronous twin of {@link IMemoryAccessor.allocNear}. */
  allocNearSync(
    target: AddressLike,
    size: number,
    options?: AllocNearOptions,
  ): AddressLike;
  freeSync(
    address: AddressLike,
    size?: number,
    freeType?: MemoryFreeType,
  ): boolean;
  protectSync(
    address: AddressLike,
    size: number,
    newProtect: MemoryProtection,
  ): MemoryProtection;
  querySync(address: AddressLike): MemoryBasicInformation;
  readInt8Sync(address: AddressLike, offset?: number): number;
  readUInt8Sync(address: AddressLike, offset?: number): number;
  readInt16Sync(address: AddressLike, offset?: number): number;
  readUInt16Sync(address: AddressLike, offset?: number): number;
  readInt32Sync(address: AddressLike, offset?: number): number;
  readUInt32Sync(address: AddressLike, offset?: number): number;
  readInt64Sync(address: AddressLike, offset?: number): bigint;
  readUInt64Sync(address: AddressLike, offset?: number): bigint;
  readFloatSync(address: AddressLike, offset?: number): number;
  readDoubleSync(address: AddressLike, offset?: number): number;
  readPointerSync(address: AddressLike, offset?: number): number;
  writeInt8Sync(address: AddressLike, value: number, offset?: number): number;
  writeUInt8Sync(address: AddressLike, value: number, offset?: number): number;
  writeInt16Sync(address: AddressLike, value: number, offset?: number): number;
  writeUInt16Sync(address: AddressLike, value: number, offset?: number): number;
  writeInt32Sync(address: AddressLike, value: number, offset?: number): number;
  writeUInt32Sync(address: AddressLike, value: number, offset?: number): number;
  writeInt64Sync(
    address: AddressLike,
    value: bigint | number,
    offset?: number,
  ): number;
  writeUInt64Sync(
    address: AddressLike,
    value: bigint | number,
    offset?: number,
  ): number;
  writeFloatSync(address: AddressLike, value: number, offset?: number): number;
  writeDoubleSync(address: AddressLike, value: number, offset?: number): number;
  writePointerSync(
    address: AddressLike,
    value: number | bigint,
    offset?: number,
  ): number;
  scanSync(
    address: AddressLike,
    size: number,
    pattern: Pattern | string,
  ): Generator<NativeMemory>;
  machineCodeSync(machineCode: CMachineCode): number;
  runSync?<T>(fn: () => T): T;
}

/**
 * Interface representing an asynchronous memory accessor that supports execution (calling native functions).
 */
export interface ICallableMemoryAccessor extends IMemoryAccessor {
  call(func: CFunction, ...args: any[]): Promise<CCallResult>;
}

/**
 * Interface representing a synchronous memory accessor that supports execution (calling native functions).
 */
export interface ISyncCallableMemoryAccessor
  extends ISyncMemoryAccessor, ICallableMemoryAccessor {
  callSync(func: CFunction, ...args: any[]): CCallResult;
}
