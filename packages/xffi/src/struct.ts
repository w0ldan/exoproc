import { toArrayBuffer, ptr as bunPtr } from 'bun:ffi';
import {
  NativePointer,
  NativeMemory,
  SyncNativePointer,
  SyncNativeMemory,
  type IMemory,
  type ISyncMemory,
  type AddressLike,
  localMemoryAccessor,
} from './pointer.js';
import {
  type StructSchema,
  type CTypeToReturnsType,
  type CTypeStringToType,
  type CType,
  mapFFITypeToC,
} from './types.js';
import {
  compileStruct,
  sizeof,
  type ComputedStructField,
  type ComputedStruct,
} from './ffi.js';
import { type ISyncMemoryAccessor, type IMemoryAccessor } from './iaccessor.js';

let classCache: WeakMap<StructSchema, any>;
let asyncClassCache: WeakMap<StructSchema, any>;

/**
 * Interface representing a native C structure with synchronous operations.
 */
export interface ISyncStruct<S extends StructSchema = any> extends ISyncMemory {
  readonly _view: DataView;
  readonly _accessor: ISyncMemoryAccessor;
  get(fieldName: string): any;
  set(fieldName: string, value: any): any;
  getAsync(fieldName: string): Promise<any>;
  setAsync(fieldName: string, value: any): Promise<void>;
  assign(values: Partial<PlainStructType<S>>): this;
}

/**
 * Interface representing a native C structure with asynchronous operations.
 */
export interface IStruct<S extends StructSchema = any> extends IMemory {
  readonly _accessor: IMemoryAccessor;
  get(fieldName: string): Promise<any>;
  set(fieldName: string, value: any): Promise<void>;
  getAsync(fieldName: string): Promise<any>;
  setAsync(fieldName: string, value: any): Promise<void>;
  toStringAsync(): Promise<string>;
  assign(values: Partial<PlainStructType<S>>): Promise<this>;
}

/**
 * Maps a StructSchema to an exact TypeScript object type.
 */
type MapArrayElementType<E> = E extends 'char' | 'CHAR' | 'BYTE'
  ? string
  : E extends 'i8' | 'int8_t'
    ? Int8Array
    : E extends 'u8' | 'uint8_t' | 'uchar'
      ? Uint8Array
      : E extends 'i16' | 'short' | 'SHORT'
        ? Int16Array
        : E extends 'u16' | 'ushort' | 'WORD'
          ? Uint16Array
          : E extends 'i32' | 'int' | 'DWORD' | 'BOOL' | 'LONG'
            ? Int32Array
            : E extends 'u32' | 'uint' | 'UINT'
              ? Uint32Array
              : E extends 'i64' | 'longlong' | 'LONGLONG'
                ? BigInt64Array
                : E extends
                      | 'u64'
                      | 'usize'
                      | 'size_t'
                      | 'UINT64'
                      | 'ptr'
                      | 'pointer'
                      | 'HANDLE'
                      | 'HWND'
                      | 'HMODULE'
                      | 'LPVOID'
                      | 'LPCVOID'
                      | 'LPDWORD'
                      | 'INT_PTR'
                  ? BigUint64Array
                  : any;

type ResolvePlainFieldType<T> = T extends keyof CTypeStringToType
  ? CTypeToReturnsType[CTypeStringToType[T]]
  : T extends CType
    ? CTypeToReturnsType[T]
    : T extends StructClass<infer SubSchema>
      ? PlainStructType<SubSchema>
      : T extends StructSchema
        ? PlainStructType<T>
        : any;

export type PlainStructType<S extends StructSchema> = {
  -readonly [K in keyof S]: ResolvePlainFieldType<S[K]>;
};

type ResolveFieldType<T> = T extends keyof CTypeStringToType
  ? CTypeToReturnsType[CTypeStringToType[T]]
  : T extends CType
    ? CTypeToReturnsType[T]
    : T extends StructClass<infer SubSchema>
      ? SyncStructType<SubSchema> | PlainStructType<SubSchema>
      : T extends StructSchema
        ? SyncStructType<T> | PlainStructType<T>
        : any;

type ResolveAsyncFieldType<T> = T extends keyof CTypeStringToType
  ? CTypeToReturnsType[CTypeStringToType[T]]
  : T extends CType
    ? CTypeToReturnsType[T]
    : T extends StructClass<infer SubSchema>
      ? StructType<SubSchema>
      : T extends StructSchema
        ? StructType<T>
        : any;

type MapFieldType<T> = T extends `${infer E}[${any}]`
  ? MapArrayElementType<E>
  : T extends [infer E, number]
    ? MapArrayElementType<E>
    : ResolveFieldType<T>;

type MapAsyncFieldType<T> = T extends `${infer E}[${any}]`
  ? Promise<MapArrayElementType<E>>
  : T extends [infer E, number]
    ? Promise<MapArrayElementType<E>>
    : Promise<ResolveAsyncFieldType<T>>;

export type InferStructSchema<S extends StructSchema> = {
  -readonly [K in keyof S]: MapFieldType<S[K]>;
};

export type SyncStructType<S extends StructSchema> = SyncNativePointer &
  ISyncStruct<S> &
  InferStructSchema<S> & {
    assign(values: Partial<PlainStructType<S>>): SyncStructType<S>;
  };

export type StructType<S extends StructSchema> = NativePointer &
  IStruct<S> & {
    -readonly [K in keyof S]: MapAsyncFieldType<S[K]>;
  } & {
    assign(values: Partial<PlainStructType<S>>): Promise<StructType<S>>;
  };

import { normalizeType } from './types.js';

function getTypedArrayConstructor(type: any) {
  const norm = normalizeType(type);
  switch (norm) {
    case 'i8':
      return Int8Array;
    case 'u8':
      return Uint8Array;
    case 'i16':
      return Int16Array;
    case 'u16':
      return Uint16Array;
    case 'i32':
      return Int32Array;
    case 'u32':
      return Uint32Array;
    case 'i64':
      return BigInt64Array;
    case 'u64':
      return BigUint64Array;
    case 'f32':
      return Float32Array;
    case 'f64':
      return Float64Array;
    case 'ptr':
      return BigUint64Array;
    case 'cstring':
      return Uint8Array; // Allow reading string memory as bytes
    default:
      return Uint8Array;
  }
}

function isStringArray(type: any): boolean {
  if (typeof type === 'string') {
    const t = type.toLowerCase();
    return t === 'char' || t === 'uchar';
  }
  return false;
}

