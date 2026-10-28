import { expect, test, describe } from 'bun:test';
import {
  NativePointer,
  SyncStruct,
  localMemoryAccessor,
} from '../../packages/xffi/src/index';
import { formatResultDetail } from '../../packages/xffi/src/debug-helper';

describe('xffi > debug helper detailed logging', () => {
  test('should correctly format null and undefined', () => {
    expect(formatResultDetail(null)).toBe('null');
    expect(formatResultDetail(undefined)).toBe('undefined');
  });

  test('should correctly format booleans and strings', () => {
    expect(formatResultDetail(true)).toBe('true');
    expect(formatResultDetail(false)).toBe('false');
    expect(formatResultDetail('test-string')).toBe('"test-string"');
  });

  test('should correctly format buffers with space-separated hex and ascii previews', () => {
    const buf = Buffer.from([0x00, 0x01, 0x41, 0x42, 0x7e, 0xff]);
    const formatted = formatResultDetail(buf);
    expect(formatted).toContain('Buffer(len=6, hex=[00 01 41 42 7e ff]');
    expect(formatted).toContain('ascii="..AB~."');
  });

  test('should correctly format TypedArrays like Uint8Array similar to buffers', () => {
    const arr = new Uint8Array([0x41, 0x42, 0x43]);
    const formatted = formatResultDetail(arr);
    expect(formatted).toContain('Uint8Array(len=3, hex=[41 42 43]');
    expect(formatted).toContain('ascii="ABC"');
  });

  test('should format numbers and bigints with detailed hex, unsigned decimal, and signed decimal (if negative)', () => {
    // Positive number
    expect(formatResultDetail(100)).toBe('0x64 (dec: 100)');
    // Negative number
    expect(formatResultDetail(-1)).toBe(
      '0xffffffffffffffff (dec: 18446744073709551615, signed: -1)',
    );
    // Large BigInt
    expect(formatResultDetail(0x7fffffffffffffffn)).toBe(
      '0x7fffffffffffffff (dec: 9223372036854775807)',
    );
    // Large negative BigInt
    expect(formatResultDetail(-2n)).toBe(
      '0xfffffffffffffffe (dec: 18446744073709551614, signed: -2)',
    );
  });

  test('should format pointers and custom objects using their toString and raw address details', () => {
    const ptr = new NativePointer(0x7ffe1234n);
    const formatted = formatResultDetail(ptr);
    expect(formatted).toBe('0x7FFE1234 (dec: 2147357236)');
  });

  test('should format structs with custom toString and avoid duplicating address info', () => {
    const schema = { x: 'i32', y: 'i32' };
    const address = localMemoryAccessor.allocSync(8);
    localMemoryAccessor.writeInt32Sync(address, 100);
    localMemoryAccessor.writeInt32Sync(address + 4, 200);

    const s = new SyncStruct(schema, address, localMemoryAccessor);
    const formatted = formatResultDetail(s);

    try {
      expect(formatted).toContain('SyncStruct');
      expect(formatted).toContain('x: 100, y: 200');
      // Struct already has "at 0x...", so we shouldn't append " [address: ...]"
      expect(formatted).not.toContain('[address:');
    } finally {
      localMemoryAccessor.freeSync(address);
    }
  });
});
