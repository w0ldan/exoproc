import { ptr as bunPtr } from 'bun:ffi';
import {
  normalizeType,
  type CTypeOrString,
  type StructSchema,
} from './types.js';
import type { IMemoryAccessor, ISyncMemoryAccessor } from './iaccessor.js';

export interface ComputedStructField {
  type: any;
  offset: number;
  size: number;
  isArray?: boolean;
  arrayLength?: number;
  arrayElementType?: any;
}

export type ComputedStruct<S extends StructSchema = StructSchema> = {
  fields: {
    [K in keyof S]: ComputedStructField;
  };
  totalSize: number;
};

/**
 * Resolves common pointer-like values into a raw numeric address without
 * constructing a pointer wrapper. This is safe to use during module init.
 */
export function resolveAddress(address: unknown): number {
  if (address === null || address === undefined) return 0;

  // Handle object wrappers (Pointer, Struct, CFunction, etc.)
  if (typeof address === 'object' || typeof address === 'function') {
    if (address && 'address' in (address as any)) {
      return resolveAddress((address as any).address);
    }
    if (address && 'ptr' in (address as any)) {
      return resolveAddress((address as any).ptr);
    }
    if (
      address &&
      '_backingBuffer' in (address as any) &&
      (address as any)._backingBuffer
    ) {
      return Number(bunPtr((address as any)._backingBuffer));
    }
    if (ArrayBuffer.isView(address)) {
      return Number(bunPtr(address as any));
    }
  }

  // Handle BigInt (The most reliable way for 64-bit addresses)
  if (typeof address === 'bigint') {
    return Number(BigInt.asIntN(64, address));
  }

  // Handle Number
  if (typeof address === 'number') {
    if (isNaN(address) || !isFinite(address)) return 0;

    // Catch common 64-bit unsigned overflows that round in JS
    // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
    if (address >= 18446744073709551615) return -1;

    // If it's a safe integer, just return it.
    if (Number.isInteger(address)) {
      return address;
    }

    // Fallback for other large numbers
    try {
      return Number(BigInt.asIntN(64, BigInt(Math.floor(address))));
    } catch {
      return 0;
    }
  }

  // Fallback for strings or other types
  try {
    const b = BigInt(address as any);
    return Number(BigInt.asIntN(64, b));
  } catch {
    return 0;
  }
}

/**
 * Calculates the alignment requirement in bytes of a given FFI type or StructSchema
 * based on standard Win64 C ABI alignment rules.
 */
export function alignmentof(type: any): number {
  if (!type && type !== 0) return 1;

  if (typeof type === 'function' && 'isStructClass' in type) {
    return alignmentof((type as any).schema);
  }

  if (Array.isArray(type)) {
    const [elemType] = type;
    return alignmentof(elemType);
  }

  if (typeof type === 'object') {
    let maxAlign = 1;
    for (const member of Object.values(type as StructSchema)) {
      const align = alignmentof(member);
      if (align > maxAlign) maxAlign = align;
    }
    return maxAlign;
  }

  if (typeof type === 'string') {
    const arrayMatch = type.match(/^(.+)\[([0-9]+)\]$/);
    if (arrayMatch && arrayMatch[1]!) {
      const elemType = arrayMatch[1].trim();
      return alignmentof(elemType);
    }
  }

  const size = sizeof(type);
  return Math.min(size, 8); // Basic types align up to 8 bytes under Win64 x64 ABI
}

/**
 * Computes the memory layout (offsets and total size) of a struct schema
 * using standard C x64 alignment rules.
 */
export function compileStruct<S extends StructSchema>(
  schema: S,
): ComputedStruct<S> {
  let offset = 0;
  let maxAlign = 1;
  let unionSize = 0;
  const isUnion = !!schema._isUnion;
  const computed = {} as any;

  for (const [key, type] of Object.entries(schema)) {
    if (key === '_isUnion') continue;

    const size = sizeof(type);
    const align = alignmentof(type);
    if (align > maxAlign) maxAlign = align;

    if (!isUnion) {
      if (align > 0 && offset % align !== 0) {
        offset = Math.ceil(offset / align) * align;
      }
    }

    let isArray = false;
    let arrayLength = 0;
    let arrayElementType: any = undefined;

    if (Array.isArray(type)) {
      isArray = true;
      arrayElementType = type[0];
      arrayLength = type[1];
    } else if (typeof type === 'string') {
      const arrayMatch = type.match(/^(.+)\[([0-9]+)\]$/);
      if (arrayMatch && arrayMatch[1] && arrayMatch[2]) {
        isArray = true;
        arrayElementType = arrayMatch[1].trim();
        arrayLength = parseInt(arrayMatch[2], 10);
      }
    }

    computed[key] = {
      type,
      offset: isUnion ? 0 : offset,
      size,
      isArray,
      arrayLength,
      arrayElementType,
    };

    if (isUnion) {
      if (size > unionSize) unionSize = size;
    } else {
      offset += size;
    }
  }

  if (isUnion) offset = unionSize;

  if (maxAlign > 0 && offset % maxAlign !== 0) {
    offset = Math.ceil(offset / maxAlign) * maxAlign;
  }

  return {
    fields: computed,
    totalSize: offset,
  };
}

