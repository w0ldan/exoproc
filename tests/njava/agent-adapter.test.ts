import { describe, expect, it } from 'bun:test';
import {
  adaptBridgeArgument,
  globalCallbackRegistry,
} from '../../packages/java/njava/src/adapter.js';
import { AgentReflectionBridge } from '../../packages/java/njava/src/agent-bridge.js';
import { createJavaCode } from 'exoproc-nashorn';
import { createRuntimeContext } from 'exoproc-runtime';

describe('njava: Agent Callback Adapter & Registration', () => {
  it('adapts ScriptFunction to Runnable with Exoproc.dispatchCallback', () => {
    let executed = false;
    const fn = () => {
      executed = true;
      return 'done';
    };
    const sf = createJavaCode(fn);
    expect((sf as any).__isScriptFunction).toBe(true);

    const bridge = new AgentReflectionBridge({ port: 43378 });
    const adapter = adaptBridgeArgument(sf, 'java.lang.Runnable', bridge);

    expect(adapter.__isGeneratedAdapter).toBe(true);
    expect(adapter.targetType).toBe('java.lang.Runnable');
    expect(adapter.callbackId).toBeDefined();
    expect(typeof adapter.callbackId).toBe('string');
    expect(adapter.callbackId.startsWith('cb_')).toBe(true);

    // Verify registration
    expect(bridge.callbackRegistry.has(adapter.callbackId)).toBe(true);
    expect(bridge.getCallback(adapter.callbackId)).toBe(fn);
    expect(globalCallbackRegistry.has(adapter.callbackId)).toBe(true);

    // Verify generated Java source code
    const src = adapter.source;
    expect(src).toContain('public class GeneratedAdapter_');
    expect(src).toContain('implements Runnable');
    expect(src).toContain('public void run()');
    expect(src).toContain(
      `org.exoproc.njava.agent.utils.Exoproc.dispatchCallback("${adapter.callbackId}", "run", new Object[0]);`,
    );

    // Verify caching: second call returns identical cached adapter
    const adapter2 = adaptBridgeArgument(sf, 'java.lang.Runnable', bridge);
    expect(adapter2).toBe(adapter);
    expect(adapter2.callbackId).toBe(adapter.callbackId);

    // Execute callback via bridge dispatch
    const res = bridge.getCallback(adapter.callbackId)!();
    expect(res).toBe('done');
    expect(executed).toBe(true);
  });

  it('adapts ScriptFunction to Callable with return Exoproc.dispatchCallback', () => {
    const fn = (a: number, b: number) => a + b;
    const sf = createJavaCode(fn);

    const bridge = new AgentReflectionBridge({ port: 43378 });
    const adapter = adaptBridgeArgument(
      sf,
      'java.util.concurrent.Callable',
      bridge,
    );

    expect(adapter.__isGeneratedAdapter).toBe(true);
    expect(adapter.targetType).toBe('java.util.concurrent.Callable');
    expect(adapter.callbackId).toBeDefined();

    const src = adapter.source;
    expect(src).toContain('implements Callable');
    expect(src).toContain('import java.util.concurrent.Callable;');
    expect(src).toContain('public Object call() throws Exception');
    expect(src).toContain(
      `return org.exoproc.njava.agent.utils.Exoproc.dispatchCallback("${adapter.callbackId}", "call", new Object[0]);`,
    );
  });

  it('adapts JavaCode to Runnable using raw user Java code', () => {
    const rawJava = 'System.out.println("custom_code");';
    const jc = createJavaCode(rawJava);
    expect((jc as any).__isJavaCode).toBe(true);

    const bridge = new AgentReflectionBridge({ port: 43378 });
    const adapter = adaptBridgeArgument(jc, 'Runnable', bridge);

    expect(adapter.__isGeneratedAdapter).toBe(true);
    expect(adapter.callbackId).toBeUndefined(); // JavaCode doesn't create a JS callback ID

    const src = adapter.source;
    expect(src).toContain('implements Runnable');
    expect(src).toContain('public void run()');
    expect(src).toContain('System.out.println("custom_code");');
    expect(src).not.toContain('Exoproc.dispatchCallback');
  });

  it('adapts ScriptFunction to String as string representation', () => {
    const fn = () => 123;
    const sf = createJavaCode(fn);

    const strResult = adaptBridgeArgument(sf, 'java.lang.String');
    expect(typeof strResult).toBe('string');
    expect(strResult).toContain('123');
  });

  it('handles incoming callback dispatch on AgentReflectionBridge', async () => {
    const bridge = new AgentReflectionBridge({ port: 43378 });
    const cbId = 'cb_test_incoming_' + Date.now();

    let receivedArgs: any[] = [];
    bridge.registerCallback(cbId, (...args: any[]) => {
      receivedArgs = args;
      return args.reduce((sum, n) => sum + n, 0);
    });

    // Mock fetch for /callback/reply
    let replyPayload: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (String(url).endsWith('/callback/reply')) {
        replyPayload = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return originalFetch(url, init);
    }) as any;

    try {
      const outcome = await bridge.dispatchIncomingCallback({
        id: 99,
        callbackId: cbId,
        method: 'calculate',
        args: [10, 20, 30],
      });

      expect(outcome.id).toBe(99);
      expect(outcome.success).toBe(true);
      expect(outcome.result).toBe(60);
      expect(receivedArgs).toEqual([10, 20, 30]);

      expect(replyPayload).toBeDefined();
      expect(replyPayload.id).toBe(99);
      expect(replyPayload.success).toBe(true);
      expect(replyPayload.result).toBe(60);
    } finally {
      globalThis.fetch = originalFetch;
      bridge.stopCallbackListener();
    }
  });

  it('reports error on unknown callbackId', async () => {
    const bridge = new AgentReflectionBridge({ port: 43378 });

    let replyPayload: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      if (String(url).endsWith('/callback/reply')) {
        replyPayload = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      return originalFetch(url, init);
    }) as any;

    try {
      const outcome = await bridge.dispatchIncomingCallback({
        id: 101,
        callbackId: 'unknown_cb_id',
        method: 'run',
        args: [],
      });

      expect(outcome.id).toBe(101);
      expect(outcome.success).toBe(false);
      expect(outcome.error).toContain('No callback function registered');

      expect(replyPayload).toBeDefined();
      expect(replyPayload.id).toBe(101);
      expect(replyPayload.success).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
      bridge.stopCallbackListener();
    }
  });

  it('automatically compiles and defines Runnable on agent ClassLoader when context is present', () => {
    let definedClassName: string | null = null;
    let definedBytecode: number[] | null = null;

    const mockLoader = {
      defineClass: (
        name: string,
        bytes: number[],
        _off: number,
        _len: number,
      ) => {
        definedClassName = name;
        definedBytecode = bytes;
        return { $ptr: 9999n };
      },
    };

    const runtime = createRuntimeContext({
      bridge: {
        getClassSync: (name: string) => ({ classObj: 1n, name }) as any,
        getClass: async (name: string) => ({ classObj: 1n, name }) as any,
        newInstanceSync: () => 88888n,
        getObjectClassSync: () => 1n,
        getClassNameSync: () => 'GeneratedAdapter',
      } as any,
    });

    // Provide mock loader to runtime ClassLoader
    (runtime as any).classLoader = runtime.createClassLoader(mockLoader);

    const bridge = new AgentReflectionBridge({ port: 43378 });
    (bridge as any).runtime = runtime;

    const fn = () => {
      console.log('Task executed');
    };

    const javaRunnable = adaptBridgeArgument(
      fn,
      'java.lang.Runnable',
      bridge,
      runtime,
    );

    expect(javaRunnable).toBeDefined();
    expect(definedClassName).toBeDefined();
    expect(definedClassName!.startsWith('GeneratedAdapter_')).toBe(true);
    expect(definedBytecode).toBeDefined();
    expect(definedBytecode![0]).toBe(0xca);
    expect(definedBytecode![1]).toBe(0xfe);
    expect(definedBytecode![2]).toBe(0xba);
    expect(definedBytecode![3]).toBe(0xbe);
  });
});
