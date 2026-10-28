import { type Pointer, ptr } from 'bun:ffi';
import { type CTypeToArgsType, CType } from './types.js';
import type { IMemoryAccessor, ISyncMemoryAccessor } from './iaccessor.js';
let defaultAccessor: any = null;
export function setDefaultAccessor(accessor: any) {
  defaultAccessor = accessor;
  (globalThis as any).__localMemoryAccessor = accessor;
}
export const localMemoryAccessor = new Proxy(
  {},
  {
    get(_target, prop) {
      if (!defaultAccessor) {
        throw new Error('localMemoryAccessor used before registration.');
      }
      return defaultAccessor[prop];
    },
    has(_target, prop) {
      if (!defaultAccessor) {
        return false;
      }
      return prop in defaultAccessor;
    },
    getPrototypeOf(_target) {
      if (!defaultAccessor) {
        return null;
      }
      return Object.getPrototypeOf(defaultAccessor);
    },
  },
) as any;

import { resolveAddress, readString, readStringSync } from './ffi.js';

export type AddressLike =
  number | bigint | IPointer | ISyncPointer | CTypeToArgsType[CType.pointer];

function pointerToSignedNumber(address: Pointer): number {
  const raw = BigInt(address);
  const signed = BigInt.asIntN(64, raw);
  if (signed === 0n && raw !== 0n && Number(address) !== 0) {
    return -1;
  }
  return Number(signed);
}

function pointerToUnsignedHex(address: Pointer): string {
  const raw = BigInt(address);
  const unsigned = BigInt.asUintN(64, raw);
  if (unsigned === 0n && raw !== 0n && Number(address) !== 0) {
    return 'FFFFFFFFFFFFFFFF';
  }
  return unsigned.toString(16).toUpperCase();
}

/**
 * Interface representing a native memory address with asynchronous operations.
 */
export interface IPointer {
  readonly address: Pointer;
  toNumber(): number;
  toString(): string;
  isNull(): boolean;
  toBigInt(): bigint;
  [Symbol.toPrimitive](hint: string): number | string;

  readPointer(
    offset?: number,
    accessor?: IMemoryAccessor,
  ): Promise<NativePointer>;

  read(
    size: number,
    offset?: number,
    accessor?: IMemoryAccessor,
  ): Promise<Buffer>;
  write(
    data: Buffer | Uint8Array,
    offset?: number,
    accessor?: IMemoryAccessor,
  ): Promise<number>;

  deref(offset?: number, accessor?: IMemoryAccessor): Promise<NativePointer>;

  readInt8(offset?: number, accessor?: IMemoryAccessor): Promise<number>;
  readUInt8(offset?: number, accessor?: IMemoryAccessor): Promise<number>;
  readInt16(offset?: number, accessor?: IMemoryAccessor): Promise<number>;
  readUInt16(offset?: number, accessor?: IMemoryAccessor): Promise<number>;
  readInt32(offset?: number, accessor?: IMemoryAccessor): Promise<number>;
  readUInt32(offset?: number, accessor?: IMemoryAccessor): Promise<number>;
  readInt64(offset?: number, accessor?: IMemoryAccessor): Promise<bigint>;
  readUInt64(offset?: number, accessor?: IMemoryAccessor): Promise<bigint>;
  readFloat(offset?: number, accessor?: IMemoryAccessor): Promise<number>;
  readDouble(offset?: number, accessor?: IMemoryAccessor): Promise<number>;