function readField(instance: any, field: ComputedStructField): any {
  const { type, offset, isArray, arrayLength, arrayElementType } = field;
  const address = Number(instance.address);
  const accessor: ISyncMemoryAccessor = instance._accessor;

  if (typeof type === 'function' && 'isStructClass' in type) {
    return new type(address + offset, accessor);
  }
  if (typeof type === 'object' && type !== null && !Array.isArray(type)) {
    return new (getCompiledClass(type as any))(address + offset, accessor);
  }

  const normType = normalizeType(type as any);

  if (
    (accessor as any).isDirectLocal &&
    instance._view &&
    instance._view.byteLength > 0
  ) {
    if (isArray) {
      if (isStringArray(arrayElementType)) {
        const buf = new Uint8Array(
          instance._view.buffer,
          instance._view.byteOffset + offset,
          arrayLength!,
        );
        let end = buf.indexOf(0);
        if (end === -1) end = arrayLength!;
        return new TextDecoder().decode(buf.subarray(0, end));
      } else {
        const TypedArray: any = getTypedArrayConstructor(arrayElementType);
        return new TypedArray(
          instance._view.buffer,
          instance._view.byteOffset + offset,
          arrayLength,
        );
      }
    }

    switch (normType) {
      case 'i8':
        return instance._view.getInt8(offset);
      case 'u8':
        return instance._view.getUint8(offset);
      case 'i16':
        return instance._view.getInt16(offset, true);
      case 'u16':
        return instance._view.getUint16(offset, true);
      case 'i32':
        return instance._view.getInt32(offset, true);
      case 'u32':
        return instance._view.getUint32(offset, true);
      case 'i64':
        return instance._view.getBigInt64(offset, true);
      case 'u64':
        return instance._view.getBigUint64(offset, true);
      case 'f32':
        return instance._view.getFloat32(offset, true);
      case 'f64':
        return instance._view.getFloat64(offset, true);
      case 'ptr':
        return Number(instance._view.getBigUint64(offset, true));
      default:
        throw new Error(`Unsupported struct field type for reading: ${type}`);
    }
  }

  if (isArray) {
    if (isStringArray(arrayElementType)) {
      const buf = accessor.readSync(address + offset, arrayLength!);
      let end = buf.indexOf(0);
      if (end === -1) end = arrayLength!;
      return new TextDecoder().decode(buf.subarray(0, end));
    } else {
      const buf = accessor.readSync(
        address + offset,
        sizeof(arrayElementType) * arrayLength!,
      );
      const TypedArray: any = getTypedArrayConstructor(arrayElementType);
      return new TypedArray(buf.buffer, buf.byteOffset, arrayLength);
    }
  }

  switch (normType) {
    case 'i8':
      return accessor.readInt8Sync(address, offset);
    case 'u8':
      return accessor.readUInt8Sync(address, offset);
    case 'i16':
      return accessor.readInt16Sync(address, offset);
    case 'u16':
      return accessor.readUInt16Sync(address, offset);
    case 'i32':
      return accessor.readInt32Sync(address, offset);
    case 'u32':
      return accessor.readUInt32Sync(address, offset);
    case 'i64':
      return accessor.readInt64Sync(address, offset);
    case 'u64':
      return accessor.readUInt64Sync(address, offset);
    case 'f32':
      return accessor.readFloatSync(address, offset);
    case 'f64':
      return accessor.readDoubleSync(address, offset);
    case 'ptr':
      return accessor.readPointerSync(address, offset);
    default:
      throw new Error(`Unsupported struct field type for reading: ${type}`);
  }
}

/**
 * Resolves a struct field value into a `bigint` for `i64`/`u64`/`ptr` writes.
 * `null`/`undefined` (a NULL pointer -- a routine value for optional `ptr`
 * fields like `lpReserved`) map to `0n` rather than throwing, and a
 * pointer-like object (anything with an `address` property) resolves via
 * that address, matching how such objects are already handled elsewhere in
 * this file.
 */
function toBigIntFieldValue(value: any): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === 'object' && 'address' in value) {
    return BigInt(Number(value.address));
  }
  return BigInt(value);
}

function writeField(
  instance: any,
  field: ComputedStructField,
  value: any,
): void {
  const { type, offset, isArray, arrayLength, arrayElementType } = field;
  const address = Number(instance.address);
  const accessor: ISyncMemoryAccessor = instance._accessor;

  if (typeof type === 'function' && 'isStructClass' in type) {
    const nested = new type(address + offset, accessor);
    for (const [k, v] of Object.entries(value)) {
      nested[k] = v;
    }
    return;
  }
  if (typeof type === 'object' && type !== null && !Array.isArray(type)) {
    const nested = new (getCompiledClass(type as any))(
      address + offset,
      accessor,
    );
    for (const [k, v] of Object.entries(value)) {
      nested[k] = v;
    }
    return;
  }

  const normType = normalizeType(type as any);

  if (
    (accessor as any).isDirectLocal &&
    instance._view &&
    instance._view.byteLength > 0
  ) {
    if (isArray) {
      if (isStringArray(arrayElementType)) {
        const encoded = new TextEncoder().encode(String(value));
        const viewBytes = new Uint8Array(
          instance._view.buffer,
          instance._view.byteOffset + offset,
          arrayLength!,
        );
        viewBytes.fill(0);
        viewBytes.set(
          encoded.subarray(0, Math.min(encoded.length, arrayLength!)),
        );
        return;
      } else {
        const TypedArray: any = getTypedArrayConstructor(arrayElementType);
        const destArray = new TypedArray(
          instance._view.buffer,
          instance._view.byteOffset + offset,
          arrayLength!,
        );
        if (Array.isArray(value) || ArrayBuffer.isView(value)) {
          destArray.set(value as any);
        } else {
          for (let i = 0; i < Math.min(arrayLength!, value.length || 0); i++) {
            destArray[i] = value[i];
          }
        }
        return;
      }
    }

    switch (normType) {
      case 'i8':
        instance._view.setInt8(offset, Number(value));
        return;
      case 'u8':
        instance._view.setUint8(offset, Number(value));
        return;
      case 'i16':
        instance._view.setInt16(offset, Number(value), true);
        return;
      case 'u16':
        instance._view.setUint16(offset, Number(value), true);
        return;
      case 'i32':
        instance._view.setInt32(offset, Number(value), true);
        return;
      case 'u32':
        instance._view.setUint32(offset, Number(value), true);
        return;
      case 'i64':
        instance._view.setBigInt64(offset, toBigIntFieldValue(value), true);
        return;
      case 'u64':
        instance._view.setBigUint64(offset, toBigIntFieldValue(value), true);
        return;
      case 'f32':
        instance._view.setFloat32(offset, Number(value), true);
        return;
      case 'f64':
        instance._view.setFloat64(offset, Number(value), true);
        return;
      case 'ptr':
        instance._view.setBigUint64(offset, toBigIntFieldValue(value), true);
        return;
      default:
        throw new Error(`Unsupported struct field type for writing: ${type}`);
    }
  }

  if (isArray) {
    if (isStringArray(arrayElementType)) {
      const encoded = new TextEncoder().encode(String(value));
      const buf = Buffer.alloc(arrayLength!);
      buf.set(encoded.subarray(0, arrayLength!));
      accessor.writeSync(address + offset, buf);
      return;
    } else {
      const TypedArray: any = getTypedArrayConstructor(arrayElementType);

      let sourceArray: any;
      if (Array.isArray(value) || ArrayBuffer.isView(value)) {
        sourceArray = new TypedArray(value);
      } else {
        sourceArray = new TypedArray(arrayLength!);
        for (let i = 0; i < Math.min(arrayLength!, value.length || 0); i++) {
          sourceArray[i] = value[i];
        }
      }

      const buf = Buffer.from(
        sourceArray.buffer,
        sourceArray.byteOffset,
        sourceArray.byteLength,
      );
      accessor.writeSync(address + offset, buf);
      return;
    }
  }

  // Resolve pointers to address number
  let valToWrite = value;
  if (normType === 'ptr') {
    if (typeof value === 'object' && value !== null && 'address' in value) {
      valToWrite = Number(value.address);
    } else {
      valToWrite = Number(value);
    }
  }

  switch (normType) {
    case 'i8':
      accessor.writeInt8Sync(address, Number(valToWrite), offset);
      break;
    case 'u8':
      accessor.writeUInt8Sync(address, Number(valToWrite), offset);
      break;
    case 'i16':
      accessor.writeInt16Sync(address, Number(valToWrite), offset);
      break;
    case 'u16':
      accessor.writeUInt16Sync(address, Number(valToWrite), offset);
      break;
    case 'i32':
      accessor.writeInt32Sync(address, Number(valToWrite), offset);
      break;
    case 'u32':
      accessor.writeUInt32Sync(address, Number(valToWrite), offset);
      break;
    case 'i64':
      accessor.writeInt64Sync(address, toBigIntFieldValue(valToWrite), offset);
      break;
    case 'u64':
      accessor.writeUInt64Sync(address, toBigIntFieldValue(valToWrite), offset);
      break;
    case 'f32':
      accessor.writeFloatSync(address, Number(valToWrite), offset);
      break;
    case 'f64':
      accessor.writeDoubleSync(address, Number(valToWrite), offset);
      break;
    case 'ptr':
      accessor.writePointerSync(address, Number(valToWrite), offset);
      break;
    default:
      throw new Error(`Unsupported struct field type for writing: ${type}`);
  }
}