/**
 * Current process information for memory management.
 */
export const currentProcessId = process.pid;
export const currentProcessHandle = -1; // Placeholder for HANDLE (-1 usually represents current process)

/**
 * @param type The extended FFI type, string alias (e.g. "HANDLE", "DWORD"), or StructSchema.
 * @returns The size in bytes of the type or struct.
 */
export function sizeof(type: any): number {
  if (!type && type !== 0) return 0;

  if (typeof type === 'function' && 'isStructClass' in type) {
    return (type as any).computed.totalSize;
  }

  if (Array.isArray(type)) {
    const [elemType, length] = type;
    return sizeof(elemType) * length;
  }

  if (typeof type === 'object') {
    return compileStruct(type as StructSchema).totalSize;
  }

  if (typeof type === 'string') {
    const arrayMatch = type.match(/^(.+)\[([0-9]+)\]$/);
    if (arrayMatch && arrayMatch[1] && arrayMatch[2]) {
      const elemType = arrayMatch[1].trim();
      const length = parseInt(arrayMatch[2], 10);
      return sizeof(elemType) * length;
    }
  }

  const norm = normalizeType(type as CTypeOrString);

  switch (norm) {
    case 'i8':
    case 'u8':
      return 1;

    case 'i16':
    case 'u16':
      return 2;

    case 'i32':
    case 'u32':
    case 'f32':
      return 4;

    case 'i64':
    case 'u64':
    case 'f64':
    case 'ptr':
    case 'cstring':
    case 'cwstring':
      // Under x64, all pointers and 64-bit ints are 8 bytes.
      return 8;

    case 'void':
      return 0;

    default:
      // Fallback for pointers and unmapped complex types
      return 8;
  }
}

let cachedLocalMemoryAccessor: any = null;

function getLocalMemoryAccessor(): any {
  if (!cachedLocalMemoryAccessor) {
    if ((globalThis as any).__localMemoryAccessor) {
      cachedLocalMemoryAccessor = (globalThis as any).__localMemoryAccessor;
    } else {
      try {
        // Use globalThis or require to dynamically resolve without circular module compilation error
        const req =
          (globalThis as any).require ||
          (typeof require !== 'undefined' ? require : null);
        if (req) {
          cachedLocalMemoryAccessor = req('./pointer.js').localMemoryAccessor;
        }
      } catch {
        // Fallback
      }
    }
  }
  return cachedLocalMemoryAccessor;
}

export async function readString(
  address: unknown,
  options?: {
    size?: number;
    encoding?: 'utf8' | 'utf16le';
    accessor?: IMemoryAccessor;
  },
): Promise<string> {
  const addr = resolveAddress(address);
  if (addr === 0) return '';

  const size = options?.size;
  const encoding = options?.encoding ?? 'utf8';
  const accessor = options?.accessor ?? getLocalMemoryAccessor();

  if (!accessor) {
    throw new Error('Local memory accessor is not initialized');
  }

  if (encoding === 'utf16le') {
    if (size !== undefined) {
      const buf = await accessor.read(addr, size * 2, 0);
      let nullIdx = -1;
      for (let i = 0; i < buf.length; i += 2) {
        if (buf[i] === 0 && buf[i + 1] === 0) {
          nullIdx = i;
          break;
        }
      }
      if (nullIdx !== -1) {
        return buf.subarray(0, nullIdx).toString('utf16le');
      }
      return buf.toString('utf16le');
    }

    let result = Buffer.alloc(0);
    let currentOffset = 0;
    const chunk = 256;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const buf = await accessor.read(addr, chunk, currentOffset);
      if (buf.length === 0) break;
      let nullIdx = -1;
      for (let i = 0; i < buf.length; i += 2) {
        if (buf[i] === 0 && buf[i + 1] === 0) {
          nullIdx = i;
          break;
        }
      }

      if (nullIdx !== -1) {
        result = Buffer.concat([result, buf.subarray(0, nullIdx)]);
        break;
      }
      result = Buffer.concat([result, buf]);
      currentOffset += chunk;
    }
    return result.toString('utf16le');
  } else {
    if (size !== undefined) {
      const buf = await accessor.read(addr, size, 0);
      const nullIdx = buf.indexOf(0);
      if (nullIdx !== -1) {
        return buf.subarray(0, nullIdx).toString('utf8');
      }
      return buf.toString('utf8');
    }

    let result = Buffer.alloc(0);
    let currentOffset = 0;
    const chunk = 256;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const buf = await accessor.read(addr, chunk, currentOffset);
      if (buf.length === 0) break;
      const nullIdx = buf.indexOf(0);
      if (nullIdx !== -1) {
        result = Buffer.concat([result, buf.subarray(0, nullIdx)]);
        break;
      }
      result = Buffer.concat([result, buf]);
      currentOffset += chunk;
    }
    return result.toString('utf8');
  }
}

