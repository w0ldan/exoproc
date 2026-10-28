import { resolveAddress } from './ffi.js';
import { functionRegistry } from './cfunction.js';
import { log } from './logger.js';

const debugLog = log.add('DebugAccessor');

export function formatAddr(address: any): string {
  try {
    const addrVal = resolveAddress(address);
    return `0x${BigInt(addrVal).toString(16)}`;
  } catch {
    return String(address);
  }
}

export function getFunctionName(func: any): string {
  try {
    const addrVal = BigInt(resolveAddress(func.ptr ?? func));
    const reg = functionRegistry.get(addrVal);
    if (reg) {
      return reg.library ? `${reg.library}!${reg.name}` : reg.name;
    }
    if (func.name) return func.name;
  } catch {
    /* ignore resolution errors */
  }
  return formatAddr(func.ptr ?? func);
}

export function formatResultDetail(result: any): string {
  if (result === null || result === undefined) return String(result);

  if (typeof result === 'boolean') {
    return String(result);
  }

  if (typeof result === 'string') {
    return `"${result}"`;
  }

  if (Buffer.isBuffer(result)) {
    const maxLen = 32;
    const slice = result.slice(0, maxLen);
    const hexBytes: string[] = [];
    let asciiChars = '';
    for (const byte of slice) {
      hexBytes.push(byte.toString(16).padStart(2, '0'));
      if (byte >= 32 && byte <= 126) {
        asciiChars += String.fromCharCode(byte);
      } else {
        asciiChars += '.';
      }
    }
    const hexStr = hexBytes.join(' ');
    const truncated = result.length > maxLen ? '...' : '';
    return `Buffer(len=${result.length}, hex=[${hexStr}${truncated}], ascii="${asciiChars}${truncated}")`;
  }

  if (ArrayBuffer.isView(result) && !(result instanceof DataView)) {
    const buf = Buffer.from(
      result.buffer,
      result.byteOffset,
      result.byteLength,
    );
    const typeName = result.constructor.name;
    const maxLen = 32;
    const slice = buf.slice(0, maxLen);
    const hexBytes: string[] = [];
    let asciiChars = '';
    for (const byte of slice) {
      hexBytes.push(byte.toString(16).padStart(2, '0'));
      if (byte >= 32 && byte <= 126) {
        asciiChars += String.fromCharCode(byte);
      } else {
        asciiChars += '.';
      }
    }
    const hexStr = hexBytes.join(' ');
    const truncated = buf.length > maxLen ? '...' : '';
    return `${typeName}(len=${buf.length}, hex=[${hexStr}${truncated}], ascii="${asciiChars}${truncated}")`;
  }

  if (typeof result === 'number' || typeof result === 'bigint') {
    if (typeof result === 'number' && !Number.isInteger(result)) {
      return `${result}`;
    }
    const valBig = BigInt(result);
    const unsigned64 = BigInt.asUintN(64, valBig);
    const signed64 = BigInt.asIntN(64, valBig);
    const hexStr = `0x${unsigned64.toString(16)}`;
    if (signed64 < 0n) {
      return `${hexStr} (dec: ${unsigned64.toString()}, signed: ${signed64.toString()})`;
    } else {
      return `${hexStr} (dec: ${unsigned64.toString()})`;
    }
  }

  if (typeof result === 'object') {
    if (
      result.constructor &&
      result.constructor !== Object &&
      typeof result.toString === 'function' &&
      result.toString !== Object.prototype.toString
    ) {
      try {
        const strVal = result.toString();
        if (strVal !== '[object Object]') {
          if (/^0x[0-9a-fA-F]+$/.test(strVal)) {
            try {
              const resolved = resolveAddress(result);
              return `${strVal} (dec: ${resolved})`;
            } catch {
              return strVal;
            }
          }
          let addrPart = '';
          if (!strVal.includes('at 0x') && !strVal.includes('at ')) {
            try {
              const resolved = resolveAddress(result);
              if (resolved !== 0) {
                addrPart = ` [address: 0x${BigInt(resolved).toString(16)} (dec: ${resolved})]`;
              }
            } catch {
              /* ignore resolution errors */
            }
          }
          return `${strVal}${addrPart}`;
        }
      } catch {
        /* ignore toString/resolution errors */
      }
    }
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }

  return String(result);
}

