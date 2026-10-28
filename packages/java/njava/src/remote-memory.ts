import { resolveAddress, type IMemoryAccessor } from 'bun-xffi';

/**
 * Writes a null-terminated UTF-8 string into `accessor`'s process and
 * returns its remote address -- JNI's `const char*` params (class/field
 * names, signatures, ...) are declared as raw pointers in
 * `jni-signatures.ts` (not auto-marshaled `cstring`s, since that conversion
 * only ever produces a *local* buffer, which is the wrong address space for
 * a remote call), so callers write the bytes into the target process
 * themselves.
 */
export async function writeUtf8CString(
  accessor: Pick<IMemoryAccessor, 'alloc' | 'write'>,
  str: string,
): Promise<bigint> {
  const bytes = Buffer.from(`${str}\0`, 'utf8');
  const addr = BigInt(resolveAddress(await accessor.alloc(bytes.length)));
  await accessor.write(addr, bytes);
  return addr;
}

/**
 * Writes a `const jvalue *args` array (one 8-byte slot per element, the
 * layout every `Call*MethodA`/`NewObjectA` signature expects) for object-ref
 * (`jobject`/`jstring`/`jclass`/...) arguments. `jvalue` is a union whose
 * largest member is pointer/`jlong`/`jdouble`-sized (8 bytes on x64), so a
 * plain 8-byte little-endian value per slot is correct regardless of which
 * union member the callee actually reads.
 */
export async function writeJvalueObjectArray(
  accessor: Pick<IMemoryAccessor, 'alloc' | 'write'>,
  values: readonly bigint[],
): Promise<bigint> {
  const buf = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => buf.writeBigUInt64LE(v, i * 8));
  const addr = BigInt(resolveAddress(await accessor.alloc(buf.length)));
  await accessor.write(addr, buf);
  return addr;
}

/**
 * Synchronous variant of {@link writeUtf8CString}.
 */
export function writeUtf8CStringSync(
  accessor: {
    allocSync?: (size: number) => any;
    writeSync?: (addr: any, data: any) => any;
    alloc?: any;
    write?: any;
  },
  str: string,
): bigint {
  const bytes = Buffer.from(`${str}\0`, 'utf8');
  if (
    typeof accessor.allocSync === 'function' &&
    typeof accessor.writeSync === 'function'
  ) {
    const addr = BigInt(resolveAddress(accessor.allocSync(bytes.length)));
    accessor.writeSync(addr, bytes);
    return addr;
  }
  throw new Error(
    'Memory accessor does not support synchronous allocations (allocSync / writeSync)',
  );
}

/**
 * Synchronous variant of {@link writeJvalueObjectArray}.
 */
export function writeJvalueObjectArraySync(
  accessor: {
    allocSync?: (size: number) => any;
    writeSync?: (addr: any, data: any) => any;
    alloc?: any;
    write?: any;
  },
  values: readonly bigint[],
): bigint {
  const buf = Buffer.alloc(values.length * 8);
  values.forEach((v, i) => buf.writeBigUInt64LE(v, i * 8));
  if (
    typeof accessor.allocSync === 'function' &&
    typeof accessor.writeSync === 'function'
  ) {
    const addr = BigInt(resolveAddress(accessor.allocSync(buf.length)));
    accessor.writeSync(addr, buf);
    return addr;
  }
  throw new Error(
    'Memory accessor does not support synchronous allocations (allocSync / writeSync)',
  );
}

/**
 * Safely frees remote memory if the accessor provides a free method.
 */
export async function freeMemory(
  accessor: { free?: (addr: any) => Promise<any> | any },
  addr: bigint,
): Promise<void> {
  if (typeof accessor.free === 'function' && addr !== 0n) {
    try {
      await accessor.free(addr);
    } catch {}
  }
}

/**
 * Synchronous variant of {@link freeMemory}.
 */
export function freeMemorySync(
  accessor: { freeSync?: (addr: any) => any; free?: any },
  addr: bigint,
): void {
  if (typeof accessor.freeSync === 'function' && addr !== 0n) {
    try {
      accessor.freeSync(addr);
    } catch {}
  }
}

/**
 * Scoped helper that allocates a UTF-8 C string in remote memory, runs `fn(addr)`, and frees it in a finally block.
 */