async function readFieldAsync(
  instance: any,
  field: ComputedStructField,
): Promise<any> {
  const { type, offset, isArray, arrayLength, arrayElementType } = field;
  const address = Number(instance.address);
  const accessor = instance._accessor;

  if (typeof type === 'function' && 'isStructClass' in type) {
    const AsyncClass = getCompiledAsyncClass((type as any).schema);
    return new AsyncClass(address + offset, accessor);
  }
  if (typeof type === 'object' && type !== null && !Array.isArray(type)) {
    const AsyncClass = getCompiledAsyncClass(type as any);
    return new AsyncClass(address + offset, accessor);
  }

  const normType = normalizeType(type as any);

  if (isArray) {
    if (isStringArray(arrayElementType)) {
      const buf = await ('read' in accessor
        ? (accessor as IMemoryAccessor).read(address + offset, arrayLength!)
        : (accessor as ISyncMemoryAccessor).readSync(
            address + offset,
            arrayLength!,
          ));
      let end = buf.indexOf(0);
      if (end === -1) end = arrayLength!;
      return new TextDecoder().decode(buf.subarray(0, end));
    } else {
      const elementSize = sizeof(arrayElementType);
      const buf = await ('read' in accessor
        ? (accessor as IMemoryAccessor).read(
            address + offset,
            elementSize * arrayLength!,
          )
        : (accessor as ISyncMemoryAccessor).readSync(
            address + offset,
            elementSize * arrayLength!,
          ));
      const TypedArray: any = getTypedArrayConstructor(arrayElementType);
      return new TypedArray(buf.buffer, buf.byteOffset, arrayLength);
    }
  }

  switch (normType) {
    case 'i8':
      return await ('readInt8' in accessor
        ? (accessor as IMemoryAccessor).readInt8(address, offset)
        : (accessor as ISyncMemoryAccessor).readInt8Sync(address, offset));
    case 'u8':
      return await ('readUInt8' in accessor
        ? (accessor as IMemoryAccessor).readUInt8(address, offset)
        : (accessor as ISyncMemoryAccessor).readUInt8Sync(address, offset));
    case 'i16':
      return await ('readInt16' in accessor
        ? (accessor as IMemoryAccessor).readInt16(address, offset)
        : (accessor as ISyncMemoryAccessor).readInt16Sync(address, offset));
    case 'u16':
      return await ('readUInt16' in accessor
        ? (accessor as IMemoryAccessor).readUInt16(address, offset)
        : (accessor as ISyncMemoryAccessor).readUInt16Sync(address, offset));
    case 'i32':
      return await ('readInt32' in accessor
        ? (accessor as IMemoryAccessor).readInt32(address, offset)
        : (accessor as ISyncMemoryAccessor).readInt32Sync(address, offset));
    case 'u32':
      return await ('readUInt32' in accessor
        ? (accessor as IMemoryAccessor).readUInt32(address, offset)
        : (accessor as ISyncMemoryAccessor).readUInt32Sync(address, offset));
    case 'i64':
      return await ('readInt64' in accessor
        ? (accessor as IMemoryAccessor).readInt64(address, offset)
        : (accessor as ISyncMemoryAccessor).readInt64Sync(address, offset));
    case 'u64':
      return await ('readUInt64' in accessor
        ? (accessor as IMemoryAccessor).readUInt64(address, offset)
        : (accessor as ISyncMemoryAccessor).readUInt64Sync(address, offset));
    case 'f32':
      return await ('readFloat' in accessor
        ? (accessor as IMemoryAccessor).readFloat(address, offset)
        : (accessor as ISyncMemoryAccessor).readFloatSync(address, offset));
    case 'f64':
      return await ('readDouble' in accessor
        ? (accessor as IMemoryAccessor).readDouble(address, offset)
        : (accessor as ISyncMemoryAccessor).readDoubleSync(address, offset));
    case 'ptr':
      return await ('readPointer' in accessor
        ? (accessor as IMemoryAccessor).readPointer(address, offset)
        : (accessor as ISyncMemoryAccessor).readPointerSync(address, offset));
    default:
      throw new Error(`Unsupported struct field type for reading: ${type}`);
  }
}

