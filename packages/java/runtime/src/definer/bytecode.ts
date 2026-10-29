import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { compileJavaSync, resolveDefaultJavaPath } from 'exoproc-jjit';
import { getAgentCacheDir } from 'exoproc-utils';
import type { ClassDefineOptions } from './types.js';

export function resolveDefaultClasspath(
  customClasspath?: string | string[],
): string[] {
  const result: string[] = [];
  if (customClasspath) {
    if (Array.isArray(customClasspath)) {
      result.push(...customClasspath);
    } else {
      result.push(customClasspath);
    }
  }

  if (process.env.NJAVA_AGENT_JAR && existsSync(process.env.NJAVA_AGENT_JAR)) {
    result.push(process.env.NJAVA_AGENT_JAR);
  }

  try {
    const cacheDir = getAgentCacheDir();
    if (existsSync(cacheDir)) {
      const preferred = join(cacheDir, 'exoproc-agent-java8.jar');
      if (existsSync(preferred)) {
        result.push(preferred);
      } else {
        const match = readdirSync(cacheDir).find(
          (f) =>
            f.startsWith('exoproc-agent-java') &&
            f.endsWith('.jar') &&
            !f.endsWith('-obf.jar'),
        );
        if (match) {
          result.push(join(cacheDir, match));
        }
      }
    }
  } catch {}

  let curr = process.cwd();
  for (let i = 0; i < 5; i++) {
    const jarPath = join(
      curr,
      'java',
      'njava-agent',
      'target',
      'njava-agent.jar',
    );
    if (existsSync(jarPath)) {
      result.push(jarPath);
      break;
    }
    const classesPath = join(curr, 'java', 'njava-agent', 'target', 'classes');
    if (existsSync(classesPath)) {
      result.push(classesPath);
      break;
    }
    const parent = dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  return result;
}

export function extractClassNameFromSource(source: string): string | undefined {
  const pkgMatch = source.match(/package\s+([\w.]+)\s*;/);
  const pkg = pkgMatch ? pkgMatch[1] : '';

  const classMatch = source.match(
    /(?:public\s+)?(?:final\s+)?(?:abstract\s+)?(?:class|interface|enum)\s+([A-Za-z0-9_$]+)/,
  );
  if (!classMatch) return undefined;

  const simpleName = classMatch[1];
  return pkg ? `${pkg}.${simpleName}` : simpleName;
}

/**
 * Prepares and compiles raw bytecode from various target representations:
 * - Compiled bytecode (`Uint8Array` or `number[]`)
 * - Java source code string (`public class Foo { ... }`)
 * - JavaClassBuilder AST or member builder
 * - GeneratedAdapterResult (`Java.code`)
 */
export function prepareBytecode(
  target: any,
  options: ClassDefineOptions = {},
): { className: string; bytecode: Uint8Array | number[] } {
  let className = options.name;
  let bytecode: Uint8Array | number[];

  // 1. If target is a GeneratedAdapterResult
  if (target && target.__isGeneratedAdapter) {
    className = className || target.className;
    const compileRes = compileJavaSync({
      source: target.source,
      javaPath: resolveDefaultJavaPath(),
      classPath: resolveDefaultClasspath(options.classPath),
    });
    if (!compileRes.success) {
      throw new Error(
        `[defineClass] Failed to compile adapter ${className}:\n${compileRes.errors.join('\n')}`,
      );
    }
    const byteBuf =
      (className ? compileRes.classes.get(className) : undefined) ||
      Array.from(compileRes.classes.values())[0];
    if (!byteBuf) {
      throw new Error(
        `[defineClass] No bytecode found after compiling adapter ${className}`,
      );
    }
    bytecode = byteBuf;
  }
  // 2. If target is a JavaClassBuilder or member builder
  else if (target && typeof target.toSource === 'function') {
    const src = target.toSource();
    const actualClassBuilder = target.classBuilder ?? target;
    const builderName = actualClassBuilder.fqcn || actualClassBuilder.name;
    className = className || builderName;
    const compileRes = compileJavaSync({
      source: src,
      javaPath: resolveDefaultJavaPath(),
      classPath: resolveDefaultClasspath(options.classPath),
    });
    if (!compileRes.success) {
      throw new Error(
        `[defineClass] Failed to compile JavaClassBuilder ${className}:\n${compileRes.errors.join('\n')}`,
      );
    }
    const byteBuf =
      (className ? compileRes.classes.get(className) : undefined) ||
      Array.from(compileRes.classes.values())[0];
    bytecode = byteBuf!;
  }
  // 3. If target is a Java source code string
  else if (
    typeof target === 'string' &&
    (target.includes('class ') ||
      target.includes('interface ') ||
      target.includes('enum '))
  ) {
    const inferred = extractClassNameFromSource(target);
    className = className || inferred;
    if (!className) {
      throw new Error(
        `[defineClass] Could not infer class name from source code. Specify options.name.`,
      );
    }
    const compileRes = compileJavaSync({
      source: target,
      javaPath: resolveDefaultJavaPath(),
      classPath: resolveDefaultClasspath(options.classPath),
    });
    if (!compileRes.success) {
      throw new Error(
        `[defineClass] Failed to compile source for ${className}:\n${compileRes.errors.join('\n')}`,
      );
    }
    const byteBuf =
      compileRes.classes.get(className) ||
      Array.from(compileRes.classes.values())[0];
    bytecode = byteBuf!;
  }
  // 4. Raw bytecode (Uint8Array, Buffer, or number[])
  else if (target instanceof Uint8Array || Array.isArray(target)) {
    className =
      className || 'DynamicClass_' + Math.random().toString(36).substring(2, 9);
    bytecode = target;
  } else {
    throw new Error(
      `[defineClass] Unsupported target argument for defineClass: ${typeof target}`,
    );
  }

  if (!className) {
    throw new Error(`[defineClass] Could not determine class name.`);
  }

  return { className, bytecode };
}