export function readStringSync(
  address: unknown,
  options?: {
    size?: number;
    encoding?: 'utf8' | 'utf16le';
    accessor?: ISyncMemoryAccessor;
  },
): string {
  const addr = resolveAddress(address);
  if (addr === 0) return '';

  const size = options?.size;
  const encoding = options?.encoding ?? 'utf8';
  const accessor = options?.accessor ?? getLocalMemoryAccessor();

  if (!accessor) {
    throw new Error('Local memory accessor is not initialized');
  }

  if (encoding === 'utf16le') {
    if (size !== undefined) {
      const buf = accessor.readSync(addr, size * 2, 0);
      let nullIdx = -1;
      for (let i = 0; i < buf.length; i += 2) {
        if (buf[i] === 0 && buf[i + 1] === 0) {
          nullIdx = i;
          break;
        }
      }
      if (nullIdx !== -1) {
        return buf.subarray(0, nullIdx).toString('utf16le');
      }
      return buf.toString('utf16le');
    }

    let result = Buffer.alloc(0);
    let currentOffset = 0;
    const chunk = 256;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const buf = accessor.readSync(addr, chunk, currentOffset);
      if (buf.length === 0) break;
      let nullIdx = -1;
      for (let i = 0; i < buf.length; i += 2) {
        if (buf[i] === 0 && buf[i + 1] === 0) {
          nullIdx = i;
          break;
        }
      }

      if (nullIdx !== -1) {
        result = Buffer.concat([result, buf.subarray(0, nullIdx)]);
        break;
      }
      result = Buffer.concat([result, buf]);
      currentOffset += chunk;
    }
    return result.toString('utf16le');
  } else {
    if (size !== undefined) {
      const buf = accessor.readSync(addr, size, 0);
      const nullIdx = buf.indexOf(0);
      if (nullIdx !== -1) {
        return buf.subarray(0, nullIdx).toString('utf8');
      }
      return buf.toString('utf8');
    }

    let result = Buffer.alloc(0);
    let currentOffset = 0;
    const chunk = 256;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const buf = accessor.readSync(addr, chunk, currentOffset);
      if (buf.length === 0) break;
      const nullIdx = buf.indexOf(0);
      if (nullIdx !== -1) {
        result = Buffer.concat([result, buf.subarray(0, nullIdx)]);
        break;
      }
      result = Buffer.concat([result, buf]);
      currentOffset += chunk;
    }
    return result.toString('utf8');
  }
}

/**
 * Aligns a value (number or bigint) UP to the specified alignment boundary (must be a power of 2).
 */
export function alignUp(value: number, alignment: number): number;
export function alignUp(value: bigint, alignment: bigint): bigint;
export function alignUp(
  value: number | bigint,
  alignment: number | bigint,
): number | bigint {
  if (typeof value === 'bigint') {
    const align = BigInt(alignment);
    return (value + align - 1n) & ~(align - 1n);
  } else {
    const align = Number(alignment);
    return Math.ceil(value / align) * align;
  }
}

/**
 * Aligns a value (number or bigint) DOWN to the specified alignment boundary (must be a power of 2).
 */
export function alignDown(value: number, alignment: number): number;
export function alignDown(value: bigint, alignment: bigint): bigint;
export function alignDown(
  value: number | bigint,
  alignment: number | bigint,
): number | bigint {
  if (typeof value === 'bigint') {
    const align = BigInt(alignment);
    return value & ~(align - 1n);
  } else {
    const align = Number(alignment);
    return Math.floor(value / align) * align;
  }
}

/**
 * Compatibility object providing core FFI utilities.
 */
export const ffi = {
  sizeof,
  alignmentof,
  resolveAddress,
  address: resolveAddress,
  readString,
  readStringSync,
  alignUp,
  alignDown,
  stackAlign16,
  struct: undefined as any,
  union: undefined as any,
  array: (type: any, length: number) => [type, length] as any,
  pointer: (_type: any) => 'ptr' as any,
};

export function stackAlign16(addr: bigint): bigint {
  return alignDown(addr, 16n);
}