async function writeFieldAsync(
  instance: any,
  field: ComputedStructField,
  value: any,
): Promise<void> {
  const { type, offset, isArray, arrayLength, arrayElementType } = field;
  const address = Number(instance.address);
  const accessor = instance._accessor;

  if (typeof type === 'function' && 'isStructClass' in type) {
    const AsyncClass = getCompiledAsyncClass((type as any).schema);
    const nested = new AsyncClass(address + offset, accessor);
    for (const [k, v] of Object.entries(value)) {
      await nested.set(k, v);
    }
    return;
  }
  if (typeof type === 'object' && type !== null && !Array.isArray(type)) {
    const AsyncClass = getCompiledAsyncClass(type as any);
    const nested = new AsyncClass(address + offset, accessor);
    for (const [k, v] of Object.entries(value)) {
      await nested.set(k, v);
    }
    return;
  }

  const normType = normalizeType(type as any);

  if (isArray) {
    const normElemType = normalizeType(arrayElementType as any);
    if (normElemType === 'i8' || normElemType === 'u8') {
      const encoded = new TextEncoder().encode(String(value));
      const buf = Buffer.alloc(arrayLength!);
      buf.set(encoded.subarray(0, arrayLength!));
      if ('write' in accessor) {
        await (accessor as IMemoryAccessor).write(address + offset, buf);
      } else {
        (accessor as ISyncMemoryAccessor).writeSync(address + offset, buf);
      }
      return;
    } else {
      const TypedArray: any = getTypedArrayConstructor(arrayElementType);
      let sourceArray: any;
      if (Array.isArray(value) || ArrayBuffer.isView(value)) {
        sourceArray = new TypedArray(value);
      } else {
        sourceArray = new TypedArray(arrayLength!);
        for (let i = 0; i < Math.min(arrayLength!, value.length || 0); i++) {
          sourceArray[i] = value[i];
        }
      }
      const buf = Buffer.from(
        sourceArray.buffer,
        sourceArray.byteOffset,
        sourceArray.byteLength,
      );
      if ('write' in accessor) {
        await (accessor as IMemoryAccessor).write(address + offset, buf);
      } else {
        (accessor as ISyncMemoryAccessor).writeSync(address + offset, buf);
      }
      return;
    }
  }

  // Resolve pointers to address number
  let valToWrite = value;
  if (normType === 'ptr') {
    if (typeof value === 'object' && value !== null && 'address' in value) {
      valToWrite = Number(value.address);
    } else {
      valToWrite = Number(value);
    }
  }

  switch (normType) {
    case 'i8':
      if ('writeInt8' in accessor)
        await (accessor as IMemoryAccessor).writeInt8(
          address,
          Number(valToWrite),
          offset,
        );
      else
        (accessor as ISyncMemoryAccessor).writeInt8Sync(
          address,
          Number(valToWrite),
          offset,
        );
      break;
    case 'u8':
      if ('writeUInt8' in accessor)
        await (accessor as IMemoryAccessor).writeUInt8(
          address,
          Number(valToWrite),
          offset,
        );
      else
        (accessor as ISyncMemoryAccessor).writeUInt8Sync(
          address,
          Number(valToWrite),
          offset,
        );
      break;
    case 'i16':
      if ('writeInt16' in accessor)
        await (accessor as IMemoryAccessor).writeInt16(
          address,
          Number(valToWrite),
          offset,
        );
      else
        (accessor as ISyncMemoryAccessor).writeInt16Sync(
          address,
          Number(valToWrite),
          offset,
        );
      break;
    case 'u16':
      if ('writeUInt16' in accessor)
        await (accessor as IMemoryAccessor).writeUInt16(
          address,
          Number(valToWrite),
          offset,
        );
      else
        (accessor as ISyncMemoryAccessor).writeUInt16Sync(
          address,
          Number(valToWrite),
          offset,
        );
      break;
    case 'i32':
      if ('writeInt32' in accessor)
        await (accessor as IMemoryAccessor).writeInt32(
          address,
          Number(valToWrite),
          offset,
        );
      else
        (accessor as ISyncMemoryAccessor).writeInt32Sync(
          address,
          Number(valToWrite),
          offset,
        );
      break;
    case 'u32':
      if ('writeUInt32' in accessor)
        await (accessor as IMemoryAccessor).writeUInt32(
          address,
          Number(valToWrite),
          offset,
        );
      else
        (accessor as ISyncMemoryAccessor).writeUInt32Sync(
          address,
          Number(valToWrite),
          offset,
        );
      break;
    case 'i64':
      if ('writeInt64' in accessor)
        await (accessor as IMemoryAccessor).writeInt64(
          address,
          toBigIntFieldValue(valToWrite),
          offset,
        );
      else
        (accessor as ISyncMemoryAccessor).writeInt64Sync(
          address,
          toBigIntFieldValue(valToWrite),
          offset,
        );
      break;
    case 'u64':
      if ('writeUInt64' in accessor)
        await (accessor as IMemoryAccessor).writeUInt64(
          address,
          toBigIntFieldValue(valToWrite),
          offset,
        );
      else
        (accessor as ISyncMemoryAccessor).writeUInt64Sync(
          address,
          toBigIntFieldValue(valToWrite),
          offset,
        );
      break;
    case 'f32':
      if ('writeFloat' in accessor)
        await (accessor as IMemoryAccessor).writeFloat(
          address,
          Number(valToWrite),
          offset,
        );
      else
        (accessor as ISyncMemoryAccessor).writeFloatSync(
          address,
          Number(valToWrite),
          offset,
        );
      break;
    case 'f64':
      if ('writeDouble' in accessor)
        await (accessor as IMemoryAccessor).writeDouble(
          address,
          Number(valToWrite),
          offset,
        );
      else
        (accessor as ISyncMemoryAccessor).writeDoubleSync(
          address,
          Number(valToWrite),
          offset,
        );
      break;
    case 'ptr':
      if ('writePointer' in accessor)
        await (accessor as IMemoryAccessor).writePointer(
          address,
          valToWrite,
          offset,
        );
      else
        (accessor as ISyncMemoryAccessor).writePointerSync(
          address,
          valToWrite,
          offset,
        );
      break;
    default:
      throw new Error(`Unsupported struct field type for writing: ${type}`);
  }
}

// -------------------------------------------------------------

// SyncStruct Compilation
// -------------------------------------------------------------

