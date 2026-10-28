import { describe, expect, it } from 'bun:test';
import {
  buildExtendedClassAdapter,
  globalCallbackRegistry,
} from '../../packages/java/njava/src/adapter.js';
import {
  createJavaContext,
  JavaContext,
} from '../../packages/java/njava/src/proxy.js';
import {
  createRuntimeContext,
  JavaRuntimeContext,
  type IJavaBridge,
} from '../../packages/java/runtime/src/index.js';

describe('njava: Java.extend & Java.super (Hybrid Mode & Zero-IPC Execution)', () => {
  it('buildExtendedClassAdapter generates proper Java AST, callback registration, and __super_ bridges', () => {
    let bridgeRegisteredCallbackId: string | undefined;
    const mockBridge = {
      registerCallback: (id: string, _fn: Function) => {
        bridgeRegisteredCallbackId = id;
      },
      getClassSync: () => ({
        name: 'com.example.BaseService',
        isInterface: false,
        getDeclaredConstructorsSync: () => [
          { ctorObj: 1n, paramTypes: ['java.lang.String'] },
        ],
        getAllMethodsSync: () => [
          {
            name: 'calculate',
            methodObj: 10n,
            type: 'int',
            paramTypes: ['int'],
            isStatic: false,
          },
          {
            name: 'getMessage',
            methodObj: 11n,
            type: 'java.lang.String',
            paramTypes: [],
            isStatic: false,
          },
        ],
      }),
    };

    const res = buildExtendedClassAdapter(
      'com.example.BaseService',
      {
        calculate: function (val: number) {
          return val * 2;
        },
      },
      { bridge: mockBridge },
    );

    expect(res.className).toStartWith('Extended_BaseService_');
    expect(res.source).toContain('extends BaseService');
    expect(res.source).toContain('super(p0);'); // Mirrors parent constructor

    // Verify @Override method dispatches to Exoproc.dispatchCallback
    expect(res.source).toContain('@Override');
    expect(res.source).toContain('public int calculate(int p0)');
    expect(res.source).toContain('Exoproc.dispatchCallback');

    // Verify __super_ bridge generation for invokespecial
    expect(res.source).toContain('public int __super_calculate(int p0)');
    expect(res.source).toContain('return super.calculate(p0);');

    // Verify hybridOverrides dictionary
    expect(res.hybridOverrides).toBeDefined();
    expect(typeof res.hybridOverrides['calculate']).toBe('function');
    expect(res.hybridOverrides['calculate'](21)).toBe(42);

    // Verify global and bridge callback registration
    expect(bridgeRegisteredCallbackId).toBeDefined();
    expect(globalCallbackRegistry.has(bridgeRegisteredCallbackId!)).toBe(true);
  });

  it('buildExtendedClassAdapter supports interfaces without __super_ bridges', () => {
    const res = buildExtendedClassAdapter('java.lang.Runnable', {
      run: () => {
        return 'executed';
      },
    });

    expect(res.source).toContain('implements Runnable');
    expect(res.source).toContain('public void run()');
    expect(res.source).toContain('Exoproc.dispatchCallback');
    // Interfaces have no super implementation
    expect(res.source).not.toContain('__super_run');
    expect(res.hybridOverrides['run']()).toBe('executed');
  });

  it('Zero-IPC Short-Circuit: calling overridden method from JS executes locally in memory without bridge IPC', () => {
    let bridgeInvokeCalls = 0;
    const mockBridge: any = {
      invokeUnboxedSync: () => {
        bridgeInvokeCalls++;
        return 999;
      },
      constructSync: () => 0x1234n,
      getClassSync: () => ({
        name: 'com.example.Calculator',
        isInterface: false,
        getDeclaredConstructorsSync: () => [{ ctorObj: 1n, paramTypes: [] }],
        getAllMethodsSync: () => [
          {
            name: 'add',
            methodObj: 20n,
            type: 'int',
            paramTypes: ['int', 'int'],
            isStatic: false,
          },
          {
            name: 'nativeCompute',
            methodObj: 21n,
            type: 'int',
            paramTypes: [],
            isStatic: false,
          },
        ],
      }),
    };

    const Java = createJavaContext(mockBridge);

    let jsOverrideCallCount = 0;
    const SubCalculator = Java.extend('com.example.Calculator', {
      add: function (a: number, b: number) {
        jsOverrideCallCount++;
        // Verify `this` is correctly bound to the Java object proxy
        expect(this).toBeDefined();
        expect(this.$ptr).toBe(0x1234n);
        return a + b;
      },
    });

    const instance = new SubCalculator();
    expect(instance).toBeDefined();
    expect(instance.$ptr).toBe(0x1234n);

    // Call the overridden method from JavaScript
    const sum = instance.add(15, 27);
    expect(sum).toBe(42);
    expect(jsOverrideCallCount).toBe(1);

    // CRITICAL: Bridge IPC was NEVER touched because of the hybrid short-circuit!
    expect(bridgeInvokeCalls).toBe(0);

    // Calling non-overridden method DOES hit the bridge
    const nativeRes = instance.nativeCompute();
    expect(nativeRes).toBe(999);
    expect(bridgeInvokeCalls).toBe(1);
  }, 30000);

  it('Java.super(this): delegates directly to __super_<method> to invoke parent implementation without recursion', () => {
    let bridgeMethodInvoked: string | undefined;
    const mockBridge: any = {
      invokeUnboxedSync: (methodObj: bigint, _ptr: bigint, args: any[]) => {
        if (methodObj === 300n) {
          bridgeMethodInvoked = '__super_getValue';
          return 100; // Original parent value
        }
        return 0;
      },
      constructSync: () => 0x5678n,
      getClassSync: () => ({
        name: 'com.example.ParentEntity',
        isInterface: false,
        getDeclaredConstructorsSync: () => [{ ctorObj: 1n, paramTypes: [] }],
        getAllMethodsSync: () => [
          {
            name: 'getValue',
            methodObj: 30n,
            type: 'int',
            paramTypes: [],
            isStatic: false,
          },
          {
            name: '__super_getValue',
            methodObj: 300n,
            type: 'int',
            paramTypes: [],
            isStatic: false,
          },
        ],
      }),
    };

    const Java = createJavaContext(mockBridge);

    const SubEntity = Java.extend('com.example.ParentEntity', {
      getValue: function () {
        // Calls the parent class via Java.super(this)
        const parentVal = Java.super(this).getValue();
        return parentVal + 25;
      },
    });

    const entity = new SubEntity();
    const result = entity.getValue();

    // 100 (from parent via __super_getValue) + 25 = 125
    expect(result).toBe(125);
    expect(bridgeMethodInvoked).toBe('__super_getValue');
  }, 30000);

  it('Supports inline method overrides passed to constructor: new SubClass({ method: fn })', () => {
    const mockBridge: any = {
      constructSync: () => 0x9999n,
      getClassSync: () => ({
        name: 'com.example.Widget',
        isInterface: false,
        getDeclaredConstructorsSync: () => [{ ctorObj: 1n, paramTypes: [] }],
        getAllMethodsSync: () => [],
      }),
    };

    const Java = createJavaContext(mockBridge);
    const WidgetSub = Java.extend('com.example.Widget');

    // Instantiate with inline overrides object
    let ran = false;
    const widget = new WidgetSub({
      paint: function (color: string) {
        ran = true;
        return `painted in ${color}`;
      },
    });

    const ret = widget.paint('blue');
    expect(ran).toBe(true);
    expect(ret).toBe('painted in blue');
  }, 30000);

  it('Supports constructor arguments with trailing overrides: new SubClass(arg1, arg2, { method: fn })', () => {
    let capturedCtorArgs: any[] | undefined;
    const mockBridge: any = {
      constructSync: (_ctorObj: bigint, args: any[]) => {
        capturedCtorArgs = args;
        return 0x8888n;
      },
      getClassSync: () => ({
        name: 'com.example.Player',
        isInterface: false,
        getDeclaredConstructorsSync: () => [
          { ctorObj: 1n, paramTypes: ['java.lang.String', 'int'] },
        ],
        getAllMethodsSync: () => [],
      }),
    };

    const Java = createJavaContext(mockBridge);
    const PlayerSub = Java.extend('com.example.Player');

    const player = new PlayerSub('Alex', 100, {
      getCustomTitle: function () {
        return `Hero [${this.$ptr}]`;
      },
    });

    expect(capturedCtorArgs).toEqual(['Alex', 100]);
    expect(player.getCustomTitle()).toBe('Hero [34952]');
  }, 30000);

  it('njava-runtime JavaRuntimeContext: registers as hybrid and supports Java.extend & Java.super', () => {
    let superInvoked = false;
    const mockBridge: any = {
      getClassSync: () => ({ name: 'TestService', classObj: 100n }) as any,
      getClass: async () => ({ name: 'TestService', classObj: 100n }) as any,
      getAllReflectedMethodsSync: () => [
        {
          name: '__super_process',
          methodObj: 500n,
          isStatic: false,
          paramTypes: ['java.lang.String'],
          type: 'java.lang.String',
        },
      ],
      invokeMethodSync: (methodObj: any, _target: any, args: any) => {
        if (methodObj === 500n) {
          superInvoked = true;
          return `base:${args[0]}`;
        }
        return null;
      },
    };

    const runtime = createRuntimeContext({ bridge: mockBridge });

    const ExtendedService = runtime.extend('TestService', {
      process: function (text: string) {
        const parentRes = runtime.super(this).process(text);
        return `custom(${parentRes})`;
      },
    });

    expect(ExtendedService).toBeDefined();

    const instance = new ExtendedService();
    const result = instance.process('input');

    expect(result).toBe('custom(base:input)');
    expect(superInvoked).toBe(true);
  }, 30000);
});
