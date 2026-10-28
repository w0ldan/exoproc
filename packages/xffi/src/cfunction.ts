import {
  CFunction as BunCFunction,
  type FFITypeOrString,
  type Pointer,
} from 'bun:ffi';
import {
  type ISyncPointer,
  SyncNativePointer,
  type AddressLike,
} from './pointer.js';
import { resolveAddress } from './ffi.js';
import { mapToBunFFIType, type CTypeOrString, normalizeType } from './types.js';
import { getActiveContext, executeInCall } from './runner-context.js';

/**
 * Interface representing a native function definition.
 */
export interface IFunction {
  readonly args?: readonly CTypeOrString[];
  readonly returns?: CTypeOrString;
}

export const functionRegistry = new Map<
  bigint,
  { name: string; library: string }
>();

/**
 * Base wrapper for native functions.
 */
export interface CFunction extends ISyncPointer {
  (...args: any[]): any;
  readonly name?: string;
  readonly args: readonly CTypeOrString[];
  readonly returns: CTypeOrString;
  readonly ptr: Pointer;
}

/**
 * Converts a raw register-width result (e.g. RAX) to the typed CCallResult
 * based on the function's declared return type.
 *
 * Used by any caller that receives a result as a raw bigint — e.g. thread redirection
 * accessors (NThread) or named-pipe callers. Mirrors the conversion that bun:ffi
 * performs for local calls.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseCallResult(raw: AddressLike, returns: CTypeOrString): any {
  const value = BigInt(resolveAddress(raw));
  const norm = normalizeType(returns);
  if (norm === 'void') return undefined;
  if (norm === 'bool') return value !== 0n;
  if (norm === 'i64' || norm === 'u64' || norm === 'usize' || norm === 'size_t')
    return value;
  // ptr, cstring, cwstring, and all numeric types → Number (consistent with bun:ffi)
  return Number(value);
}

function normalizePointerArgForType(
  value: unknown,
  normalizedType: string,
): number | bigint {
  const resolved = resolveAddress(value);
  if (
    normalizedType === 'u64' ||
    normalizedType === 'usize' ||
    normalizedType === 'size_t'
  ) {
    return BigInt.asUintN(64, BigInt(resolved));
  }
  if (normalizedType === 'i64') {
    return BigInt(resolved);
  }
  return resolved;
}

export function createCFunction(
  address: AddressLike,
  sig: [CTypeOrString, CTypeOrString[]],
  callable?: CallableFunction,
  name?: string,
): CFunction {
  const nativePtr = new SyncNativePointer(address);
  const returns = sig[0] as FFITypeOrString;
  const args = sig[1] as FFITypeOrString[];

  let innerCallable: CallableFunction;
  if (callable) {
    innerCallable = callable;
  } else {
    innerCallable = BunCFunction({
      ptr: nativePtr.address,
      returns: mapToBunFFIType(sig[0]),
      args: sig[1].map(mapToBunFFIType) as FFITypeOrString[],
    });
  }

  const cstringIndices: number[] = [];
  const cwstringIndices: number[] = [];
  const normalizedArgTypes: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const norm = normalizeType(args[i]);
    normalizedArgTypes.push(norm);
    if (norm === 'cstring') {
      cstringIndices.push(i);
    } else if (norm === 'cwstring') {
      cwstringIndices.push(i);
    }
  }

  const wrapper = function (...argsList: any[]) {
    if (argsList.length === args.length + 1) {
      const possibleAccessor = argsList[0];
      if (
        possibleAccessor &&
        typeof possibleAccessor === 'object' &&
        typeof possibleAccessor.read === 'function' &&
        typeof possibleAccessor.write === 'function'
      ) {
        const rawArgs = argsList.slice(1);
        const hasStringArgs =
          cstringIndices.some((idx) => typeof rawArgs[idx] === 'string') ||
          cwstringIndices.some((idx) => typeof rawArgs[idx] === 'string');

        if (hasStringArgs && typeof possibleAccessor.alloc === 'function') {
          return (async () => {
            const tempAddrs: AddressLike[] = [];
            const callArgs = [...rawArgs];
            try {
              for (const idx of cstringIndices) {
                if (typeof callArgs[idx] === 'string') {
                  const buf = Buffer.from(callArgs[idx] + '\0', 'utf8');
                  const addr = await possibleAccessor.alloc(buf.length);
                  await possibleAccessor.write(addr, buf);
                  tempAddrs.push(addr);
                  callArgs[idx] = addr;
                }
              }
              for (const idx of cwstringIndices) {
                if (typeof callArgs[idx] === 'string') {
                  const buf = Buffer.from(callArgs[idx] + '\0', 'utf16le');
                  const addr = await possibleAccessor.alloc(buf.length);
                  await possibleAccessor.write(addr, buf);
                  tempAddrs.push(addr);
                  callArgs[idx] = addr;
                }
              }
              if (typeof possibleAccessor.call === 'function') {
                return await possibleAccessor.call(wrapper, ...callArgs);
              } else if (typeof possibleAccessor.callSync === 'function') {
                return possibleAccessor.callSync(wrapper, ...callArgs);
              }
            } finally {
              for (const addr of tempAddrs) {
                if (typeof possibleAccessor.free === 'function') {
                  await possibleAccessor.free(addr).catch(() => {});
                }
              }
            }
          })();
        }

        if (typeof possibleAccessor.call === 'function') {
          return possibleAccessor.call(wrapper, ...rawArgs);
        } else if (typeof possibleAccessor.callSync === 'function') {
          return possibleAccessor.callSync(wrapper, ...rawArgs);
        }
      }
    }

    const activeCtx = getActiveContext();
    if (
      activeCtx &&
      !activeCtx.inCall &&
      (typeof (activeCtx.accessor as any).call === 'function' ||
        typeof (activeCtx.accessor as any).callSync === 'function')
    ) {
      const { accessor, isSync } = activeCtx;
      const hasStringArgs =
        cstringIndices.some((idx) => typeof argsList[idx] === 'string') ||
        cwstringIndices.some((idx) => typeof argsList[idx] === 'string');

      if (isSync) {
        if (
          hasStringArgs &&
          typeof (accessor as any).allocSync === 'function' &&
          typeof (accessor as any).writeSync === 'function'
        ) {
          return executeInCall(activeCtx, () => {
            const tempAddrs: AddressLike[] = [];
            const callArgs = [...argsList];
            try {
              for (const idx of cstringIndices) {
                if (typeof callArgs[idx] === 'string') {
                  const buf = Buffer.from(callArgs[idx] + '\0', 'utf8');
                  const addr = (accessor as any).allocSync(buf.length);
                  (accessor as any).writeSync(addr, buf);
                  tempAddrs.push(addr);
                  callArgs[idx] = addr;
                }
              }
              for (const idx of cwstringIndices) {
                if (typeof callArgs[idx] === 'string') {
                  const buf = Buffer.from(callArgs[idx] + '\0', 'utf16le');
                  const addr = (accessor as any).allocSync(buf.length);
                  (accessor as any).writeSync(addr, buf);
                  tempAddrs.push(addr);
                  callArgs[idx] = addr;
                }
              }
              if (typeof (accessor as any).callSync === 'function') {
                return (accessor as any).callSync(wrapper, ...callArgs);
              }
              if (typeof (accessor as any).call === 'function') {
                return (accessor as any).call(wrapper, ...callArgs);
              }
            } finally {
              for (const addr of tempAddrs) {
                if (typeof (accessor as any).freeSync === 'function') {
                  try {
                    (accessor as any).freeSync(addr);
                  } catch {}
                }
              }
            }
          });
        }

        if (typeof (accessor as any).callSync === 'function') {
          return executeInCall(activeCtx, () =>
            (accessor as any).callSync(wrapper, ...argsList),
          );
        }
        if (typeof (accessor as any).call === 'function') {
          return executeInCall(activeCtx, () =>
            (accessor as any).call(wrapper, ...argsList),
          );
        }
      } else {
        if (
          hasStringArgs &&
          typeof accessor.alloc === 'function' &&
          typeof accessor.write === 'function'
        ) {
          return executeInCall(activeCtx, () =>
            (async () => {
              const tempAddrs: AddressLike[] = [];
              const callArgs = [...argsList];
              try {
                for (const idx of cstringIndices) {
                  if (typeof callArgs[idx] === 'string') {
                    const buf = Buffer.from(callArgs[idx] + '\0', 'utf8');
                    const addr = await accessor.alloc(buf.length);
                    await accessor.write(addr, buf);
                    tempAddrs.push(addr);
                    callArgs[idx] = addr;
                  }
                }
                for (const idx of cwstringIndices) {
                  if (typeof callArgs[idx] === 'string') {
                    const buf = Buffer.from(callArgs[idx] + '\0', 'utf16le');
                    const addr = await accessor.alloc(buf.length);
                    await accessor.write(addr, buf);
                    tempAddrs.push(addr);
                    callArgs[idx] = addr;
                  }
                }
                if (typeof (accessor as any).call === 'function') {
                  return await (accessor as any).call(wrapper, ...callArgs);
                }
                if (typeof (accessor as any).callSync === 'function') {
                  return (accessor as any).callSync(wrapper, ...callArgs);
                }
              } finally {
                for (const addr of tempAddrs) {
                  if (typeof accessor.free === 'function') {
                    await accessor.free(addr).catch(() => {});
                  }
                }
              }
            })(),
          );
        }

        if (typeof (accessor as any).call === 'function') {
          return executeInCall(activeCtx, () =>
            (accessor as any).call(wrapper, ...argsList),
          );
        }
        if (typeof (accessor as any).callSync === 'function') {
          return executeInCall(activeCtx, () =>
            (accessor as any).callSync(wrapper, ...argsList),
          );
        }
      }
    }
    for (let i = 0; i < cstringIndices.length; i++) {
      const idx = cstringIndices[i];
      if (idx !== undefined && typeof argsList[idx] === 'string') {
        argsList[idx] = Buffer.from(argsList[idx] + '\0', 'utf8');
      }
    }
    for (let i = 0; i < cwstringIndices.length; i++) {
      const idx = cwstringIndices[i];
      if (idx !== undefined && typeof argsList[idx] === 'string') {
        argsList[idx] = Buffer.from(argsList[idx] + '\0', 'utf16le');
      }
    }
    for (let i = 0; i < argsList.length; i++) {
      const val = argsList[i];
      const normType = normalizedArgTypes[i] ?? 'ptr';
      if (
        typeof val === 'string' &&
        normType !== 'cstring' &&
        normType !== 'cwstring'
      ) {
        const trimmed = val.trim();
        if (/^-?0x[0-9a-fA-F]+$/.test(trimmed)) {
          argsList[i] = normalizePointerArgForType(trimmed, normType);
          continue;
        } else if (
          normType === 'ptr' ||
          normType === 'i64' ||
          normType === 'u64' ||
          normType === 'usize' ||
          normType === 'size_t'
        ) {
          const isAnsi = name ? name.endsWith('A') : false;
          const strBuf = Buffer.from(val + '\0', isAnsi ? 'utf8' : 'utf16le');
          argsList[i] =
            normType === 'ptr'
              ? strBuf
              : normalizePointerArgForType(strBuf, normType);
          continue;
        }
      }
      if (val && typeof val === 'object' && 'address' in (val as any)) {
        argsList[i] = normalizePointerArgForType(
          (val as any).address,
          normType,
        );
      } else if (normType === 'ptr' && typeof val === 'bigint') {
        argsList[i] = Number(val);
      } else if (
        (normType === 'u64' ||
          normType === 'usize' ||
          normType === 'size_t' ||
          normType === 'i64') &&
        typeof val !== 'bigint'
      ) {
        argsList[i] = BigInt(resolveAddress(val));
      } else if (
        typeof val === 'bigint' &&
        normType !== 'u64' &&
        normType !== 'usize' &&
        normType !== 'size_t' &&
        normType !== 'i64'
      ) {
        argsList[i] = Number(val);
      }
    }
    return innerCallable(...argsList);
  } as any;

  Object.setPrototypeOf(wrapper, SyncNativePointer.prototype);

  wrapper.args = args;
  wrapper.returns = returns;
  wrapper.address = nativePtr.address;
  wrapper.ptr = nativePtr.address;

  wrapper.toNumber = nativePtr.toNumber.bind(nativePtr);
  wrapper.toString = nativePtr.toString.bind(nativePtr);
  wrapper.isNull = nativePtr.isNull.bind(nativePtr);
  wrapper.valueOf = nativePtr.valueOf.bind(nativePtr);
  wrapper[Symbol.toPrimitive] = nativePtr[Symbol.toPrimitive].bind(nativePtr);

  if (name !== undefined) {
    Object.defineProperty(wrapper, 'name', { value: name, configurable: true });
  }
  if (name) {
    const addr = BigInt(resolveAddress(address));
    functionRegistry.set(addr, { name, library: '' });
  }

  return wrapper;
}

export function createDynamicCFunction(
  address: AddressLike,
  sig: [CTypeOrString, CTypeOrString[]],
  size: number,
  bytes: Uint8Array | number[],
  callable?: CallableFunction,
): DynamicCFunction {
  const wrapper = createCFunction(address, sig, callable) as any;
  wrapper.size = size;
  wrapper.bytes = bytes;
  return wrapper;
}

export interface DynamicCFunction extends CFunction {
  readonly size: number;
  readonly bytes: Uint8Array | number[];
}
