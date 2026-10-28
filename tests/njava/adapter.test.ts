import { describe, expect, it } from 'bun:test';
import {
  createJavaCode,
  JavaCode,
  ScriptFunction,
} from '../../packages/java/nashorn/src/index.js';
import {
  adaptBridgeArgument,
  type GeneratedAdapterResult,
} from '../../packages/java/njava/src/adapter.js';
import {
  JavaRuntimeContext,
  createRuntimeContext,
  type IJavaBridge,
} from '../../packages/java/runtime/src/index.js';

describe('njava: adaptBridgeArgument (Multi-Java Object Morphing)', () => {
  it('adapts JavaCode to String and caches it', () => {
    const raw = 'Minecraft.getMinecraft().displayGuiScreen(null);';
    const jc = createJavaCode(raw) as JavaCode;

    const res1 = adaptBridgeArgument(jc, 'java.lang.String');
    expect(res1).toBe(raw);
    expect(jc.hasCast('java.lang.String')).toBe(true);

    // Second call returns cached result
    const res2 = adaptBridgeArgument(jc, 'java.lang.String');
    expect(res2).toBe(raw);
  });

  it('adapts JavaCode to Runnable without mapper and caches one-time builder', () => {
    const raw = 'Minecraft.getMinecraft().displayGuiScreen(null);';
    const jc = createJavaCode(raw) as JavaCode;

    const res1 = adaptBridgeArgument(
      jc,
      'java.lang.Runnable',
    ) as GeneratedAdapterResult;
    expect(res1).toBeDefined();
    expect(res1.__isGeneratedAdapter).toBe(true);
    expect(res1.targetType).toBe('java.lang.Runnable');
    expect(res1.builder).toBeDefined();
    expect(res1.builder.pool).toBeUndefined(); // NOTE: mapper'sız saf Java!

    // Verify generated source structure
    expect(res1.source).toContain('implements Runnable');
    expect(res1.source).toContain('public void run()');
    expect(res1.source).toContain(raw);

    // Second call returns exact same cached reference (1 kere üretir)
    const res2 = adaptBridgeArgument(jc, 'java.lang.Runnable');
    expect(res2).toBe(res1);
  });

  it('adapts JavaCode to Callable and caches one-time builder', () => {
    const raw = 'return 42;';
    const jc = createJavaCode(raw) as JavaCode;

    const res = adaptBridgeArgument(
      jc,
      'java.util.concurrent.Callable',
    ) as GeneratedAdapterResult;
    expect(res.targetType).toBe('java.util.concurrent.Callable');
    expect(res.source).toContain('implements Callable');
    expect(res.source).toContain('public Object call()');
    expect(res.source).toContain('return 42;');

    expect(jc.hasCast('java.util.concurrent.Callable')).toBe(true);
  });

  it('behaves as a polymorphic multi-Java object across 3 different casts', () => {
    const code = 'doAction();';
    const jc = createJavaCode(code) as JavaCode;

    // Cast 1: String
    const strRes = adaptBridgeArgument(jc, 'java.lang.String');
    expect(strRes).toBe(code);

    // Cast 2: Runnable
    const runRes = adaptBridgeArgument(
      jc,
      'java.lang.Runnable',
    ) as GeneratedAdapterResult;
    expect(runRes.targetType).toBe('java.lang.Runnable');

    // Cast 3: Callable
    const callRes = adaptBridgeArgument(
      jc,
      'java.util.concurrent.Callable',
    ) as GeneratedAdapterResult;
    expect(callRes.targetType).toBe('java.util.concurrent.Callable');

    // Single JavaCode instance now holds all 3 casts in memory:
    expect(jc.casts.size).toBe(3);
    expect(jc.getCast('java.lang.String')).toBe(strRes);
    expect(jc.getCast<GeneratedAdapterResult>('java.lang.Runnable')).toBe(
      runRes,
    );
    expect(
      jc.getCast<GeneratedAdapterResult>('java.util.concurrent.Callable'),
    ).toBe(callRes);
  });

  it('adapts ScriptFunction directly from Java.code(fn) and extracts body on first access', () => {
    let callCount = 0;
    const fn = () => {
      callCount++;
      return 'done';
    };

    const sf = createJavaCode(fn) as ScriptFunction;
    expect(sf.__isScriptFunction).toBe(true);

    // First access extracts body
    const body1 = sf.body;
    expect(body1).toContain('callCount++');

    // Bridge uses Exoproc.dispatchCallback in Agent mode to build Runnable adapter
    const res = adaptBridgeArgument(
      sf,
      'java.lang.Runnable',
    ) as GeneratedAdapterResult;
    expect(res.source).toContain('implements Runnable');
    expect(res.source).toContain('Exoproc.dispatchCallback');
    expect(res.callbackId).toBeDefined();

    // Cached on ScriptFunction
    expect(sf.hasCast('java.lang.Runnable')).toBe(true);
    expect(adaptBridgeArgument(sf, 'java.lang.Runnable')).toBe(res);
  });

  it('triggers bridge.adaptArgument when JavaCode is passed to a native proxy method', () => {
    const adaptedCalls: Array<{ arg: any; targetType?: string }> = [];

    // Mock bridge with adaptArgument
    const mockBridge: any = {
      getClassSync: () => ({ name: 'TestService', classObj: 100n }) as any,
      getClass: async () => ({ name: 'TestService', classObj: 100n }) as any,
      getAllReflectedMethodsSync: () => [
        {
          name: 'schedule',
          methodObj: 200n,
          isStatic: true,
          paramTypes: ['java.lang.Runnable'],
          type: 'void',
        },
      ],
      invokeMethodSync: (methodObj: any, target: any, args: any) => {
        return { called: true, args };
      },
      adaptArgument: (arg: any, targetType?: string) => {
        adaptedCalls.push({ arg, targetType });
        return adaptBridgeArgument(arg, targetType);
      },
    };

    const context = new JavaRuntimeContext({ bridge: mockBridge });
    const TestService = context.type('TestService');

    const code = context.code('Minecraft.getMinecraft().shutdown();');
    TestService.schedule(code);

    // Verified that proxy recognized JavaCode and delegated to bridge.adaptArgument
    expect(adaptedCalls.length).toBe(1);
    expect(adaptedCalls[0].arg).toBe(code);
    expect(adaptedCalls[0].targetType).toBe('java.lang.Runnable');

    // Verified that the one-time cast was registered on the code object
    expect(code.hasCast('java.lang.Runnable')).toBe(true);
  });
});
