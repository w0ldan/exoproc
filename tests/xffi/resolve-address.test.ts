import { expect, test, describe } from 'bun:test';
import { resolveAddress } from '../../packages/xffi/src/ffi';

describe('resolveAddress', () => {
  test('handles null and undefined', () => {
    expect(resolveAddress(null)).toBe(0);
    expect(resolveAddress(undefined)).toBe(0);
  });

  test('handles object with address property', () => {
    expect(resolveAddress({ address: 123 })).toBe(123);
    expect(resolveAddress({ address: 0x12345678n })).toBe(0x12345678);
  });

  test('handles bigint', () => {
    expect(resolveAddress(123n)).toBe(123);
    expect(resolveAddress(-1n)).toBe(-1);
    // 0xFFFFFFFFFFFFFFFF as bigint
    expect(resolveAddress(18446744073709551615n)).toBe(-1);
    // 0xFFFFFFFFFFFFFFFE as bigint
    expect(resolveAddress(18446744073709551614n)).toBe(-2);
    // 0xFFFFFFFFFFFFFFFD as bigint
    expect(resolveAddress(18446744073709551613n)).toBe(-3);
  });

  test('handles number', () => {
    expect(resolveAddress(123)).toBe(123);
    expect(resolveAddress(-1)).toBe(-1);
    expect(resolveAddress(-2)).toBe(-2);
    // The problematic part:
    // eslint-disable-next-line @typescript-eslint/no-loss-of-precision
    expect(resolveAddress(18446744073709551615)).toBe(-1);
  });
});