// READ
export function debugReadBefore(
  backendName: string,
  address: any,
  size: number,
  offset: number,
): void {
  debugLog.debug(
    `read(address=${formatAddr(address)}, size=${size}, offset=${offset}) forwarding to ${backendName}`,
  );
}
export function debugReadAfter(result: Buffer): void {
  debugLog.debug(`read returned ${formatResultDetail(result)}`);
}
export function debugReadSyncBefore(
  backendName: string,
  address: any,
  size: number,
  offset: number,
): void {
  debugLog.debug(
    `readSync(address=${formatAddr(address)}, size=${size}, offset=${offset}) forwarding to ${backendName}`,
  );
}
export function debugReadSyncAfter(result: Buffer): void {
  debugLog.debug(`readSync returned ${formatResultDetail(result)}`);
}

// WRITE
export function debugWriteBefore(
  backendName: string,
  address: any,
  data: any,
  offset: number,
): void {
  const dataDetail = formatResultDetail(data);
  debugLog.debug(
    `write(address=${formatAddr(address)}, data=${dataDetail}, offset=${offset}) forwarding to ${backendName}`,
  );
}
export function debugWriteAfter(result: number): void {
  debugLog.debug(`write returned ${result} bytes written`);
}
export function debugWriteSyncBefore(
  backendName: string,
  address: any,
  data: any,
  offset: number,
): void {
  const dataDetail = formatResultDetail(data);
  debugLog.debug(
    `writeSync(address=${formatAddr(address)}, data=${dataDetail}, offset=${offset}) forwarding to ${backendName}`,
  );
}
export function debugWriteSyncAfter(result: number): void {
  debugLog.debug(`writeSync returned ${result} bytes written`);
}

// ALLOC
export function debugAllocBefore(
  backendName: string,
  size: number,
  address: any,
  protection: any,
  allocationType: any,
): void {
  const protStr =
    protection !== undefined ? formatResultDetail(protection) : 'undefined';
  const allocTypeStr =
    allocationType !== undefined
      ? formatResultDetail(allocationType)
      : 'undefined';
  debugLog.debug(
    `alloc(size=0x${size.toString(16)} (dec: ${size}), address=${formatAddr(address)}, protection=${protStr}, allocationType=${allocTypeStr}) forwarding to ${backendName}`,
  );
}
export function debugAllocAfter(result: any): void {
  debugLog.debug(`alloc returned address ${formatAddr(result)}`);
}
export function debugAllocSyncBefore(
  backendName: string,
  size: number,
  address: any,
  protection: any,
  allocationType: any,
): void {
  const protStr =
    protection !== undefined ? formatResultDetail(protection) : 'undefined';
  const allocTypeStr =
    allocationType !== undefined
      ? formatResultDetail(allocationType)
      : 'undefined';
  debugLog.debug(
    `allocSync(size=0x${size.toString(16)} (dec: ${size}), address=${formatAddr(address)}, protection=${protStr}, allocationType=${allocTypeStr}) forwarding to ${backendName}`,
  );
}
export function debugAllocSyncAfter(result: any): void {
  debugLog.debug(`allocSync returned address ${formatAddr(result)}`);
}

// FREE
export function debugFreeBefore(
  backendName: string,
  address: any,
  size: number,
  freeType: any,
): void {
  const freeTypeStr =
    freeType !== undefined ? formatResultDetail(freeType) : 'undefined';
  debugLog.debug(
    `free(address=${formatAddr(address)}, size=0x${size.toString(16)} (dec: ${size}), freeType=${freeTypeStr}) forwarding to ${backendName}`,
  );
}
export function debugFreeAfter(result: boolean): void {
  debugLog.debug(`free returned ${result}`);
}
export function debugFreeSyncBefore(
  backendName: string,
  address: any,
  size: number,
  freeType: any,
): void {
  const freeTypeStr =
    freeType !== undefined ? formatResultDetail(freeType) : 'undefined';
  debugLog.debug(
    `freeSync(address=${formatAddr(address)}, size=0x${size.toString(16)} (dec: ${size}), freeType=${freeTypeStr}) forwarding to ${backendName}`,
  );
}
export function debugFreeSyncAfter(result: boolean): void {
  debugLog.debug(`freeSync returned ${result}`);
}

// PROTECT
export function debugProtectBefore(
  backendName: string,
  address: any,
  size: number,
  newProtect: any,
): void {
  const protStr =
    newProtect !== undefined ? formatResultDetail(newProtect) : 'undefined';
  debugLog.debug(
    `protect(address=${formatAddr(address)}, size=0x${size.toString(16)} (dec: ${size}), newProtect=${protStr}) forwarding to ${backendName}`,
  );
}
export function debugProtectAfter(result: any): void {
  debugLog.debug(
    `protect returned old protection: ${formatResultDetail(result)}`,
  );
}
export function debugProtectSyncBefore(
  backendName: string,
  address: any,
  size: number,
  newProtect: any,
): void {
  const protStr =
    newProtect !== undefined ? formatResultDetail(newProtect) : 'undefined';
  debugLog.debug(
    `protectSync(address=${formatAddr(address)}, size=0x${size.toString(16)} (dec: ${size}), newProtect=${protStr}) forwarding to ${backendName}`,
  );
}
export function debugProtectSyncAfter(result: any): void {
  debugLog.debug(
    `protectSync returned old protection: ${formatResultDetail(result)}`,
  );
}

