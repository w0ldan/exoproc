import type { Win64Process } from './win64-machine.js';
import { createWin32SyscallThunk } from './win32-dlls.js';

export type Pointer = number;
export type FFITypeOrString = string | number;
export interface FFIFunction {
  args?: readonly FFITypeOrString[];
  returns?: FFITypeOrString;
}

export interface FFIOptions extends FFIFunction {
  ptr: number | bigint;
}

export interface FFILibrary<
  T extends Record<string, FFIFunction> = Record<string, FFIFunction>,
> {
  symbols: {
    [K in keyof T]: (...args: unknown[]) => unknown;
  };
  close(): void;
}

const SIMULATED_FFI_TYPES = {
  char: 0,
  int8_t: 1,
  i8: 1,
  uint8_t: 2,
  u8: 2,
  int16_t: 3,
  i16: 3,
  uint16_t: 4,
  u16: 4,
  int: 5,
  int32_t: 5,
  i32: 5,
  c_int: 5,
  uint32_t: 6,
  u32: 6,
  c_uint: 6,
  int64_t: 7,
  i64: 7,
  isize: 7,
  uint64_t: 8,
  u64: 8,
  usize: 8,
  double: 9,
  f64: 9,
  float: 10,
  f32: 10,
  bool: 11,
  'void*': 12,
  ptr: 12,
  pointer: 12,
  void: 13,
  'char*': 12,
  cstring: 14,
  i64_fast: 15,
  u64_fast: 16,
  function: 17,
  callback: 17,
  fn: 17,
  napi_env: 18,
  napi_value: 19,
  buffer: 20,
} as const;

/**
 * Browser-side `bun:ffi` type table. It deliberately does not import the ABI
 * package. Unknown properties trap immediately so a newly used Bun FFI type
 * cannot silently turn into `undefined` and corrupt a call signature.
 */
export const FFIType = new Proxy(SIMULATED_FFI_TYPES, {
  get(target, property, receiver) {
    if (typeof property === 'symbol' || Reflect.has(target, property)) {
      return Reflect.get(target, property, receiver);
    }
    throw new Error(`bun:ffi browser shim does not define FFIType.${property}`);
  },
});

let activeProcess: Win64Process | undefined;

export function bindWin64Process(process: Win64Process): () => void {
  const previous = activeProcess;
  activeProcess = process;
  return () => {
    activeProcess = previous;
  };
}

export function getBoundWin64Process(): Win64Process {
  if (!activeProcess) {
    throw new Error(
      'bun:ffi browser shim has no Win64 process context. Call bindWin64Process(process) before executing package code.',
    );
  }
  return activeProcess;
}

const pointerValue = (value: number | bigint) =>
  typeof value === 'bigint' ? value : BigInt(value);

