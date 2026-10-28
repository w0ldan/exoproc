import { read, toArrayBuffer, type Pointer } from 'bun:ffi';
import {
  type AddressLike,
  setDefaultAccessor,
  NativeMemory,
} from './pointer.js';
import {
  resolveAddress,
  currentProcessId,
  currentProcessHandle,
} from './ffi.js';
export * from './iaccessor.js';
import { runOn, runOnSync } from './runner-context.js';
import {
  type IMemoryAccessor,
  type ISyncMemoryAccessor,
  type AllocNearOptions,
} from './iaccessor.js';
import { Kernel32Impl } from './win/kernel32.js';
import { CrtImpl } from './win/msvcrt.js';
import { MemoryBasicInformation } from './win/structs.js';
import {
  MemoryFreeType,
  MemoryProtection,
  MemoryState,
} from './win/defines.js';
import { Pattern } from './win/scanner.js';
import { type CMachineCode } from './cmachinecode.js';
import {
  computeNearAllocRange,
  nearProbeAddresses,
  freeRegionCandidate,
  AllocNearRangeError,
} from './near-alloc.js';

/**
 * Base abstract class that implements helper asynchronous scalar reads/writes
 * by translating them into core `read` and `write` calls.
 * Custom/Remote accessors can inherit from this to get all helper methods for free.
 */
export abstract class AbstractMemoryAccessor implements IMemoryAccessor {
  protected _processId: number;
  constructor(processId: number) {
    this._processId = processId;
  }

  enableDebug(): void {}

  disableDebug(): void {}

  abstract machineCode(machineCode: CMachineCode): Promise<number>;

  get processId(): number {
    return this._processId;
  }

  get isLocal() {
    return this.processId === currentProcessId;
  }

  abstract read(
    address: AddressLike,
    size: number,
    offset?: number,
  ): Promise<Buffer>;
  abstract write(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset?: number,
  ): Promise<number>;
  abstract alloc(
    size: number,
    address?: AddressLike | null,
    protection?: MemoryProtection,
    allocationType?: MemoryState,
  ): Promise<AddressLike>;
  abstract free(
    address: AddressLike,
    size?: number,
    freeType?: MemoryFreeType,
  ): Promise<boolean>;
  abstract protect(
    address: AddressLike,
    size: number,
    newProtect: MemoryProtection,
  ): Promise<MemoryProtection>;
  abstract query(address: AddressLike): Promise<MemoryBasicInformation>;

  async allocNear(
    target: AddressLike,
    size: number,
    options: AllocNearOptions = {},
  ): Promise<AddressLike> {
    const range = computeNearAllocRange(target, options);
    const protection = options.protection ?? MemoryProtection.EXECUTE_READWRITE;
    const allocationType = (MemoryState.COMMIT |
      MemoryState.RESERVE) as MemoryState;

    for (const probeAddr of nearProbeAddresses(range, 'backward')) {
      const info = await this.query(probeAddr);
      const candidate = freeRegionCandidate(info, size, range);
      if (candidate === null) continue;
      try {
        return await this.alloc(size, candidate, protection, allocationType);
      } catch {
        /* region got claimed or rejected between query and alloc -- keep looking */
      }
    }
    for (const probeAddr of nearProbeAddresses(range, 'forward')) {
      const info = await this.query(probeAddr);
      const candidate = freeRegionCandidate(info, size, range);
      if (candidate === null) continue;
      try {
        return await this.alloc(size, candidate, protection, allocationType);
      } catch {
        /* region got claimed or rejected between query and alloc -- keep looking */
      }
    }
    throw new AllocNearRangeError(range.target, range.maxDistance);
  }

  async readInt8(address: AddressLike, offset = 0): Promise<number> {
    const buf = await this.read(resolveAddress(address) + offset, 1);
    return buf.readInt8(0);
  }
  async readUInt8(address: AddressLike, offset = 0): Promise<number> {
    const buf = await this.read(resolveAddress(address) + offset, 1);
    return buf.readUInt8(0);
  }
  async readInt16(address: AddressLike, offset = 0): Promise<number> {
    const buf = await this.read(resolveAddress(address) + offset, 2);
    return buf.readInt16LE(0);
  }
  async readUInt16(address: AddressLike, offset = 0): Promise<number> {
    const buf = await this.read(resolveAddress(address) + offset, 2);
    return buf.readUInt16LE(0);
  }
  async readInt32(address: AddressLike, offset = 0): Promise<number> {
    const buf = await this.read(resolveAddress(address) + offset, 4);
    return buf.readInt32LE(0);
  }
  async readUInt32(address: AddressLike, offset = 0): Promise<number> {
    const buf = await this.read(resolveAddress(address) + offset, 4);
    return buf.readUInt32LE(0);
  }
  async readInt64(address: AddressLike, offset = 0): Promise<bigint> {
    const buf = await this.read(resolveAddress(address) + offset, 8);
    return buf.readBigInt64LE(0);
  }
  async readUInt64(address: AddressLike, offset = 0): Promise<bigint> {
    const buf = await this.read(resolveAddress(address) + offset, 8);
    return buf.readBigUInt64LE(0);
  }
  async readFloat(address: AddressLike, offset = 0): Promise<number> {
    const buf = await this.read(resolveAddress(address) + offset, 4);
    return buf.readFloatLE(0);
  }
  async readDouble(address: AddressLike, offset = 0): Promise<number> {
    const buf = await this.read(resolveAddress(address) + offset, 8);
    return buf.readDoubleLE(0);
  }
  async readPointer(address: AddressLike, offset = 0): Promise<number> {
    const buf = await this.read(resolveAddress(address) + offset, 8);
    return Number(buf.readBigUInt64LE(0));
  }