function getCompiledClass(schema: StructSchema) {
  if (!classCache) {
    classCache = new WeakMap<StructSchema, any>();
  }
  let CompiledClass = classCache.get(schema);
  if (!CompiledClass) {
    const computed = compileStruct(schema);
    const length = computed.totalSize;

    CompiledClass = class extends SyncNativeMemory implements ISyncStruct {
      public readonly _view: DataView;
      public readonly _accessor: ISyncMemoryAccessor;
      public readonly _backingBuffer?: Buffer;

      static alloc(accessor?: ISyncMemoryAccessor) {
        const resolvedAccessor = accessor ?? localMemoryAccessor;
        const address = resolvedAccessor.allocSync(length);
        return new CompiledClass(address, resolvedAccessor);
      }

      static allocSync(accessor?: ISyncMemoryAccessor) {
        return this.alloc(accessor);
      }

      constructor(
        addressOrAccessor?: AddressLike | ISyncMemoryAccessor | any,
        accessor?: ISyncMemoryAccessor,
      ) {
        let buffer: Buffer | undefined;
        let actualAddress: number | bigint;
        let resolvedAccessor: ISyncMemoryAccessor;
        let initialValues: any = undefined;

        if (
          addressOrAccessor !== undefined &&
          addressOrAccessor !== null &&
          typeof addressOrAccessor === 'object'
        ) {
          if ('address' in addressOrAccessor) {
            resolvedAccessor = accessor ?? localMemoryAccessor;
          } else if (
            'readSync' in addressOrAccessor ||
            'allocSync' in addressOrAccessor
          ) {
            resolvedAccessor = addressOrAccessor as any;
            addressOrAccessor = undefined;
          } else if (ArrayBuffer.isView(addressOrAccessor)) {
            buffer = Buffer.from(
              addressOrAccessor.buffer,
              addressOrAccessor.byteOffset,
              addressOrAccessor.byteLength,
            );
            actualAddress = Number(bunPtr(addressOrAccessor as any));
            resolvedAccessor = accessor ?? localMemoryAccessor;
          } else {
            initialValues = addressOrAccessor;
            addressOrAccessor = undefined;
            resolvedAccessor = accessor ?? localMemoryAccessor;
          }
        } else {
          resolvedAccessor = accessor ?? localMemoryAccessor;
        }

        if (resolvedAccessor && !('readSync' in resolvedAccessor)) {
          throw new Error(
            'Synchronous operations are not supported on this async-only MemoryAccessor. Use Struct instead.',
          );
        }

        if (addressOrAccessor === undefined) {
          if ((resolvedAccessor as any).isDirectLocal) {
            const u8 = new Uint8Array(length);
            buffer = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
            actualAddress = Number(bunPtr(u8));
          } else {
            actualAddress = resolvedAccessor.allocSync(length) as any;
          }
        } else if (
          typeof addressOrAccessor === 'object' &&
          'address' in addressOrAccessor
        ) {
          actualAddress = addressOrAccessor.address as any;
        } else {
          actualAddress = addressOrAccessor as any;
        }

        super(actualAddress as any, length);
        this._accessor = resolvedAccessor;

        if (buffer) {
          this._backingBuffer = buffer;
          this._view = new DataView(
            buffer.buffer,
            buffer.byteOffset,
            buffer.byteLength,
          );
        } else {
          const addrNum = Number(this.address);
          if ((resolvedAccessor as any).isDirectLocal && addrNum > 0) {
            const ab = toArrayBuffer(addrNum as any, 0, length);
            this._view = new DataView(ab);
          } else {
            this._view = new DataView(new ArrayBuffer(0));
          }
        }

        if (initialValues) {
          this.assign(initialValues);
        }
      }

      assign(values: any): this {
        if (!values) return this;
        for (const [k, v] of Object.entries(values)) {
          if (v !== undefined) {
            const field = computed.fields[k];
            if (!field) {
              throw new Error(`Field '${k}' does not exist in struct schema.`);
            }
            (this as any)[k] = v;
          }
        }
        return this;
      }

      get(fieldName: string): any {
        const field = computed.fields[fieldName];
        if (!field) {
          throw new Error(
            `Field '${fieldName}' does not exist in struct schema.`,
          );
        }
        return readField(this, field);
      }

      set(fieldName: string, value: any): any {
        const field = computed.fields[fieldName];
        if (!field) {
          throw new Error(
            `Field '${fieldName}' does not exist in struct schema.`,
          );
        }
        return writeField(this, field, value);
      }

      getAsync(fieldName: string): Promise<any> {
        try {
          return Promise.resolve(this.get(fieldName));
        } catch (err) {
          return Promise.reject(err);
        }
      }

      setAsync(fieldName: string, value: any): Promise<void> {
        try {
          this.set(fieldName, value);
          return Promise.resolve();
        } catch (err) {
          return Promise.reject(err);
        }
      }

      override toString(): string {
        const hexAddr = SyncNativePointer.prototype.toString.call(this);
        if (Number(this.address) <= 0) {
          return `SyncStruct { <cannot read fields: invalid or pseudo-handle address> } at ${hexAddr} (${length} bytes)`;
        }
        const fieldsStr = Object.keys(schema)
          .map((key) => {
            const val = (this as any)[key];
            if (
              val instanceof Uint8Array ||
              val instanceof Int8Array ||
              val instanceof Uint16Array ||
              val instanceof Int16Array ||
              val instanceof Uint32Array ||
              val instanceof Int32Array ||
              val instanceof Float32Array ||
              val instanceof Float64Array ||
              val instanceof BigInt64Array ||
              val instanceof BigUint64Array
            ) {
              return `${key}: [${val.toString()}]`;
            }
            return `${key}: ${val}`;
          })
          .join(', ');
        return `SyncStruct { ${fieldsStr} } at ${hexAddr} (${length} bytes)`;
      }
    };

    // Dynamically compile properties onto the prototype of CompiledClass
    for (const key of Object.keys(computed.fields)) {
      Object.defineProperty(CompiledClass.prototype, key, {
        get() {
          return this.get(key);
        },
        set(value) {
          this.set(key, value);
        },
        enumerable: true,
        configurable: true,
      });
    }

    classCache.set(schema, CompiledClass);
  }
  return CompiledClass;
}

export interface SyncStructConstructor {
  <S extends StructSchema>(
    schema: S,
    address?: AddressLike,
    accessor?: ISyncMemoryAccessor,
  ): SyncStructType<S>;
  new <S extends StructSchema>(
    schema: S,
    address?: AddressLike,
    accessor?: ISyncMemoryAccessor,
  ): SyncStructType<S>;
  new <S extends StructSchema>(
    schema: S,
    values?: Partial<PlainStructType<S>>,
    accessor?: ISyncMemoryAccessor,
  ): SyncStructType<S>;
  alloc<S extends StructSchema>(
    schema: S,
    accessor?: ISyncMemoryAccessor,
  ): SyncStructType<S>;
}

export const SyncStruct: SyncStructConstructor = function <
  S extends StructSchema,
>(
  schema: S,
  address?: AddressLike,
  accessor?: ISyncMemoryAccessor,
): SyncStructType<S> {
  const CompiledClass = getCompiledClass(schema);
  return new CompiledClass(address, accessor) as any;
} as any;

SyncStruct.alloc = function <S extends StructSchema>(
  schema: S,
  accessor?: ISyncMemoryAccessor,
): SyncStructType<S> {
  const resolvedAccessor = accessor ?? localMemoryAccessor;
  const computed = compileStruct(schema);
  const length = computed.totalSize;

  const address = resolvedAccessor.allocSync(length);
  return new SyncStruct(schema, address, resolvedAccessor);
};

// -------------------------------------------------------------
// Struct (Async) Implementation
// -------------------------------------------------------------