  writeInt8(
    value: number,
    offset?: number,
    accessor?: IMemoryAccessor,
  ): Promise<number>;
  writeUInt8(
    value: number,
    offset?: number,
    accessor?: IMemoryAccessor,
  ): Promise<number>;
  writeInt16(
    value: number,
    offset?: number,
    accessor?: IMemoryAccessor,
  ): Promise<number>;
  writeUInt16(
    value: number,
    offset?: number,
    accessor?: IMemoryAccessor,
  ): Promise<number>;
  writeInt32(
    value: number,
    offset?: number,
    accessor?: IMemoryAccessor,
  ): Promise<number>;
  writeUInt32(
    value: number,
    offset?: number,
    accessor?: IMemoryAccessor,
  ): Promise<number>;
  writeInt64(
    value: bigint | number,
    offset?: number,
    accessor?: IMemoryAccessor,
  ): Promise<number>;
  writeUInt64(
    value: bigint | number,
    offset?: number,
    accessor?: IMemoryAccessor,
  ): Promise<number>;
  writeFloat(
    value: number,
    offset?: number,
    accessor?: IMemoryAccessor,
  ): Promise<number>;
  writeDouble(
    value: number,
    offset?: number,
    accessor?: IMemoryAccessor,
  ): Promise<number>;
  writePointer(
    value: number | bigint,
    offset?: number,
    accessor?: IMemoryAccessor,
  ): Promise<number>;

  readString(options?: {
    size?: number;
    encoding?: 'utf8' | 'utf16le';
    accessor?: IMemoryAccessor;
  }): Promise<string>;

  free(accessor?: IMemoryAccessor): Promise<boolean>;
}

/**
 * Interface representing a native memory address with synchronous operations.
 * Extends IPointer to provide a universal interface that supports both sync and async.
 */
export interface ISyncPointer extends IPointer {
  readPointerSync(
    offset?: number,
    accessor?: ISyncMemoryAccessor,
  ): SyncNativePointer;

  readSync(
    size: number,
    offset?: number,
    accessor?: ISyncMemoryAccessor,
  ): Buffer;
  writeSync(
    data: Buffer | Uint8Array,
    offset?: number,
    accessor?: ISyncMemoryAccessor,
  ): number;

  derefSync(offset?: number, accessor?: ISyncMemoryAccessor): SyncNativePointer;

  readInt8Sync(offset?: number, accessor?: ISyncMemoryAccessor): number;
  readUInt8Sync(offset?: number, accessor?: ISyncMemoryAccessor): number;
  readInt16Sync(offset?: number, accessor?: ISyncMemoryAccessor): number;
  readUInt16Sync(offset?: number, accessor?: ISyncMemoryAccessor): number;
  readInt32Sync(offset?: number, accessor?: ISyncMemoryAccessor): number;
  readUInt32Sync(offset?: number, accessor?: ISyncMemoryAccessor): number;
  readInt64Sync(offset?: number, accessor?: ISyncMemoryAccessor): bigint;
  readUInt64Sync(offset?: number, accessor?: ISyncMemoryAccessor): bigint;
  readFloatSync(offset?: number, accessor?: ISyncMemoryAccessor): number;
  readDoubleSync(offset?: number, accessor?: ISyncMemoryAccessor): number;

  writeInt8Sync(
    value: number,
    offset?: number,
    accessor?: ISyncMemoryAccessor,
  ): number;
  writeUInt8Sync(
    value: number,
    offset?: number,
    accessor?: ISyncMemoryAccessor,
  ): number;
  writeInt16Sync(
    value: number,
    offset?: number,
    accessor?: ISyncMemoryAccessor,
  ): number;
  writeUInt16Sync(
    value: number,
    offset?: number,
    accessor?: ISyncMemoryAccessor,
  ): number;
  writeInt32Sync(
    value: number,
    offset?: number,
    accessor?: ISyncMemoryAccessor,
  ): number;
  writeUInt32Sync(
    value: number,
    offset?: number,
    accessor?: ISyncMemoryAccessor,
  ): number;
  writeInt64Sync(
    value: bigint | number,
    offset?: number,
    accessor?: ISyncMemoryAccessor,
  ): number;
  writeUInt64Sync(
    value: bigint | number,
    offset?: number,
    accessor?: ISyncMemoryAccessor,
  ): number;
  writeFloatSync(
    value: number,
    offset?: number,
    accessor?: ISyncMemoryAccessor,
  ): number;
  writeDoubleSync(
    value: number,
    offset?: number,
    accessor?: ISyncMemoryAccessor,
  ): number;
  writePointerSync(
    value: number | bigint,
    offset?: number,
    accessor?: ISyncMemoryAccessor,
  ): number;