const normalizeLibraryName = (name: string) => {
  const leaf = name.replace(/\//g, '\\').split('\\').pop() ?? name;
  return leaf.toLowerCase().endsWith('.dll')
    ? leaf.toLowerCase()
    : `${leaf.toLowerCase()}.dll`;
};

/**
 * Real `bun:ffi` auto-dereferences a `cstring`-typed return value into a JS
 * string (or `null` for a null pointer) rather than handing back the raw
 * pointer -- callers like `bun-capstone`'s `Capstone.regName()` rely on
 * that (`CapstoneImpl.cs_reg_name(...)?.toString()`, expecting an actual
 * string already). Mirror that here by reading the null-terminated string
 * out of the *guest* process's memory at the returned address.
 */
function decodeCStringReturn(value: bigint): string | null {
  if (value === 0n) return null;
  return getBoundWin64Process().memory.readCString(value);
}

const normalizeReturn = (
  value: bigint,
  returnType: FFITypeOrString | undefined,
): unknown => {
  if (typeof returnType === 'number') {
    if (returnType === SIMULATED_FFI_TYPES.void) return undefined;
    if (returnType === SIMULATED_FFI_TYPES.bool) return value !== 0n;
    if (
      returnType === SIMULATED_FFI_TYPES.i64 ||
      returnType === SIMULATED_FFI_TYPES.i64_fast
    ) {
      return BigInt.asIntN(64, value);
    }
    if (
      returnType === SIMULATED_FFI_TYPES.u64 ||
      returnType === SIMULATED_FFI_TYPES.u64_fast ||
      returnType === SIMULATED_FFI_TYPES.usize
    ) {
      return BigInt.asUintN(64, value);
    }
    if (returnType === SIMULATED_FFI_TYPES.cstring) {
      return decodeCStringReturn(value);
    }
    if (
      returnType === SIMULATED_FFI_TYPES.ptr ||
      returnType === SIMULATED_FFI_TYPES.function ||
      returnType === SIMULATED_FFI_TYPES.buffer
    ) {
      // Simulated user-space pointers fit safely in a JS number. Interpreting
      // the raw bits as signed also preserves Win32 pseudo-handles such as
      // `(HANDLE)-1` instead of rounding UINT64_MAX to 2^64.
      return Number(BigInt.asIntN(64, value));
    }
    return Number(value);
  }

  const normalized = String(returnType ?? 'void').toLowerCase();
  if (normalized === 'void') return undefined;
  if (normalized === 'bool') return value !== 0n;
  if (normalized === 'i64') return BigInt.asIntN(64, value);
  if (
    normalized === 'u64' ||
    normalized === 'usize' ||
    normalized === 'size_t'
  ) {
    return BigInt.asUintN(64, value);
  }
  if (normalized === 'cstring') return decodeCStringReturn(value);
  if (
    normalized === 'ptr' ||
    normalized === 'pointer' ||
    normalized === 'function' ||
    normalized === 'buffer'
  ) {
    return Number(BigInt.asIntN(64, value));
  }
  return Number(value);
};

const callableAt =
  (process: Win64Process, address: bigint, definition: FFIFunction) =>
  (...args: unknown[]) => {
    const result = process.invoke(address, args);
    return normalizeReturn(result.value, definition.returns);
  };

export function dlopen<T extends Record<string, FFIFunction>>(
  libraryName: string,
  definitions: T,
): FFILibrary<T> {
  const process = getBoundWin64Process();
  const normalized = normalizeLibraryName(libraryName);
  const module = process.getModule(normalized);
  if (!module) {
    throw new Error(
      `STATUS_DLL_NOT_FOUND: ${normalized} is not mapped in PID ${process.pid}`,
    );
  }

  const symbols = {} as FFILibrary<T>['symbols'];
  for (const [name, definition] of Object.entries(definitions)) {
    const address = module.exports.get(name);
    if (address === undefined) {
      throw new Error(`STATUS_ENTRYPOINT_NOT_FOUND: ${normalized}!${name}`);
    }
    Object.assign(symbols, {
      [name]: callableAt(process, address, definition),
    });
  }
  return {
    symbols,
    close: () => undefined,
  };
}

export function CFunction(
  options: FFIOptions,
): (...args: unknown[]) => unknown {
  const process = getBoundWin64Process();
  return callableAt(process, pointerValue(options.ptr), options);
}

/**
 * `ptr(view)` stability cache: real `bun:ffi` returns the buffer's *own*
 * address, which is the same on every call for the same buffer. Keyed by
 * the underlying ArrayBuffer (+ view window), per bound process.
 */
const externalBufferMappings = new WeakMap<
  ArrayBufferLike,
  { process: Win64Process; windows: Map<string, bigint> }
>();

export function ptr(value: unknown): Pointer {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof value === 'object' && 'address' in value) {
    return Number((value as { address: number | bigint }).address);
  }

  let bytes: Uint8Array | undefined;
  if (value instanceof Uint8Array) bytes = value;
  else if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (!bytes) return 0;

  const process = getBoundWin64Process();
  // Real `ptr(uint8array)` is "address of the caller's own buffer", not
  // "address of a private copy": alias the buffer into the address space
  // so guest code and the JS view share the exact same bytes (a struct's
  // `_view` over its own backing buffer, a guest-written output
  // parameter, ...). Like the real thing, the same buffer maps to the
  // same address on every call.
  const windowKey = `${bytes.byteOffset}:${bytes.byteLength}`;
  let entry = externalBufferMappings.get(bytes.buffer);
  if (entry && entry.process !== process) {
    entry = undefined;
  }
  const existing = entry?.windows.get(windowKey);
  if (existing !== undefined) return Number(existing);

  const address = process.mapExternalBuffer(bytes, 'bun:ffi ptr() buffer');
  if (!entry) {
    entry = { process, windows: new Map() };
    externalBufferMappings.set(bytes.buffer, entry);
  }
  entry.windows.set(windowKey, address);
  return Number(address);
}