function getCompiledAsyncClass(schema: StructSchema) {
  if (!asyncClassCache) {
    asyncClassCache = new WeakMap<StructSchema, any>();
  }
  let AsyncCompiledClass = asyncClassCache.get(schema);
  if (!AsyncCompiledClass) {
    const computed = compileStruct(schema);
    const length = computed.totalSize;

    AsyncCompiledClass = class extends NativeMemory implements IStruct {
      public readonly _accessor: IMemoryAccessor;
      public readonly _backingBuffer?: Buffer;

      static async alloc(accessor?: IMemoryAccessor) {
        const resolvedAccessor = accessor ?? localMemoryAccessor;
        let address: AddressLike;
        if ('alloc' in resolvedAccessor) {
          address = await (resolvedAccessor as IMemoryAccessor).alloc(length);
        } else {
          address = (resolvedAccessor as ISyncMemoryAccessor).allocSync(length);
        }
        return new AsyncCompiledClass(address, resolvedAccessor);
      }

      static allocSync(accessor?: IMemoryAccessor) {
        const resolvedAccessor = accessor ?? localMemoryAccessor;
        if ('allocSync' in resolvedAccessor) {
          const address = (resolvedAccessor as ISyncMemoryAccessor).allocSync(
            length,
          );
          return new AsyncCompiledClass(address, resolvedAccessor);
        }
        throw new Error(
          'Synchronous allocation is not supported on this async-only MemoryAccessor.',
        );
      }

      constructor(
        addressOrAccessor?: AddressLike | IMemoryAccessor,
        accessor?: IMemoryAccessor,
      ) {
        let buffer: Buffer | undefined;
        let actualAddress: number | bigint;
        let resolvedAccessor: IMemoryAccessor;
        let initialValues: any = undefined;

        if (
          addressOrAccessor !== undefined &&
          addressOrAccessor !== null &&
          typeof addressOrAccessor === 'object'
        ) {
          if ('address' in addressOrAccessor) {
            resolvedAccessor = accessor ?? localMemoryAccessor;
            actualAddress = (addressOrAccessor as any).address;
          } else if (
            'read' in addressOrAccessor ||
            'alloc' in addressOrAccessor
          ) {
            resolvedAccessor = addressOrAccessor as any;
            addressOrAccessor = undefined;
            actualAddress = undefined as any;
          } else if (ArrayBuffer.isView(addressOrAccessor)) {
            buffer = Buffer.from(
              addressOrAccessor.buffer,
              addressOrAccessor.byteOffset,
              addressOrAccessor.byteLength,
            );
            actualAddress = Number(bunPtr(addressOrAccessor as any));
            resolvedAccessor = accessor ?? localMemoryAccessor;
          } else {
            initialValues = addressOrAccessor;
            addressOrAccessor = undefined;
            actualAddress = undefined as any;
            resolvedAccessor = accessor ?? localMemoryAccessor;
          }
        } else {
          actualAddress = addressOrAccessor as any;
          resolvedAccessor = accessor ?? localMemoryAccessor;
        }

        if (actualAddress === undefined) {
          if ((resolvedAccessor as any).isDirectLocal) {
            const u8 = new Uint8Array(length);
            buffer = Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
            actualAddress = Number(bunPtr(u8));
          } else {
            throw new Error(
              'Cannot implicitly allocate memory synchronously in Struct constructor. Please allocate memory asynchronously first using allocAsync(), then pass the resolved address to the Struct constructor.',
            );
          }
        }

        super(actualAddress as any, length);
        this._accessor = resolvedAccessor;
        if (buffer) {
          this._backingBuffer = buffer;
        }

        if (initialValues) {
          this.assign(initialValues);
        }
      }

      async assign(values: any): Promise<this> {
        if (!values) return this;
        for (const [k, v] of Object.entries(values)) {
          if (v !== undefined) {
            await this.set(k, v);
          }
        }
        return this;
      }

      async get(fieldName: string): Promise<any> {
        const field = computed.fields[fieldName];
        if (!field) {
          throw new Error(
            `Field '${fieldName}' does not exist in struct schema.`,
          );
        }
        return readFieldAsync(this, field);
      }

      async set(fieldName: string, value: any): Promise<void> {
        const field = computed.fields[fieldName];
        if (!field) {
          throw new Error(
            `Field '${fieldName}' does not exist in struct schema.`,
          );
        }
        await writeFieldAsync(this, field, value);
      }

      async getAsync(fieldName: string): Promise<any> {
        return this.get(fieldName);
      }

      async setAsync(fieldName: string, value: any): Promise<void> {
        await this.set(fieldName, value);
      }

      async toStringAsync(): Promise<string> {
        const hexAddr = NativePointer.prototype.toString.call(this);
        if (Number(this.address) <= 0) {
          return `Struct { <cannot read fields: invalid or pseudo-handle address> } at ${hexAddr} (${length} bytes)`;
        }
        const fieldPromises = Object.keys(schema).map(async (key) => {
          const val = await this.get(key);
          if (
            val instanceof Uint8Array ||
            val instanceof Int8Array ||
            val instanceof Uint16Array ||
            val instanceof Int16Array ||
            val instanceof Uint32Array ||
            val instanceof Int32Array ||
            val instanceof Float32Array ||
            val instanceof Float64Array ||
            val instanceof BigInt64Array ||
            val instanceof BigUint64Array
          ) {
            return `${key}: [${val.toString()}]`;
          }
          return `${key}: ${val}`;
        });
        const fieldsStr = (await Promise.all(fieldPromises)).join(', ');
        return `Struct { ${fieldsStr} } at ${hexAddr} (${length} bytes)`;
      }

      override toString(): string {
        const hexAddr = NativePointer.prototype.toString.call(this);
        return `Struct { <async fields: use await struct.toStringAsync() or await getters> } at ${hexAddr} (${length} bytes)`;
      }
    };

    // Dynamically compile properties onto the prototype of AsyncCompiledClass
    for (const key of Object.keys(computed.fields)) {
      Object.defineProperty(AsyncCompiledClass.prototype, key, {
        get() {
          return this.get(key);
        },
        set(value) {
          this.set(key, value);
        },
        enumerable: true,
        configurable: true,
      });
    }

    asyncClassCache.set(schema, AsyncCompiledClass);
  }
  return AsyncCompiledClass;
}

export interface StructConstructor {
  <S extends StructSchema>(
    schema: S,
    address?: AddressLike,
    accessor?: IMemoryAccessor,
  ): StructType<S>;
  new <S extends StructSchema>(
    schema: S,
    address?: AddressLike,
    accessor?: IMemoryAccessor,
  ): StructType<S>;
  new <S extends StructSchema>(
    schema: S,
    values?: Partial<PlainStructType<S>>,
    accessor?: IMemoryAccessor,
  ): StructType<S>;
  alloc<S extends StructSchema>(
    schema: S,
    accessor?: IMemoryAccessor,
  ): Promise<StructType<S>>;
}

export const Struct: StructConstructor = function <S extends StructSchema>(
  schema: S,
  address?: AddressLike,
  accessor?: IMemoryAccessor,
): StructType<S> {
  const CompiledClass = getCompiledAsyncClass(schema);
  return new CompiledClass(address, accessor) as any;
} as any;

Struct.alloc = async function <S extends StructSchema>(
  schema: S,
  accessor?: IMemoryAccessor,
): Promise<StructType<S>> {
  const resolvedAccessor = accessor ?? localMemoryAccessor;
  const computed = compileStruct(schema);
  const length = computed.totalSize;

  let address: AddressLike;
  if ('alloc' in resolvedAccessor) {
    address = await (resolvedAccessor as IMemoryAccessor).alloc(length);
  } else {
    address = (resolvedAccessor as ISyncMemoryAccessor).allocSync(length);
  }

  return new Struct(schema, address, resolvedAccessor);
};