// QUERY
export function debugQueryBefore(backendName: string, address: any): void {
  debugLog.debug(
    `query(address=${formatAddr(address)}) forwarding to ${backendName}`,
  );
}
export function debugQueryAfter(result: any): void {
  debugLog.debug(
    `query returned region base=${formatAddr(result.BaseAddress)}, size=0x${result.RegionSize.toString(16)} (state=${formatResultDetail(result.State)}, protect=${formatResultDetail(result.Protect)}, type=${formatResultDetail(result.Type)})`,
  );
}
export function debugQuerySyncBefore(backendName: string, address: any): void {
  debugLog.debug(
    `querySync(address=${formatAddr(address)}) forwarding to ${backendName}`,
  );
}
export function debugQuerySyncAfter(result: any): void {
  debugLog.debug(
    `querySync returned region base=${formatAddr(result.BaseAddress)}, size=0x${result.RegionSize.toString(16)} (state=${formatResultDetail(result.State)}, protect=${formatResultDetail(result.Protect)}, type=${formatResultDetail(result.Type)})`,
  );
}

// CALL
export function debugCallBefore(
  backendName: string,
  func: any,
  args: any[],
): void {
  debugLog.debug(
    `call(func=${getFunctionName(func)}, args=[${args.map((a) => formatResultDetail(a)).join(', ')}]) forwarding to ${backendName}`,
  );
}
export function debugCallAfter(result: any): void {
  debugLog.debug(`call returned ${formatResultDetail(result)}`);
}
export function debugCallSyncBefore(
  backendName: string,
  func: any,
  args: any[],
): void {
  debugLog.debug(
    `callSync(func=${getFunctionName(func)}, args=[${args.map((a) => formatResultDetail(a)).join(', ')}]) forwarding to ${backendName}`,
  );
}
export function debugCallSyncAfter(result: any): void {
  debugLog.debug(`callSync returned ${formatResultDetail(result)}`);
}

// MACHINECODE
export function debugMachineCodeBefore(
  backendName: string,
  size: number,
): void {
  debugLog.debug(`machineCode(size=${size}) forwarding to ${backendName}`);
}
export function debugMachineCodeAfter(result: number): void {
  debugLog.debug(`machineCode returned address ${formatAddr(result)}`);
}
export function debugMachineCodeSyncBefore(
  backendName: string,
  size: number,
): void {
  debugLog.debug(`machineCodeSync(size=${size}) forwarding to ${backendName}`);
}
export function debugMachineCodeSyncAfter(result: number): void {
  debugLog.debug(`machineCodeSync returned address ${formatAddr(result)}`);
}

// SCAN
export function debugScanBefore(
  backendName: string,
  address: any,
  size: number,
  pattern: string,
): void {
  debugLog.debug(
    `scan(address=${formatAddr(address)}, size=${size}, pattern="${pattern}") forwarding to ${backendName}`,
  );
}
export function debugScanAfter(hitCount: number): void {
  debugLog.debug(`scan completed yielding ${hitCount} hit(s)`);
}
export function debugScanSyncBefore(
  backendName: string,
  address: any,
  size: number,
  pattern: string,
): void {
  debugLog.debug(
    `scanSync(address=${formatAddr(address)}, size=${size}, pattern="${pattern}") forwarding to ${backendName}`,
  );
}
export function debugScanSyncAfter(hitCount: number): void {
  debugLog.debug(`scanSync completed yielding ${hitCount} hit(s)`);
}

// DEDICATED LOGGING RUNNERS WITH CALLBACKS
export async function debugRead(
  backendName: string,
  address: any,
  size: number,
  offset: number,
  fn: () => Promise<Buffer>,
): Promise<Buffer> {
  debugReadBefore(backendName, address, size, offset);
  const res = await fn();
  debugReadAfter(res);
  return res;
}
export function debugReadSync(
  backendName: string,
  address: any,
  size: number,
  offset: number,
  fn: () => Buffer,
): Buffer {
  debugReadSyncBefore(backendName, address, size, offset);
  const res = fn();
  debugReadSyncAfter(res);
  return res;
}