  async writeInt8(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    const buf = Buffer.alloc(1);
    buf.writeInt8(value, 0);
    return await this.write(resolveAddress(address) + offset, buf);
  }
  async writeUInt8(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    const buf = Buffer.alloc(1);
    buf.writeUInt8(value, 0);
    return await this.write(resolveAddress(address) + offset, buf);
  }
  async writeInt16(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    const buf = Buffer.alloc(2);
    buf.writeInt16LE(value, 0);
    return await this.write(resolveAddress(address) + offset, buf);
  }
  async writeUInt16(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(value, 0);
    return await this.write(resolveAddress(address) + offset, buf);
  }
  async writeInt32(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(value, 0);
    return await this.write(resolveAddress(address) + offset, buf);
  }
  async writeUInt32(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(value, 0);
    return await this.write(resolveAddress(address) + offset, buf);
  }
  async writeInt64(
    address: AddressLike,
    value: bigint | number,
    offset = 0,
  ): Promise<number> {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64LE(BigInt(value), 0);
    return await this.write(resolveAddress(address) + offset, buf);
  }
  async writeUInt64(
    address: AddressLike,
    value: bigint | number,
    offset = 0,
  ): Promise<number> {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(value), 0);
    return await this.write(resolveAddress(address) + offset, buf);
  }
  async writeFloat(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    const buf = Buffer.alloc(4);
    buf.writeFloatLE(value, 0);
    return await this.write(resolveAddress(address) + offset, buf);
  }
  async writeDouble(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    const buf = Buffer.alloc(8);
    buf.writeDoubleLE(value, 0);
    return await this.write(resolveAddress(address) + offset, buf);
  }
  async writePointer(
    address: AddressLike,
    value: number | bigint,
    offset = 0,
  ): Promise<number> {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(value), 0);
    return await this.write(resolveAddress(address) + offset, buf);
  }

  abstract scan(
    address: AddressLike,
    size: number,
    pattern: Pattern | string,
  ): AsyncGenerator<NativeMemory>;

  /**
   * Executes an asynchronous callback with this accessor bound as the ambient context.
   * Any Win32 CFunction invoked inside `fn` will automatically route through this accessor.
   */
  public run<T>(fn: () => Promise<T> | T): Promise<T> {
    return runOn(this, fn);
  }
}

/**
 * Base abstract class that implements helper typed scalar reads/writes
 * by translating them into core `readSync` and `writeSync` calls.
 * Custom/Remote accessors can inherit from this to get all helper methods for free.
 */