export interface StructClass<S extends StructSchema> {
  new (address?: AddressLike, accessor?: IMemoryAccessor): SyncStructType<S>;
  new (accessor?: IMemoryAccessor): SyncStructType<S>;
  new (
    values?: Partial<PlainStructType<S>>,
    accessor?: ISyncMemoryAccessor,
  ): SyncStructType<S>;
  (address?: AddressLike, accessor?: IMemoryAccessor): SyncStructType<S>;
  (accessor?: IMemoryAccessor): SyncStructType<S>;
  (
    values?: Partial<PlainStructType<S>>,
    accessor?: ISyncMemoryAccessor,
  ): SyncStructType<S>;

  alloc(values?: Partial<PlainStructType<S>>): Promise<StructType<S>>;
  alloc(
    accessor: IMemoryAccessor,
    values?: Partial<PlainStructType<S>>,
  ): Promise<StructType<S>>;
  alloc(
    accessor?: IMemoryAccessor,
    address?: AddressLike,
    values?: Partial<PlainStructType<S>>,
  ): Promise<StructType<S>>;

  allocSync(values?: Partial<PlainStructType<S>>): SyncStructType<S>;
  allocSync(
    accessor: ISyncMemoryAccessor,
    values?: Partial<PlainStructType<S>>,
  ): SyncStructType<S>;
  allocSync(
    accessor?: ISyncMemoryAccessor,
    address?: AddressLike,
    values?: Partial<PlainStructType<S>>,
  ): SyncStructType<S>;

  allocArray(
    count: number,
    values?: Partial<PlainStructType<S>>[],
  ): Promise<StructType<S>[]>;
  allocArray(
    accessor: IMemoryAccessor,
    count: number,
    values?: Partial<PlainStructType<S>>[],
  ): Promise<StructType<S>[]>;
  allocArray(
    accessor?: IMemoryAccessor,
    address?: AddressLike,
    count?: number,
    values?: Partial<PlainStructType<S>>[],
  ): Promise<StructType<S>[]>;

  allocArraySync(
    count: number,
    values?: Partial<PlainStructType<S>>[],
  ): SyncStructType<S>[];
  allocArraySync(
    accessor: ISyncMemoryAccessor,
    count: number,
    values?: Partial<PlainStructType<S>>[],
  ): SyncStructType<S>[];
  allocArraySync(
    accessor?: ISyncMemoryAccessor,
    address?: AddressLike,
    count?: number,
    values?: Partial<PlainStructType<S>>[],
  ): SyncStructType<S>[];

  readonly schema: S;
  readonly computed: ComputedStruct<S>;
  readonly isStructClass: true;
}

export function struct<S extends StructSchema>(schema: S): StructClass<S>;
export function struct<S extends StructSchema>(
  name: string,
  schema: S,
): StructClass<S>;
export function struct<S extends StructSchema>(
  first: string | S,
  second?: S,
): StructClass<S> {
  const schema = (typeof first === 'string' ? second : first) as S;
  const CompiledClass = getCompiledClass(schema);
  const AsyncCompiledClass = getCompiledAsyncClass(schema);

  const computed = compileStruct(schema);

  (CompiledClass as any).schema = schema;
  (CompiledClass as any).computed = computed;
  (CompiledClass as any).isStructClass = true;

  (AsyncCompiledClass as any).schema = schema;
  (AsyncCompiledClass as any).computed = computed;
  (AsyncCompiledClass as any).isStructClass = true;

  (CompiledClass as any).alloc = async function (
    ...args: any[]
  ): Promise<StructType<S>> {
    let resolvedAccessor: IMemoryAccessor = localMemoryAccessor;
    let actualAddress: AddressLike | undefined = undefined;
    let initialValues: any = undefined;

    if (args.length === 1) {
      if (
        args[0] &&
        typeof args[0] === 'object' &&
        !('read' in args[0]) &&
        !('readSync' in args[0]) &&
        !('alloc' in args[0]) &&
        !('allocSync' in args[0])
      ) {
        initialValues = args[0];
      } else {
        resolvedAccessor = args[0] ?? localMemoryAccessor;
      }
    } else if (args.length === 2) {
      const first = args[0];
      const second = args[1];
      if (
        first &&
        typeof first === 'object' &&
        ('read' in first ||
          'readSync' in first ||
          'alloc' in first ||
          'allocSync' in first)
      ) {
        resolvedAccessor = first;
        if (second && typeof second === 'object' && !('address' in second)) {
          initialValues = second;
        } else {
          actualAddress = second;
        }
      } else {
        actualAddress = first;
        initialValues = second;
      }
    } else if (args.length === 3) {
      resolvedAccessor = args[0];
      actualAddress = args[1];
      initialValues = args[2];
    }

    const length = computed.totalSize;
    if (actualAddress === undefined) {
      if ('alloc' in resolvedAccessor) {
        actualAddress = await (resolvedAccessor as IMemoryAccessor).alloc(
          length,
        );
      } else {
        actualAddress = (resolvedAccessor as ISyncMemoryAccessor).allocSync(
          length,
        );
      }
    }

    const instance = new AsyncCompiledClass(
      actualAddress,
      resolvedAccessor,
    ) as any;
    if (initialValues) {
      await instance.assign(initialValues);
    }
    return instance;
  };

  (CompiledClass as any).allocSync = function (
    ...args: any[]
  ): SyncStructType<S> {
    let resolvedAccessor: ISyncMemoryAccessor = localMemoryAccessor;
    let actualAddress: AddressLike | undefined = undefined;
    let initialValues: any = undefined;

    if (args.length === 1) {
      if (
        args[0] &&
        typeof args[0] === 'object' &&
        !('readSync' in args[0]) &&
        !('allocSync' in args[0])
      ) {
        initialValues = args[0];
      } else {
        resolvedAccessor = args[0] ?? localMemoryAccessor;
      }
    } else if (args.length === 2) {
      const first = args[0];
      const second = args[1];
      if (
        first &&
        typeof first === 'object' &&
        ('readSync' in first || 'allocSync' in first)
      ) {
        resolvedAccessor = first;
        if (second && typeof second === 'object' && !('address' in second)) {
          initialValues = second;
        } else {
          actualAddress = second;
        }
      } else {
        actualAddress = first;
        initialValues = second;
      }
    } else if (args.length === 3) {
      resolvedAccessor = args[0];
      actualAddress = args[1];
      initialValues = args[2];
    }

    const length = computed.totalSize;
    if (actualAddress === undefined) {
      actualAddress = resolvedAccessor.allocSync(length);
    }

    const instance = new CompiledClass(actualAddress, resolvedAccessor) as any;
    if (initialValues) {
      instance.assign(initialValues);
    }
    return instance;
  };

  (CompiledClass as any).allocArraySync = function (
    ...args: any[]
  ): SyncStructType<S>[] {
    let resolvedAccessor: ISyncMemoryAccessor = localMemoryAccessor;
    let actualAddress: AddressLike | undefined = undefined;
    let count = 0;
    let initialValues: any[] | undefined = undefined;

    if (args.length === 1) {
      count = args[0];
    } else if (args.length === 2) {
      if (
        args[0] &&
        typeof args[0] === 'object' &&
        ('readSync' in args[0] || 'allocSync' in args[0])
      ) {
        resolvedAccessor = args[0];
        count = args[1];
      } else {
        count = args[0];
        initialValues = args[1];
      }
    } else if (args.length === 3) {
      if (
        args[0] &&
        typeof args[0] === 'object' &&
        ('readSync' in args[0] || 'allocSync' in args[0])
      ) {
        resolvedAccessor = args[0];
        count = args[1];
        initialValues = args[2];
      } else {
        actualAddress = args[0];
        count = args[1];
        initialValues = args[2];
      }
    } else if (args.length === 4) {
      resolvedAccessor = args[0];
      actualAddress = args[1];
      count = args[2];
      initialValues = args[3];
    }

    const itemSize = computed.totalSize;
    const totalSize = itemSize * count;

    if (actualAddress == null) {
      actualAddress = resolvedAccessor.allocSync(totalSize);
    }

    const baseAddrNum =
      typeof actualAddress === 'object' &&
      actualAddress !== null &&
      'address' in actualAddress
        ? Number(actualAddress.address)
        : Number(actualAddress!);

    const instances: SyncStructType<S>[] = [];
    for (let i = 0; i < count; i++) {
      const offsetAddr = baseAddrNum + i * itemSize;
      const instance = new CompiledClass(offsetAddr, resolvedAccessor) as any;
      if (initialValues && initialValues[i]) {
        instance.assign(initialValues[i]);
      }
      instances.push(instance);
    }
    return instances;
  };

  (CompiledClass as any).allocArray = async function (
    ...args: any[]
  ): Promise<StructType<S>[]> {
    let resolvedAccessor: IMemoryAccessor = localMemoryAccessor;
    let actualAddress: AddressLike | undefined = undefined;
    let count = 0;
    let initialValues: any[] | undefined = undefined;

    if (args.length === 1) {
      count = args[0];
    } else if (args.length === 2) {
      if (
        args[0] &&
        typeof args[0] === 'object' &&
        ('read' in args[0] || 'alloc' in args[0])
      ) {
        resolvedAccessor = args[0];
        count = args[1];
      } else {
        count = args[0];
        initialValues = args[1];
      }
    } else if (args.length === 3) {
      if (
        args[0] &&
        typeof args[0] === 'object' &&
        ('read' in args[0] || 'alloc' in args[0])
      ) {
        resolvedAccessor = args[0];
        count = args[1];
        initialValues = args[2];
      } else {
        actualAddress = args[0];
        count = args[1];
        initialValues = args[2];
      }
    } else if (args.length === 4) {
      resolvedAccessor = args[0];
      actualAddress = args[1];
      count = args[2];
      initialValues = args[3];
    }

    const itemSize = computed.totalSize;
    const totalSize = itemSize * count;

    if (actualAddress == null) {
      if ('alloc' in resolvedAccessor) {
        actualAddress = await (resolvedAccessor as IMemoryAccessor).alloc(
          totalSize,
        );
      } else {
        actualAddress = (resolvedAccessor as ISyncMemoryAccessor).allocSync(
          totalSize,
        );
      }
    }

    const baseAddrNum =
      typeof actualAddress === 'object' &&
      actualAddress !== null &&
      'address' in actualAddress
        ? Number(actualAddress.address)
        : Number(actualAddress!);

    const instances: StructType<S>[] = [];
    for (let i = 0; i < count; i++) {
      const offsetAddr = baseAddrNum + i * itemSize;
      const instance = new AsyncCompiledClass(
        offsetAddr,
        resolvedAccessor,
      ) as any;
      if (initialValues && initialValues[i]) {
        await instance.assign(initialValues[i]);
      }
      instances.push(instance);
    }
    return instances;
  };

  const toCDef = function (
    name?: string,
    classToNameMap?: Map<any, string>,
  ): string {
    const structName =
      name ??
      (CompiledClass as any).structName ??
      CompiledClass.name ??
      'Struct';
    const entries = classToNameMap ?? new Map<any, string>();
    if (!entries.has(CompiledClass)) entries.set(CompiledClass, structName);
    if (!entries.has(AsyncCompiledClass))
      entries.set(AsyncCompiledClass, structName);
    return toCStructDefinition(structName, schema, entries);
  };
  (CompiledClass as any).toCDefinition = toCDef;
  (AsyncCompiledClass as any).toCDefinition = toCDef;

  return CompiledClass as any;
}

