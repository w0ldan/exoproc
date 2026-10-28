import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  compileJava,
  compileJavaSync,
  extractClassInfo,
  parseJavaVersion,
  resolveEcjJarPath,
} from '../../packages/java/njava/src/compiler.js';
import { getTestJavaPath } from './java-test-helpers.js';

describe('njava compiler', () => {
  it('parses java version strings correctly', () => {
    expect(parseJavaVersion('1.8.0_292')).toBe(8);
    expect(parseJavaVersion('openjdk version "1.8.0_462"')).toBe(8);
    expect(parseJavaVersion('java version "17.0.9"')).toBe(17);
    expect(parseJavaVersion('openjdk 21.0.3 2024-04-16')).toBe(21);
    expect(parseJavaVersion('25-ea')).toBe(25);
  });

  it('extracts class and package info from source code', () => {
    const code = `
      package org.exoproc.injected;
      import java.util.List;

      public class JumpHook implements Runnable {
          public void run() {
              System.out.println("jump");
          }
      }
    `;
    const info = extractClassInfo(code);
    expect(info.packageName).toBe('org.exoproc.injected');
    expect(info.className).toBe('JumpHook');
    expect(info.fqcn).toBe('org.exoproc.injected.JumpHook');
  });

  it('resolves correct ecj jar paths', () => {
    const jar8 = resolveEcjJarPath(8);
    expect(jar8.endsWith('ecj-3.26.0.jar')).toBe(true);
    expect(existsSync(jar8)).toBe(true);

    const jar17 = resolveEcjJarPath(17);
    expect(jar17.endsWith('ecj-3.46.100.jar')).toBe(true);
    expect(existsSync(jar17)).toBe(true);
  });

  it('fails if javaPath is not provided (njava does not guess java paths)', async () => {
    const source = `public class Test {}`;
    expect(compileJava({ source })).rejects.toThrow(
      'javaPath is required for compileJava',
    );
  });

  it('compiles a Java 8 class and produces valid bytecode using test helper javaPath', async () => {
    const javaPath = getTestJavaPath(8);

    const source = `
      package org.exoproc.test;

      public class SimpleTask implements Runnable {
          private final int count;

          public SimpleTask(int count) {
              this.count = count;
          }

          @Override
          public void run() {
              System.out.println("Count: " + this.count);
          }
      }
    `;

    const result = await compileJava({
      source,
      javaPath,
      javaVersion: 8,
      targetVersion: '-1.8',
    });

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.mainClass).toBe('org.exoproc.test.SimpleTask');
    expect(result.classes.has('org.exoproc.test.SimpleTask')).toBe(true);

    const bytecode = result.classes.get('org.exoproc.test.SimpleTask')!;
    expect(bytecode.length).toBeGreaterThan(100);

    // Verify Java bytecode magic number: 0xCAFEBABE
    expect(bytecode[0]).toBe(0xca);
    expect(bytecode[1]).toBe(0xfe);
    expect(bytecode[2]).toBe(0xba);
    expect(bytecode[3]).toBe(0xbe);

    // Verify Java 8 major version: 52 (0x0034)
    const majorVersion = (bytecode[6] << 8) | bytecode[7];
    expect(majorVersion).toBe(52);
  });

  it('compiles with inner classes and collects all generated class files', async () => {
    const javaPath = getTestJavaPath(8);

    const source = `
      package org.exoproc.test;

      public class OuterClass {
          public static class InnerStatic {
              public String greet() {
                  return "hello";
              }
          }

          public Runnable createAnon() {
              return new Runnable() {
                  public void run() {}
              };
          }
      }
    `;

    const result = await compileJava({
      source,
      javaPath,
      javaVersion: 8,
    });

    expect(result.success).toBe(true);
    expect(result.classes.has('org.exoproc.test.OuterClass')).toBe(true);
    expect(result.classes.has('org.exoproc.test.OuterClass$InnerStatic')).toBe(
      true,
    );
    expect(result.classes.has('org.exoproc.test.OuterClass$1')).toBe(true);
  });

  it('handles compilation errors gracefully', async () => {
    const javaPath = getTestJavaPath(8);

    const brokenSource = `
      package org.exoproc.test;

      public class BrokenClass {
          this is totally invalid java code!
      }
    `;

    const result = await compileJava({
      source: brokenSource,
      javaPath,
      javaVersion: 8,
    });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.classes.size).toBe(0);
  });

  it('compiles with Java 17 when available', async () => {
    const java17Path = getTestJavaPath(17);
    if (!existsSync(java17Path)) {
      return;
    }

    const source = `
      package org.exoproc.test;

      public class ModernClass {
          public static String format(Object obj) {
              return "Value: " + String.valueOf(obj);
          }
      }
    `;

    const result = await compileJava({
      source,
      javaPath: java17Path,
      javaVersion: 17,
      targetVersion: '-17',
    });

    expect(result.success).toBe(true);
    expect(result.classes.has('org.exoproc.test.ModernClass')).toBe(true);

    const bytecode = result.classes.get('org.exoproc.test.ModernClass')!;
    // Verify Java 17 major version: 61 (0x003D)
    const majorVersion = (bytecode[6] << 8) | bytecode[7];
    expect(majorVersion).toBe(61);
  });

  it('compiles directly to specified outputDir without reading bytecode unless requested', async () => {
    const javaPath = getTestJavaPath(8);
    const customOut = join(import.meta.dir, 'tmp_out_' + Date.now());

    const source = `
      package com.custom.out;
      public class OutTest {
        public static int getNumber() { return 777; }
      }
    `;

    const result = await compileJava({
      source,
      javaPath,
      outputDir: customOut,
    });

    expect(result.success).toBe(true);
    expect(result.outputDir).toBe(resolve(customOut));
    expect(
      existsSync(join(customOut, 'com', 'custom', 'out', 'OutTest.class')),
    ).toBe(true);

    // Explicit bytecode read
    const bc = await result.readBytecode('com.custom.out.OutTest');
    expect(bc).toBeDefined();
    expect(bc![0]).toBe(0xca);
    expect(bc![1]).toBe(0xfe);

    // Explicit readClasses
    const all = await result.readClasses();
    expect(all.has('com.custom.out.OutTest')).toBe(true);

    // Cleanup
    await rm(customOut, { recursive: true, force: true });
  });

  it('compiles synchronously using compileJavaSync', () => {
    const javaPath = getTestJavaPath(8);
    const source = `
      public class SyncCompiled {
        public static String hello() { return "world"; }
      }
    `;

    const result = compileJavaSync({
      source,
      javaPath,
    });

    expect(result.success).toBe(true);
    expect(result.mainClass).toBe('SyncCompiled');
    expect(result.classes.has('SyncCompiled')).toBe(true);
    const bc = result.classes.get('SyncCompiled')!;
    expect(bc[0]).toBe(0xca);
    expect(bc[1]).toBe(0xfe);
  });
});
