import { describe, expect, it } from 'bun:test';
import {
  WCHAR,
  CHAR,
  STRING,
  StringBuffer,
  CStringBuffer,
  CScalarBuffer,
  DWORD,
  INT,
  UINT,
  BOOL,
  SHORT,
  USHORT,
  BYTE,
  INT64,
  UINT64,
  createScope,
} from '../../packages/xffi/src/index.js';

describe('CBuffer and C-style Type Helpers', () => {
  describe('Buffer.prototype.text augmentation', () => {
    it('automatically extracts UTF-16LE text with null-trimming', () => {
      const buf = Buffer.alloc(32);
      buf.write('Hello Notepad', 0, 'utf16le');
      expect(buf.text).toBe('Hello Notepad');
    });

    it('automatically extracts UTF-8 text with null-trimming', () => {
      const buf = Buffer.alloc(32);
      buf.write('Hello ASCII', 0, 'utf8');
      expect(buf.text).toBe('Hello ASCII');
    });

    it('allows setting text directly onto Buffer', () => {
      const buf = Buffer.alloc(32);
      buf.text = 'New Text';
      expect(buf.text).toBe('New Text');
    });
  });

  describe('WCHAR & CStringBuffer (Wide Strings)', () => {
    it('creates wide buffer with character capacity', () => {
      const buf = WCHAR(256);
      expect(buf.capacity).toBe(256);
      expect(buf.byteLength).toBe(512);
      expect(buf.isWide).toBe(true);
      expect(buf.text).toBe('');
    });

    it('supports new WCHAR(256)', () => {
      const buf = new WCHAR(128);
      expect(buf.capacity).toBe(128);
      expect(buf.byteLength).toBe(256);
    });

    it('supports array index syntax WCHAR[256]', () => {
      const buf = WCHAR[64];
      expect(buf.capacity).toBe(64);
      expect(buf.byteLength).toBe(128);
    });

    it('supports initializing with string', () => {
      const buf = WCHAR('woldan');
      expect(buf.text).toBe('woldan');
      expect(buf.toString()).toBe('woldan');
      expect(buf.valueOf()).toBe('woldan');
      expect(JSON.stringify({ str: buf })).toBe(
        JSON.stringify({ str: 'woldan' }),
      );
      expect(buf[0]).toBe('w');
      expect(buf[1]).toBe('o');
      expect(buf[5]).toBe('n');
    });

    it('updates text via setter', () => {
      const buf = WCHAR(256);
      buf.text = 'updated';
      expect(buf.text).toBe('updated');
      expect(buf.toString()).toBe('updated');
    });
  });

  describe('CHAR (ANSI Strings)', () => {
    it('creates ANSI buffer with 1 byte per char', () => {
      const buf = CHAR(100);
      expect(buf.capacity).toBe(100);
      expect(buf.byteLength).toBe(100);
      expect(buf.isWide).toBe(false);
    });

    it('supports CHAR[100] and string init', () => {
      const buf = CHAR('hello ansi');
      expect(buf.text).toBe('hello ansi');
      expect(buf.isWide).toBe(false);
      expect(buf.byteLength).toBe(11); // 'hello ansi\0'
    });
  });

  describe('STRING and StringBuffer', () => {
    it('creates wide buffer by default', () => {
      const buf = STRING(256);
      expect(buf.isWide).toBe(true);
      expect(buf.capacity).toBe(256);
      expect(buf.byteLength).toBe(512);
    });

    it('StringBuffer is an alias to STRING', () => {
      const buf = new StringBuffer(128);
      expect(buf.isWide).toBe(true);
      expect(buf.capacity).toBe(128);
    });
  });

  describe('Scalar Out-Parameters (DWORD, INT, BOOL, etc.)', () => {
    it('creates out-parameter buffer when called without args', () => {
      const dw = DWORD();
      expect(dw).toBeInstanceOf(CScalarBuffer);
      expect(dw.byteLength).toBe(4);
      expect(dw.value).toBe(0);

      dw.value = 12345;
      expect(dw.value).toBe(12345);
      expect(dw.toString()).toBe('12345');
      expect(Number(dw)).toBe(12345);
      expect(+dw).toBe(12345);
    });

    it('supports new DWORD() and new DWORD(val)', () => {
      const dw = new DWORD(42);
      expect(dw).toBeInstanceOf(CScalarBuffer);
      expect(dw.value).toBe(42);
    });

    it('acts as type cast when called with an argument', () => {
      const cast = DWORD(0x1000);
      expect(typeof cast).toBe('number');
      expect(cast).toBe(4096);
    });

    it('supports INT, UINT, BOOL, BYTE, INT64', () => {
      const i = INT();
      expect(i.byteLength).toBe(4);
      i.value = -50;
      expect(i.value).toBe(-50);

      const b = BOOL();
      expect(b.byteLength).toBe(4);
      b.value = true;
      expect(b.value).toBe(1);

      const u64 = UINT64();
      expect(u64.byteLength).toBe(8);
      u64.value = 0xffffffffffffn;
      expect(u64.value).toBe(0xffffffffffffn);
    });
  });

  describe('createScope integration', () => {
    it('exposes all helpers globally in scope', () => {
      const dummyAccessor: any = {};
      const scope = createScope(dummyAccessor);

      expect(typeof scope.WCHAR).toBe('function');
      expect(typeof scope.CHAR).toBe('function');
      expect(typeof scope.STRING).toBe('function');
      expect(typeof scope.DWORD).toBe('function');
      expect(typeof scope.INT).toBe('function');

      const buf = scope.WCHAR(256);
      expect(buf.capacity).toBe(256);
      expect(buf.isWide).toBe(true);

      const pVal = scope.DWORD();
      expect(pVal.byteLength).toBe(4);
    });
  });
});