export abstract class AbstractSyncMemoryAccessor
  extends AbstractMemoryAccessor
  implements ISyncMemoryAccessor
{
  /**
   * Executes a synchronous callback with this accessor bound as the ambient context.
   * Any Win32 CFunction invoked inside `fn` will automatically route through this accessor.
   */
  public runSync<T>(fn: () => T): T {
    return runOnSync(this, fn);
  }
  abstract readSync(
    address: AddressLike,
    size: number,
    offset?: number,
  ): Buffer;
  abstract writeSync(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset?: number,
  ): number;
  abstract allocSync(
    size: number,
    address?: AddressLike | null,
    protection?: MemoryProtection,
    allocationType?: MemoryState,
  ): AddressLike;
  abstract freeSync(
    address: AddressLike,
    size?: number,
    freeType?: MemoryFreeType,
  ): boolean;
  abstract protectSync(
    address: AddressLike,
    size: number,
    newProtect: MemoryProtection,
  ): MemoryProtection;
  abstract querySync(address: AddressLike): MemoryBasicInformation;

  /** Synchronous twin of {@link AbstractMemoryAccessor.allocNear}. */
  allocNearSync(
    target: AddressLike,
    size: number,
    options: AllocNearOptions = {},
  ): AddressLike {
    const range = computeNearAllocRange(target, options);
    const protection = options.protection ?? MemoryProtection.EXECUTE_READWRITE;
    const allocationType = (MemoryState.COMMIT |
      MemoryState.RESERVE) as MemoryState;

    for (const probeAddr of nearProbeAddresses(range, 'backward')) {
      const info = this.querySync(probeAddr);
      const candidate = freeRegionCandidate(info, size, range);
      if (candidate === null) continue;
      try {
        return this.allocSync(size, candidate, protection, allocationType);
      } catch {
        /* region got claimed or rejected between query and alloc -- keep looking */
      }
    }
    for (const probeAddr of nearProbeAddresses(range, 'forward')) {
      const info = this.querySync(probeAddr);
      const candidate = freeRegionCandidate(info, size, range);
      if (candidate === null) continue;
      try {
        return this.allocSync(size, candidate, protection, allocationType);
      } catch {
        /* region got claimed or rejected between query and alloc -- keep looking */
      }
    }
    throw new AllocNearRangeError(range.target, range.maxDistance);
  }

  abstract machineCodeSync(machineCode: CMachineCode): number;

  override async machineCode(machineCode: CMachineCode): Promise<number> {
    return this.machineCodeSync(machineCode);
  }

  readInt8Sync(address: AddressLike, offset = 0): number {
    return this.readSync(resolveAddress(address) + offset, 1).readInt8(0);
  }
  readUInt8Sync(address: AddressLike, offset = 0): number {
    return this.readSync(resolveAddress(address) + offset, 1).readUInt8(0);
  }
  readInt16Sync(address: AddressLike, offset = 0): number {
    return this.readSync(resolveAddress(address) + offset, 2).readInt16LE(0);
  }
  readUInt16Sync(address: AddressLike, offset = 0): number {
    return this.readSync(resolveAddress(address) + offset, 2).readUInt16LE(0);
  }
  readInt32Sync(address: AddressLike, offset = 0): number {
    return this.readSync(resolveAddress(address) + offset, 4).readInt32LE(0);
  }
  readUInt32Sync(address: AddressLike, offset = 0): number {
    return this.readSync(resolveAddress(address) + offset, 4).readUInt32LE(0);
  }
  readInt64Sync(address: AddressLike, offset = 0): bigint {
    return this.readSync(resolveAddress(address) + offset, 8).readBigInt64LE(0);
  }
  readUInt64Sync(address: AddressLike, offset = 0): bigint {
    return this.readSync(resolveAddress(address) + offset, 8).readBigUInt64LE(
      0,
    );
  }
  readFloatSync(address: AddressLike, offset = 0): number {
    return this.readSync(resolveAddress(address) + offset, 4).readFloatLE(0);
  }
  readDoubleSync(address: AddressLike, offset = 0): number {
    return this.readSync(resolveAddress(address) + offset, 8).readDoubleLE(0);
  }
  readPointerSync(address: AddressLike, offset = 0): number {
    return Number(
      this.readSync(resolveAddress(address) + offset, 8).readBigUInt64LE(0),
    );
  }

  writeInt8Sync(address: AddressLike, value: number, offset = 0): number {
    const buf = Buffer.alloc(1);
    buf.writeInt8(value, 0);
    return this.writeSync(resolveAddress(address) + offset, buf);
  }
  writeUInt8Sync(address: AddressLike, value: number, offset = 0): number {
    const buf = Buffer.alloc(1);
    buf.writeUInt8(value, 0);
    return this.writeSync(resolveAddress(address) + offset, buf);
  }
  writeInt16Sync(address: AddressLike, value: number, offset = 0): number {
    const buf = Buffer.alloc(2);
    buf.writeInt16LE(value, 0);
    return this.writeSync(resolveAddress(address) + offset, buf);
  }
  writeUInt16Sync(address: AddressLike, value: number, offset = 0): number {
    const buf = Buffer.alloc(2);
    buf.writeUInt16LE(value, 0);
    return this.writeSync(resolveAddress(address) + offset, buf);
  }
  writeInt32Sync(address: AddressLike, value: number, offset = 0): number {
    const buf = Buffer.alloc(4);
    buf.writeInt32LE(value, 0);
    return this.writeSync(resolveAddress(address) + offset, buf);
  }
  writeUInt32Sync(address: AddressLike, value: number, offset = 0): number {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(value, 0);
    return this.writeSync(resolveAddress(address) + offset, buf);
  }
  writeInt64Sync(
    address: AddressLike,
    value: bigint | number,
    offset = 0,
  ): number {
    const buf = Buffer.alloc(8);
    buf.writeBigInt64LE(BigInt(value), 0);
    return this.writeSync(resolveAddress(address) + offset, buf);
  }
  writeUInt64Sync(
    address: AddressLike,
    value: bigint | number,
    offset = 0,
  ): number {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(value), 0);
    return this.writeSync(resolveAddress(address) + offset, buf);
  }
  writeFloatSync(address: AddressLike, value: number, offset = 0): number {
    const buf = Buffer.alloc(4);
    buf.writeFloatLE(value, 0);
    return this.writeSync(resolveAddress(address) + offset, buf);
  }
  writeDoubleSync(address: AddressLike, value: number, offset = 0): number {
    const buf = Buffer.alloc(8);
    buf.writeDoubleLE(value, 0);
    return this.writeSync(resolveAddress(address) + offset, buf);
  }
  writePointerSync(
    address: AddressLike,
    value: number | bigint,
    offset = 0,
  ): number {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(value), 0);
    return this.writeSync(resolveAddress(address) + offset, buf);
  }

  // --- Generic Asynchronous Implementations wrapping Synchronous versions ---
  async read(
    address: AddressLike,
    size: number,
    offset?: number,
  ): Promise<Buffer> {
    return this.readSync(address, size, offset);
  }
  async write(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset?: number,
  ): Promise<number> {
    return this.writeSync(address, data, offset);
  }
  async alloc(
    size: number,
    address?: AddressLike | null,
    protection?: MemoryProtection,
    allocationType: MemoryState = (MemoryState.COMMIT |
      MemoryState.RESERVE) as MemoryState,
  ): Promise<AddressLike> {
    return this.allocSync(size, address, protection, allocationType);
  }
  async free(
    address: AddressLike,
    size?: number,
    freeType?: MemoryFreeType,
  ): Promise<boolean> {
    return this.freeSync(address, size, freeType);
  }
  async protect(
    address: AddressLike,
    size: number,
    newProtect: MemoryProtection,
  ): Promise<MemoryProtection> {
    return this.protectSync(address, size, newProtect);
  }
  async query(address: AddressLike): Promise<MemoryBasicInformation> {
    return this.querySync(address);
  }

  // Async scalar reads mapped to their sync counterparts
  override async readInt8(address: AddressLike, offset = 0): Promise<number> {
    return this.readInt8Sync(address, offset);
  }
  override async readUInt8(address: AddressLike, offset = 0): Promise<number> {
    return this.readUInt8Sync(address, offset);
  }
  override async readInt16(address: AddressLike, offset = 0): Promise<number> {
    return this.readInt16Sync(address, offset);
  }
  override async readUInt16(address: AddressLike, offset = 0): Promise<number> {
    return this.readUInt16Sync(address, offset);
  }
  override async readInt32(address: AddressLike, offset = 0): Promise<number> {
    return this.readInt32Sync(address, offset);
  }
  override async readUInt32(address: AddressLike, offset = 0): Promise<number> {
    return this.readUInt32Sync(address, offset);
  }
  override async readInt64(address: AddressLike, offset = 0): Promise<bigint> {
    return this.readInt64Sync(address, offset);
  }
  override async readUInt64(address: AddressLike, offset = 0): Promise<bigint> {
    return this.readUInt64Sync(address, offset);
  }
  override async readFloat(address: AddressLike, offset = 0): Promise<number> {
    return this.readFloatSync(address, offset);
  }
  override async readDouble(address: AddressLike, offset = 0): Promise<number> {
    return this.readDoubleSync(address, offset);
  }
  override async readPointer(
    address: AddressLike,
    offset = 0,
  ): Promise<number> {
    return this.readPointerSync(address, offset);
  }

  // Async scalar writes mapped to their sync counterparts
  override async writeInt8(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    return this.writeInt8Sync(address, value, offset);
  }
  override async writeUInt8(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    return this.writeUInt8Sync(address, value, offset);
  }
  override async writeInt16(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    return this.writeInt16Sync(address, value, offset);
  }
  override async writeUInt16(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    return this.writeUInt16Sync(address, value, offset);
  }
  override async writeInt32(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    return this.writeInt32Sync(address, value, offset);
  }
  override async writeUInt32(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    return this.writeUInt32Sync(address, value, offset);
  }
  override async writeInt64(
    address: AddressLike,
    value: bigint | number,
    offset = 0,
  ): Promise<number> {
    return this.writeInt64Sync(address, value, offset);
  }
  override async writeUInt64(
    address: AddressLike,
    value: bigint | number,
    offset = 0,
  ): Promise<number> {
    return this.writeUInt64Sync(address, value, offset);
  }
  override async writeFloat(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    return this.writeFloatSync(address, value, offset);
  }
  override async writeDouble(
    address: AddressLike,
    value: number,
    offset = 0,
  ): Promise<number> {
    return this.writeDoubleSync(address, value, offset);
  }
  override async writePointer(
    address: AddressLike,
    value: number | bigint,
    offset = 0,
  ): Promise<number> {
    return this.writePointerSync(address, value, offset);
  }

  abstract scanSync(
    address: AddressLike,
    size: number,
    pattern: Pattern | string,
  ): Generator<NativeMemory>;

  override async *scan(
    address: AddressLike,
    size: number,
    pattern: Pattern | string,
  ): AsyncGenerator<NativeMemory> {
    yield* this.scanSync(address, size, pattern);
  }
}