  readStringSync(options?: {
    size?: number;
    encoding?: 'utf8' | 'utf16le';
    accessor?: ISyncMemoryAccessor;
  }): string;

  freeSync(accessor?: ISyncMemoryAccessor): boolean;
}

export interface ISyncMemory extends ISyncPointer {
  readonly size: number;
}

export interface IMemory extends IPointer {
  readonly size: number;
}

export class SyncNativePointer implements ISyncPointer {
  public readonly address: Pointer;

  constructor(value: AddressLike | null) {
    if (value === null || value === undefined) {
      this.address = 0 as Pointer;
    } else if (typeof value === 'object' && 'address' in value) {
      this.address = value.address as Pointer;
    } else if (ArrayBuffer.isView(value)) {
      this.address = ptr(value) as Pointer;
    } else {
      this.address = resolveAddress(value) as Pointer;
    }
  }

  toNumber(): number {
    return pointerToSignedNumber(this.address);
  }
  toString(): string {
    return `0x${pointerToUnsignedHex(this.address)}`;
  }
  isNull(): boolean {
    return Number(this.address) === 0;
  }
  toBigInt(): bigint {
    return BigInt(resolveAddress(this.address));
  }
  valueOf(): number {
    return this.toNumber();
  }

  [Symbol.toPrimitive](hint: string): number | string {
    if (hint === 'string') return this.toString();
    if (hint === 'number') return this.toNumber();
    return this.toNumber();
  }

