import { Buffer } from 'node:buffer';
import { getActiveContext } from '../runner-context.js';
import { resolveAddress } from '../ffi.js';

// Global declaration for Buffer augmentation
declare global {
  interface Buffer {
    text: string;
  }
}

// Augment Buffer.prototype.text if not already defined
if (!Object.getOwnPropertyDescriptor(Buffer.prototype, 'text')) {
  Object.defineProperty(Buffer.prototype, 'text', {
    get(this: Buffer): string {
      if (!this || this.length === 0) return '';
      // Heuristic: If length >= 2 and byte 1 is 0 and byte 0 is non-zero, it's UTF-16LE.
      const isUtf16 =
        this.length >= 2 &&
        (this[1] === 0 || (this.length >= 4 && this[3] === 0));
      const encoding = isUtf16 ? 'utf16le' : 'utf8';
      const str = this.toString(encoding);
      const nullIdx = str.indexOf('\0');
      return nullIdx !== -1 ? str.slice(0, nullIdx) : str;
    },
    set(this: Buffer, val: string) {
      this.fill(0);
      const isUtf16 =
        this.length >= 2 &&
        (this[1] === 0 || (this.length >= 4 && this[3] === 0));
      this.write(val, 0, isUtf16 ? 'utf16le' : 'utf8');
    },
    configurable: true,
    enumerable: false,
  });
}

/**
 * C-style string buffer for Win32 API calls.
 * Encapsulates an underlying Buffer with UTF-16LE (WCHAR) or UTF-8 (CHAR) encoding.
 * Automatically marshalled to remote memory and written back upon function return.
 */
export class CStringBuffer {
  [index: number]: string | undefined;
  public readonly _backingBuffer: Buffer;
  public readonly isWide: boolean;
  public readonly capacity: number; // In characters