export class RemoteMemoryAccessor
  extends AbstractSyncMemoryAccessor
  implements ISyncMemoryAccessor
{
  public readonly handle: AddressLike;

  protected readonly ownsHandle: boolean;

  constructor(
    processId: number,
    options: {
      handle?: AddressLike;
      access?: number;
      inheritHandle?: boolean;
      closeHandle?: boolean;
    } = {},
  ) {
    super(processId);
    this.ownsHandle = options.closeHandle ?? true;

    if (processId === -1 || processId === -2) {
      this.handle = 0;
    } else if (options.handle !== undefined) {
      this.handle = options.handle;
    } else {
      const access =
        options.access ?? 0x0002 | 0x0008 | 0x0010 | 0x0020 | 0x0400;
      const inheritHandle = options.inheritHandle ? 1 : 0;
      const openedHandle = Kernel32Impl.OpenProcess(
        access,
        inheritHandle,
        processId,
      );
      if (!openedHandle) {
        throw new Error(`OpenProcess failed for processId ${processId}`);
      }
      this.handle = openedHandle;
    }
  }

  close(): void {
    if (this.ownsHandle && this.handle) {
      Kernel32Impl.CloseHandle(this.handle);
    }
  }

  readSync(address: AddressLike, size: number, offset = 0): Buffer {
    const source = resolveAddress(address) + offset;
    const buffer = Buffer.alloc(size);
    const bytesRead = Buffer.alloc(8);
    const success = Kernel32Impl.ReadProcessMemory(
      this.handle,
      source,
      buffer,
      size,
      bytesRead,
    );

    if (!success) {
      return Buffer.alloc(0);
    }

    const readSize = Number(bytesRead.readBigUInt64LE(0));
    return readSize >= size ? buffer : buffer.subarray(0, readSize);
  }

  writeSync(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): number {
    const destination = resolveAddress(address) + offset;
    const source = data instanceof Buffer ? data : Buffer.from(data);
    const bytesWritten = Buffer.alloc(8);
    const success = Kernel32Impl.WriteProcessMemory(
      this.handle,
      destination,
      source,
      source.byteLength,
      bytesWritten,
    );
    if (!success) {
      return 0;
    }
    return Number(bytesWritten.readBigUInt64LE(0));
  }

  allocSync(
    size: number | any,
    address: AddressLike | null = null,
    protection: any = 0x04,
    allocationType: any = 0x3000,
  ): AddressLike {
    const allocSize = typeof size === 'number' ? size : Number(size); // simplify sizeof assumption
    const pointer = Kernel32Impl.VirtualAllocEx(
      this.handle,
      address,
      allocSize,
      allocationType,
      protection,
    );
    if (!pointer) {
      throw new Error(`VirtualAllocEx failed for size ${allocSize}`);
    }
    return pointer;
  }

  freeSync(
    address: AddressLike,
    size = 0,
    freeType: MemoryFreeType = MemoryFreeType.DECOMMIT,
  ): boolean {
    return !!Kernel32Impl.VirtualFreeEx(
      this.handle,
      resolveAddress(address),
      size,
      freeType,
    );
  }

  protectSync(
    address: AddressLike,
    size: number,
    newProtect: MemoryProtection,
  ): MemoryProtection {
    const oldProtect = Buffer.alloc(4);
    const success = Kernel32Impl.VirtualProtectEx(
      this.handle,
      resolveAddress(address),
      size,
      newProtect,
      oldProtect,
    );
    if (!success) return MemoryProtection.NOACCESS;
    return oldProtect.readUInt32LE(0) as MemoryProtection;
  }

  querySync(address: AddressLike): MemoryBasicInformation {
    const info = new MemoryBasicInformation();
    const result = Kernel32Impl.VirtualQueryEx(
      this.handle,
      resolveAddress(address),
      info,
      info.size,
    );
    if (!result) {
      throw new Error(
        `VirtualQueryEx failed for address ${resolveAddress(address)}`,
      );
    }

    return info;
  }

  // --- Asynchronous Implementations delegating to the *Sync methods ---
  override async read(
    address: AddressLike,
    size: number,
    offset = 0,
  ): Promise<Buffer> {
    return this.readSync(address, size, offset);
  }

  override async write(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): Promise<number> {
    return this.writeSync(address, data, offset);
  }

  override async alloc(
    size: number,
    address: AddressLike | null = null,
    protection: MemoryProtection = MemoryProtection.READWRITE,
    allocationType: MemoryState = (MemoryState.COMMIT |
      MemoryState.RESERVE) as MemoryState,
  ): Promise<AddressLike> {
    return this.allocSync(size, address, protection, allocationType);
  }

  override async free(
    address: AddressLike,
    size = 0,
    freeType: MemoryFreeType = MemoryFreeType.DECOMMIT,
  ): Promise<boolean> {
    return this.freeSync(address, size, freeType);
  }

  override async protect(
    address: AddressLike,
    size: number,
    newProtect: MemoryProtection,
  ): Promise<MemoryProtection> {
    return this.protectSync(address, size, newProtect);
  }

  override async query(address: AddressLike): Promise<MemoryBasicInformation> {
    return this.querySync(address);
  }

  override machineCodeSync(machineCode: CMachineCode): number {
    if (
      typeof machineCode.shouldCloneForAccessor === 'function' &&
      !machineCode.shouldCloneForAccessor(this)
    ) {
      return machineCode.address;
    }
    const size = machineCode.size;
    const bytes = Array.isArray(machineCode.bytes)
      ? new Uint8Array(machineCode.bytes)
      : machineCode.bytes;
    const remoteAddr = this.allocSync(
      size,
      null,
      0x40, // EXECUTE_READWRITE
      0x3000, // COMMIT | RESERVE
    );
    this.writeSync(remoteAddr, bytes);
    return Number(remoteAddr);
  }

  override async machineCode(machineCode: CMachineCode): Promise<number> {
    if (
      typeof machineCode.shouldCloneForAccessor === 'function' &&
      !machineCode.shouldCloneForAccessor(this)
    ) {
      return machineCode.address;
    }
    const size = machineCode.size;
    const bytes = Array.isArray(machineCode.bytes)
      ? new Uint8Array(machineCode.bytes)
      : machineCode.bytes;
    const remoteAddr = await this.alloc(
      size,
      null,
      0x40, // EXECUTE_READWRITE
      0x3000, // COMMIT | RESERVE
    );
    await this.write(remoteAddr, bytes);
    return Number(remoteAddr);
  }

  override *scanSync(
    address: AddressLike,
    size: number,
    pattern: Pattern | string,
  ): Generator<NativeMemory> {
    const pat = typeof pattern === 'string' ? new Pattern(pattern) : pattern;
    const startAddr = BigInt(resolveAddress(address));
    const end = startAddr + BigInt(size);
    let current = startAddr;

    while (current < end) {
      const mbi = this.querySync(current);
      const regionBase = BigInt(resolveAddress(mbi.BaseAddress));
      const regionSize = BigInt(mbi.RegionSize);
      const regionEnd = regionBase + regionSize;
      const isReadable =
        mbi.State === MemoryState.COMMIT &&
        !(mbi.Protect & MemoryProtection.GUARD) &&
        !!(mbi.Protect & pat.protect);

      if (isReadable) {
        const scanStart = current > regionBase ? current : regionBase;
        const scanEnd = end < regionEnd ? end : regionEnd;
        const scanSize = Number(scanEnd - scanStart);
        if (scanSize >= pat.length) {
          const localBuf = this.readSync(scanStart, scanSize);
          const needle = pat.bytes;
          let pos = 0;
          while (pos <= localBuf.length - pat.length) {
            const idx = localBuf.indexOf(needle, pos);
            if (idx === -1) break;
            yield new NativeMemory(scanStart + BigInt(idx), pat.length);
            pos = idx + 1;
          }
        }
      }
      if (regionEnd <= current) break;
      current = regionEnd;
    }
  }
}