export async function withUtf8CString<T>(
  accessor: Pick<IMemoryAccessor, 'alloc' | 'write'> & {
    free?: (addr: any) => Promise<any> | any;
  },
  str: string,
  fn: (addr: bigint) => Promise<T>,
): Promise<T> {
  const addr = await writeUtf8CString(accessor, str);
  try {
    return await fn(addr);
  } finally {
    await freeMemory(accessor, addr);
  }
}

/**
 * Synchronous variant of {@link withUtf8CString}.
 */
export function withUtf8CStringSync<T>(
  accessor: {
    allocSync?: (size: number) => any;
    writeSync?: (addr: any, data: any) => any;
    freeSync?: (addr: any) => any;
  },
  str: string,
  fn: (addr: bigint) => T,
): T {
  const addr = writeUtf8CStringSync(accessor, str);
  try {
    return fn(addr);
  } finally {
    freeMemorySync(accessor, addr);
  }
}

/**
 * Scoped helper that allocates a `jvalue` object array in remote memory, runs `fn(addr)`, and frees it in a finally block.
 */
export async function withJvalueObjectArray<T>(
  accessor: Pick<IMemoryAccessor, 'alloc' | 'write'> & {
    free?: (addr: any) => Promise<any> | any;
  },
  values: readonly bigint[],
  fn: (addr: bigint) => Promise<T>,
): Promise<T> {
  const addr = await writeJvalueObjectArray(accessor, values);
  try {
    return await fn(addr);
  } finally {
    await freeMemory(accessor, addr);
  }
}

/**
 * Synchronous variant of {@link withJvalueObjectArray}.
 */
export function withJvalueObjectArraySync<T>(
  accessor: {
    allocSync?: (size: number) => any;
    writeSync?: (addr: any, data: any) => any;
    freeSync?: (addr: any) => any;
  },
  values: readonly bigint[],
  fn: (addr: bigint) => T,
): T {
  const addr = writeJvalueObjectArraySync(accessor, values);
  try {
    return fn(addr);
  } finally {
    freeMemorySync(accessor, addr);
  }
}

/**
 * Writes raw bytes into target process and returns its remote address.
 */
export async function writeBytes(
  accessor: Pick<IMemoryAccessor, 'alloc' | 'write'>,
  data: Uint8Array | Buffer,
): Promise<bigint> {
  const addr = BigInt(resolveAddress(await accessor.alloc(data.length)));
  await accessor.write(addr, data);
  return addr;
}

/**
 * Synchronous variant of writeBytes.
 */
export function writeBytesSync(
  accessor: {
    allocSync?: (size: number) => any;
    writeSync?: (addr: any, data: any) => any;
  },
  data: Uint8Array | Buffer,
): bigint {
  if (
    typeof accessor.allocSync === 'function' &&
    typeof accessor.writeSync === 'function'
  ) {
    const addr = BigInt(resolveAddress(accessor.allocSync(data.length)));
    accessor.writeSync(addr, data);
    return addr;
  }
  throw new Error(
    'Memory accessor does not support synchronous allocations (allocSync / writeSync)',
  );
}

/**
 * Scoped helper that allocates raw bytes in remote memory, runs fn(addr), and frees it.
 */
export async function withBytes<T>(
  accessor: Pick<IMemoryAccessor, 'alloc' | 'write'> & {
    free?: (addr: any) => Promise<any> | any;
  },
  data: Uint8Array | Buffer,
  fn: (addr: bigint) => Promise<T>,
): Promise<T> {
  const addr = await writeBytes(accessor, data);
  try {
    return await fn(addr);
  } finally {
    await freeMemory(accessor, addr);
  }
}

/**
 * Synchronous variant of withBytes.
 */
export function withBytesSync<T>(
  accessor: {
    allocSync?: (size: number) => any;
    writeSync?: (addr: any, data: any) => any;
    freeSync?: (addr: any) => any;
  },
  data: Uint8Array | Buffer,
  fn: (addr: bigint) => T,
): T {
  const addr = writeBytesSync(accessor, data);
  try {
    return fn(addr);
  } finally {
    freeMemorySync(accessor, addr);
  }
}