function resolveFieldCDeclaration(
  key: string,
  type: any,
  classToName: Map<any, string>,
): string {
  let isArray = false;
  let arrayLen = 0;
  let baseType = type;

  if (Array.isArray(baseType)) {
    isArray = true;
    arrayLen = baseType[1];
    baseType = baseType[0];
  } else if (typeof baseType === 'string') {
    const arrayMatch = baseType.match(/^(.+)\[([0-9]+)\]$/);
    if (arrayMatch && arrayMatch[1] && arrayMatch[2]) {
      isArray = true;
      baseType = arrayMatch[1].trim();
      arrayLen = parseInt(arrayMatch[2], 10);
    }
  }

  let typeStr = '';
  if (typeof baseType === 'function' && (baseType as any).isStructClass) {
    typeStr =
      classToName.get(baseType) ??
      (baseType as any).structName ??
      (baseType as any).name ??
      'Struct';
  } else if (typeof baseType === 'object' && baseType !== null) {
    // Nested inline struct/union schema
    const fieldsStrs: string[] = [];
    const isUnion = !!(baseType as any)._isUnion;
    for (const [subKey, subType] of Object.entries(baseType)) {
      if (subKey === '_isUnion') continue;
      fieldsStrs.push(
        `    ${resolveFieldCDeclaration(subKey, subType, classToName)}`,
      );
    }
    typeStr = `${isUnion ? 'union' : 'struct'} {\n${fieldsStrs.join('\n')}\n  }`;
  } else {
    typeStr = mapFFITypeToC(baseType);
  }

  if (isArray) {
    return `${typeStr} ${key}[${arrayLen}];`;
  } else {
    return `${typeStr} ${key};`;
  }
}

/**
 * High-level union factory that returns a dynamically compiled class.
 * All fields in a union share the same memory location (offset 0).
 */
export function union<S extends StructSchema>(schema: S): StructClass<S>;
export function union<S extends StructSchema>(
  name: string,
  schema: S,
): StructClass<S>;
export function union<S extends StructSchema>(
  first: string | S,
  second?: S,
): StructClass<S> {
  const schema = (typeof first === 'string' ? second : first) as S;
  return struct({ ...schema, _isUnion: true });
}

export function toCStructDefinition(
  structName: string,
  schema: StructSchema,
  classToName: Map<any, string> = new Map(),
): string {
  const fieldsStrs: string[] = [];
  const isUnion = !!schema._isUnion;
  for (const [key, type] of Object.entries(schema)) {
    if (key === '_isUnion') continue;
    fieldsStrs.push(`  ${resolveFieldCDeclaration(key, type, classToName)}`);
  }
  return `typedef ${isUnion ? 'union' : 'struct'} {\n${fieldsStrs.join('\n')}\n} ${structName};`;
}