/**
 * High-performance Memory Accessor for the local process.
 * Utilizes bun:ffi low-level 'read' namespace for scalar reads.
 * Implements both IMemoryAccessor and ISyncMemoryAccessor to run in hybrid mode.
 */
export class LocalMemoryAccessor extends RemoteMemoryAccessor {
  public readonly isDirectLocal = true;
  private _virtualAllocated = new Set<number>();

  constructor() {
    super(currentProcessId, {
      handle: currentProcessHandle,
      closeHandle: false,
    });
  }

  override readSync(address: AddressLike, size: number, offset = 0): Buffer {
    const addr = resolveAddress(address) + offset;
    if (addr <= 0) return Buffer.alloc(0);
    return Buffer.from(toArrayBuffer(addr as Pointer, 0, size));
  }

  override writeSync(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): number {
    const addr = resolveAddress(address) + offset;
    if (addr <= 0) return 0;
    const dest = new Uint8Array(
      toArrayBuffer(addr as Pointer, 0, data.byteLength),
    );
    dest.set(data);
    return data.byteLength;
  }

  override allocSync(
    size: number,
    address: AddressLike | null = null,
    protection: MemoryProtection = 0x04,
    allocationType: MemoryState = 0x3000,
  ): number {
    const isExecutable = !!(protection & 0xf0);
    if (isExecutable || address !== null) {
      const ptr = Kernel32Impl.VirtualAlloc(
        address ? resolveAddress(address) : 0,
        size,
        allocationType,
        protection,
      );
      if (!ptr || Number(ptr) === 0) {
        throw new Error(`VirtualAlloc failed for size ${size}`);
      }
      this._virtualAllocated.add(Number(ptr));
      return Number(ptr);
    }
    const ptr = CrtImpl.malloc(size);
    if (!ptr) throw new Error(`malloc failed for size ${size}`);
    return Number(ptr);
  }