  readSync(
    size: number,
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): Buffer {
    return accessor.readSync(this.address, size, offset);
  }
  async read(
    size: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<Buffer> {
    return accessor.read(this.address, size, offset);
  }

  writeSync(
    data: Buffer | Uint8Array,
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.writeSync(this.address, data, offset);
  }
  async write(
    data: Buffer | Uint8Array,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.write(this.address, data, offset);
  }

  readPointerSync(
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): SyncNativePointer {
    if (this.isNull()) return new SyncNativePointer(0);
    const targetAddr = accessor.readPointerSync(this.address, offset);
    return new SyncNativePointer(targetAddr);
  }
  async readPointer(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<NativePointer> {
    if (this.isNull()) return new NativePointer(0);
    let targetAddr: number;
    if ('readPointer' in accessor) {
      targetAddr = await accessor.readPointer(this.address, offset);
    } else {
      targetAddr = (accessor as any).readPointerSync(this.address, offset);
    }
    return new NativePointer(targetAddr);
  }

  add(offset: number): SyncNativePointer {
    return new SyncNativePointer(this.toNumber() + offset);
  }
  sub(offset: number): SyncNativePointer {
    return new SyncNativePointer(this.toNumber() - offset);
  }

  derefSync(
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): SyncNativePointer {
    return this.readPointerSync(offset, accessor);
  }
  async deref(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<NativePointer> {
    return await this.readPointer(offset, accessor);
  }

  freeSync(
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): boolean {
    return accessor.freeSync(this.address);
  }
  async free(
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<boolean> {
    return accessor.free(this.address);
  }

  readInt8Sync(
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.readInt8Sync(this.address, offset);
  }
  readUInt8Sync(
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.readUInt8Sync(this.address, offset);
  }
  readInt16Sync(
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.readInt16Sync(this.address, offset);
  }
  readUInt16Sync(
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.readUInt16Sync(this.address, offset);
  }
  readInt32Sync(
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.readInt32Sync(this.address, offset);
  }
  readUInt32Sync(
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.readUInt32Sync(this.address, offset);
  }
  readInt64Sync(
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): bigint {
    return accessor.readInt64Sync(this.address, offset);
  }
  readUInt64Sync(
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): bigint {
    return accessor.readUInt64Sync(this.address, offset);
  }
  readFloatSync(
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.readFloatSync(this.address, offset);
  }
  readDoubleSync(
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.readDoubleSync(this.address, offset);
  }

  async readInt8(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readInt8(this.address, offset);
  }
  async readUInt8(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readUInt8(this.address, offset);
  }
  async readInt16(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readInt16(this.address, offset);
  }
  async readUInt16(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readUInt16(this.address, offset);
  }
  async readInt32(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readInt32(this.address, offset);
  }
  async readUInt32(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readUInt32(this.address, offset);
  }
  async readInt64(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<bigint> {
    return accessor.readInt64(this.address, offset);
  }
  async readUInt64(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<bigint> {
    return accessor.readUInt64(this.address, offset);
  }
  async readFloat(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readFloat(this.address, offset);
  }
  async readDouble(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readDouble(this.address, offset);
  }

  writeInt8Sync(
    value: number,
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.writeInt8Sync(this.address, value, offset);
  }
  writeUInt8Sync(
    value: number,
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.writeUInt8Sync(this.address, value, offset);
  }
  writeInt16Sync(
    value: number,
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.writeInt16Sync(this.address, value, offset);
  }
  writeUInt16Sync(
    value: number,
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.writeUInt16Sync(this.address, value, offset);
  }
  writeInt32Sync(
    value: number,
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.writeInt32Sync(this.address, value, offset);
  }
  writeUInt32Sync(
    value: number,
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.writeUInt32Sync(this.address, value, offset);
  }
  writeInt64Sync(
    value: bigint | number,
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.writeInt64Sync(this.address, value, offset);
  }
  writeUInt64Sync(
    value: bigint | number,
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.writeUInt64Sync(this.address, value, offset);
  }
  writeFloatSync(
    value: number,
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.writeFloatSync(this.address, value, offset);
  }
  writeDoubleSync(
    value: number,
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.writeDoubleSync(this.address, value, offset);
  }
  writePointerSync(
    value: number | bigint,
    offset = 0,
    accessor: ISyncMemoryAccessor = localMemoryAccessor as any,
  ): number {
    return accessor.writePointerSync(this.address, value, offset);
  }

  async writeInt8(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeInt8(this.address, value, offset);
  }
  async writeUInt8(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeUInt8(this.address, value, offset);
  }
  async writeInt16(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeInt16(this.address, value, offset);
  }
  async writeUInt16(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeUInt16(this.address, value, offset);
  }
  async writeInt32(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeInt32(this.address, value, offset);
  }
  async writeUInt32(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeUInt32(this.address, value, offset);
  }
  async writeInt64(
    value: bigint | number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeInt64(this.address, value, offset);
  }
  async writeUInt64(
    value: bigint | number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeUInt64(this.address, value, offset);
  }
  async writeFloat(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeFloat(this.address, value, offset);
  }
  async writeDouble(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeDouble(this.address, value, offset);
  }
  async writePointer(
    value: number | bigint,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writePointer(this.address, value, offset);
  }

  readStringSync(options?: {
    size?: number;
    encoding?: 'utf8' | 'utf16le';
    accessor?: ISyncMemoryAccessor;
  }): string {
    return readStringSync(this.address, options);
  }

  async readString(options?: {
    size?: number;
    encoding?: 'utf8' | 'utf16le';
    accessor?: IMemoryAccessor;
  }): Promise<string> {
    return readString(this.address, options);
  }
}

export class SyncNativeMemory extends SyncNativePointer implements ISyncMemory {
  public readonly size: number;

  constructor(address: AddressLike | null, size: number) {
    super(address);
    this.size = size;
  }

  override toString(): string {
    return `Memory at ${super.toString()} (${this.size} bytes)`;
  }
}

export class NativePointer implements IPointer {
  public readonly address: Pointer;

  constructor(value: AddressLike | null) {
    if (value === null || value === undefined) {
      this.address = 0 as Pointer;
    } else if (typeof value === 'object' && 'address' in value) {
      this.address = value.address as Pointer;
    } else if (ArrayBuffer.isView(value)) {
      this.address = ptr(value) as Pointer;
    } else {
      this.address = resolveAddress(value) as Pointer;
    }
  }

  toNumber(): number {
    return pointerToSignedNumber(this.address);
  }
  toString(): string {
    return `0x${pointerToUnsignedHex(this.address)}`;
  }
  isNull(): boolean {
    return Number(this.address) === 0;
  }
  toBigInt(): bigint {
    return BigInt(resolveAddress(this.address));
  }
  valueOf(): number {
    return this.toNumber();
  }
  [Symbol.toPrimitive](hint: string): number | string {
    if (hint === 'string') return this.toString();
    if (hint === 'number') return this.toNumber();
    return this.toNumber();
  }

  async read(
    size: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<Buffer> {
    return accessor.read(this.address, size, offset);
  }
  async write(
    data: Buffer | Uint8Array,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.write(this.address, data, offset);
  }

  async readPointer(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<NativePointer> {
    if (this.isNull()) return new NativePointer(0);
    const target = await accessor.readPointer(this.address, offset);
    return new NativePointer(target);
  }

  add(offset: number): NativePointer {
    return new NativePointer(this.toNumber() + offset);
  }
  sub(offset: number): NativePointer {
    return new NativePointer(this.toNumber() - offset);
  }

  async deref(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<NativePointer> {
    return await this.readPointer(offset, accessor);
  }
  async free(
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<boolean> {
    return accessor.free(this.address);
  }

  async readInt8(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readInt8(this.address, offset);
  }
  async readUInt8(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readUInt8(this.address, offset);
  }
  async readInt16(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readInt16(this.address, offset);
  }
  async readUInt16(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readUInt16(this.address, offset);
  }
  async readInt32(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readInt32(this.address, offset);
  }
  async readUInt32(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readUInt32(this.address, offset);
  }
  async readInt64(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<bigint> {
    return accessor.readInt64(this.address, offset);
  }
  async readUInt64(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<bigint> {
    return accessor.readUInt64(this.address, offset);
  }
  async readFloat(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readFloat(this.address, offset);
  }
  async readDouble(
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.readDouble(this.address, offset);
  }

  async writeInt8(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeInt8(this.address, value, offset);
  }
  async writeUInt8(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeUInt8(this.address, value, offset);
  }
  async writeInt16(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeInt16(this.address, value, offset);
  }
  async writeUInt16(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeUInt16(this.address, value, offset);
  }
  async writeInt32(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeInt32(this.address, value, offset);
  }
  async writeUInt32(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeUInt32(this.address, value, offset);
  }
  async writeInt64(
    value: bigint | number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeInt64(this.address, value, offset);
  }
  async writeUInt64(
    value: bigint | number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeUInt64(this.address, value, offset);
  }
  async writeFloat(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeFloat(this.address, value, offset);
  }
  async writeDouble(
    value: number,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writeDouble(this.address, value, offset);
  }
  async writePointer(
    value: number | bigint,
    offset = 0,
    accessor: IMemoryAccessor = localMemoryAccessor,
  ): Promise<number> {
    return accessor.writePointer(this.address, value, offset);
  }

  async readString(options?: {
    size?: number;
    encoding?: 'utf8' | 'utf16le';
    accessor?: IMemoryAccessor;
  }): Promise<string> {
    return readString(this.address, options);
  }

  upgrade(byteLength: number): NativeMemory {
    return new NativeMemory(this, byteLength);
  }
}

export class NativeMemory extends NativePointer implements IMemory {
  public readonly size: number;

  constructor(address: AddressLike | null, size: number) {
    super(address);
    this.size = size;
  }

  override toString(): string {
    return `Memory at ${super.toString()} (${this.size} bytes)`;
  }
}
