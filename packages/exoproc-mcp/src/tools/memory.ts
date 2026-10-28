import { MemoryProtection } from 'bun-xffi';
import { resolveAccessor } from './session.js';

export async function readMemory(options: {
  session: string;
  address: string | number | bigint;
  size: number;
}): Promise<{
  address: string;
  size: number;
  hex: string;
  ascii: string;
  uint32?: number;
  uint64?: string;
}> {
  const addr = BigInt(options.address);
  const acc = await resolveAccessor(options.session);
  const buf = await acc.read(addr, options.size);

  let u32: number | undefined;
  let u64: string | undefined;

  if (buf.length >= 4) {
    u32 = buf.readUInt32LE(0);
  }
  if (buf.length >= 8) {
    u64 = `0x${buf.readBigUInt64LE(0).toString(16)}`;
  }

  const ascii = Array.from(buf)
    .map((b: number) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
    .join('');

  return {
    address: `0x${addr.toString(16)}`,
    size: buf.length,
    hex: buf.toString('hex'),
    ascii,
    uint32: u32,
    uint64: u64,
  };
}

export async function writeMemory(options: {
  session: string;
  address: string | number | bigint;
  hex: string;
}): Promise<{ success: boolean; address: string; bytesWritten: number }> {
  const addr = BigInt(options.address);
  const cleanHex = options.hex.replace(/[^0-9a-fA-F]/g, '');
  const buf = Buffer.from(cleanHex, 'hex');
  const acc = await resolveAccessor(options.session);
  await acc.write(addr, buf);

  return {
    success: true,
    address: `0x${addr.toString(16)}`,
    bytesWritten: buf.length,
  };
}

export async function scanPattern(options: {
  session: string;
  pattern: string;
  address?: string | number | bigint;
  size?: number;
}): Promise<{ pattern: string; matches: string[] }> {
  const acc = await resolveAccessor(options.session);
  const base =
    options.address !== undefined ? BigInt(options.address) : 0x10000n;
  const size = options.size ?? 0x1000000;
  const matches: string[] = [];

  for await (const m of acc.scan(base, size, options.pattern)) {
    matches.push(`0x${BigInt(m.address).toString(16)}`);
    if (matches.length >= 100) break;
  }

  return {
    pattern: options.pattern,
    matches,
  };
}

export async function allocateMemory(options: {
  session: string;
  size: number;
  protect?: number;
}): Promise<{ address: string; size: number }> {
  const acc = await resolveAccessor(options.session);
  const prot = options.protect ?? MemoryProtection.EXECUTE_READWRITE;
  const addr = await acc.alloc(options.size, null, prot);

  return {
    address: `0x${BigInt(addr!.toString()).toString(16)}`,
    size: options.size,
  };
}