  override freeSync(
    address: AddressLike,
    _size = 0,
    _freeType: any = 0,
  ): boolean {
    const addrNum = resolveAddress(address);
    if (this._virtualAllocated.has(addrNum)) {
      this._virtualAllocated.delete(addrNum);
      return !!Kernel32Impl.VirtualFree(addrNum, 0, 0x8000); // MEM_RELEASE
    }
    CrtImpl.free(addrNum);
    return true;
  }

  override protectSync(
    address: AddressLike,
    size: number,
    newProtect: MemoryProtection,
  ): MemoryProtection {
    const oldProtect = Buffer.alloc(4);
    const success = Kernel32Impl.VirtualProtect(
      resolveAddress(address),
      size,
      newProtect,
      oldProtect,
    );
    if (!success) return MemoryProtection.NOACCESS;
    return oldProtect.readUInt32LE(0) as MemoryProtection;
  }

  override querySync(address: AddressLike): MemoryBasicInformation {
    const info = new MemoryBasicInformation();
    const result = Kernel32Impl.VirtualQuery(
      resolveAddress(address),
      info,
      info.size,
    );
    if (!result) {
      throw new Error(
        `VirtualQuery failed for address ${resolveAddress(address)}`,
      );
    }
    return info;
  }

  override async protect(
    address: AddressLike,
    size: number,
    newProtect: MemoryProtection,
  ): Promise<MemoryProtection> {
    return this.protectSync(address, size, newProtect);
  }