  constructor(sizeOrString?: number | string | Buffer, isWide = true) {
    this.isWide = isWide;
    if (typeof sizeOrString === 'number') {
      this.capacity = sizeOrString > 0 ? sizeOrString : 260;
      this._backingBuffer = Buffer.alloc(this.capacity * (isWide ? 2 : 1));
    } else if (typeof sizeOrString === 'string') {
      this.capacity = sizeOrString.length + 1;
      this._backingBuffer = Buffer.from(
        sizeOrString + '\0',
        isWide ? 'utf16le' : 'utf8',
      );
    } else if (Buffer.isBuffer(sizeOrString)) {
      this._backingBuffer = sizeOrString;
      this.capacity = Math.floor(sizeOrString.length / (isWide ? 2 : 1));
    } else {
      this.capacity = 260; // MAX_PATH default
      this._backingBuffer = Buffer.alloc(260 * (isWide ? 2 : 1));
    }

    return new Proxy(this, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          const idx = Number(prop);
          const t = target.text;
          return idx < t.length ? t[idx] : undefined;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  get text(): string {
    const str = this._backingBuffer.toString(this.isWide ? 'utf16le' : 'utf8');
    const nullIdx = str.indexOf('\0');
    return nullIdx !== -1 ? str.slice(0, nullIdx) : str;
  }

  set text(val: string) {
    this._backingBuffer.fill(0);
    this._backingBuffer.write(val, 0, this.isWide ? 'utf16le' : 'utf8');
  }

  get value(): string {
    return this.text;
  }

  set value(val: string) {
    this.text = val;
  }

  get length(): number {
    return this.text.length;
  }

  get byteLength(): number {
    return this._backingBuffer.length;
  }

  get buffer(): Buffer {
    return this._backingBuffer;
  }

  clear(): this {
    this._backingBuffer.fill(0);
    return this;
  }

  set(val: string): this {
    this.text = val;
    return this;
  }

  toString(): string {
    return this.text;
  }

  valueOf(): string {
    return this.text;
  }

  toJSON(): string {
    return this.text;
  }

  [Symbol.toPrimitive](_hint: string): string {
    return this.text;
  }
}

export type ScalarBufferType =
  | 'uint32'
  | 'int32'
  | 'uint64'
  | 'int64'
  | 'uint16'
  | 'int16'
  | 'uint8'
  | 'int8'
  | 'float'
  | 'double';

/**
 * C-style scalar buffer for out-parameters in Win32 API calls (e.g. DWORD*, INT*, BOOL*).
 * Automatically marshalled to remote memory and written back upon function return.
 */
export class CScalarBuffer {
  public readonly _backingBuffer: Buffer;
  public readonly type: ScalarBufferType;

  constructor(
    size: number,
    type: ScalarBufferType,
    initialValue?: number | bigint | boolean,
  ) {
    this.type = type;
    this._backingBuffer = Buffer.alloc(size);
    if (initialValue !== undefined) {
      this.value = initialValue as any;
    }
  }

  get value(): number | bigint {
    switch (this.type) {
      case 'uint32':
        return this._backingBuffer.readUInt32LE(0);
      case 'int32':
        return this._backingBuffer.readInt32LE(0);
      case 'uint64':
        return this._backingBuffer.readBigUInt64LE(0);
      case 'int64':
        return this._backingBuffer.readBigInt64LE(0);
      case 'uint16':
        return this._backingBuffer.readUInt16LE(0);
      case 'int16':
        return this._backingBuffer.readInt16LE(0);
      case 'uint8':
        return this._backingBuffer.readUInt8(0);
      case 'int8':
        return this._backingBuffer.readInt8(0);
      case 'float':
        return this._backingBuffer.readFloatLE(0);
      case 'double':
        return this._backingBuffer.readDoubleLE(0);
    }
  }

  set value(val: number | bigint | boolean) {
    switch (this.type) {
      case 'uint32':
        this._backingBuffer.writeUInt32LE(Number(val) >>> 0, 0);
        break;
      case 'int32':
        this._backingBuffer.writeInt32LE(Number(val) | 0, 0);
        break;
      case 'uint64':
        this._backingBuffer.writeBigUInt64LE(BigInt(val), 0);
        break;
      case 'int64':
        this._backingBuffer.writeBigInt64LE(BigInt(val), 0);
        break;
      case 'uint16':
        this._backingBuffer.writeUInt16LE(Number(val) & 0xffff, 0);
        break;
      case 'int16':
        this._backingBuffer.writeInt16LE(Number(val), 0);
        break;
      case 'uint8':
        this._backingBuffer.writeUInt8(Number(val) & 0xff, 0);
        break;
      case 'int8':
        this._backingBuffer.writeInt8(Number(val), 0);
        break;
      case 'float':
        this._backingBuffer.writeFloatLE(Number(val), 0);
        break;
      case 'double':
        this._backingBuffer.writeDoubleLE(Number(val), 0);
        break;
    }
  }

  get val(): number | bigint {
    return this.value;
  }

  set val(v: number | bigint | boolean) {
    this.value = v;
  }

  get buffer(): Buffer {
    return this._backingBuffer;
  }

  get byteLength(): number {
    return this._backingBuffer.length;
  }

  valueOf(): number | bigint {
    return this.value;
  }

  toString(): string {
    return String(this.value);
  }

  toJSON(): number | string {
    const v = this.value;
    return typeof v === 'bigint' ? v.toString() : v;
  }

  [Symbol.toPrimitive](hint: string): number | bigint | string {
    if (hint === 'string') return String(this.value);
    if (hint === 'number') return Number(this.value);
    return this.value;
  }
}

export interface StringBufferFactory {
  (sizeOrString?: number | string | Buffer): CStringBuffer;
  new (sizeOrString?: number | string | Buffer): CStringBuffer;
  [capacity: number]: CStringBuffer;
}

export function createStringBufferFactory(
  isWide: boolean | (() => boolean),
): StringBufferFactory {
  const factory = function (arg?: number | string | Buffer): CStringBuffer {
    const wide = typeof isWide === 'function' ? isWide() : isWide;
    return new CStringBuffer(arg, wide);
  };

  return new Proxy(factory, {
    apply(_target, _thisArg, argArray) {
      return factory(argArray[0]);
    },
    construct(_target, argArray) {
      return factory(argArray[0]);
    },
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        return factory(Number(prop));
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as StringBufferFactory;
}

export const WCHAR = createStringBufferFactory(true);
export const CHAR = createStringBufferFactory(false);
export const STRING = createStringBufferFactory(() => {
  const ctx = getActiveContext();
  return ctx?.preferUnicode ?? true;
});
export const StringBuffer = STRING;

export interface ScalarTypeHelper<T = number | bigint> {
  (): CScalarBuffer;
  (v: unknown): T;
  new (initialValue?: number | bigint | boolean): CScalarBuffer;
  out: (initialValue?: number | bigint | boolean) => CScalarBuffer;
  buffer: (initialValue?: number | bigint | boolean) => CScalarBuffer;
  ptr: (initialValue?: number | bigint | boolean) => CScalarBuffer;
}

export function createScalarTypeHelper<T = number | bigint>(
  size: number,
  type: ScalarBufferType,
  castFn: (v: unknown) => T,
): ScalarTypeHelper<T> {
  const helper = function (v?: unknown): any {
    if (v === undefined) {
      return new CScalarBuffer(size, type);
    }
    return castFn(v);
  };

  return new Proxy(helper, {
    apply(_target, _thisArg, argArray) {
      if (argArray.length === 0 || argArray[0] === undefined) {
        return new CScalarBuffer(size, type);
      }
      return castFn(argArray[0]);
    },
    construct(_target, argArray) {
      const initialVal = argArray.length > 0 ? argArray[0] : undefined;
      return new CScalarBuffer(size, type, initialVal);
    },
    get(target, prop, receiver) {
      if (prop === 'out' || prop === 'buffer' || prop === 'ptr') {
        return (initialVal?: any) => new CScalarBuffer(size, type, initialVal);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as ScalarTypeHelper<T>;
}

export const DWORD = createScalarTypeHelper(
  4,
  'uint32',
  (v: unknown) => Number(BigInt(resolveAddress(v)) & 0xffffffffn) >>> 0,
);
export const WORD = createScalarTypeHelper(2, 'uint16', (v: unknown) =>
  Number(BigInt(resolveAddress(v)) & 0xffffn),
);
export const BYTE = createScalarTypeHelper(1, 'uint8', (v: unknown) =>
  Number(BigInt(resolveAddress(v)) & 0xffn),
);
export const BOOL = createScalarTypeHelper(4, 'int32', (v: unknown) =>
  v ? 1 : 0,
);
export const INT = createScalarTypeHelper(4, 'int32', (v: unknown) =>
  Number(BigInt.asIntN(32, BigInt(resolveAddress(v)))),
);
export const UINT = createScalarTypeHelper(
  4,
  'uint32',
  (v: unknown) => Number(BigInt(resolveAddress(v)) & 0xffffffffn) >>> 0,
);
export const LONG = createScalarTypeHelper(4, 'int32', (v: unknown) =>
  Number(BigInt.asIntN(32, BigInt(resolveAddress(v)))),
);
export const ULONG = createScalarTypeHelper(
  4,
  'uint32',
  (v: unknown) => Number(BigInt(resolveAddress(v)) & 0xffffffffn) >>> 0,
);
export const SHORT = createScalarTypeHelper(2, 'int16', (v: unknown) =>
  Number(BigInt.asIntN(16, BigInt(resolveAddress(v)))),
);
export const USHORT = createScalarTypeHelper(2, 'uint16', (v: unknown) =>
  Number(BigInt(resolveAddress(v)) & 0xffffn),
);
export const LONGLONG = createScalarTypeHelper(8, 'int64', (v: unknown) =>
  BigInt(resolveAddress(v)),
);
export const ULONGLONG = createScalarTypeHelper(8, 'uint64', (v: unknown) =>
  BigInt.asUintN(64, BigInt(resolveAddress(v))),
);
export const INT64 = createScalarTypeHelper(8, 'int64', (v: unknown) =>
  BigInt(resolveAddress(v)),
);
export const UINT64 = createScalarTypeHelper(8, 'uint64', (v: unknown) =>
  BigInt.asUintN(64, BigInt(resolveAddress(v))),
);
export const QWORD = createScalarTypeHelper(8, 'uint64', (v: unknown) =>
  BigInt.asUintN(64, BigInt(resolveAddress(v))),
);
export const FLOAT = createScalarTypeHelper(4, 'float', (v: unknown) =>
  Number(v),
);
export const DOUBLE = createScalarTypeHelper(8, 'double', (v: unknown) =>
  Number(v),
);

export const HWND = (v?: unknown) =>
  v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v);
export const HANDLE = (v?: unknown) =>
  v === undefined ? new CScalarBuffer(8, 'uint64') : resolveAddress(v);
export const LPARAM = (v?: unknown) =>
  v === undefined
    ? new CScalarBuffer(8, 'int64')
    : typeof v === 'string' && !/^-?0x[0-9a-fA-F]+$/.test(v.trim())
      ? v
      : BigInt(resolveAddress(v));
export const WPARAM = (v?: unknown) =>
  v === undefined
    ? new CScalarBuffer(8, 'uint64')
    : BigInt.asUintN(64, BigInt(resolveAddress(v)));
export const LRESULT = (v?: unknown) =>
  v === undefined ? new CScalarBuffer(8, 'int64') : BigInt(resolveAddress(v));
