import { expect, test, describe } from 'bun:test';
import { parseAccessibleObjectString } from 'bun-njava/reflection-parser';

describe('njava > parseAccessibleObjectString', () => {
  describe('methods', () => {
    test('parses Class.forName with throws clause', () => {
      const parsed = parseAccessibleObjectString(
        'public static java.lang.Class java.lang.Class.forName(java.lang.String) throws java.lang.ClassNotFoundException',
      );
      expect(parsed.kind).toBe('method');
      expect(parsed.modifiers).toEqual(new Set(['public', 'static']));
      expect(parsed.type).toBe('java.lang.Class');
      expect(parsed.declaringClass).toBe('java.lang.Class');
      expect(parsed.name).toBe('forName');
      expect(parsed.paramTypes).toEqual(['java.lang.String']);
      expect(parsed.exceptionTypes).toEqual([
        'java.lang.ClassNotFoundException',
      ]);
    });

    test('parses Object.hashCode with native modifier and 0 params', () => {
      const parsed = parseAccessibleObjectString(
        'public native int java.lang.Object.hashCode()',
      );
      expect(parsed.kind).toBe('method');
      expect(parsed.modifiers).toEqual(new Set(['public', 'native']));
      expect(parsed.type).toBe('int');
      expect(parsed.declaringClass).toBe('java.lang.Object');
      expect(parsed.name).toBe('hashCode');
      expect(parsed.paramTypes).toEqual([]);
      expect(parsed.exceptionTypes).toEqual([]);
    });

    test('parses String.concat', () => {
      const parsed = parseAccessibleObjectString(
        'public java.lang.String java.lang.String.concat(java.lang.String)',
      );
      expect(parsed.kind).toBe('method');
      expect(parsed.modifiers).toEqual(new Set(['public']));
      expect(parsed.type).toBe('java.lang.String');
      expect(parsed.declaringClass).toBe('java.lang.String');
      expect(parsed.name).toBe('concat');
      expect(parsed.paramTypes).toEqual(['java.lang.String']);
      expect(parsed.exceptionTypes).toEqual([]);
    });

    test('parses default interface method', () => {
      const parsed = parseAccessibleObjectString(
        'public default void java.lang.Iterable.forEach(java.util.function.Consumer)',
      );
      expect(parsed.kind).toBe('method');
      expect(parsed.modifiers).toEqual(new Set(['public', 'default']));
      expect(parsed.type).toBe('void');
      expect(parsed.declaringClass).toBe('java.lang.Iterable');
      expect(parsed.name).toBe('forEach');
      expect(parsed.paramTypes).toEqual(['java.util.function.Consumer']);
    });

    test('parses method returning array with multiple parameters and multiple throws', () => {
      const parsed = parseAccessibleObjectString(
        'public synchronized byte[] com.example.MyService.processData(byte[],int,boolean) throws java.io.IOException,java.lang.RuntimeException',
      );
      expect(parsed.kind).toBe('method');
      expect(parsed.modifiers).toEqual(new Set(['public', 'synchronized']));
      expect(parsed.type).toBe('byte[]');
      expect(parsed.declaringClass).toBe('com.example.MyService');
      expect(parsed.name).toBe('processData');
      expect(parsed.paramTypes).toEqual(['byte[]', 'int', 'boolean']);
      expect(parsed.exceptionTypes).toEqual([
        'java.io.IOException',
        'java.lang.RuntimeException',
      ]);
    });

    test('parses package-private method without modifiers', () => {
      const parsed = parseAccessibleObjectString('void com.example.Foo.bar()');
      expect(parsed.kind).toBe('method');
      expect(parsed.modifiers).toEqual(new Set());
      expect(parsed.type).toBe('void');
      expect(parsed.declaringClass).toBe('com.example.Foo');
      expect(parsed.name).toBe('bar');
      expect(parsed.paramTypes).toEqual([]);
    });

    test('parses static add method on unqualified class Idle', () => {
      const parsed = parseAccessibleObjectString(
        'public static int Idle.add(int,int)',
      );
      expect(parsed.kind).toBe('method');
      expect(parsed.modifiers).toEqual(new Set(['public', 'static']));
      expect(parsed.type).toBe('int');
      expect(parsed.declaringClass).toBe('Idle');
      expect(parsed.name).toBe('add');
      expect(parsed.paramTypes).toEqual(['int', 'int']);
    });
  });

  describe('constructors', () => {
    test('parses String constructor with primitive and array args', () => {
      const parsed = parseAccessibleObjectString(
        'public java.lang.String(byte[],int,int)',
      );
      expect(parsed.kind).toBe('constructor');
      expect(parsed.modifiers).toEqual(new Set(['public']));
      expect(parsed.type).toBeNull();
      expect(parsed.declaringClass).toBe('java.lang.String');
      expect(parsed.name).toBeNull();
      expect(parsed.paramTypes).toEqual(['byte[]', 'int', 'int']);
      expect(parsed.exceptionTypes).toEqual([]);
    });

    test('parses Integer(String) constructor with throws', () => {
      const parsed = parseAccessibleObjectString(
        'public java.lang.Integer(java.lang.String) throws java.lang.NumberFormatException',
      );
      expect(parsed.kind).toBe('constructor');
      expect(parsed.modifiers).toEqual(new Set(['public']));
      expect(parsed.type).toBeNull();
      expect(parsed.declaringClass).toBe('java.lang.Integer');
      expect(parsed.name).toBeNull();
      expect(parsed.paramTypes).toEqual(['java.lang.String']);
      expect(parsed.exceptionTypes).toEqual([
        'java.lang.NumberFormatException',
      ]);
    });

    test('parses default Object constructor without modifiers', () => {
      const parsed = parseAccessibleObjectString('java.lang.Object()');
      expect(parsed.kind).toBe('constructor');
      expect(parsed.modifiers).toEqual(new Set());
      expect(parsed.type).toBeNull();
      expect(parsed.declaringClass).toBe('java.lang.Object');
      expect(parsed.name).toBeNull();
      expect(parsed.paramTypes).toEqual([]);
      expect(parsed.exceptionTypes).toEqual([]);
    });

    test('parses Idle constructor', () => {
      const parsed = parseAccessibleObjectString('public Idle()');
      expect(parsed.kind).toBe('constructor');
      expect(parsed.modifiers).toEqual(new Set(['public']));
      expect(parsed.type).toBeNull();
      expect(parsed.declaringClass).toBe('Idle');
      expect(parsed.name).toBeNull();
      expect(parsed.paramTypes).toEqual([]);
    });
  });

  describe('fields', () => {
    test('parses static final field', () => {
      const parsed = parseAccessibleObjectString(
        'public static final int java.lang.Integer.MAX_VALUE',
      );
      expect(parsed.kind).toBe('field');
      expect(parsed.modifiers).toEqual(new Set(['public', 'static', 'final']));
      expect(parsed.type).toBe('int');
      expect(parsed.declaringClass).toBe('java.lang.Integer');
      expect(parsed.name).toBe('MAX_VALUE');
      expect(parsed.paramTypes).toEqual([]);
      expect(parsed.exceptionTypes).toEqual([]);
    });

    test('parses private field on Throwable', () => {
      const parsed = parseAccessibleObjectString(
        'private java.lang.String java.lang.Throwable.detailMessage',
      );
      expect(parsed.kind).toBe('field');
      expect(parsed.modifiers).toEqual(new Set(['private']));
      expect(parsed.type).toBe('java.lang.String');
      expect(parsed.declaringClass).toBe('java.lang.Throwable');
      expect(parsed.name).toBe('detailMessage');
    });

    test('parses field on unqualified class', () => {
      const parsed = parseAccessibleObjectString(
        'public static int Idle.intValue',
      );
      expect(parsed.kind).toBe('field');
      expect(parsed.modifiers).toEqual(new Set(['public', 'static']));
      expect(parsed.type).toBe('int');
      expect(parsed.declaringClass).toBe('Idle');
      expect(parsed.name).toBe('intValue');
    });

    test('parses array field', () => {
      const parsed = parseAccessibleObjectString(
        'public static byte[] com.example.Foo.buffer',
      );
      expect(parsed.kind).toBe('field');
      expect(parsed.modifiers).toEqual(new Set(['public', 'static']));
      expect(parsed.type).toBe('byte[]');
      expect(parsed.declaringClass).toBe('com.example.Foo');
      expect(parsed.name).toBe('buffer');
    });
  });
});
