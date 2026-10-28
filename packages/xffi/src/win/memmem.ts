import { cmachinecode, type CMachineCode } from '../cmachinecode.js';
import { type AddressLike } from '../pointer.js';

export const memmem = cmachinecode({
  returns: 'ptr',
  args: ['ptr', 'size_t', 'ptr', 'size_t'],
  source: `
    if (arg3 == 0) return (void*)arg0;
    if (arg1 < arg3) return 0;
    const char* h = (const char*)arg0;
    const char* n = (const char*)arg2;
    for (unsigned long long i = 0; i <= arg1 - arg3; i++) {
        int match = 1;
        for (unsigned long long j = 0; j < arg3; j++) {
            if (h[i+j] != n[j]) {
                match = 0;
                break;
            }
        }
        if (match) return (void*)(h + i);
    }
    return 0;
  `,
}) as CMachineCode &
  ((
    haystack: AddressLike,
    haystackLen: AddressLike,
    needle: AddressLike,
    needleLen: AddressLike,
  ) => bigint);

export const memmem1 = cmachinecode({
  returns: 'ptr',
  args: ['ptr', 'size_t', 'u8'],
  source: `
    if (arg1 < 1) return 0;
    const char* h = (const char*)arg0;
    for (unsigned long long i = 0; i < arg1; i++) {
        if (*(const unsigned char*)(h + i) == (unsigned char)arg2) {
            return (void*)(h + i);
        }
    }
    return 0;
  `,
}) as CMachineCode &
  ((haystack: AddressLike, haystackLen: AddressLike, needle: number) => bigint);

export const memmem2 = cmachinecode({
  returns: 'ptr',
  args: ['ptr', 'size_t', 'u16'],
  source: `
    if (arg1 < 2) return 0;
    const char* h = (const char*)arg0;
    for (unsigned long long i = 0; i <= arg1 - 2; i++) {
        if (*(const unsigned short*)(h + i) == arg2) {
            return (void*)(h + i);
        }
    }
    return 0;
  `,
}) as CMachineCode &
  ((haystack: AddressLike, haystackLen: AddressLike, needle: number) => bigint);

export const memmem4 = cmachinecode({
  returns: 'ptr',
  args: ['ptr', 'size_t', 'u32'],
  source: `
    if (arg1 < 4) return 0;
    const char* h = (const char*)arg0;
    for (unsigned long long i = 0; i <= arg1 - 4; i++) {
        if (*(const unsigned int*)(h + i) == arg2) {
            return (void*)(h + i);
        }
    }
    return 0;
  `,
}) as CMachineCode &
  ((haystack: AddressLike, haystackLen: AddressLike, needle: number) => bigint);

export const memmem8 = cmachinecode({
  returns: 'ptr',
  args: ['ptr', 'size_t', 'u64'],
  source: `
    if (arg1 < 8) return 0;
    const char* h = (const char*)arg0;
    for (unsigned long long i = 0; i <= arg1 - 8; i++) {
        if (*(const unsigned long long*)(h + i) == arg2) {
            return (void*)(h + i);
        }
    }
    return 0;
  `,
}) as CMachineCode &
  ((
    haystack: AddressLike,
    haystackLen: AddressLike,
    needle: AddressLike,
  ) => bigint);

export const memmemWithoutBuffer = cmachinecode({
  returns: 'ptr',
  args: ['ptr', 'size_t', 'u64', 'size_t'],
  source: `
    if (arg1 < arg3) return 0;
    const char* h = (const char*)arg0;
    const char* n = (const char*)&arg2;
    unsigned long long len = arg3;
    for (unsigned long long i = 0; i <= arg1 - len; i++) {
        int match = 1;
        for (unsigned long long j = 0; j < len; j++) {
            if (h[i+j] != n[j]) {
                match = 0;
                break;
            }
        }
        if (match) return (void*)(h + i);
    }
    return 0;
  `,
}) as CMachineCode &
  ((
    haystack: AddressLike,
    haystackLen: AddressLike,
    needleVal: bigint,
    byteCount: bigint | number,
  ) => bigint);

/**
 * Smart memmem dispatcher.
 * Uses memmem2/4/8 (needle passed as a register value) for 2/4/8-byte patterns,
 * falling back to the general memmem for all other lengths.
 */
export function smartMemmem(
  haystack: AddressLike,
  haystackLen: AddressLike,
  needle: AddressLike | Uint8Array,
  needleLen: AddressLike,
): bigint {
  const n = Number(needleLen);
  const isBufferLike = ArrayBuffer.isView(needle);
  if (n === 1) {
    const val = isBufferLike ? (needle as Uint8Array)[0]! : Number(needle);
    return memmem1(haystack, haystackLen, val);
  }
  if (n === 2) {
    const val = isBufferLike
      ? (needle as Uint8Array)[0]! | ((needle as Uint8Array)[1]! << 8)
      : Number(needle);
    return memmem2(haystack, haystackLen, val);
  }
  if (n === 3 || n === 5 || n === 6 || n === 7) {
    let val = 0n;
    if (isBufferLike) {
      for (let i = 0; i < n; i++) {
        val |= BigInt((needle as Uint8Array)[i]!) << BigInt(i * 8);
      }
    } else {
      val = BigInt(needle as any);
    }
    return memmemWithoutBuffer(haystack, haystackLen, val, n);
  }
  if (n === 4) {
    const val = isBufferLike
      ? (needle as Uint8Array)[0]! |
        ((needle as Uint8Array)[1]! << 8) |
        ((needle as Uint8Array)[2]! << 16) |
        ((needle as Uint8Array)[3]! << 24)
      : Number(needle);
    return memmem4(haystack, haystackLen, val);
  }
  if (n === 8) {
    let val: bigint;
    if (isBufferLike) {
      const view = new DataView(
        (needle as Uint8Array).buffer,
        (needle as Uint8Array).byteOffset,
        (needle as Uint8Array).byteLength,
      );
      val = view.getBigUint64(0, true);
    } else {
      val = needle as bigint;
    }
    return memmem8(haystack, haystackLen, val);
  }
  return memmem(haystack, haystackLen, needle as AddressLike, needleLen);
}

export const remoteCallDispatcher = cmachinecode({
  returns: 'void',
  args: ['ptr'],
  source: `
    typedef struct {
        void* func;
        unsigned long long args[4];
        unsigned long long result;
    } DispatchParams;

    DispatchParams* p = (DispatchParams*)arg0;
    p->result = ((unsigned long long(*)(unsigned long long, unsigned long long, unsigned long long, unsigned long long))p->func)(
        p->args[0], p->args[1], p->args[2], p->args[3]
    );
  `,
}) as CMachineCode & ((paramsAddr: AddressLike) => void);