  override async query(address: AddressLike): Promise<MemoryBasicInformation> {
    return this.querySync(address);
  }

  // Override reads using bun:ffi's low-level scalar reading (bypass DataView allocation)
  override readInt8Sync(address: AddressLike, offset = 0): number {
    return read.i8((resolveAddress(address) + offset) as Pointer);
  }
  override readUInt8Sync(address: AddressLike, offset = 0): number {
    return read.u8((resolveAddress(address) + offset) as Pointer);
  }
  override readInt16Sync(address: AddressLike, offset = 0): number {
    return read.i16((resolveAddress(address) + offset) as Pointer);
  }
  override readUInt16Sync(address: AddressLike, offset = 0): number {
    return read.u16((resolveAddress(address) + offset) as Pointer);
  }
  override readInt32Sync(address: AddressLike, offset = 0): number {
    return read.i32((resolveAddress(address) + offset) as Pointer);
  }
  override readUInt32Sync(address: AddressLike, offset = 0): number {
    return read.u32((resolveAddress(address) + offset) as Pointer);
  }
  override readInt64Sync(address: AddressLike, offset = 0): bigint {
    return read.i64((resolveAddress(address) + offset) as Pointer);
  }
  override readUInt64Sync(address: AddressLike, offset = 0): bigint {
    return read.u64((resolveAddress(address) + offset) as Pointer);
  }
  override readFloatSync(address: AddressLike, offset = 0): number {
    return read.f32((resolveAddress(address) + offset) as Pointer);
  }
  override readDoubleSync(address: AddressLike, offset = 0): number {
    return read.f64((resolveAddress(address) + offset) as Pointer);
  }
  override readPointerSync(address: AddressLike, offset = 0): number {
    return Number(read.ptr((resolveAddress(address) + offset) as Pointer));
  }

