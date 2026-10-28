/**
 * @exoproc/njava-runtime - Built-in java.lang.System Definition
 * Provides zero-JNI timestamps and console outputs with native JVM fallback.
 */

import type { JavaClassDefinition } from '../types.js';

export const JavaLangSystemDef: JavaClassDefinition = {
  name: 'java.lang.System',
  aliases: ['System'],
  mode: 'hybrid',
  superclassName: 'java.lang.Object',

  staticMethods: {
    currentTimeMillis: () => Date.now(),
    nanoTime: () => BigInt(Math.floor(performance.now() * 1e6)),
    identityHashCode: (_ctx, obj: any) => {
      if (typeof obj === 'bigint') return Number(obj & 0x7fffffffn);
      return Math.floor(Math.random() * 0x7fffffff);
    },
    gc: (_ctx) => {
      // No-op or native trigger
    },
    exit: (_ctx, code: number) => {
      process.exit(code);
    },
  },

  staticFields: {
    out: {
      println: (...args: any[]) => console.log(...args),
      print: (...args: any[]) => process.stdout.write(args.join(' ')),
    },
    err: {
      println: (...args: any[]) => console.error(...args),
      print: (...args: any[]) => process.stderr.write(args.join(' ')),
    },
  },
};