export function toArrayBuffer(
  pointer: Pointer,
  byteOffset = 0,
  byteLength = 0,
): ArrayBuffer {
  const process = getBoundWin64Process();
  const address = BigInt(pointer) + BigInt(byteOffset);
  const mapping = process.memory.findMapping(address);
  if (!mapping) {
    return new ArrayBuffer(0);
  }
  const available = mapping.size - Number(address - mapping.base);
  const length = byteLength > 0 ? Math.min(byteLength, available) : available;

  // Live view, zero copy -- only expressible when the requested range is
  // the mapping's *entire* backing buffer starting at its base (a plain
  // JS ArrayBuffer can never represent "bytes k..n of a larger region").
  // Heap allocations are deliberately exact-size, single-mapping regions
  // (see `Win64Heap`'s page-per-allocation mode) precisely so this fast
  // path covers callers that require writable zero-copy guest-memory views.
  if (
    !mapping.cow &&
    address === mapping.base &&
    mapping.data.byteOffset === 0 &&
    length === mapping.data.byteLength &&
    mapping.data.byteLength === mapping.size
  ) {
    return mapping.data.buffer as ArrayBuffer;
  }

  const bytes = process.memory.read(address, length);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

const scalar = (
  pointer: Pointer,
  width: 1 | 2 | 4 | 8,
  getter:
    | 'getInt8'
    | 'getUint8'
    | 'getInt16'
    | 'getUint16'
    | 'getInt32'
    | 'getUint32'
    | 'getBigInt64'
    | 'getBigUint64'
    | 'getFloat32'
    | 'getFloat64',
) => {
  const bytes = getBoundWin64Process().memory.read(BigInt(pointer), width);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (getter === 'getInt8') return view.getInt8(0);
  if (getter === 'getUint8') return view.getUint8(0);
  if (getter === 'getInt16') return view.getInt16(0, true);
  if (getter === 'getUint16') return view.getUint16(0, true);
  if (getter === 'getInt32') return view.getInt32(0, true);
  if (getter === 'getUint32') return view.getUint32(0, true);
  if (getter === 'getBigInt64') return view.getBigInt64(0, true);
  if (getter === 'getBigUint64') {
    return view.getBigUint64(0, true);
  }
  if (getter === 'getFloat32') return view.getFloat32(0, true);
  return view.getFloat64(0, true);
};

export const read = {
  i8: (pointer: Pointer) => scalar(pointer, 1, 'getInt8'),
  u8: (pointer: Pointer) => scalar(pointer, 1, 'getUint8'),
  i16: (pointer: Pointer) => scalar(pointer, 2, 'getInt16'),
  u16: (pointer: Pointer) => scalar(pointer, 2, 'getUint16'),
  i32: (pointer: Pointer) => scalar(pointer, 4, 'getInt32'),
  u32: (pointer: Pointer) => scalar(pointer, 4, 'getUint32'),
  i64: (pointer: Pointer) => scalar(pointer, 8, 'getBigInt64'),
  u64: (pointer: Pointer) => scalar(pointer, 8, 'getBigUint64'),
  f32: (pointer: Pointer) => scalar(pointer, 4, 'getFloat32'),
  f64: (pointer: Pointer) => scalar(pointer, 8, 'getFloat64'),
  ptr: (pointer: Pointer) => scalar(pointer, 8, 'getBigUint64'),
};

export class CString {
  constructor(
    public readonly ptr: Pointer,
    public readonly byteOffset = 0,
    public readonly byteLength?: number,
  ) {}

  public toString(): string {
    const process = getBoundWin64Process();
    const address = BigInt(this.ptr + this.byteOffset);
    if (this.byteLength !== undefined) {
      return new TextDecoder().decode(
        process.memory.read(address, this.byteLength),
      );
    }
    return process.memory.readCString(address);
  }
}

const CALLBACK_ARG_REGISTERS = ['RCX', 'RDX', 'R8', 'R9'] as const;

/** Converts a guest register/stack slot back into a JS value, per the
 * callback's declared FFI argument type. */
function callbackArgFromRaw(raw: bigint, ffiType: FFITypeOrString): unknown {
  switch (String(ffiType).toLowerCase()) {
    case 'bool':
      return (raw & 1n) !== 0n;
    case 'i8':
      return Number(BigInt.asIntN(8, raw));
    case 'u8':
      return Number(BigInt.asUintN(8, raw));
    case 'i16':
      return Number(BigInt.asIntN(16, raw));
    case 'u16':
      return Number(BigInt.asUintN(16, raw));
    case 'i32':
      return Number(BigInt.asIntN(32, raw));
    case 'u32':
      return Number(BigInt.asUintN(32, raw));
    case 'i64':
      return BigInt.asIntN(64, raw);
    case 'u64':
    case 'usize':
    case 'size_t':
      return BigInt.asUintN(64, raw);
    default:
      // ptr/cstring/function and anything pointer-sized: plain number
      // (simulated addresses always fit in a JS safe integer).
      return Number(BigInt.asUintN(64, raw));
  }
}

function callbackReturnToRaw(value: unknown, ffiType: FFITypeOrString): bigint {
  switch (String(ffiType).toLowerCase()) {
    case 'void':
      return 0n;
    case 'bool':
      return value ? 1n : 0n;
    default:
      return typeof value === 'bigint' ? value : BigInt(Number(value ?? 0));
  }
}

export class JSCallback {
  public readonly ptr: Pointer;
  private closed = false;
  private readonly process: Win64Process;
  private readonly syscallId: number;

  constructor(
    public readonly fn: (...args: unknown[]) => unknown,
    public readonly definition: FFIFunction,
  ) {
    this.process = getBoundWin64Process();
    const argTypes = definition.args ?? [];
    // A real `syscall`-instruction trampoline in *executable* guest memory:
    // native code calls `ptr` like any other function pointer, the CPU trap
    // re-enters JS synchronously, and the handler's return value lands in
    // RAX exactly like a native callee's would.
    this.syscallId = this.process.machine.registerDynamicSyscall(
      (process, _thread, registers) => {
        const args = argTypes.map((type, index) => {
          const register = CALLBACK_ARG_REGISTERS[index];
          if (register) {
            return callbackArgFromRaw(registers[register], type);
          }
          return callbackArgFromRaw(
            process.memory.readU64(
              registers.RSP + 0x28n + BigInt((index - 4) * 8),
            ),
            type,
          );
        });
        return callbackReturnToRaw(
          this.fn(...args),
          definition.returns ?? 'void',
        );
      },
    );
    const thunk = createWin32SyscallThunk(this.syscallId);
    const address = this.process.allocate(
      thunk.byteLength,
      'rwx',
      0n,
      'JSCallback thunk',
    );
    this.process.memory.write(address, thunk);
    this.ptr = Number(address);
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.process.machine.unregisterDynamicSyscall(this.syscallId);
    this.process.free(BigInt(this.ptr));
  }

  public get isClosed(): boolean {
    return this.closed;
  }
}

export interface CCOptions {
  symbols: Record<string, FFIFunction>;
  library?: string[];
}

/**
 * Lightweight browser fallback for `cc()`. This path does not compile C; it
 * exposes requested symbol names already present in mapped modules. Full C
 * source compilation is provided by the worker implementation.
 */
export function cc(options: CCOptions) {
  const process = getBoundWin64Process();
  const libraries = options.library?.map(normalizeLibraryName);
  const symbols: Record<string, (...args: unknown[]) => unknown> = {};

  for (const [requestedName, definition] of Object.entries(options.symbols)) {
    let address: bigint | undefined;
    if (libraries) {
      for (const library of libraries) {
        address = process.resolveSymbol(library, requestedName);
        if (address !== undefined) break;
      }
    } else {
      for (const module of process.modules) {
        address = process.resolveSymbol(module.name, requestedName);
        if (address !== undefined) break;
      }
    }
    if (address === undefined) {
      symbols[requestedName] = () => {
        throw new Error(
          `bun:ffi cc browser shim cannot resolve ${requestedName}`,
        );
      };
    } else {
      symbols[requestedName] = callableAt(process, address, definition);
    }
  }

  return {
    symbols,
    close: () => undefined,
  };
}

export function createBrowserBunFFI(process: Win64Process) {
  return {
    bind: () => bindWin64Process(process),
    dlopen: <T extends Record<string, FFIFunction>>(
      name: string,
      definitions: T,
    ) => {
      const restore = bindWin64Process(process);
      try {
        return dlopen(name, definitions);
      } finally {
        restore();
      }
    },
    ptr: (value: unknown) => {
      const restore = bindWin64Process(process);
      try {
        return ptr(value);
      } finally {
        restore();
      }
    },
    machine: process.machine,
    process,
  };
}