  // Optimized direct scalar writes
  override writeInt8Sync(
    address: AddressLike,
    value: number,
    offset = 0,
  ): number {
    const view = new DataView(
      toArrayBuffer((resolveAddress(address) + offset) as Pointer, 0, 1),
    );
    view.setInt8(0, value);
    return 1;
  }
  override writeUInt8Sync(
    address: AddressLike,
    value: number,
    offset = 0,
  ): number {
    const view = new DataView(
      toArrayBuffer((resolveAddress(address) + offset) as Pointer, 0, 1),
    );
    view.setUint8(0, value);
    return 1;
  }
  override writeInt16Sync(
    address: AddressLike,
    value: number,
    offset = 0,
  ): number {
    const view = new DataView(
      toArrayBuffer((resolveAddress(address) + offset) as Pointer, 0, 2),
    );
    view.setInt16(0, value, true);
    return 2;
  }
  override writeUInt16Sync(
    address: AddressLike,
    value: number,
    offset = 0,
  ): number {
    const view = new DataView(
      toArrayBuffer((resolveAddress(address) + offset) as Pointer, 0, 2),
    );
    view.setUint16(0, value, true);
    return 2;
  }
  override writeInt32Sync(
    address: AddressLike,
    value: number,
    offset = 0,
  ): number {
    const view = new DataView(
      toArrayBuffer((resolveAddress(address) + offset) as Pointer, 0, 4),
    );
    view.setInt32(0, value, true);
    return 4;
  }
  override writeUInt32Sync(
    address: AddressLike,
    value: number,
    offset = 0,
  ): number {
    const view = new DataView(
      toArrayBuffer((resolveAddress(address) + offset) as Pointer, 0, 4),
    );
    view.setUint32(0, value, true);
    return 4;
  }
  override writeInt64Sync(
    address: AddressLike,
    value: bigint | number,
    offset = 0,
  ): number {
    const view = new DataView(
      toArrayBuffer((resolveAddress(address) + offset) as Pointer, 0, 8),
    );
    view.setBigInt64(0, BigInt(value), true);
    return 8;
  }
  override writeUInt64Sync(
    address: AddressLike,
    value: bigint | number,
    offset = 0,
  ): number {
    const view = new DataView(
      toArrayBuffer((resolveAddress(address) + offset) as Pointer, 0, 8),
    );
    view.setBigUint64(0, BigInt(value), true);
    return 8;
  }
  override writeFloatSync(
    address: AddressLike,
    value: number,
    offset = 0,
  ): number {
    const view = new DataView(
      toArrayBuffer((resolveAddress(address) + offset) as Pointer, 0, 4),
    );
    view.setFloat32(0, value, true);
    return 4;
  }
  override writeDoubleSync(
    address: AddressLike,
    value: number,
    offset = 0,
  ): number {
    const view = new DataView(
      toArrayBuffer((resolveAddress(address) + offset) as Pointer, 0, 8),
    );
    view.setFloat64(0, value, true);
    return 8;
  }
  override writePointerSync(
    address: AddressLike,
    value: number | bigint,
    offset = 0,
  ): number {
    const view = new DataView(
      toArrayBuffer((resolveAddress(address) + offset) as Pointer, 0, 8),
    );
    view.setBigUint64(0, BigInt(value), true);
    return 8;
  }

  override machineCodeSync(machineCode: CMachineCode): number {
    return Number(machineCode.ptr);
  }

  override async machineCode(machineCode: CMachineCode): Promise<number> {
    return Number(machineCode.ptr);
  }

  override *scanSync(
    address: AddressLike,
    size: number,
    pattern: Pattern | string,
  ): Generator<NativeMemory> {
    const pat = typeof pattern === 'string' ? new Pattern(pattern) : pattern;
    const startAddr = BigInt(resolveAddress(address));
    const end = startAddr + BigInt(size);
    let current = startAddr;

    while (current < end) {
      let mbi: MemoryBasicInformation;
      try {
        mbi = this.querySync(current);
      } catch {
        // VirtualQuery can fail for restricted address ranges (e.g. the null page on
        // Windows Server 2025 with VBS). Skip forward by the minimum allocation
        // granularity (64 KB) and keep scanning.
        current += 0x10000n;
        continue;
      }
      const regionBase = BigInt(resolveAddress(mbi.BaseAddress));
      const regionSize = BigInt(mbi.RegionSize);
      const regionEnd = regionBase + regionSize;
      const isReadable =
        mbi.State === MemoryState.COMMIT &&
        !(mbi.Protect & MemoryProtection.GUARD) &&
        !!(mbi.Protect & pat.protect);

      if (isReadable) {
        const scanStart = current > regionBase ? current : regionBase;
        const scanEnd = end < regionEnd ? end : regionEnd;
        const scanSize = Number(scanEnd - scanStart);
        if (scanSize >= pat.length) {
          const localBuf = Buffer.from(
            toArrayBuffer(Number(scanStart) as Pointer, 0, scanSize),
          );
          const needle = pat.bytes;
          let pos = 0;
          while (pos <= localBuf.length - pat.length) {
            const idx = localBuf.indexOf(needle, pos);
            if (idx === -1) break;
            yield new NativeMemory(scanStart + BigInt(idx), pat.length);
            pos = idx + 1;
          }
        }
      }
      if (regionEnd <= current) break;
      current = regionEnd;
    }
  }
}
export const concreteLocalMemoryAccessor: LocalMemoryAccessor =
  new LocalMemoryAccessor();
setDefaultAccessor(concreteLocalMemoryAccessor);
