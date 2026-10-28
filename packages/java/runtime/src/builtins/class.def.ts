/**
 * @exoproc/njava-runtime - Built-in java.lang.Class Definition
 * Implements java.lang.Class in hybrid mode: metadata answered in-memory with zero JNI,
 * with automatic fallback to live JVM for native reflection or bytecode ops.
 */

import type { JavaClassDefinition } from '../types.js';
import type { RuntimeClass } from '../class-model.js';

export const JavaLangClassDef: JavaClassDefinition<RuntimeClass> = {
  name: 'java.lang.Class',
  aliases: ['Class'],
  mode: 'hybrid',
  superclassName: 'java.lang.Object',

  staticMethods: {
    forName: (ctx, className: string) => {
      return ctx.getClass(className);
    },
  },

  instanceMethods: {
    getName: (target) => target.getName(),
    getCanonicalName: (target) => target.getCanonicalName(),
    getSimpleName: (target) => target.getSimpleName(),
    getTypeName: (target) => target.getTypeName(),
    getSuperclass: (target) => target.getSuperclass(),
    getMethods: (target) => target.getMethods(),
    getDeclaredMethods: (target) => target.getDeclaredMethods(),
    getMethod: (target, _ctx, name: string, ...paramTypes: string[]) =>
      target.getMethod(name, paramTypes),
    getDeclaredMethod: (target, _ctx, name: string, ...paramTypes: string[]) =>
      target.getDeclaredMethod(name, paramTypes),
    getFields: (target) => target.getFields(),
    getDeclaredFields: (target) => target.getDeclaredFields(),
    getField: (target, _ctx, name: string) => target.getField(name),
    getDeclaredField: (target, _ctx, name: string) =>
      target.getDeclaredField(name),
    isInterface: (target) => target.isInterface(),
    isArray: (target) => target.isArray(),
    isPrimitive: (target) => target.isPrimitive(),
    isEnum: (target) => target.isEnum(),
    toString: (target: RuntimeClass) => target.toString(),
  },
};
