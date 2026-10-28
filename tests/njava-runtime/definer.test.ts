import { describe, expect, it } from 'bun:test';
import {
  createRuntimeContext,
  defaultClassDefinerRegistry,
  ClassLoader,
  UnsafeClassLoader,
  AgentClassLoader,
  AutoClassLoader,
  type IClassDefinerStrategy,
  type ClassDefineContext,
} from '../../packages/java/runtime/src/index.js';
import { JavaClassBuilder } from 'exoproc-jjit';

describe('njava-runtime: Modular Class Definer', () => {
  it('registers all standard strategies in registry', () => {
    expect(defaultClassDefinerRegistry.has('classLoader')).toBe(true);
    expect(defaultClassDefinerRegistry.has('unsafe')).toBe(true);
    expect(defaultClassDefinerRegistry.has('agent')).toBe(true);
    expect(defaultClassDefinerRegistry.has('auto')).toBe(true);
  });

  it('allows registering custom strategies', () => {
    class CustomDefiner implements IClassDefinerStrategy {
      public readonly name = 'custom' as any;
      public isAvailable() {
        return true;
      }
      public define(ctx: ClassDefineContext) {
        return { defined: true, name: ctx.className };
      }
    }

    defaultClassDefinerRegistry.register(new CustomDefiner());
    expect(defaultClassDefinerRegistry.has('custom')).toBe(true);

    const runtime = createRuntimeContext();
    const res = runtime.defineClass([0xca, 0xfe, 0xba, 0xbe], {
      name: 'CustomTest',
      strategy: 'custom' as any,
    });

    expect(res).toEqual({ defined: true, name: 'CustomTest' });
  });

  it('Strategy 1 (classLoader): executes direct ClassLoader.defineClass reflection ("en açık olan")', () => {
    let capturedArgs: any = null;
    const mockLoader = {
      defineClass: (
        name: string,
        bytes: number[],
        off: number,
        len: number,
      ) => {
        capturedArgs = { name, bytes, off, len };
        return { $ptr: 12345n };
      },
    };

    const mockBridge = {
      getClassSync: () => ({ classObj: 1n, name: 'Dummy' }) as any,
      getClass: async () => ({ classObj: 1n, name: 'Dummy' }) as any,
    };

    const runtime = createRuntimeContext({ bridge: mockBridge as any });
    const fakeBytecode = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);

    runtime.defineClass(fakeBytecode, {
      name: 'org.example.MyExplicitClass',
      classLoader: mockLoader,
      strategy: 'classLoader',
    });

    expect(capturedArgs).toBeDefined();
    expect(capturedArgs.name).toBe('org.example.MyExplicitClass');
    expect(capturedArgs.bytes).toEqual([0xca, 0xfe, 0xba, 0xbe]);
    expect(capturedArgs.off).toBe(0);
    expect(capturedArgs.len).toBe(4);
  });

  it('Strategy 2 (unsafe): executes sun.misc.Unsafe.defineClass reflection', () => {
    let unsafeArgs: any = null;
    const mockLoader = { $ptr: 999n };

    const mockUnsafeInstance = {
      defineClass: (
        name: string,
        b: number[],
        off: number,
        len: number,
        cl: any,
        pd: any,
      ) => {
        unsafeArgs = { name, b, off, len, cl, pd };
        return { $ptr: 555n };
      },
    };

    const mockBridge = {
      getClassSync: (name: string) => ({ classObj: 2n, name }) as any,
      getClass: async () => ({}) as any,
    };

    const runtime = createRuntimeContext({ bridge: mockBridge as any });
    runtime.registerClass({
      name: 'sun.misc.Unsafe',
      mode: 'hybrid',
      staticFields: {
        theUnsafe: mockUnsafeInstance,
      },
    });

    const fakeBytecode = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);

    runtime.defineClass(fakeBytecode, {
      name: 'org.example.UnsafeClass',
      classLoader: mockLoader,
      strategy: 'unsafe',
    });

    expect(unsafeArgs).toBeDefined();
    expect(unsafeArgs.name).toBe('org.example.UnsafeClass');
    expect(unsafeArgs.b).toEqual([0xca, 0xfe, 0xba, 0xbe]);
    expect(unsafeArgs.off).toBe(0);
    expect(unsafeArgs.len).toBe(4);
    expect(unsafeArgs.cl).toBe(mockLoader);
  });

  it('Strategy 3 (agent): executes Exoproc.defineClass helper reflection', () => {
    let exoprocArgs: any = null;

    const mockBridge = {
      getClassSync: (name: string) => ({ classObj: 888n, name }) as any,
      getClass: async () => ({}) as any,
    };

    const runtime = createRuntimeContext({ bridge: mockBridge as any });
    runtime.registerClass({
      name: 'org.exoproc.njava.agent.utils.Exoproc',
      mode: 'hybrid',
      staticMethods: {
        defineClass: (
          _ctx: any,
          name: string,
          bytes: number[],
          loader: any,
        ) => {
          exoprocArgs = { name, bytes, loader };
          return { $ptr: 777n };
        },
      },
    });

    const fakeBytecode = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);

    runtime.defineClass(fakeBytecode, {
      name: 'org.example.AgentHelperClass',
      strategy: 'agent',
    });

    expect(exoprocArgs).toBeDefined();
    expect(exoprocArgs.name).toBe('org.example.AgentHelperClass');
    expect(exoprocArgs.bytes).toEqual([0xca, 0xfe, 0xba, 0xbe]);
  });

  it('compiles Java source code in-memory and defines it', () => {
    let compiledBytecodeReceived: number[] | null = null;
    let classNameReceived: string | null = null;

    const mockLoader = {
      defineClass: (
        name: string,
        bytes: number[],
        _off: number,
        _len: number,
      ) => {
        classNameReceived = name;
        compiledBytecodeReceived = bytes;
        return { $ptr: 111n };
      },
    };

    const runtime = createRuntimeContext({
      bridge: {
        getClassSync: () => ({ classObj: 1n, name: 'Dummy' }) as any,
        getClass: async () => ({ classObj: 1n, name: 'Dummy' }) as any,
      } as any,
    });

    const javaSource = `
      package org.exoproc.sample;
      public class LiveMath {
          public static int add(int a, int b) {
              return a + b;
          }
      }
    `;

    runtime.defineClass(javaSource, {
      classLoader: mockLoader,
      strategy: 'classLoader',
    });

    expect(classNameReceived as any).toBe('org.exoproc.sample.LiveMath');
    expect(compiledBytecodeReceived).toBeDefined();
    expect(Array.isArray(compiledBytecodeReceived)).toBe(true);
    // Check Java magic number 0xCAFEBABE
    expect(compiledBytecodeReceived![0]).toBe(0xca);
    expect(compiledBytecodeReceived![1]).toBe(0xfe);
    expect(compiledBytecodeReceived![2]).toBe(0xba);
    expect(compiledBytecodeReceived![3]).toBe(0xbe);
  });

  it('compiles JavaClassBuilder and defines it', () => {
    let classNameReceived: string | null = null;
    let bytecodeMagic: number[] = [];

    const mockLoader = {
      defineClass: (name: string, bytes: number[]) => {
        classNameReceived = name;
        bytecodeMagic = bytes.slice(0, 4);
        return { $ptr: 222n };
      },
    };

    const runtime = createRuntimeContext({
      bridge: {
        getClassSync: () => ({ classObj: 1n, name: 'Dummy' }) as any,
        getClass: async () => ({ classObj: 1n, name: 'Dummy' }) as any,
      } as any,
    });

    const builder = new JavaClassBuilder('DynamicRunnable')
      .public()
      .implements('Runnable')
      .method('run')
      .annotation('@Override')
      .public()
      .void()
      .body('System.out.println("Hello");');

    runtime.defineClass(builder, {
      classLoader: mockLoader,
      strategy: 'classLoader',
    });

    expect(classNameReceived as any).toBe('DynamicRunnable');
    expect(bytecodeMagic).toEqual([0xca, 0xfe, 0xba, 0xbe]);
  });

  it('compiles GeneratedAdapterResult from Java.code/ScriptFunction and defines it', () => {
    let classNameReceived: string | null = null;
    let bytecodeLength = 0;

    const mockLoader = {
      defineClass: (
        name: string,
        bytes: number[],
        _off: number,
        len: number,
      ) => {
        classNameReceived = name;
        bytecodeLength = len;
        return { $ptr: 333n };
      },
    };

    const runtime = createRuntimeContext({
      bridge: {
        getClassSync: () => ({ classObj: 1n, name: 'Dummy' }) as any,
        getClass: async () => ({ classObj: 1n, name: 'Dummy' }) as any,
      } as any,
    });

    const fakeAdapter = {
      __isGeneratedAdapter: true,
      className: 'GeneratedRunnableAdapter_1',
      targetType: 'java.lang.Runnable',
      source: `
        public class GeneratedRunnableAdapter_1 implements Runnable {
            @Override
            public void run() {
                System.out.println("Adapted callback executed");
            }
        }
      `,
    };

    runtime.defineClass(fakeAdapter, {
      classLoader: mockLoader,
      strategy: 'classLoader',
    });

    expect(classNameReceived as any).toBe('GeneratedRunnableAdapter_1');
    expect(bytecodeLength).toBeGreaterThan(0);
  });

  describe('ClassLoader JS Object Architecture', () => {
    it('defines class directly via loader.defineClass(target)', () => {
      let capturedArgs: any = null;
      const mockTargetLoader = {
        defineClass: (
          name: string,
          bytes: number[],
          off: number,
          len: number,
        ) => {
          capturedArgs = { name, bytes, off, len };
          return { $ptr: 777n };
        },
      };

      const runtime = createRuntimeContext({
        bridge: {
          getClassSync: () => ({ classObj: 1n, name: 'Dummy' }) as any,
          getClass: async () => ({ classObj: 1n, name: 'Dummy' }) as any,
        } as any,
      });

      // User creates an explicit ClassLoader JS object initialized with the target loader
      const loader = new ClassLoader(runtime, mockTargetLoader);

      const res = loader.defineClass(`
        package org.example.loader;
        public class DirectLoaderClass {
            public static int getCode() { return 100; }
        }
      `);

      expect(capturedArgs).toBeDefined();
      expect(capturedArgs.name).toBe('org.example.loader.DirectLoaderClass');
      expect(capturedArgs.bytes.length).toBeGreaterThan(0);
      expect(res).toBeDefined();
    });

    it('passes ClassLoader directly to runtime.defineClass(target, loader) without strategy string', () => {
      let capturedArgs: any = null;
      const mockTargetLoader = {
        defineClass: (
          name: string,
          bytes: number[],
          off: number,
          len: number,
        ) => {
          capturedArgs = { name, bytes, off, len };
          return { $ptr: 888n };
        },
      };

      const runtime = createRuntimeContext({
        bridge: {
          getClassSync: () => ({ classObj: 1n, name: 'Dummy' }) as any,
          getClass: async () => ({ classObj: 1n, name: 'Dummy' }) as any,
        } as any,
      });

      const loader = runtime.createClassLoader(mockTargetLoader);

      runtime.defineClass([0xca, 0xfe, 0xba, 0xbe], loader);

      expect(capturedArgs).toBeDefined();
      expect(capturedArgs.bytes).toEqual([0xca, 0xfe, 0xba, 0xbe]);
    });

    it('uses UnsafeClassLoader JS object without strategy string', () => {
      let unsafeCaptured: any = null;
      const mockLoaderHandle = { $ptr: 444n };

      const runtime = createRuntimeContext({
        bridge: {
          getClassSync: (name: string) => ({ classObj: 2n, name }) as any,
          getClass: async () => ({}) as any,
        } as any,
      });

      runtime.registerClass({
        name: 'sun.misc.Unsafe',
        mode: 'hybrid',
        staticFields: {
          theUnsafe: {
            defineClass: (
              name: string,
              b: number[],
              off: number,
              len: number,
              cl: any,
              pd: any,
            ) => {
              unsafeCaptured = { name, b, off, len, cl, pd };
              return { $ptr: 999n };
            },
          },
        },
      });

      const unsafeLoader = new UnsafeClassLoader(runtime, mockLoaderHandle);
      unsafeLoader.defineClass([0xca, 0xfe, 0xba, 0xbe], {
        name: 'com.secret.UnsafeLoaded',
      });

      expect(unsafeCaptured).toBeDefined();
      expect(unsafeCaptured.name).toBe('com.secret.UnsafeLoaded');
      expect(unsafeCaptured.cl).toBe(mockLoaderHandle);
    });

    it('uses AgentClassLoader JS object without strategy string', () => {
      let agentCaptured: any = null;

      const runtime = createRuntimeContext({
        bridge: {
          getClassSync: (name: string) => ({ classObj: 555n, name }) as any,
          getClass: async () => ({}) as any,
        } as any,
      });

      runtime.registerClass({
        name: 'org.exoproc.njava.agent.utils.Exoproc',
        mode: 'hybrid',
        staticMethods: {
          defineClass: (
            _ctx: any,
            name: string,
            bytes: number[],
            loader: any,
          ) => {
            agentCaptured = { name, bytes, loader };
            return { $ptr: 666n };
          },
        },
      });

      const agentLoader = new AgentClassLoader(runtime);
      runtime.defineClass([0xca, 0xfe, 0xba, 0xbe], agentLoader);

      expect(agentCaptured).toBeDefined();
      expect(agentCaptured.bytes).toEqual([0xca, 0xfe, 0xba, 0xbe]);
    });

    it('provides default ClassLoader on runtime.classLoader', () => {
      const runtime = createRuntimeContext();
      expect(runtime.classLoader).toBeDefined();
      expect(runtime.classLoader instanceof ClassLoader).toBe(true);
      expect(runtime.classLoader instanceof AutoClassLoader).toBe(true);
    });
  });
});