export async function debugWrite(
  backendName: string,
  address: any,
  data: any,
  offset: number,
  fn: () => Promise<number>,
): Promise<number> {
  debugWriteBefore(backendName, address, data, offset);
  const res = await fn();
  debugWriteAfter(res);
  return res;
}
export function debugWriteSync(
  backendName: string,
  address: any,
  data: any,
  offset: number,
  fn: () => number,
): number {
  debugWriteSyncBefore(backendName, address, data, offset);
  const res = fn();
  debugWriteSyncAfter(res);
  return res;
}

export async function debugAlloc(
  backendName: string,
  size: number,
  address: any,
  protection: any,
  allocationType: any,
  fn: () => Promise<any>,
): Promise<any> {
  debugAllocBefore(backendName, size, address, protection, allocationType);
  const res = await fn();
  debugAllocAfter(res);
  return res;
}
export function debugAllocSync(
  backendName: string,
  size: number,
  address: any,
  protection: any,
  allocationType: any,
  fn: () => any,
): any {
  debugAllocSyncBefore(backendName, size, address, protection, allocationType);
  const res = fn();
  debugAllocSyncAfter(res);
  return res;
}

export async function debugFree(
  backendName: string,
  address: any,
  size: number,
  freeType: any,
  fn: () => Promise<boolean>,
): Promise<boolean> {
  debugFreeBefore(backendName, address, size, freeType);
  const res = await fn();
  debugFreeAfter(res);
  return res;
}
export function debugFreeSync(
  backendName: string,
  address: any,
  size: number,
  freeType: any,
  fn: () => boolean,
): boolean {
  debugFreeSyncBefore(backendName, address, size, freeType);
  const res = fn();
  debugFreeSyncAfter(res);
  return res;
}

export async function debugProtect(
  backendName: string,
  address: any,
  size: number,
  newProtect: any,
  fn: () => Promise<any>,
): Promise<any> {
  debugProtectBefore(backendName, address, size, newProtect);
  const res = await fn();
  debugProtectAfter(res);
  return res;
}
export function debugProtectSync(
  backendName: string,
  address: any,
  size: number,
  newProtect: any,
  fn: () => any,
): any {
  debugProtectSyncBefore(backendName, address, size, newProtect);
  const res = fn();
  debugProtectSyncAfter(res);
  return res;
}

export async function debugQuery(
  backendName: string,
  address: any,
  fn: () => Promise<any>,
): Promise<any> {
  debugQueryBefore(backendName, address);
  const res = await fn();
  debugQueryAfter(res);
  return res;
}
export function debugQuerySync(
  backendName: string,
  address: any,
  fn: () => any,
): any {
  debugQuerySyncBefore(backendName, address);
  const res = fn();
  debugQuerySyncAfter(res);
  return res;
}

export async function debugCall(
  backendName: string,
  func: any,
  args: any[],
  fn: () => Promise<any>,
): Promise<any> {
  debugCallBefore(backendName, func, args);
  const res = await fn();
  debugCallAfter(res);
  return res;
}
export function debugCallSync(
  backendName: string,
  func: any,
  args: any[],
  fn: () => any,
): any {
  debugCallSyncBefore(backendName, func, args);
  const res = fn();
  debugCallSyncAfter(res);
  return res;
}

export async function debugMachineCode(
  backendName: string,
  size: number,
  fn: () => Promise<number>,
): Promise<number> {
  debugMachineCodeBefore(backendName, size);
  const res = await fn();
  debugMachineCodeAfter(res);
  return res;
}
export function debugMachineCodeSync(
  backendName: string,
  size: number,
  fn: () => number,
): number {
  debugMachineCodeSyncBefore(backendName, size);
  const res = fn();
  debugMachineCodeSyncAfter(res);
  return res;
}

export async function* debugScan(
  backendName: string,
  address: any,
  size: number,
  pattern: any,
  fn: () => AsyncGenerator<any>,
): AsyncGenerator<any> {
  const patStr = typeof pattern === 'string' ? pattern : pattern.pattern;
  debugScanBefore(backendName, address, size, patStr);
  let count = 0;
  for await (const hit of fn()) {
    count++;
    yield hit;
  }
  debugScanAfter(count);
}
export function* debugScanSync(
  backendName: string,
  address: any,
  size: number,
  pattern: any,
  fn: () => Generator<any>,
): Generator<any> {
  const patStr = typeof pattern === 'string' ? pattern : pattern.pattern;
  debugScanSyncBefore(backendName, address, size, patStr);
  let count = 0;
  for (const hit of fn()) {
    count++;
    yield hit;
  }
  debugScanSyncAfter(count);
}
