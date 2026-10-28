import { describe, it, expect } from 'bun:test';
import {
  createRuntimeContext,
  createPool,
  type JavaClassDefinition,
} from '../../packages/java/runtime/src/index.js';

describe('njava-runtime', () => {
  it('should initialize runtime context and resolve built-in java.lang.Class', () => {
    const runtime = createRuntimeContext();

    const ClassType = runtime.type('java.lang.Class');
    expect(ClassType).toBeDefined();

    const cls = ClassType.class;
    expect(cls).toBeDefined();
    expect(cls.getName()).toBe('java.lang.Class');
    expect(cls.getCanonicalName()).toBe('java.lang.Class');
    expect(cls.getSimpleName()).toBe('Class');
    expect(cls.getSuperclass()?.getName()).toBe('java.lang.Object');
  });

  it('should preserve singleton identity across Class.forName and Java.type().class', () => {
    const runtime = createRuntimeContext();

    const ClassType = runtime.type('java.lang.Class');
    const c1 = ClassType.forName('java.lang.String');
    const c2 = runtime.type('java.lang.String').class;

    expect(c1).toBe(c2);
    expect(c1.getName()).toBe('java.lang.String');
    expect(c1.getSimpleName()).toBe('String');
    expect(c1.getCanonicalName()).toBe('java.lang.String');
  });

  it('should support Virtual mode classes (pure TypeScript without JVM)', () => {
    const runtime = createRuntimeContext();

    const Vector3fDef: JavaClassDefinition = {
      name: 'org.lwjgl.util.vector.Vector3f',
      aliases: ['Vector3f'],
      mode: 'virtual',
      superclassName: 'java.lang.Object',
      construct: (_ctx, x = 0, y = 0, z = 0) => {
        return { x, y, z };
      },
      instanceMethods: {
        length: (target) =>
          Math.sqrt(
            target.x * target.x + target.y * target.y + target.z * target.z,
          ),
        set: (target, _ctx, x, y, z) => {
          target.x = x;
          target.y = y;
          target.z = z;
        },
      },
      instanceFields: {
        x: (target: any) => target.x,
        y: (target: any) => target.y,
        z: (target: any) => target.z,
      },
      staticMethods: {
        zero: () => ({ x: 0, y: 0, z: 0 }),
      },
    };

    runtime.registerClass(Vector3fDef);

    const Vector3f = runtime.type('org.lwjgl.util.vector.Vector3f');
    expect(Vector3f).toBeDefined();

    // 1. Static method
    const zeroVec = Vector3f.zero();
    expect(zeroVec.x).toBe(0);

    // 2. Constructor & instance methods
    const v = new Vector3f(3, 4, 0);
    expect(v.x).toBe(3);
    expect(v.y).toBe(4);
    expect(v.length()).toBe(5);

    v.set(0, 0, 10);
    expect(v.z).toBe(10);
    expect(v.length()).toBe(10);

    // 3. Class metadata
    expect(v.getClass().getName()).toBe('org.lwjgl.util.vector.Vector3f');
    expect(v.getClass().getSimpleName()).toBe('Vector3f');
    expect(Vector3f.class === v.getClass()).toBe(true);
  });

  it('should support Hybrid mode with TS handlers and fallback', () => {
    let nativeCalled = false;

    const mockBridge = {
      invokeMethodSync: (methodObj: bigint, instance: bigint, args: any[]) => {
        nativeCalled = true;
        return 42;
      },
      getAllReflectedMethodsSync: () => [
        {
          name: 'nativeCalculate',
          isStatic: false,
          methodObj: 999n,
          type: 'int',
        },
      ],
    };

    const runtime = createRuntimeContext({ bridge: mockBridge as any });

    const MathHelperDef: JavaClassDefinition = {
      name: 'net.minecraft.util.MathHelper',
      mode: 'hybrid',
      staticMethods: {
        floor_double: (_ctx, val: number) => Math.floor(val),
      },
    };

    runtime.registerClass(MathHelperDef);

    const MathHelper = runtime.type('net.minecraft.util.MathHelper');

    // TS-intercepted static method
    expect(MathHelper.floor_double(4.9)).toBe(4);
    expect(nativeCalled).toBe(false);
  });

  it('should support wrapHybrid for live pointers with TS extensions', () => {
    const runtime = createRuntimeContext();

    const fakeObjPtr = 0x12345678n;
    const hybridPlayer = runtime.wrapHybrid(
      fakeObjPtr,
      'net.minecraft.client.entity.EntityPlayerSP',
      {
        methods: {
          getCustomGreeting: (target) =>
            `Hello from player @ 0x${target.$ptr.toString(16)}`,
        },
      },
    );

    expect(hybridPlayer.$ptr).toBe(fakeObjPtr);
    expect(hybridPlayer.getCustomGreeting()).toBe(
      'Hello from player @ 0x12345678',
    );
    expect(hybridPlayer.getClass().getSimpleName()).toBe('EntityPlayerSP');
  });

  it('should resolve deobfuscated mapping names via MappingPool', () => {
    const pool = createPool();
    pool.registerMatch({
      canonicalName: 'net.minecraft.client.entity.EntityPlayerSP',
      realClassName: 'bew',
      fields: {},
      methods: {},
    });

    const runtime = createRuntimeContext({ pool });

    // Request via obfuscated name
    const byObf = runtime.type('bew');
    // Request via canonical name
    const byCanon = runtime.type('net.minecraft.client.entity.EntityPlayerSP');
    // Request via short simple name
    const byShort = runtime.type('EntityPlayerSP');

    // 1. They are different objects (views) based on how they were requested
    expect(byObf.class).not.toBe(byCanon.class);
    expect(byShort.class).not.toBe(byCanon.class);

    // 2. But they represent the same underlying class!
    expect(byObf.class.equals(byCanon.class)).toBe(true);
    expect(byShort.class.equals(byCanon.class)).toBe(true);
    expect(byObf.equals(byCanon)).toBe(true);

    // 3. getName() reflects how each was requested
    expect(byObf.class.getName()).toBe('bew');
    expect(byShort.class.getName()).toBe('EntityPlayerSP');
    expect(byCanon.class.getName()).toBe(
      'net.minecraft.client.entity.EntityPlayerSP',
    );

    // 4. getCanonicalName() is the same across all three
    expect(byObf.class.getCanonicalName()).toBe(
      'net.minecraft.client.entity.EntityPlayerSP',
    );
    expect(byShort.class.getCanonicalName()).toBe(
      'net.minecraft.client.entity.EntityPlayerSP',
    );
    expect(byCanon.class.getCanonicalName()).toBe(
      'net.minecraft.client.entity.EntityPlayerSP',
    );

    // 5. getSimpleName()
    expect(byObf.class.getSimpleName()).toBe('bew');
    expect(byShort.class.getSimpleName()).toBe('EntityPlayerSP');
    expect(byCanon.class.getSimpleName()).toBe('EntityPlayerSP');
  });
});
