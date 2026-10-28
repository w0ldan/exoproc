import type { DummyFunction, IMemoryAccessor } from 'bun-xffi';
import type { JniNativeFunctionName } from './njava-accessor.js';
import {
  parseAccessibleObjectString,
  type ParsedAccessibleObject,
} from './reflection-parser.js';
import {
  writeUtf8CString,
  writeUtf8CStringSync,
  withUtf8CString,
  withUtf8CStringSync,
  withJvalueObjectArray,
  withJvalueObjectArraySync,
  withBytes,
  withBytesSync,
} from './remote-memory.js';
import {
  NJavaError,
  ClassNotFoundError,
  MethodNotFoundError,
  FieldNotFoundError,
  ConstructorNotFoundError,
  ReflectiveInvokeError,
  BoxingUnsupportedError,
} from './errors.js';

const PRIMITIVE_TYPES = new Set([
  'boolean',
  'byte',
  'short',
  'int',
  'long',
  'float',
  'double',
  'char',
]);

function isPrimitiveTypeName(name: string): boolean {
  return PRIMITIVE_TYPES.has(name);
}

export interface ReflectedConstructor {
  ctorObj: bigint;
  paramTypes: readonly string[];
}

/**
 * Reflection-based JVM interface providing dynamic, name-based resolution of
 * classes, methods, and constructors with automatic primitive boxing.
 *
 * Supports both asynchronous (`await bridge.findClass(...)`) and synchronous
 * (`bridge.findClassSync(...)`) execution.
 *
 * Bootstraps without `FindClass` or hardcoded classloader assumptions.
 */
export class ReflectionBridge {
  private readonly primitiveBoxCtors = new Map<string, bigint>();

  private stringClass!: bigint;
  private objectClass!: bigint;
  private classClass!: bigint;
  private methodClass!: bigint;
  private constructorClass!: bigint;
  private iteClass!: bigint;
  private characterClass!: bigint;
  private fieldClass!: bigint;

  private toStringMid!: bigint;
  private getMethodsMid!: bigint;
  private getDeclaredMethodsMid!: bigint;
  private invokeMid!: bigint;
  private getCauseMid!: bigint;
  private charCtorMid!: bigint;
  private setAccessibleMethod: bigint = 0n;
  private trueArgsArr: bigint = 0n;

  private forNameMethod!: bigint;
  private getDeclaredConstructorsMethod!: bigint;
  private getDeclaredFieldsMethod!: bigint;
  private getClassLoaderMethod!: bigint;
  private constructorNewInstanceMethod!: bigint;
  private fieldGetMethod!: bigint;
  private fieldSetMethod!: bigint;
  private systemClassLoader!: bigint;
  private loadClassMethod!: bigint;

  constructor(
    private readonly fns: Record<JniNativeFunctionName, DummyFunction>,
    private readonly memory: Pick<
      IMemoryAccessor,
      'alloc' | 'write' | 'read'
    > & {
      free?: (addr: any) => Promise<any> | any;
      allocSync?: any;
      writeSync?: any;
      freeSync?: any;
    },
  ) {}

  private callFnSync(fn: DummyFunction, ...args: any[]): any {
    if (typeof (fn as any).callSync === 'function') {
      return (fn as any).callSync(...args);
    }
    return (fn as any)(...args);
  }

  public async toGlobalRef(ref: bigint): Promise<bigint> {
    if (!ref || ref === 0n) return 0n;
    const g = BigInt(await this.fns.NewGlobalRef(ref));
    await this.fns.DeleteLocalRef(ref);
    return g;
  }

  public toGlobalRefSync(ref: bigint): bigint {
    if (!ref || ref === 0n) return 0n;
    const g = BigInt(this.callFnSync(this.fns.NewGlobalRef, ref));
    this.callFnSync(this.fns.DeleteLocalRef, ref);
    return g;
  }

  public async deleteGlobalRef(ref: bigint): Promise<void> {
    if (ref && ref !== 0n) {
      try {
        await this.fns.DeleteGlobalRef(ref);
      } catch {}
    }
  }

  public deleteGlobalRefSync(ref: bigint): void {
    if (ref && ref !== 0n) {
      try {
        this.callFnSync(this.fns.DeleteGlobalRef, ref);
      } catch {}
    }
  }

  /**
   * Scopes local JNI object reference allocations within a local frame, automatically
   * freeing intermediate objects upon completion.
   */
  public async withLocalFrame<T>(
    capacity: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const status = Number(await this.fns.PushLocalFrame(capacity));
    if (status !== 0) {
      throw new NJavaError(`PushLocalFrame failed with status ${status}`);
    }
    try {
      return await fn();
    } finally {
      await this.fns.PopLocalFrame(0n);
    }
  }

  /**
   * Synchronous twin of {@link withLocalFrame}.
   */
  public withLocalFrameSync<T>(capacity: number, fn: () => T): T {
    const status = Number(this.callFnSync(this.fns.PushLocalFrame, capacity));
    if (status !== 0) {
      throw new NJavaError(`PushLocalFrame failed with status ${status}`);
    }
    try {
      return fn();
    } finally {
      this.callFnSync(this.fns.PopLocalFrame, 0n);
    }
  }

  /**
   * Bootstraps the reflection system asynchronously:
   * 1. Reaches `java.lang.Class` without `FindClass` via `NewStringUTF("")` ->
   *    `GetObjectClass` (String) -> `GetSuperclass` (Object) -> `GetObjectClass` (Class).
   * 2. Binds `Object.toString` and `Class.getMethods` via hardcoded `GetMethodID`.
   * 3. Discovers `Class.forName`, `getDeclaredConstructors`, `getDeclaredFields`,
   *    `getClassLoader` by name via `getMethods()`.
   * 4. Reaches `java.lang.reflect.Method` and `Method.invoke`.
   * 5. Reaches `InvocationTargetException` by reflectively invoking `Class.forName("")`.
   * 6. Reaches `Constructor` class and `Constructor.newInstance` by name.
   * 7. Reaches `Throwable.getCause` on `iteClass` by name.
   * 8. Discovers wrapper constructors for all 8 primitive types.
   */
  public async init(): Promise<void> {
    // 1. Reach java.lang.Class without FindClass
    const emptyStrAddr = await writeUtf8CString(this.memory, '');
    const emptyJstr = BigInt(await this.fns.NewStringUTF(emptyStrAddr));
    if (!emptyJstr) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: NewStringUTF returned NULL',
      );
    }

    this.stringClass = BigInt(await this.fns.GetObjectClass(emptyJstr));
    if (!this.stringClass) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: GetObjectClass(emptyJstr) returned NULL',
      );
    }

    this.objectClass = BigInt(await this.fns.GetSuperclass(this.stringClass));
    if (!this.objectClass) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: GetSuperclass(String) returned NULL',
      );
    }

    this.classClass = BigInt(await this.fns.GetObjectClass(this.objectClass));
    if (!this.classClass) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: GetObjectClass(Object.class) returned NULL',
      );
    }

    // 2. Hardcoded GetMethodID for Object.toString and Class.getMethods
    const toStringNameAddr = await writeUtf8CString(this.memory, 'toString');
    const toStringSigAddr = await writeUtf8CString(
      this.memory,
      '()Ljava/lang/String;',
    );
    this.toStringMid = BigInt(
      await this.fns.GetMethodID(
        this.objectClass,
        toStringNameAddr,
        toStringSigAddr,
      ),
    );
    if (!this.toStringMid) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: GetMethodID(Object.toString) returned 0',
      );
    }

    const getMethodsNameAddr = await writeUtf8CString(
      this.memory,
      'getMethods',
    );
    const getMethodsSigAddr = await writeUtf8CString(
      this.memory,
      '()[Ljava/lang/reflect/Method;',
    );
    this.getMethodsMid = BigInt(
      await this.fns.GetMethodID(
        this.classClass,
        getMethodsNameAddr,
        getMethodsSigAddr,
      ),
    );
    if (!this.getMethodsMid) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: GetMethodID(Class.getMethods) returned 0',
      );
    }

    const getDeclaredMethodsNameAddr = await writeUtf8CString(
      this.memory,
      'getDeclaredMethods',
    );
    this.getDeclaredMethodsMid = BigInt(
      await this.fns.GetMethodID(
        this.classClass,
        getDeclaredMethodsNameAddr,
        getMethodsSigAddr,
      ),
    );
    if (!this.getDeclaredMethodsMid) {
      this.getDeclaredMethodsMid = this.getMethodsMid;
    }

    // 3. Resolve Class methods by name
    const classMethods = await this.findMethods(this.classClass, [
      'forName',
      'getDeclaredConstructors',
      'getDeclaredFields',
      'getClassLoader',
    ]);

    const forName = classMethods.get('forName');
    if (!forName) {
      throw new MethodNotFoundError('forName', 'java.lang.Class');
    }
    this.forNameMethod = forName;

    const getDeclaredConstructors = classMethods.get('getDeclaredConstructors');
    if (!getDeclaredConstructors) {
      throw new MethodNotFoundError(
        'getDeclaredConstructors',
        'java.lang.Class',
      );
    }
    this.getDeclaredConstructorsMethod = getDeclaredConstructors;

    const getDeclaredFields = classMethods.get('getDeclaredFields');
    if (!getDeclaredFields) {
      throw new MethodNotFoundError('getDeclaredFields', 'java.lang.Class');
    }
    this.getDeclaredFieldsMethod = getDeclaredFields;

    const getClassLoader = classMethods.get('getClassLoader');
    if (!getClassLoader) {
      throw new MethodNotFoundError('getClassLoader', 'java.lang.Class');
    }
    this.getClassLoaderMethod = getClassLoader;

    // 4. Reach Method's class and invoke method
    this.methodClass = BigInt(
      await this.fns.GetObjectClass(this.forNameMethod),
    );
    if (!this.methodClass) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: GetObjectClass(forNameMethod) returned NULL',
      );
    }

    const methodInvokeMethod = await this.findMethod(
      this.methodClass,
      'invoke',
    );
    if (!methodInvokeMethod) {
      throw new MethodNotFoundError('invoke', 'java.lang.reflect.Method');
    }

    this.invokeMid = BigInt(
      await this.fns.FromReflectedMethod(methodInvokeMethod),
    );
    if (!this.invokeMid) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: FromReflectedMethod(Method.invoke) returned 0',
      );
    }

    // 5. Reach InvocationTargetException without FindClass by provoking Class.forName("")
    const forNameArgsArray = BigInt(
      await this.fns.NewObjectArray(1, this.objectClass, 0n),
    );
    await this.fns.SetObjectArrayElement(forNameArgsArray, 0, emptyJstr);
    await this.rawInvoke(this.forNameMethod, 0n, forNameArgsArray);

    const iteThrowable = BigInt(await this.fns.ExceptionOccurred());
    if (!iteThrowable) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: Class.forName("") did not throw',
      );
    }
    this.iteClass = BigInt(await this.fns.GetObjectClass(iteThrowable));
    await this.fns.ExceptionClear();

    // 6. Reach Constructor class and newInstance by name
    const stringCtorsArray = await this.rawInvoke(
      this.getDeclaredConstructorsMethod,
      this.stringClass,
      0n,
    );
    const ctor0 = BigInt(
      await this.fns.GetObjectArrayElement(stringCtorsArray, 0),
    );
    if (!ctor0) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: String has no constructors',
      );
    }
    this.constructorClass = BigInt(await this.fns.GetObjectClass(ctor0));

    const constructorNewInstanceMethod = await this.findMethod(
      this.constructorClass,
      'newInstance',
    );
    if (!constructorNewInstanceMethod) {
      throw new MethodNotFoundError(
        'newInstance',
        'java.lang.reflect.Constructor',
      );
    }
    this.constructorNewInstanceMethod = constructorNewInstanceMethod;

    // 7. Resolve getCause on iteClass by name
    const getCauseMethod = await this.findMethod(this.iteClass, 'getCause');
    if (!getCauseMethod) {
      throw new MethodNotFoundError('getCause', 'java.lang.Throwable');
    }
    this.getCauseMid = BigInt(
      await this.fns.FromReflectedMethod(getCauseMethod),
    );
    if (!this.getCauseMid) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: FromReflectedMethod(Throwable.getCause) returned 0',
      );
    }

    // 8. Reach System ClassLoader to allow loading user/application classes (-cp)
    const classLoaderClass = await this.findClassByForName(
      'java.lang.ClassLoader',
    );
    const getSystemClassLoaderMethod = await this.findMethod(
      classLoaderClass,
      'getSystemClassLoader',
    );
    if (!getSystemClassLoaderMethod) {
      throw new MethodNotFoundError(
        'getSystemClassLoader',
        'java.lang.ClassLoader',
      );
    }
    this.systemClassLoader = await this.rawInvoke(
      getSystemClassLoaderMethod,
      0n,
      0n,
    );
    const loadClassMethod = await this.findMethod(
      classLoaderClass,
      'loadClass',
    );
    if (!loadClassMethod) {
      throw new MethodNotFoundError('loadClass', 'java.lang.ClassLoader');
    }
    this.loadClassMethod = loadClassMethod;

    // 9. Reach Field class and Field.get / Field.set methods
    const stringFieldsArray = await this.rawInvoke(
      this.getDeclaredFieldsMethod,
      this.stringClass,
      0n,
    );
    const field0 = BigInt(
      await this.fns.GetObjectArrayElement(stringFieldsArray, 0),
    );
    if (!field0) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: String has no fields',
      );
    }
    this.fieldClass = BigInt(await this.fns.GetObjectClass(field0));

    const fieldGetMethod = await this.findMethod(this.fieldClass, 'get');
    if (!fieldGetMethod) {
      throw new MethodNotFoundError('get', 'java.lang.reflect.Field');
    }
    this.fieldGetMethod = fieldGetMethod;

    const fieldSetMethod = await this.findMethod(this.fieldClass, 'set');
    if (!fieldSetMethod) {
      throw new MethodNotFoundError('set', 'java.lang.reflect.Field');
    }
    this.fieldSetMethod = fieldSetMethod;

    // 10. Discover wrapper constructors for all 8 primitive types
    await this.initBoxing();

    // 11. Promote long-lived bootstrap handles to Global Refs
    this.stringClass = await this.toGlobalRef(this.stringClass);
    this.objectClass = await this.toGlobalRef(this.objectClass);
    this.classClass = await this.toGlobalRef(this.classClass);
    this.methodClass = await this.toGlobalRef(this.methodClass);
    this.constructorClass = await this.toGlobalRef(this.constructorClass);
    this.iteClass = await this.toGlobalRef(this.iteClass);
    this.characterClass = await this.toGlobalRef(this.characterClass);
    this.fieldClass = await this.toGlobalRef(this.fieldClass);
    this.systemClassLoader = await this.toGlobalRef(this.systemClassLoader);
    this.forNameMethod = await this.toGlobalRef(this.forNameMethod);
    this.getDeclaredConstructorsMethod = await this.toGlobalRef(
      this.getDeclaredConstructorsMethod,
    );
    this.getDeclaredFieldsMethod = await this.toGlobalRef(
      this.getDeclaredFieldsMethod,
    );
    this.getClassLoaderMethod = await this.toGlobalRef(
      this.getClassLoaderMethod,
    );
    this.constructorNewInstanceMethod = await this.toGlobalRef(
      this.constructorNewInstanceMethod,
    );
    this.fieldGetMethod = await this.toGlobalRef(this.fieldGetMethod);
    this.fieldSetMethod = await this.toGlobalRef(this.fieldSetMethod);
    this.loadClassMethod = await this.toGlobalRef(this.loadClassMethod);
    if (this.setAccessibleMethod) {
      this.setAccessibleMethod = await this.toGlobalRef(
        this.setAccessibleMethod,
      );
    }
    if (this.trueArgsArr) {
      this.trueArgsArr = await this.toGlobalRef(this.trueArgsArr);
    }
    for (const [key, ctor] of this.primitiveBoxCtors.entries()) {
      this.primitiveBoxCtors.set(key, await this.toGlobalRef(ctor));
    }
  }

  /**
   * Synchronous twin of {@link init}.
   */
  public initSync(): void {
    const memorySync = this.memory as any;
    const emptyStrAddr = writeUtf8CStringSync(memorySync, '');
    const emptyJstr = BigInt(
      this.callFnSync(this.fns.NewStringUTF, emptyStrAddr),
    );
    if (!emptyJstr) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: NewStringUTF returned NULL',
      );
    }

    this.stringClass = BigInt(
      this.callFnSync(this.fns.GetObjectClass, emptyJstr),
    );
    if (!this.stringClass) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: GetObjectClass(emptyJstr) returned NULL',
      );
    }

    this.objectClass = BigInt(
      this.callFnSync(this.fns.GetSuperclass, this.stringClass),
    );
    if (!this.objectClass) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: GetSuperclass(String) returned NULL',
      );
    }

    this.classClass = BigInt(
      this.callFnSync(this.fns.GetObjectClass, this.objectClass),
    );
    if (!this.classClass) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: GetObjectClass(Object.class) returned NULL',
      );
    }

    const toStringNameAddr = writeUtf8CStringSync(memorySync, 'toString');
    const toStringSigAddr = writeUtf8CStringSync(
      memorySync,
      '()Ljava/lang/String;',
    );
    this.toStringMid = BigInt(
      this.callFnSync(
        this.fns.GetMethodID,
        this.objectClass,
        toStringNameAddr,
        toStringSigAddr,
      ),
    );
    if (!this.toStringMid) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: GetMethodID(Object.toString) returned 0',
      );
    }

    const getMethodsNameAddr = writeUtf8CStringSync(memorySync, 'getMethods');
    const getMethodsSigAddr = writeUtf8CStringSync(
      memorySync,
      '()[Ljava/lang/reflect/Method;',
    );
    this.getMethodsMid = BigInt(
      this.callFnSync(
        this.fns.GetMethodID,
        this.classClass,
        getMethodsNameAddr,
        getMethodsSigAddr,
      ),
    );
    if (!this.getMethodsMid) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: GetMethodID(Class.getMethods) returned 0',
      );
    }

    const getDeclaredMethodsNameAddr = writeUtf8CStringSync(
      memorySync,
      'getDeclaredMethods',
    );
    this.getDeclaredMethodsMid = BigInt(
      this.callFnSync(
        this.fns.GetMethodID,
        this.classClass,
        getDeclaredMethodsNameAddr,
        getMethodsSigAddr,
      ),
    );
    if (!this.getDeclaredMethodsMid) {
      this.getDeclaredMethodsMid = this.getMethodsMid;
    }

    const classMethods = this.findMethodsSync(this.classClass, [
      'forName',
      'getDeclaredConstructors',
      'getDeclaredFields',
      'getClassLoader',
    ]);

    this.forNameMethod = classMethods.get('forName')!;
    this.getDeclaredConstructorsMethod = classMethods.get(
      'getDeclaredConstructors',
    )!;
    this.getDeclaredFieldsMethod = classMethods.get('getDeclaredFields')!;
    this.getClassLoaderMethod = classMethods.get('getClassLoader')!;

    this.methodClass = BigInt(
      this.callFnSync(this.fns.GetObjectClass, this.forNameMethod),
    );
    const methodInvokeMethod = this.findMethodSync(this.methodClass, 'invoke')!;
    this.invokeMid = BigInt(
      this.callFnSync(this.fns.FromReflectedMethod, methodInvokeMethod),
    );

    const forNameArgsArray = BigInt(
      this.callFnSync(this.fns.NewObjectArray, 1, this.objectClass, 0n),
    );
    this.callFnSync(
      this.fns.SetObjectArrayElement,
      forNameArgsArray,
      0,
      emptyJstr,
    );
    this.rawInvokeSync(this.forNameMethod, 0n, forNameArgsArray);

    const iteThrowable = BigInt(this.callFnSync(this.fns.ExceptionOccurred));
    this.iteClass = BigInt(
      this.callFnSync(this.fns.GetObjectClass, iteThrowable),
    );
    this.callFnSync(this.fns.ExceptionClear);

    const stringCtorsArray = this.rawInvokeSync(
      this.getDeclaredConstructorsMethod,
      this.stringClass,
      0n,
    );
    const ctor0 = BigInt(
      this.callFnSync(this.fns.GetObjectArrayElement, stringCtorsArray, 0),
    );
    this.constructorClass = BigInt(
      this.callFnSync(this.fns.GetObjectClass, ctor0),
    );
    this.constructorNewInstanceMethod = this.findMethodSync(
      this.constructorClass,
      'newInstance',
    )!;

    const getCauseMethod = this.findMethodSync(this.iteClass, 'getCause')!;
    this.getCauseMid = BigInt(
      this.callFnSync(this.fns.FromReflectedMethod, getCauseMethod),
    );

    const classLoaderClass = this.findClassByForNameSync(
      'java.lang.ClassLoader',
    );
    const getSystemClassLoaderMethod = this.findMethodSync(
      classLoaderClass,
      'getSystemClassLoader',
    )!;
    this.systemClassLoader = this.rawInvokeSync(
      getSystemClassLoaderMethod,
      0n,
      0n,
    );
    this.loadClassMethod = this.findMethodSync(classLoaderClass, 'loadClass')!;

    const stringFieldsArray = this.rawInvokeSync(
      this.getDeclaredFieldsMethod,
      this.stringClass,
      0n,
    );
    const field0 = BigInt(
      this.callFnSync(this.fns.GetObjectArrayElement, stringFieldsArray, 0),
    );
    this.fieldClass = BigInt(this.callFnSync(this.fns.GetObjectClass, field0));
    this.fieldGetMethod = this.findMethodSync(this.fieldClass, 'get')!;
    this.fieldSetMethod = this.findMethodSync(this.fieldClass, 'set')!;

    this.initBoxingSync();

    // 11. Promote long-lived bootstrap handles to Global Refs (Sync)
    this.stringClass = this.toGlobalRefSync(this.stringClass);
    this.objectClass = this.toGlobalRefSync(this.objectClass);
    this.classClass = this.toGlobalRefSync(this.classClass);
    this.methodClass = this.toGlobalRefSync(this.methodClass);
    this.constructorClass = this.toGlobalRefSync(this.constructorClass);
    this.iteClass = this.toGlobalRefSync(this.iteClass);
    this.characterClass = this.toGlobalRefSync(this.characterClass);
    this.fieldClass = this.toGlobalRefSync(this.fieldClass);
    this.systemClassLoader = this.toGlobalRefSync(this.systemClassLoader);
    this.forNameMethod = this.toGlobalRefSync(this.forNameMethod);
    this.getDeclaredConstructorsMethod = this.toGlobalRefSync(
      this.getDeclaredConstructorsMethod,
    );
    this.getDeclaredFieldsMethod = this.toGlobalRefSync(
      this.getDeclaredFieldsMethod,
    );
    this.getClassLoaderMethod = this.toGlobalRefSync(this.getClassLoaderMethod);
    this.constructorNewInstanceMethod = this.toGlobalRefSync(
      this.constructorNewInstanceMethod,
    );
    this.fieldGetMethod = this.toGlobalRefSync(this.fieldGetMethod);
    this.fieldSetMethod = this.toGlobalRefSync(this.fieldSetMethod);
    this.loadClassMethod = this.toGlobalRefSync(this.loadClassMethod);
    if (this.setAccessibleMethod) {
      this.setAccessibleMethod = this.toGlobalRefSync(this.setAccessibleMethod);
    }
    if (this.trueArgsArr) {
      this.trueArgsArr = this.toGlobalRefSync(this.trueArgsArr);
    }
    for (const [key, ctor] of this.primitiveBoxCtors.entries()) {
      this.primitiveBoxCtors.set(key, this.toGlobalRefSync(ctor));
    }
  }

  private async findClassByForName(name: string): Promise<bigint> {
    const nameAddr = await writeUtf8CString(this.memory, name);
    const nameJstr = BigInt(await this.fns.NewStringUTF(nameAddr));
    if (!nameJstr) {
      throw new NJavaError(`NewStringUTF failed for class name "${name}"`);
    }

    const argsArr = BigInt(
      await this.fns.NewObjectArray(1, this.objectClass, 0n),
    );
    await this.fns.SetObjectArrayElement(argsArr, 0, nameJstr);
    return await this.invokeMethod(this.forNameMethod, 0n, argsArr);
  }

  private findClassByForNameSync(name: string): bigint {
    const memorySync = this.memory as any;
    const nameAddr = writeUtf8CStringSync(memorySync, name);
    const nameJstr = BigInt(this.callFnSync(this.fns.NewStringUTF, nameAddr));
    if (!nameJstr) {
      throw new NJavaError(`NewStringUTF failed for class name "${name}"`);
    }

    const argsArr = BigInt(
      this.callFnSync(this.fns.NewObjectArray, 1, this.objectClass, 0n),
    );
    this.callFnSync(this.fns.SetObjectArrayElement, argsArr, 0, nameJstr);
    return this.invokeMethodSync(this.forNameMethod, 0n, argsArr);
  }

  private async initBoxing(): Promise<void> {
    const primitives: Array<[string, string]> = [
      ['boolean', 'java.lang.Boolean'],
      ['byte', 'java.lang.Byte'],
      ['short', 'java.lang.Short'],
      ['int', 'java.lang.Integer'],
      ['long', 'java.lang.Long'],
      ['float', 'java.lang.Float'],
      ['double', 'java.lang.Double'],
    ];

    for (const [prim, wrapperName] of primitives) {
      const wrapperClass = await this.findClass(wrapperName);
      const ctor = await this.findConstructor(
        wrapperClass,
        (params) => params.length === 1 && params[0] === 'java.lang.String',
      );
      if (!ctor) {
        throw new ConstructorNotFoundError(`${wrapperName}(java.lang.String)`);
      }
      this.primitiveBoxCtors.set(prim, ctor);
      this.primitiveBoxCtors.set(wrapperName, ctor);
    }

    this.characterClass = await this.findClass('java.lang.Character');
    const charCtor = await this.findConstructor(
      this.characterClass,
      (params) => params.length === 1 && params[0] === 'char',
    );
    if (!charCtor) {
      throw new ConstructorNotFoundError('java.lang.Character(char)');
    }
    this.charCtorMid = BigInt(await this.fns.FromReflectedMethod(charCtor));
    if (!this.charCtorMid) {
      throw new NJavaError(
        'ReflectionBridge bootstrap failed: FromReflectedMethod(Character.<init>) returned 0',
      );
    }

    // AccessibleObject.setAccessible(boolean)
    try {
      const accessibleObjectClass = await this.findClass(
        'java.lang.reflect.AccessibleObject',
      );
      const allMethods = await this.getAllReflectedMethods(
        accessibleObjectClass,
      );
      const setAcc = allMethods.find(
        (m) =>
          m.name === 'setAccessible' &&
          m.paramTypes.length === 1 &&
          m.paramTypes[0] === 'boolean',
      );
      this.setAccessibleMethod = setAcc?.methodObj ?? 0n;
      if (this.setAccessibleMethod) {
        const boolTrue = await this.box('boolean', true);
        const arr = BigInt(
          await this.fns.NewObjectArray(1, this.objectClass, 0n),
        );
        await this.fns.SetObjectArrayElement(arr, 0, boolTrue);
        this.trueArgsArr = arr;
      }
    } catch {}
  }

  private initBoxingSync(): void {
    const primitives: Array<[string, string]> = [
      ['boolean', 'java.lang.Boolean'],
      ['byte', 'java.lang.Byte'],
      ['short', 'java.lang.Short'],
      ['int', 'java.lang.Integer'],
      ['long', 'java.lang.Long'],
      ['float', 'java.lang.Float'],
      ['double', 'java.lang.Double'],
    ];

    for (const [prim, wrapperName] of primitives) {
      const wrapperClass = this.findClassSync(wrapperName);
      const ctor = this.findConstructorSync(
        wrapperClass,
        (params) => params.length === 1 && params[0] === 'java.lang.String',
      );
      if (!ctor) {
        throw new ConstructorNotFoundError(`${wrapperName}(java.lang.String)`);
      }
      this.primitiveBoxCtors.set(prim, ctor);
      this.primitiveBoxCtors.set(wrapperName, ctor);
    }

    this.characterClass = this.findClassSync('java.lang.Character');
    const charCtor = this.findConstructorSync(
      this.characterClass,
      (params) => params.length === 1 && params[0] === 'char',
    );
    if (!charCtor) {
      throw new ConstructorNotFoundError('java.lang.Character(char)');
    }
    this.charCtorMid = BigInt(
      this.callFnSync(this.fns.FromReflectedMethod, charCtor),
    );

    // AccessibleObject.setAccessible(boolean)
    try {
      const accessibleObjectClass = this.findClassSync(
        'java.lang.reflect.AccessibleObject',
      );
      const allMethods = this.getAllReflectedMethodsSync(accessibleObjectClass);
      const setAcc = allMethods.find(
        (m) =>
          m.name === 'setAccessible' &&
          m.paramTypes.length === 1 &&
          m.paramTypes[0] === 'boolean',
      );
      this.setAccessibleMethod = setAcc?.methodObj ?? 0n;
      if (this.setAccessibleMethod) {
        const boolTrue = this.boxSync('boolean', true);
        const arr = BigInt(
          this.callFnSync(this.fns.NewObjectArray, 1, this.objectClass, 0n),
        );
        this.callFnSync(this.fns.SetObjectArrayElement, arr, 0, boolTrue);
        this.trueArgsArr = arr;
      }
    } catch {}
  }

  /** Returns the `toString()` text ("ao-string") of a reflected object, cached. */
  public async getAoString(obj: bigint): Promise<string> {
    const jstr = BigInt(
      await this.fns.CallObjectMethodA(obj, this.toStringMid, 0n),
    );
    if (!jstr) {
      throw new NJavaError(
        `getAoString failed on object 0x${obj.toString(16)}`,
      );
    }

    try {
      const utfLength = Number(await this.fns.GetStringUTFLength(jstr));
      const utfCharsPtr = BigInt(await this.fns.GetStringUTFChars(jstr, 0n));
      const utfBuf = await this.memory.read(utfCharsPtr, utfLength);
      const str = utfBuf.toString('utf8');
      await this.fns.ReleaseStringUTFChars(jstr, utfCharsPtr);
      return str;
    } finally {
      await this.fns.DeleteLocalRef(jstr);
    }
  }

  /** Sync twin of {@link getAoString}. */
  public getAoStringSync(obj: bigint): string {
    const jstr = BigInt(
      this.callFnSync(this.fns.CallObjectMethodA, obj, this.toStringMid, 0n),
    );
    if (!jstr) {
      throw new NJavaError(
        `getAoStringSync failed on object 0x${obj.toString(16)}`,
      );
    }

    try {
      const utfLength = Number(
        this.callFnSync(this.fns.GetStringUTFLength, jstr),
      );
      const utfCharsPtr = BigInt(
        this.callFnSync(this.fns.GetStringUTFChars, jstr, 0n),
      );
      const memorySync = this.memory as any;
      const utfBuf = memorySync.readSync(utfCharsPtr, utfLength);
      const str = utfBuf.toString('utf8');
      this.callFnSync(this.fns.ReleaseStringUTFChars, jstr, utfCharsPtr);
      return str;
    } finally {
      this.callFnSync(this.fns.DeleteLocalRef, jstr);
    }
  }

  /** Bypasses Java access control checks (private/protected) on any AccessibleObject (Field, Method, Constructor). */
  public async makeAccessible(obj: bigint): Promise<void> {
    if (this.setAccessibleMethod && this.trueArgsArr && obj && obj !== 0n) {
      try {
        await this.rawInvoke(this.setAccessibleMethod, obj, this.trueArgsArr);
      } catch {}
    }
  }

  /** Sync twin of {@link makeAccessible}. */
  public makeAccessibleSync(obj: bigint): void {
    if (this.setAccessibleMethod && this.trueArgsArr && obj && obj !== 0n) {
      try {
        this.rawInvokeSync(this.setAccessibleMethod, obj, this.trueArgsArr);
      } catch {}
    }
  }

  /** Resolves the runtime java.lang.Class object handle of a live object reference. */
  public async getObjectClass(obj: bigint): Promise<bigint> {
    if (!obj || obj === 0n) return 0n;
    return BigInt(await this.fns.GetObjectClass(obj));
  }

  /** Sync twin of {@link getObjectClass}. */
  public getObjectClassSync(obj: bigint): bigint {
    if (!obj || obj === 0n) return 0n;
    return BigInt(this.callFnSync(this.fns.GetObjectClass, obj));
  }

  /** Resolves the runtime clean class name of a live object reference. */
  public async getObjectClassName(obj: bigint): Promise<string> {
    const classObj = await this.getObjectClass(obj);
    if (!classObj || classObj === 0n) return '';
    return this.getClassName(classObj);
  }

  /** Sync twin of {@link getObjectClassName}. */
  public getObjectClassNameSync(obj: bigint): string {
    const classObj = this.getObjectClassSync(obj);
    if (!classObj || classObj === 0n) return '';
    return this.getClassNameSync(classObj);
  }

  /** Returns the clean class name of a `java.lang.Class` object (e.g. "java.lang.String" or "ave"). */
  public async getClassName(classObj: bigint): Promise<string> {
    const str = await this.getAoString(classObj);
    return str.replace(/^(class|interface)\s+/, '');
  }

  /** Sync twin of {@link getClassName}. */
  public getClassNameSync(classObj: bigint): string {
    const str = this.getAoStringSync(classObj);
    return str.replace(/^(class|interface)\s+/, '');
  }

  /**
   * Resolves the direct superclass of `classObj`, or returns `undefined` if
   * `classObj` is `java.lang.Object` or an interface/primitive.
   */
  public async getSuperclass(classObj: bigint): Promise<bigint | undefined> {
    const superCls = BigInt(await this.fns.GetSuperclass(classObj));
    if (!superCls || superCls === 0n) return undefined;
    return superCls;
  }

  /** Sync twin of {@link getSuperclass}. */
  public getSuperclassSync(classObj: bigint): bigint | undefined {
    const superCls = BigInt(this.callFnSync(this.fns.GetSuperclass, classObj));
    if (!superCls || superCls === 0n) return undefined;
    return superCls;
  }

  /** Returns the entire superclass hierarchy of `classObj` up to `java.lang.Object`. */
  public async getSuperclassChain(classObj: bigint): Promise<string[]> {
    const chain: string[] = [];
    let curr: bigint | undefined = classObj;
    while (curr && curr !== 0n) {
      const name = await this.getClassName(curr);
      chain.push(name);
      if (name === 'java.lang.Object') break;
      curr = await this.getSuperclass(curr);
    }
    return chain;
  }

  /** Sync twin of {@link getSuperclassChain}. */
  public getSuperclassChainSync(classObj: bigint): string[] {
    const chain: string[] = [];
    let curr: bigint | undefined = classObj;
    while (curr && curr !== 0n) {
      const name = this.getClassNameSync(curr);
      chain.push(name);
      if (name === 'java.lang.Object') break;
      curr = this.getSuperclassSync(curr);
    }
    return chain;
  }

  /** Resolves a class by name via system class loader (no JNI `FindClass`). */
  public async findClass(name: string): Promise<bigint> {
    const nameAddr = await writeUtf8CString(this.memory, name);
    const nameJstr = BigInt(await this.fns.NewStringUTF(nameAddr));
    if (!nameJstr) {
      throw new NJavaError(`NewStringUTF failed for class name "${name}"`);
    }

    const argsArr = BigInt(
      await this.fns.NewObjectArray(1, this.objectClass, 0n),
    );
    await this.fns.SetObjectArrayElement(argsArr, 0, nameJstr);

    try {
      const cls = await this.invokeMethod(
        this.loadClassMethod,
        this.systemClassLoader,
        argsArr,
      );
      if (!cls) throw new ClassNotFoundError(name);
      return cls;
    } catch (err) {
      if (
        err instanceof ReflectiveInvokeError &&
        err.aoString.includes('ClassNotFoundException')
      ) {
        try {
          const cls = await this.invokeMethod(this.forNameMethod, 0n, argsArr);
          if (!cls) throw new ClassNotFoundError(name);
          return cls;
        } catch {
          throw new ClassNotFoundError(name);
        }
      }
      throw err;
    }
  }

  /** Sync twin of {@link findClass}. */
  public findClassSync(name: string): bigint {
    const memorySync = this.memory as any;
    const nameAddr = writeUtf8CStringSync(memorySync, name);
    const nameJstr = BigInt(this.callFnSync(this.fns.NewStringUTF, nameAddr));
    if (!nameJstr) {
      throw new NJavaError(`NewStringUTF failed for class name "${name}"`);
    }

    const argsArr = BigInt(
      this.callFnSync(this.fns.NewObjectArray, 1, this.objectClass, 0n),
    );
    this.callFnSync(this.fns.SetObjectArrayElement, argsArr, 0, nameJstr);

    try {
      const cls = this.invokeMethodSync(
        this.loadClassMethod,
        this.systemClassLoader,
        argsArr,
      );
      if (!cls) throw new ClassNotFoundError(name);
      return cls;
    } catch (err) {
      if (
        err instanceof ReflectiveInvokeError &&
        err.aoString.includes('ClassNotFoundException')
      ) {
        try {
          const cls = this.invokeMethodSync(this.forNameMethod, 0n, argsArr);
          if (!cls) throw new ClassNotFoundError(name);
          return cls;
        } catch {
          throw new ClassNotFoundError(name);
        }
      }
      throw err;
    }
  }

  /** Resolves a class by name and returns a `ReflectedClass` handle. */
  public async getClass(name: string): Promise<ReflectedClass> {
    const classObj = await this.findClass(name);
    return new ReflectedClass(classObj, name, this);
  }

  /** Sync twin of {@link getClass}. */
  public getClassSync(name: string): ReflectedClass {
    const classObj = this.findClassSync(name);
    return new ReflectedClass(classObj, name, this);
  }

  /**
   * Defines a class directly in JVM memory using JNI DefineClass.
   */
  public async defineClass(
    name: string,
    bytecode: Uint8Array | Buffer,
    loader?: bigint,
  ): Promise<bigint> {
    const memory = this.memory as any;
    const internalName = name.replace(/\./g, '/');
    return withUtf8CString(memory, internalName, async (nameAddr) => {
      return withBytes(memory, bytecode, async (bufAddr) => {
        const classPtr = BigInt(
          await this.fns.DefineClass(
            nameAddr,
            loader ?? this.systemClassLoader,
            bufAddr,
            bytecode.length,
          ),
        );
        if (!classPtr) {
          throw new NJavaError(`JNI DefineClass failed for "${name}"`);
        }
        return classPtr;
      });
    });
  }

  /**
   * Synchronous twin of defineClass.
   */
  public defineClassSync(
    name: string,
    bytecode: Uint8Array | Buffer,
    loader?: bigint,
  ): bigint {
    const memorySync = this.memory as any;
    const internalName = name.replace(/\./g, '/');
    return withUtf8CStringSync(memorySync, internalName, (nameAddr) => {
      return withBytesSync(memorySync, bytecode, (bufAddr) => {
        const classPtr = BigInt(
          this.callFnSync(
            this.fns.DefineClass,
            nameAddr,
            loader ?? this.systemClassLoader,
            bufAddr,
            bytecode.length,
          ),
        );
        if (!classPtr) {
          throw new NJavaError(`JNI DefineClass failed for "${name}"`);
        }
        return classPtr;
      });
    });
  }

  /** Resolves a single method on `classObj` by matching its name. */
  public async findMethod(
    classObj: bigint,
    name: string,
  ): Promise<bigint | undefined> {
    const map = await this.findMethods(classObj, [name]);
    return map.get(name);
  }

  /** Sync twin of {@link findMethod}. */
  public findMethodSync(classObj: bigint, name: string): bigint | undefined {
    const map = this.findMethodsSync(classObj, [name]);
    return map.get(name);
  }

  /** Resolves a single method and returns a `ReflectedMethod` handle. */
  public async getMethod(
    classObj: bigint,
    name: string,
  ): Promise<ReflectedMethod> {
    const method = await this.findReflectedMethod(classObj, name);
    if (!method) {
      throw new MethodNotFoundError(name);
    }
    return method;
  }

  /** Sync twin of {@link getMethod}. */
  public getMethodSync(classObj: bigint, name: string): ReflectedMethod {
    const method = this.findReflectedMethodSync(classObj, name);
    if (!method) {
      throw new MethodNotFoundError(name);
    }
    return method;
  }

  /** Resolves a single method and returns a `ReflectedMethod` handle, or `undefined`. */
  public async findReflectedMethod(
    classObj: bigint,
    name: string,
  ): Promise<ReflectedMethod | undefined> {
    const methodObj = await this.findMethod(classObj, name);
    if (!methodObj) return undefined;
    const aoStr = await this.getAoString(methodObj);
    const parsed = parseAccessibleObjectString(aoStr);
    return new ReflectedMethod(methodObj, parsed, this);
  }

  /** Sync twin of {@link findReflectedMethod}. */
  public findReflectedMethodSync(
    classObj: bigint,
    name: string,
  ): ReflectedMethod | undefined {
    const methodObj = this.findMethodSync(classObj, name);
    if (!methodObj) return undefined;
    const aoStr = this.getAoStringSync(methodObj);
    const parsed = parseAccessibleObjectString(aoStr);
    return new ReflectedMethod(methodObj, parsed, this);
  }

  /** Resolves multiple methods on `classObj` in a single `getMethods()` enumeration. */
  public async findMethods(
    classObj: bigint,
    names: readonly string[],
  ): Promise<Map<string, bigint>> {
    return await this.withLocalFrame(64, async () => {
      const wanted = new Set(names);
      const result = new Map<string, bigint>();

      const methodsArr = BigInt(
        await this.fns.CallObjectMethodA(classObj, this.getMethodsMid, 0n),
      );
      if (!methodsArr) return result;

      const len = Number(await this.fns.GetArrayLength(methodsArr));
      for (let i = 0; i < len; i++) {
        const methodObj = BigInt(
          await this.fns.GetObjectArrayElement(methodsArr, i),
        );
        if (!methodObj) continue;

        const aoStr = await this.getAoString(methodObj);
        const parsed = parseAccessibleObjectString(aoStr);
        if (
          parsed.name &&
          wanted.has(parsed.name) &&
          !result.has(parsed.name)
        ) {
          result.set(parsed.name, await this.toGlobalRef(methodObj));
          if (result.size === wanted.size) break;
        }
      }

      return result;
    });
  }

  /** Sync twin of {@link findMethods}. */
  public findMethodsSync(
    classObj: bigint,
    names: readonly string[],
  ): Map<string, bigint> {
    return this.withLocalFrameSync(64, () => {
      const wanted = new Set(names);
      const result = new Map<string, bigint>();

      const methodsArr = BigInt(
        this.callFnSync(
          this.fns.CallObjectMethodA,
          classObj,
          this.getMethodsMid,
          0n,
        ),
      );
      if (!methodsArr) return result;

      const len = Number(this.callFnSync(this.fns.GetArrayLength, methodsArr));
      for (let i = 0; i < len; i++) {
        const methodObj = BigInt(
          this.callFnSync(this.fns.GetObjectArrayElement, methodsArr, i),
        );
        if (!methodObj) continue;

        const aoStr = this.getAoStringSync(methodObj);
        const parsed = parseAccessibleObjectString(aoStr);
        if (
          parsed.name &&
          wanted.has(parsed.name) &&
          !result.has(parsed.name)
        ) {
          result.set(parsed.name, this.toGlobalRefSync(methodObj));
          if (result.size === wanted.size) break;
        }
      }

      return result;
    });
  }

  /** Resolves multiple methods on `classObj` and returns them as `ReflectedMethod` handles. */
  public async findReflectedMethods(
    classObj: bigint,
    names?: readonly string[],
  ): Promise<Map<string, ReflectedMethod>> {
    return await this.withLocalFrame(64, async () => {
      const wanted = names ? new Set(names) : undefined;
      const result = new Map<string, ReflectedMethod>();

      const mid = this.getDeclaredMethodsMid || this.getMethodsMid;
      const methodsArr = BigInt(
        await this.fns.CallObjectMethodA(classObj, mid, 0n),
      );
      if (!methodsArr) return result;

      const len = Number(await this.fns.GetArrayLength(methodsArr));
      for (let i = 0; i < len; i++) {
        const methodObj = BigInt(
          await this.fns.GetObjectArrayElement(methodsArr, i),
        );
        if (!methodObj) continue;

        const aoStr = await this.getAoString(methodObj);
        const parsed = parseAccessibleObjectString(aoStr);
        if (
          parsed.name &&
          (!wanted || wanted.has(parsed.name)) &&
          !result.has(parsed.name)
        ) {
          const globalMethod = await this.toGlobalRef(methodObj);
          result.set(
            parsed.name,
            new ReflectedMethod(globalMethod, parsed, this),
          );
          if (wanted && result.size === wanted.size) break;
        }
      }

      return result;
    });
  }

  /** Sync twin of {@link findReflectedMethods}. */
  public findReflectedMethodsSync(
    classObj: bigint,
    names?: readonly string[],
  ): Map<string, ReflectedMethod> {
    return this.withLocalFrameSync(64, () => {
      const wanted = names ? new Set(names) : undefined;
      const result = new Map<string, ReflectedMethod>();

      const mid = this.getDeclaredMethodsMid || this.getMethodsMid;
      const methodsArr = BigInt(
        this.callFnSync(this.fns.CallObjectMethodA, classObj, mid, 0n),
      );
      if (!methodsArr) return result;

      const len = Number(this.callFnSync(this.fns.GetArrayLength, methodsArr));
      for (let i = 0; i < len; i++) {
        const methodObj = BigInt(
          this.callFnSync(this.fns.GetObjectArrayElement, methodsArr, i),
        );
        if (!methodObj) continue;

        const aoStr = this.getAoStringSync(methodObj);
        const parsed = parseAccessibleObjectString(aoStr);
        if (
          parsed.name &&
          (!wanted || wanted.has(parsed.name)) &&
          !result.has(parsed.name)
        ) {
          const globalMethod = this.toGlobalRefSync(methodObj);
          result.set(
            parsed.name,
            new ReflectedMethod(globalMethod, parsed, this),
          );
          if (wanted && result.size === wanted.size) break;
        }
      }

      return result;
    });
  }

  /** Resolves all methods on `classObj` (including overloads and declared protected/private methods) as `ReflectedMethod[]`. */
  public async getAllReflectedMethods(
    classObj: bigint,
  ): Promise<ReflectedMethod[]> {
    return await this.withLocalFrame(128, async () => {
      const result: ReflectedMethod[] = [];
      const seen = new Set<string>();

      const mids = [this.getMethodsMid, this.getDeclaredMethodsMid].filter(
        Boolean,
      );
      for (const mid of mids) {
        const methodsArr = BigInt(
          await this.fns.CallObjectMethodA(classObj, mid, 0n),
        );
        if (!methodsArr) continue;

        const len = Number(await this.fns.GetArrayLength(methodsArr));
        for (let i = 0; i < len; i++) {
          const methodObj = BigInt(
            await this.fns.GetObjectArrayElement(methodsArr, i),
          );
          if (!methodObj) continue;

          const aoStr = await this.getAoString(methodObj);
          const parsed = parseAccessibleObjectString(aoStr);
          if (parsed.name) {
            const sig = `${parsed.name}(${parsed.paramTypes.join(',')})`;
            if (!seen.has(sig)) {
              seen.add(sig);
              const globalMethod = await this.toGlobalRef(methodObj);
              result.push(new ReflectedMethod(globalMethod, parsed, this));
            }
          }
        }
      }
      return result;
    });
  }

  /** Sync twin of {@link getAllReflectedMethods}. */
  public getAllReflectedMethodsSync(classObj: bigint): ReflectedMethod[] {
    return this.withLocalFrameSync(128, () => {
      const result: ReflectedMethod[] = [];
      const seen = new Set<string>();

      const mids = [this.getMethodsMid, this.getDeclaredMethodsMid].filter(
        Boolean,
      );
      for (const mid of mids) {
        const methodsArr = BigInt(
          this.callFnSync(this.fns.CallObjectMethodA, classObj, mid, 0n),
        );
        if (!methodsArr) continue;

        const len = Number(
          this.callFnSync(this.fns.GetArrayLength, methodsArr),
        );
        for (let i = 0; i < len; i++) {
          const methodObj = BigInt(
            this.callFnSync(this.fns.GetObjectArrayElement, methodsArr, i),
          );
          if (!methodObj) continue;

          const aoStr = this.getAoStringSync(methodObj);
          const parsed = parseAccessibleObjectString(aoStr);
          if (parsed.name) {
            const sig = `${parsed.name}(${parsed.paramTypes.join(',')})`;
            if (!seen.has(sig)) {
              seen.add(sig);
              const globalMethod = this.toGlobalRefSync(methodObj);
              result.push(new ReflectedMethod(globalMethod, parsed, this));
            }
          }
        }
      }
      return result;
    });
  }

  /** Finds a constructor on `classObj` matching a parameter-types predicate. */
  public async findConstructor(
    classObj: bigint,
    matches: (paramTypes: readonly string[]) => boolean,
  ): Promise<bigint | undefined> {
    const ctorsArr = await this.invokeMethod(
      this.getDeclaredConstructorsMethod,
      classObj,
      0n,
    );
    if (!ctorsArr) return undefined;

    const len = Number(await this.fns.GetArrayLength(ctorsArr));
    for (let i = 0; i < len; i++) {
      const ctorObj = BigInt(await this.fns.GetObjectArrayElement(ctorsArr, i));
      if (!ctorObj) continue;

      const aoStr = await this.getAoString(ctorObj);
      const parsed = parseAccessibleObjectString(aoStr);
      if (matches(parsed.paramTypes)) {
        return ctorObj;
      }
    }

    return undefined;
  }

  /** Sync twin of {@link findConstructor}. */
  public findConstructorSync(
    classObj: bigint,
    matches: (paramTypes: readonly string[]) => boolean,
  ): bigint | undefined {
    const ctorsArr = this.invokeMethodSync(
      this.getDeclaredConstructorsMethod,
      classObj,
      0n,
    );
    if (!ctorsArr) return undefined;

    const len = Number(this.callFnSync(this.fns.GetArrayLength, ctorsArr));
    for (let i = 0; i < len; i++) {
      const ctorObj = BigInt(
        this.callFnSync(this.fns.GetObjectArrayElement, ctorsArr, i),
      );
      if (!ctorObj) continue;

      const aoStr = this.getAoStringSync(ctorObj);
      const parsed = parseAccessibleObjectString(aoStr);
      if (matches(parsed.paramTypes)) {
        return ctorObj;
      }
    }

    return undefined;
  }

  /** Returns all constructors on `classObj`. */
  public async getAllConstructors(
    classObj: bigint,
  ): Promise<Array<{ ctorObj: bigint; paramTypes: readonly string[] }>> {
    return await this.withLocalFrame(64, async () => {
      const ctors: Array<{ ctorObj: bigint; paramTypes: readonly string[] }> =
        [];
      const ctorsArr = await this.invokeMethod(
        this.getDeclaredConstructorsMethod,
        classObj,
        0n,
      );
      if (!ctorsArr) return ctors;

      const len = Number(await this.fns.GetArrayLength(ctorsArr));
      for (let i = 0; i < len; i++) {
        const ctorObj = BigInt(
          await this.fns.GetObjectArrayElement(ctorsArr, i),
        );
        if (!ctorObj) continue;

        const aoStr = await this.getAoString(ctorObj);
        const parsed = parseAccessibleObjectString(aoStr);
        const globalCtor = await this.toGlobalRef(ctorObj);
        ctors.push({ ctorObj: globalCtor, paramTypes: parsed.paramTypes });
      }
      return ctors;
    });
  }

  /** Sync twin of {@link getAllConstructors}. */
  public getAllConstructorsSync(
    classObj: bigint,
  ): Array<{ ctorObj: bigint; paramTypes: readonly string[] }> {
    return this.withLocalFrameSync(64, () => {
      const ctors: Array<{ ctorObj: bigint; paramTypes: readonly string[] }> =
        [];
      const ctorsArr = this.invokeMethodSync(
        this.getDeclaredConstructorsMethod,
        classObj,
        0n,
      );
      if (!ctorsArr) return ctors;

      const len = Number(this.callFnSync(this.fns.GetArrayLength, ctorsArr));
      for (let i = 0; i < len; i++) {
        const ctorObj = BigInt(
          this.callFnSync(this.fns.GetObjectArrayElement, ctorsArr, i),
        );
        if (!ctorObj) continue;

        const aoStr = this.getAoStringSync(ctorObj);
        const parsed = parseAccessibleObjectString(aoStr);
        const globalCtor = this.toGlobalRefSync(ctorObj);
        ctors.push({ ctorObj: globalCtor, paramTypes: parsed.paramTypes });
      }
      return ctors;
    });
  }

  /** Returns the `ClassLoader` for `classObj`. */
  public async getClassLoader(classObj: bigint): Promise<bigint> {
    return await this.invokeMethod(this.getClassLoaderMethod, classObj, 0n);
  }

  /** Sync twin of {@link getClassLoader}. */
  public getClassLoaderSync(classObj: bigint): bigint {
    return this.invokeMethodSync(this.getClassLoaderMethod, classObj, 0n);
  }

  /** Resolves a single field on `classObj` (or its superclasses) by matching its name. */
  public async findField(
    classObj: bigint,
    name: string,
  ): Promise<bigint | undefined> {
    let curr: bigint | undefined = classObj;
    while (curr && curr !== 0n) {
      const map = await this.findFields(curr, [name]);
      const res = map.get(name);
      if (res) return res;
      curr = await this.getSuperclass(curr);
    }
    return undefined;
  }

  /** Sync twin of {@link findField}. */
  public findFieldSync(classObj: bigint, name: string): bigint | undefined {
    let curr: bigint | undefined = classObj;
    while (curr && curr !== 0n) {
      const map = this.findFieldsSync(curr, [name]);
      const res = map.get(name);
      if (res) return res;
      curr = this.getSuperclassSync(curr);
    }
    return undefined;
  }

  /** Resolves a single field and returns a `ReflectedField` handle. */
  public async getField(
    classObj: bigint,
    name: string,
  ): Promise<ReflectedField> {
    const field = await this.findReflectedField(classObj, name);
    if (!field) {
      throw new FieldNotFoundError(name);
    }
    return field;
  }

  /** Sync twin of {@link getField}. */
  public getFieldSync(classObj: bigint, name: string): ReflectedField {
    const field = this.findReflectedFieldSync(classObj, name);
    if (!field) {
      throw new FieldNotFoundError(name);
    }
    return field;
  }

  /** Resolves a single field and returns a `ReflectedField` handle, or `undefined`. */
  public async findReflectedField(
    classObj: bigint,
    name: string,
  ): Promise<ReflectedField | undefined> {
    const fieldObj = await this.findField(classObj, name);
    if (!fieldObj) return undefined;
    const aoStr = await this.getAoString(fieldObj);
    const parsed = parseAccessibleObjectString(aoStr);
    const globalField = await this.toGlobalRef(fieldObj);
    return new ReflectedField(globalField, parsed, this);
  }

  /** Sync twin of {@link findReflectedField}. */
  public findReflectedFieldSync(
    classObj: bigint,
    name: string,
  ): ReflectedField | undefined {
    const fieldObj = this.findFieldSync(classObj, name);
    if (!fieldObj) return undefined;
    const aoStr = this.getAoStringSync(fieldObj);
    const parsed = parseAccessibleObjectString(aoStr);
    const globalField = this.toGlobalRefSync(fieldObj);
    return new ReflectedField(globalField, parsed, this);
  }

  /** Resolves multiple fields on `classObj` in a single `getDeclaredFields()` enumeration. */
  public async findFields(
    classObj: bigint,
    names: readonly string[],
  ): Promise<Map<string, bigint>> {
    return await this.withLocalFrame(64, async () => {
      const wanted = new Set(names);
      const result = new Map<string, bigint>();

      const fieldsArr = await this.invokeMethod(
        this.getDeclaredFieldsMethod,
        classObj,
        0n,
      );
      if (!fieldsArr) return result;

      const len = Number(await this.fns.GetArrayLength(fieldsArr));
      for (let i = 0; i < len; i++) {
        const fieldObj = BigInt(
          await this.fns.GetObjectArrayElement(fieldsArr, i),
        );
        if (!fieldObj) continue;

        const aoStr = await this.getAoString(fieldObj);
        const parsed = parseAccessibleObjectString(aoStr);
        if (
          parsed.name &&
          wanted.has(parsed.name) &&
          !result.has(parsed.name)
        ) {
          result.set(parsed.name, await this.toGlobalRef(fieldObj));
          if (result.size === wanted.size) break;
        }
      }

      return result;
    });
  }

  /** Sync twin of {@link findFields}. */
  public findFieldsSync(
    classObj: bigint,
    names: readonly string[],
  ): Map<string, bigint> {
    return this.withLocalFrameSync(64, () => {
      const wanted = new Set(names);
      const result = new Map<string, bigint>();

      const fieldsArr = this.invokeMethodSync(
        this.getDeclaredFieldsMethod,
        classObj,
        0n,
      );
      if (!fieldsArr) return result;

      const len = Number(this.callFnSync(this.fns.GetArrayLength, fieldsArr));
      for (let i = 0; i < len; i++) {
        const fieldObj = BigInt(
          this.callFnSync(this.fns.GetObjectArrayElement, fieldsArr, i),
        );
        if (!fieldObj) continue;

        const aoStr = this.getAoStringSync(fieldObj);
        const parsed = parseAccessibleObjectString(aoStr);
        if (
          parsed.name &&
          wanted.has(parsed.name) &&
          !result.has(parsed.name)
        ) {
          result.set(parsed.name, this.toGlobalRefSync(fieldObj));
          if (result.size === wanted.size) break;
        }
      }

      return result;
    });
  }

  /** Resolves multiple fields on `classObj` and returns them as `ReflectedField` handles. */
  public async findReflectedFields(
    classObj: bigint,
    names?: readonly string[],
  ): Promise<Map<string, ReflectedField>> {
    const wanted = names ? new Set(names) : undefined;
    const result = new Map<string, ReflectedField>();

    const fieldsArr = await this.invokeMethod(
      this.getDeclaredFieldsMethod,
      classObj,
      0n,
    );
    if (!fieldsArr) return result;

    const len = Number(await this.fns.GetArrayLength(fieldsArr));
    for (let i = 0; i < len; i++) {
      const fieldObj = BigInt(
        await this.fns.GetObjectArrayElement(fieldsArr, i),
      );
      if (!fieldObj) continue;

      const aoStr = await this.getAoString(fieldObj);
      const parsed = parseAccessibleObjectString(aoStr);
      if (
        parsed.name &&
        (!wanted || wanted.has(parsed.name)) &&
        !result.has(parsed.name)
      ) {
        result.set(parsed.name, new ReflectedField(fieldObj, parsed, this));
        if (wanted && result.size === wanted.size) break;
      }
    }

    return result;
  }

  /** Sync twin of {@link findReflectedFields}. */
  public findReflectedFieldsSync(
    classObj: bigint,
    names?: readonly string[],
  ): Map<string, ReflectedField> {
    const wanted = names ? new Set(names) : undefined;
    const result = new Map<string, ReflectedField>();

    const fieldsArr = this.invokeMethodSync(
      this.getDeclaredFieldsMethod,
      classObj,
      0n,
    );
    if (!fieldsArr) return result;

    const len = Number(this.callFnSync(this.fns.GetArrayLength, fieldsArr));
    for (let i = 0; i < len; i++) {
      const fieldObj = BigInt(
        this.callFnSync(this.fns.GetObjectArrayElement, fieldsArr, i),
      );
      if (!fieldObj) continue;

      const aoStr = this.getAoStringSync(fieldObj);
      const parsed = parseAccessibleObjectString(aoStr);
      if (
        parsed.name &&
        (!wanted || wanted.has(parsed.name)) &&
        !result.has(parsed.name)
      ) {
        result.set(parsed.name, new ReflectedField(fieldObj, parsed, this));
        if (wanted && result.size === wanted.size) break;
      }
    }

    return result;
  }

  /** Reads the raw `jobject` value of a field via `Field.get(instance)`. */
  public async getFieldValue(fieldObj: bigint, instance = 0n): Promise<bigint> {
    await this.makeAccessible(fieldObj);
    const invokeArgs = BigInt(
      await this.fns.NewObjectArray(1, this.objectClass, 0n),
    );
    await this.fns.SetObjectArrayElement(invokeArgs, 0, instance);
    return await this.invokeMethod(this.fieldGetMethod, fieldObj, invokeArgs);
  }

  /** Sync twin of {@link getFieldValue}. */
  public getFieldValueSync(fieldObj: bigint, instance = 0n): bigint {
    this.makeAccessibleSync(fieldObj);
    const invokeArgs = BigInt(
      this.callFnSync(this.fns.NewObjectArray, 1, this.objectClass, 0n),
    );
    this.callFnSync(this.fns.SetObjectArrayElement, invokeArgs, 0, instance);
    return this.invokeMethodSync(this.fieldGetMethod, fieldObj, invokeArgs);
  }

  /** Reads and unboxes a field's value to its native JS type. */
  public async getFieldValueUnboxed(
    fieldObj: bigint,
    instance = 0n,
  ): Promise<string | number | boolean | bigint | null> {
    const aoStr = await this.getAoString(fieldObj);
    const parsed = parseAccessibleObjectString(aoStr);
    const rawVal = await this.getFieldValue(fieldObj, instance);
    return await this.unbox(rawVal, parsed.type ?? undefined);
  }

  /** Sync twin of {@link getFieldValueUnboxed}. */
  public getFieldValueUnboxedSync(
    fieldObj: bigint,
    instance = 0n,
  ): string | number | boolean | bigint | null {
    const aoStr = this.getAoStringSync(fieldObj);
    const parsed = parseAccessibleObjectString(aoStr);
    const rawVal = this.getFieldValueSync(fieldObj, instance);
    return this.unboxSync(rawVal, parsed.type ?? undefined);
  }

  /** Finds a field by name on `classObj` and reads its unboxed value. */
  public async readField(
    classObj: bigint,
    fieldName: string,
    instance = 0n,
  ): Promise<string | number | boolean | bigint | null> {
    const fieldObj = await this.findField(classObj, fieldName);
    if (!fieldObj) {
      throw new FieldNotFoundError(fieldName);
    }
    return await this.getFieldValueUnboxed(fieldObj, instance);
  }

  /** Sync twin of {@link readField}. */
  public readFieldSync(
    classObj: bigint,
    fieldName: string,
    instance = 0n,
  ): string | number | boolean | bigint | null {
    const fieldObj = this.findFieldSync(classObj, fieldName);
    if (!fieldObj) {
      throw new FieldNotFoundError(fieldName);
    }
    return this.getFieldValueUnboxedSync(fieldObj, instance);
  }

  /** Sets a field's value via `Field.set(instance, value)` with auto-boxing. */
  public async setFieldValue(
    fieldObj: bigint,
    value: string | number | boolean | bigint,
    instance = 0n,
  ): Promise<void> {
    await this.makeAccessible(fieldObj);
    const aoStr = await this.getAoString(fieldObj);
    const parsed = parseAccessibleObjectString(aoStr);

    let boxedVal: bigint;
    if (parsed.type && isPrimitiveTypeName(parsed.type)) {
      boxedVal = await this.box(parsed.type, value);
    } else if (
      parsed.type === 'java.lang.String' &&
      typeof value === 'string'
    ) {
      const strAddr = await writeUtf8CString(this.memory, value);
      boxedVal = BigInt(await this.fns.NewStringUTF(strAddr));
    } else {
      boxedVal = BigInt(value);
    }

    const invokeArgs = BigInt(
      await this.fns.NewObjectArray(2, this.objectClass, 0n),
    );
    await this.fns.SetObjectArrayElement(invokeArgs, 0, instance);
    await this.fns.SetObjectArrayElement(invokeArgs, 1, boxedVal);

    await this.invokeMethod(this.fieldSetMethod, fieldObj, invokeArgs);
  }

  /** Sync twin of {@link setFieldValue}. */
  public setFieldValueSync(
    fieldObj: bigint,
    value: string | number | boolean | bigint,
    instance = 0n,
  ): void {
    this.makeAccessibleSync(fieldObj);
    const aoStr = this.getAoStringSync(fieldObj);
    const parsed = parseAccessibleObjectString(aoStr);

    let boxedVal: bigint;
    if (parsed.type && isPrimitiveTypeName(parsed.type)) {
      boxedVal = this.boxSync(parsed.type, value);
    } else if (
      parsed.type === 'java.lang.String' &&
      typeof value === 'string'
    ) {
      const memorySync = this.memory as any;
      const strAddr = writeUtf8CStringSync(memorySync, value);
      boxedVal = BigInt(this.callFnSync(this.fns.NewStringUTF, strAddr));
    } else {
      boxedVal = BigInt(value);
    }

    const invokeArgs = BigInt(
      this.callFnSync(this.fns.NewObjectArray, 2, this.objectClass, 0n),
    );
    this.callFnSync(this.fns.SetObjectArrayElement, invokeArgs, 0, instance);
    this.callFnSync(this.fns.SetObjectArrayElement, invokeArgs, 1, boxedVal);

    this.invokeMethodSync(this.fieldSetMethod, fieldObj, invokeArgs);
  }

  /** Finds a field by name on `classObj` and sets its value with auto-boxing. */
  public async writeField(
    classObj: bigint,
    fieldName: string,
    value: string | number | boolean | bigint,
    instance = 0n,
  ): Promise<void> {
    const fieldObj = await this.findField(classObj, fieldName);
    if (!fieldObj) {
      throw new FieldNotFoundError(fieldName);
    }
    await this.setFieldValue(fieldObj, value, instance);
  }

  /** Sync twin of {@link writeField}. */
  public writeFieldSync(
    classObj: bigint,
    fieldName: string,
    value: string | number | boolean | bigint,
    instance = 0n,
  ): void {
    const fieldObj = this.findFieldSync(classObj, fieldName);
    if (!fieldObj) {
      throw new FieldNotFoundError(fieldName);
    }
    this.setFieldValueSync(fieldObj, value, instance);
  }

  private async rawInvoke(
    methodObj: bigint,
    instance: bigint,
    argsArray: bigint,
  ): Promise<bigint> {
    return await withJvalueObjectArray(
      this.memory as any,
      [instance, argsArray],
      async (jvalAddr) => {
        return BigInt(
          await this.fns.CallObjectMethodA(methodObj, this.invokeMid, jvalAddr),
        );
      },
    );
  }

  private rawInvokeSync(
    methodObj: bigint,
    instance: bigint,
    argsArray: bigint,
  ): bigint {
    return withJvalueObjectArraySync(
      this.memory as any,
      [instance, argsArray],
      (jvalAddr) => {
        return BigInt(
          this.callFnSync(
            this.fns.CallObjectMethodA,
            methodObj,
            this.invokeMid,
            jvalAddr,
          ),
        );
      },
    );
  }

  private async checkAndUnwrapException(): Promise<void> {
    let exc = BigInt(await this.fns.ExceptionOccurred());
    if (!exc) return;

    // Immediately clear pending exception before inspecting the throwable object
    await this.fns.ExceptionClear();

    for (;;) {
      const excClass = BigInt(await this.fns.GetObjectClass(exc));
      const isSame =
        (await this.fns.IsSameObject(excClass, this.iteClass)) !== 0;
      if (!isSame) break;

      const cause = BigInt(
        await this.fns.CallObjectMethodA(exc, this.getCauseMid, 0n),
      );
      if (!cause) break;
      exc = cause;
    }

    const aoString = await this.getAoString(exc);
    throw new ReflectiveInvokeError(aoString);
  }

  private checkAndUnwrapExceptionSync(): void {
    let exc = BigInt(this.callFnSync(this.fns.ExceptionOccurred));
    if (!exc) return;

    // Immediately clear pending exception before inspecting the throwable object
    this.callFnSync(this.fns.ExceptionClear);

    for (;;) {
      const excClass = BigInt(this.callFnSync(this.fns.GetObjectClass, exc));
      const isSame =
        this.callFnSync(this.fns.IsSameObject, excClass, this.iteClass) !== 0;
      if (!isSame) break;

      const cause = BigInt(
        this.callFnSync(this.fns.CallObjectMethodA, exc, this.getCauseMid, 0n),
      );
      if (!cause) break;
      exc = cause;
    }

    const aoString = this.getAoStringSync(exc);
    throw new ReflectiveInvokeError(aoString);
  }

  /** Raw `Method.invoke` call with unwrapped exception handling. */
  public async invokeMethod(
    methodObj: bigint,
    instance: bigint,
    argsArray: bigint,
  ): Promise<bigint> {
    await this.makeAccessible(methodObj);
    const res = await this.rawInvoke(methodObj, instance, argsArray);
    await this.checkAndUnwrapException();
    return res;
  }

  /** Sync twin of {@link invokeMethod}. */
  public invokeMethodSync(
    methodObj: bigint,
    instance: bigint,
    argsArray: bigint,
  ): bigint {
    this.makeAccessibleSync(methodObj);
    const res = this.rawInvokeSync(methodObj, instance, argsArray);
    this.checkAndUnwrapExceptionSync();
    return res;
  }

  /** Raw `Constructor.newInstance` call with unwrapped exception handling. */
  public async newInstance(
    ctorObj: bigint,
    argsArray: bigint,
  ): Promise<bigint> {
    await this.makeAccessible(ctorObj);
    const invokeArgs = BigInt(
      await this.fns.NewObjectArray(1, this.objectClass, 0n),
    );
    await this.fns.SetObjectArrayElement(invokeArgs, 0, argsArray);
    return await this.invokeMethod(
      this.constructorNewInstanceMethod,
      ctorObj,
      invokeArgs,
    );
  }

  /** Sync twin of {@link newInstance}. */
  public newInstanceSync(ctorObj: bigint, argsArray: bigint): bigint {
    this.makeAccessibleSync(ctorObj);
    const invokeArgs = BigInt(
      this.callFnSync(this.fns.NewObjectArray, 1, this.objectClass, 0n),
    );
    this.callFnSync(this.fns.SetObjectArrayElement, invokeArgs, 0, argsArray);
    return this.invokeMethodSync(
      this.constructorNewInstanceMethod,
      ctorObj,
      invokeArgs,
    );
  }

  /** Boxes a JS primitive into its Java wrapper object. */
  public async box(
    primitiveType: string,
    value: string | number | boolean | bigint,
  ): Promise<bigint> {
    const normalized = primitiveType.toLowerCase();
    if (normalized === 'char' || primitiveType === 'java.lang.Character') {
      let charCode: number;
      if (typeof value === 'string') {
        charCode = value.charCodeAt(0);
      } else if (typeof value === 'number') {
        charCode = value;
      } else if (typeof value === 'bigint') {
        charCode = Number(value);
      } else {
        throw new BoxingUnsupportedError(primitiveType);
      }
      return await withJvalueObjectArray(
        this.memory as any,
        [BigInt(charCode)],
        async (jvalAddr) => {
          const res = BigInt(
            await this.fns.NewObjectA(
              this.characterClass,
              this.charCtorMid,
              jvalAddr,
            ),
          );
          await this.checkAndUnwrapException();
          return res;
        },
      );
    }

    let strVal: string;
    if (normalized === 'boolean' || primitiveType === 'java.lang.Boolean') {
      strVal = value ? 'true' : 'false';
    } else if (
      normalized === 'byte' ||
      normalized === 'short' ||
      normalized === 'int' ||
      normalized === 'long' ||
      normalized === 'float' ||
      normalized === 'double' ||
      primitiveType.startsWith('java.lang.')
    ) {
      strVal = String(value);
    } else {
      throw new BoxingUnsupportedError(primitiveType);
    }

    const ctor = this.primitiveBoxCtors.get(primitiveType);
    if (!ctor) throw new BoxingUnsupportedError(primitiveType);

    return await withUtf8CString(
      this.memory as any,
      strVal,
      async (strAddr) => {
        const jstr = BigInt(await this.fns.NewStringUTF(strAddr));
        if (!jstr) {
          throw new NJavaError(
            `NewStringUTF failed for boxed value "${strVal}"`,
          );
        }

        const ctorArgs = BigInt(
          await this.fns.NewObjectArray(1, this.objectClass, 0n),
        );
        await this.fns.SetObjectArrayElement(ctorArgs, 0, jstr);

        return await this.newInstance(ctor, ctorArgs);
      },
    );
  }

  /** Sync twin of {@link box}. */
  public boxSync(
    primitiveType: string,
    value: string | number | boolean | bigint,
  ): bigint {
    const normalized = primitiveType.toLowerCase();
    const memorySync = this.memory as any;
    if (normalized === 'char' || primitiveType === 'java.lang.Character') {
      let charCode: number;
      if (typeof value === 'string') {
        charCode = value.charCodeAt(0);
      } else if (typeof value === 'number') {
        charCode = value;
      } else if (typeof value === 'bigint') {
        charCode = Number(value);
      } else {
        throw new BoxingUnsupportedError(primitiveType);
      }
      return withJvalueObjectArraySync(
        memorySync,
        [BigInt(charCode)],
        (jvalAddr) => {
          const res = BigInt(
            this.callFnSync(
              this.fns.NewObjectA,
              this.characterClass,
              this.charCtorMid,
              jvalAddr,
            ),
          );
          this.checkAndUnwrapExceptionSync();
          return res;
        },
      );
    }

    let strVal: string;
    if (normalized === 'boolean' || primitiveType === 'java.lang.Boolean') {
      strVal = value ? 'true' : 'false';
    } else if (
      normalized === 'byte' ||
      normalized === 'short' ||
      normalized === 'int' ||
      normalized === 'long' ||
      normalized === 'float' ||
      normalized === 'double' ||
      primitiveType.startsWith('java.lang.')
    ) {
      strVal = String(value);
    } else {
      throw new BoxingUnsupportedError(primitiveType);
    }

    const ctor = this.primitiveBoxCtors.get(primitiveType);
    if (!ctor) throw new BoxingUnsupportedError(primitiveType);

    return withUtf8CStringSync(memorySync, strVal, (strAddr) => {
      const jstr = BigInt(this.callFnSync(this.fns.NewStringUTF, strAddr));
      if (!jstr) {
        throw new NJavaError(`NewStringUTF failed for boxed value "${strVal}"`);
      }

      const ctorArgs = BigInt(
        this.callFnSync(this.fns.NewObjectArray, 1, this.objectClass, 0n),
      );
      this.callFnSync(this.fns.SetObjectArrayElement, ctorArgs, 0, jstr);

      return this.newInstanceSync(ctor, ctorArgs);
    });
  }

  /** Ergonomic `Method.invoke` with auto-boxing of primitive arguments. */
  public async invoke(
    methodObj: bigint,
    instance: bigint,
    args: readonly (string | number | boolean | bigint)[],
  ): Promise<bigint> {
    const aoStr = await this.getAoString(methodObj);
    const parsed = parseAccessibleObjectString(aoStr);

    const boxedElements: bigint[] = [];
    for (let i = 0; i < args.length; i++) {
      const paramType = parsed.paramTypes[i];
      const arg = args[i];
      if (arg === undefined) continue;

      if (paramType && isPrimitiveTypeName(paramType)) {
        boxedElements.push(await this.box(paramType, arg));
      } else if (typeof arg === 'string') {
        const strAddr = await writeUtf8CString(this.memory, arg);
        boxedElements.push(BigInt(await this.fns.NewStringUTF(strAddr)));
      } else {
        boxedElements.push(BigInt(arg));
      }
    }

    const argsArr = BigInt(
      await this.fns.NewObjectArray(boxedElements.length, this.objectClass, 0n),
    );
    for (let i = 0; i < boxedElements.length; i++) {
      const elem = boxedElements[i];
      if (elem !== undefined) {
        await this.fns.SetObjectArrayElement(argsArr, i, elem);
      }
    }

    return await this.invokeMethod(methodObj, instance, argsArr);
  }

  /** Sync twin of {@link invoke}. */
  public invokeSync(
    methodObj: bigint,
    instance: bigint,
    args: readonly (string | number | boolean | bigint)[],
  ): bigint {
    const aoStr = this.getAoStringSync(methodObj);
    const parsed = parseAccessibleObjectString(aoStr);

    const boxedElements: bigint[] = [];
    for (let i = 0; i < args.length; i++) {
      const paramType = parsed.paramTypes[i];
      const arg = args[i];
      if (arg === undefined) continue;

      if (paramType && isPrimitiveTypeName(paramType)) {
        boxedElements.push(this.boxSync(paramType, arg));
      } else if (typeof arg === 'string') {
        const memorySync = this.memory as any;
        const strAddr = writeUtf8CStringSync(memorySync, arg);
        boxedElements.push(
          BigInt(this.callFnSync(this.fns.NewStringUTF, strAddr)),
        );
      } else {
        boxedElements.push(BigInt(arg));
      }
    }

    const argsArr = BigInt(
      this.callFnSync(
        this.fns.NewObjectArray,
        boxedElements.length,
        this.objectClass,
        0n,
      ),
    );
    for (let i = 0; i < boxedElements.length; i++) {
      const elem = boxedElements[i];
      if (elem !== undefined) {
        this.callFnSync(this.fns.SetObjectArrayElement, argsArr, i, elem);
      }
    }

    return this.invokeMethodSync(methodObj, instance, argsArr);
  }

  /** Ergonomic `Method.invoke` with auto-boxing of args and unboxing of the return value. */
  public async invokeUnboxed(
    methodObj: bigint,
    instance: bigint,
    args: readonly (string | number | boolean | bigint)[],
  ): Promise<string | number | boolean | bigint | null> {
    const aoStr = await this.getAoString(methodObj);
    const parsed = parseAccessibleObjectString(aoStr);
    const rawRes = await this.invoke(methodObj, instance, args);
    if (parsed.type === 'void') return null;
    return await this.unbox(rawRes, parsed.type ?? undefined);
  }

  /** Sync twin of {@link invokeUnboxed}. */
  public invokeUnboxedSync(
    methodObj: bigint,
    instance: bigint,
    args: readonly (string | number | boolean | bigint)[],
  ): string | number | boolean | bigint | null {
    const aoStr = this.getAoStringSync(methodObj);
    const parsed = parseAccessibleObjectString(aoStr);
    const rawRes = this.invokeSync(methodObj, instance, args);
    if (parsed.type === 'void') return null;
    return this.unboxSync(rawRes, parsed.type ?? undefined);
  }

  /** Unboxes a Java object (`Integer`, `Boolean`, `Double`, `String`, etc.) into a JS value. */
  public async unbox(
    obj: bigint,
    typeHint?: string,
  ): Promise<string | number | boolean | bigint | null> {
    if (!obj || obj === 0n) return null;

    const normalized = typeHint ? typeHint.toLowerCase() : '';

    if (normalized === 'boolean' || typeHint === 'java.lang.Boolean') {
      const str = await this.getAoString(obj);
      return str === 'true';
    }

    if (
      normalized === 'int' ||
      normalized === 'short' ||
      normalized === 'byte' ||
      typeHint === 'java.lang.Integer' ||
      typeHint === 'java.lang.Short' ||
      typeHint === 'java.lang.Byte'
    ) {
      const str = await this.getAoString(obj);
      return parseInt(str, 10);
    }

    if (normalized === 'long' || typeHint === 'java.lang.Long') {
      const str = await this.getAoString(obj);
      return BigInt(str);
    }

    if (
      normalized === 'double' ||
      normalized === 'float' ||
      typeHint === 'java.lang.Double' ||
      typeHint === 'java.lang.Float'
    ) {
      const str = await this.getAoString(obj);
      return parseFloat(str);
    }

    if (normalized === 'char' || typeHint === 'java.lang.Character') {
      return await this.getAoString(obj);
    }

    if (typeHint === 'java.lang.String') {
      const len = Number(await this.fns.GetStringLength(obj));
      const charsPtr = BigInt(await this.fns.GetStringChars(obj, 0n));
      const buf = await this.memory.read(charsPtr, len * 2);
      const str = buf.toString('utf16le');
      await this.fns.ReleaseStringChars(obj, charsPtr);
      return str;
    }

    const objClass = BigInt(await this.fns.GetObjectClass(obj));
    if ((await this.fns.IsSameObject(objClass, this.stringClass)) !== 0) {
      const len = Number(await this.fns.GetStringLength(obj));
      const charsPtr = BigInt(await this.fns.GetStringChars(obj, 0n));
      const buf = await this.memory.read(charsPtr, len * 2);
      const str = buf.toString('utf16le');
      await this.fns.ReleaseStringChars(obj, charsPtr);
      return str;
    }

    return obj;
  }

  /** Sync twin of {@link unbox}. */
  public unboxSync(
    obj: bigint,
    typeHint?: string,
  ): string | number | boolean | bigint | null {
    if (!obj || obj === 0n) return null;

    const normalized = typeHint ? typeHint.toLowerCase() : '';

    if (normalized === 'boolean' || typeHint === 'java.lang.Boolean') {
      const str = this.getAoStringSync(obj);
      return str === 'true';
    }

    if (
      normalized === 'int' ||
      normalized === 'short' ||
      normalized === 'byte' ||
      typeHint === 'java.lang.Integer' ||
      typeHint === 'java.lang.Short' ||
      typeHint === 'java.lang.Byte'
    ) {
      const str = this.getAoStringSync(obj);
      return parseInt(str, 10);
    }

    if (normalized === 'long' || typeHint === 'java.lang.Long') {
      const str = this.getAoStringSync(obj);
      return BigInt(str);
    }

    if (
      normalized === 'double' ||
      normalized === 'float' ||
      typeHint === 'java.lang.Double' ||
      typeHint === 'java.lang.Float'
    ) {
      const str = this.getAoStringSync(obj);
      return parseFloat(str);
    }

    if (normalized === 'char' || typeHint === 'java.lang.Character') {
      return this.getAoStringSync(obj);
    }

    const memorySync = this.memory as any;
    if (typeHint === 'java.lang.String') {
      const len = Number(this.callFnSync(this.fns.GetStringLength, obj));
      const charsPtr = BigInt(
        this.callFnSync(this.fns.GetStringChars, obj, 0n),
      );
      const buf = memorySync.readSync(charsPtr, len * 2);
      const str = buf.toString('utf16le');
      this.callFnSync(this.fns.ReleaseStringChars, obj, charsPtr);
      return str;
    }

    const objClass = BigInt(this.callFnSync(this.fns.GetObjectClass, obj));
    if (
      this.callFnSync(this.fns.IsSameObject, objClass, this.stringClass) !== 0
    ) {
      const len = Number(this.callFnSync(this.fns.GetStringLength, obj));
      const charsPtr = BigInt(
        this.callFnSync(this.fns.GetStringChars, obj, 0n),
      );
      const buf = memorySync.readSync(charsPtr, len * 2);
      const str = buf.toString('utf16le');
      this.callFnSync(this.fns.ReleaseStringChars, obj, charsPtr);
      return str;
    }

    return obj;
  }

  /** Ergonomic `Constructor.newInstance` with auto-boxing of primitive arguments. */
  public async construct(
    ctorObj: bigint,
    args: readonly (string | number | boolean | bigint)[],
  ): Promise<bigint> {
    const aoStr = await this.getAoString(ctorObj);
    const parsed = parseAccessibleObjectString(aoStr);

    const boxedElements: bigint[] = [];
    for (let i = 0; i < args.length; i++) {
      const paramType = parsed.paramTypes[i];
      const arg = args[i];
      if (arg === undefined) continue;

      if (paramType && isPrimitiveTypeName(paramType)) {
        boxedElements.push(await this.box(paramType, arg));
      } else if (typeof arg === 'string') {
        const strAddr = await writeUtf8CString(this.memory, arg);
        boxedElements.push(BigInt(await this.fns.NewStringUTF(strAddr)));
      } else {
        boxedElements.push(BigInt(arg));
      }
    }

    const argsArr = BigInt(
      await this.fns.NewObjectArray(boxedElements.length, this.objectClass, 0n),
    );
    for (let i = 0; i < boxedElements.length; i++) {
      const elem = boxedElements[i];
      if (elem !== undefined) {
        await this.fns.SetObjectArrayElement(argsArr, i, elem);
      }
    }

    return await this.newInstance(ctorObj, argsArr);
  }

  /** Sync twin of {@link construct}. */
  public constructSync(
    ctorObj: bigint,
    args: readonly (string | number | boolean | bigint)[],
  ): bigint {
    const aoStr = this.getAoStringSync(ctorObj);
    const parsed = parseAccessibleObjectString(aoStr);

    const boxedElements: bigint[] = [];
    for (let i = 0; i < args.length; i++) {
      const paramType = parsed.paramTypes[i];
      const arg = args[i];
      if (arg === undefined) continue;

      if (paramType && isPrimitiveTypeName(paramType)) {
        boxedElements.push(this.boxSync(paramType, arg));
      } else if (typeof arg === 'string') {
        const memorySync = this.memory as any;
        const strAddr = writeUtf8CStringSync(memorySync, arg);
        boxedElements.push(
          BigInt(this.callFnSync(this.fns.NewStringUTF, strAddr)),
        );
      } else {
        boxedElements.push(BigInt(arg));
      }
    }

    const argsArr = BigInt(
      this.callFnSync(
        this.fns.NewObjectArray,
        boxedElements.length,
        this.objectClass,
        0n,
      ),
    );
    for (let i = 0; i < boxedElements.length; i++) {
      const elem = boxedElements[i];
      if (elem !== undefined) {
        this.callFnSync(this.fns.SetObjectArrayElement, argsArr, i, elem);
      }
    }

    return this.newInstanceSync(ctorObj, argsArr);
  }
}

/**
 * Handle representing a reflected Java `Field`, providing high-level `get()` and `set()`
 * with automatic type unboxing and primitive boxing in both sync and async modes.
 */
export class ReflectedField {
  constructor(
    public readonly fieldObj: bigint,
    public readonly parsed: ParsedAccessibleObject,
    private readonly bridge: ReflectionBridge,
  ) {}

  public get name(): string {
    return this.parsed.name ?? '';
  }

  public get type(): string | null {
    return this.parsed.type;
  }

  public get declaringClass(): string {
    return this.parsed.declaringClass;
  }

  public get isStatic(): boolean {
    return this.parsed.modifiers.has('static');
  }

  /**
   * Reads and automatically unboxes the field value asynchronously.
   * For static fields, `instance` can be omitted (defaults to `0n`).
   */
  public async get(
    instance = 0n,
  ): Promise<string | number | boolean | bigint | null> {
    return await this.bridge.getFieldValueUnboxed(this.fieldObj, instance);
  }

  /** Sync twin of {@link get}. */
  public getSync(instance = 0n): string | number | boolean | bigint | null {
    return this.bridge.getFieldValueUnboxedSync(this.fieldObj, instance);
  }

  /** Reads the raw `jobject` pointer without unboxing. */
  public async getRaw(instance = 0n): Promise<bigint> {
    return await this.bridge.getFieldValue(this.fieldObj, instance);
  }

  /** Sync twin of {@link getRaw}. */
  public getRawSync(instance = 0n): bigint {
    return this.bridge.getFieldValueSync(this.fieldObj, instance);
  }

  /** Sets the field value with automatic primitive boxing. */
  public async set(
    value: string | number | boolean | bigint,
    instance = 0n,
  ): Promise<void> {
    await this.bridge.setFieldValue(this.fieldObj, value, instance);
  }

  /** Sync twin of {@link set}. */
  public setSync(
    value: string | number | boolean | bigint,
    instance = 0n,
  ): void {
    this.bridge.setFieldValueSync(this.fieldObj, value, instance);
  }
}

/**
 * Handle representing a reflected Java `Method`, providing high-level `invoke()` / `call()`
 * with automatic argument boxing and return value unboxing in both sync and async modes.
 */
export class ReflectedMethod {
  constructor(
    public readonly methodObj: bigint,
    public readonly parsed: ParsedAccessibleObject,
    private readonly bridge: ReflectionBridge,
  ) {}

  public get name(): string {
    return this.parsed.name ?? '';
  }

  public get type(): string | null {
    return this.parsed.type;
  }

  public get returnType(): string | null {
    return this.parsed.type;
  }

  public get declaringClass(): string {
    return this.parsed.declaringClass;
  }

  public get isStatic(): boolean {
    return this.parsed.modifiers.has('static');
  }

  public get paramTypes(): readonly string[] {
    return this.parsed.paramTypes;
  }

  /** Invokes the method asynchronously with automatic argument boxing and return value unboxing. */
  public async invoke(
    instanceOrArgs?: bigint | readonly (string | number | boolean | bigint)[],
    maybeArgs?: readonly (string | number | boolean | bigint)[],
  ): Promise<string | number | boolean | bigint | null> {
    let instance = 0n;
    let args: readonly (string | number | boolean | bigint)[] = [];

    if (Array.isArray(instanceOrArgs)) {
      args = instanceOrArgs;
    } else if (typeof instanceOrArgs === 'bigint') {
      instance = instanceOrArgs;
      if (maybeArgs) args = maybeArgs;
    }

    return await this.bridge.invokeUnboxed(this.methodObj, instance, args);
  }

  /** Sync twin of {@link invoke}. */
  public invokeSync(
    instanceOrArgs?: bigint | readonly (string | number | boolean | bigint)[],
    maybeArgs?: readonly (string | number | boolean | bigint)[],
  ): string | number | boolean | bigint | null {
    let instance = 0n;
    let args: readonly (string | number | boolean | bigint)[] = [];

    if (Array.isArray(instanceOrArgs)) {
      args = instanceOrArgs;
    } else if (typeof instanceOrArgs === 'bigint') {
      instance = instanceOrArgs;
      if (maybeArgs) args = maybeArgs;
    }

    return this.bridge.invokeUnboxedSync(this.methodObj, instance, args);
  }

  /** Invokes the method on an instance (or static with `0n`) with variadic arguments. */
  public async call(
    instance: bigint,
    ...args: (string | number | boolean | bigint)[]
  ): Promise<string | number | boolean | bigint | null> {
    return await this.bridge.invokeUnboxed(this.methodObj, instance, args);
  }

  /** Sync twin of {@link call}. */
  public callSync(
    instance: bigint,
    ...args: (string | number | boolean | bigint)[]
  ): string | number | boolean | bigint | null {
    return this.bridge.invokeUnboxedSync(this.methodObj, instance, args);
  }

  /** Invokes the method and returns the raw `jobject` pointer. */
  public async invokeRaw(
    instance: bigint,
    args: readonly (string | number | boolean | bigint)[],
  ): Promise<bigint> {
    return await this.bridge.invoke(this.methodObj, instance, args);
  }

  /** Sync twin of {@link invokeRaw}. */
  public invokeRawSync(
    instance: bigint,
    args: readonly (string | number | boolean | bigint)[],
  ): bigint {
    return this.bridge.invokeSync(this.methodObj, instance, args);
  }
}

/**
 * Handle representing a reflected Java `Class`, providing high-level access to fields and methods
 * in both sync and async modes.
 */
export class ReflectedClass {
  private cachedDeclaredMethods?: ReflectedMethod[];
  private cachedDeclaredFields?: ReflectedField[];
  private cachedAllMethods?: ReflectedMethod[];
  private cachedDeclaredConstructors?: Array<{
    ctorObj: bigint;
    paramTypes: readonly string[];
  }>;

  constructor(
    public readonly classObj: bigint,
    public readonly name: string,
    private readonly bridge: ReflectionBridge,
    public mapper?: { resolveDeobfClass(n: string): string },
  ) {}

  /** Attaches a mapping registry to this reflected class handle. */
  public withMapper(mapper?: {
    resolveDeobfClass(n: string): string;
  }): ReflectedClass {
    return new ReflectedClass(this.classObj, this.name, this.bridge, mapper);
  }

  /** Returns the full class name (e.g. "net.minecraft.entity.player.EntityPlayer" when mapped). */
  public getName(): string {
    return this.mapper ? this.mapper.resolveDeobfClass(this.name) : this.name;
  }

  /** Returns the simple class name without package prefix (e.g. "EntityPlayer" when mapped). */
  public getSimpleName(): string {
    const name = this.getName();
    const parts = name.split('.');
    return parts[parts.length - 1] ?? name;
  }

  /** Returns the Java-style toString() representation (e.g. "class net.minecraft.entity.player.EntityPlayer"). */
  public toString(): string {
    const deobf = this.getName();
    const raw = this.bridge.getAoStringSync?.(this.classObj);
    if (raw && raw.startsWith('interface ')) {
      return `interface ${deobf}`;
    }
    return `class ${deobf}`;
  }

  /** Resolves a field by name, throwing `FieldNotFoundError` if missing. */
  public async getField(name: string): Promise<ReflectedField> {
    return await this.bridge.getField(this.classObj, name);
  }

  /** Sync twin of {@link getField}. */
  public getFieldSync(name: string): ReflectedField {
    return this.bridge.getFieldSync(this.classObj, name);
  }

  /** Resolves a field by name, or returns `undefined` if missing. */
  public async findField(name: string): Promise<ReflectedField | undefined> {
    return await this.bridge.findReflectedField(this.classObj, name);
  }

  /** Sync twin of {@link findField}. */
  public findFieldSync(name: string): ReflectedField | undefined {
    return this.bridge.findReflectedFieldSync(this.classObj, name);
  }

  /** Resolves all (or specified) fields on this class as `ReflectedField` handles. */
  public async getFields(
    names?: readonly string[],
  ): Promise<Map<string, ReflectedField>> {
    return await this.bridge.findReflectedFields(this.classObj, names);
  }

  /** Sync twin of {@link getFields}. */
  public getFieldsSync(names?: readonly string[]): Map<string, ReflectedField> {
    return this.bridge.findReflectedFieldsSync(this.classObj, names);
  }

  /** Resolves a method by name, throwing `MethodNotFoundError` if missing. */
  public async getMethod(name: string): Promise<ReflectedMethod> {
    return await this.bridge.getMethod(this.classObj, name);
  }

  /** Sync twin of {@link getMethod}. */
  public getMethodSync(name: string): ReflectedMethod {
    return this.bridge.getMethodSync(this.classObj, name);
  }

  /** Resolves a method by name, or returns `undefined` if missing. */
  public async findMethod(name: string): Promise<ReflectedMethod | undefined> {
    return await this.bridge.findReflectedMethod(this.classObj, name);
  }

  /** Sync twin of {@link findMethod}. */
  public findMethodSync(name: string): ReflectedMethod | undefined {
    return this.bridge.findReflectedMethodSync(this.classObj, name);
  }

  /** Resolves all (or specified) methods on this class as `ReflectedMethod` handles. */
  public async getMethods(
    names?: readonly string[],
  ): Promise<Map<string, ReflectedMethod>> {
    return await this.bridge.findReflectedMethods(this.classObj, names);
  }

  /** Sync twin of {@link getMethods}. */
  public getMethodsSync(
    names?: readonly string[],
  ): Map<string, ReflectedMethod> {
    return this.bridge.findReflectedMethodsSync(this.classObj, names);
  }

  /** Directly reads and unboxes a static or instance field. */
  public async readField(
    fieldName: string,
    instance = 0n,
  ): Promise<string | number | boolean | bigint | null> {
    return await this.bridge.readField(this.classObj, fieldName, instance);
  }

  /** Sync twin of {@link readField}. */
  public readFieldSync(
    fieldName: string,
    instance = 0n,
  ): string | number | boolean | bigint | null {
    return this.bridge.readFieldSync(this.classObj, fieldName, instance);
  }

  /** Directly sets a static or instance field with auto-boxing. */
  public async writeField(
    fieldName: string,
    value: string | number | boolean | bigint,
    instance = 0n,
  ): Promise<void> {
    await this.bridge.writeField(this.classObj, fieldName, value, instance);
  }

  /** Sync twin of {@link writeField}. */
  public writeFieldSync(
    fieldName: string,
    value: string | number | boolean | bigint,
    instance = 0n,
  ): void {
    this.bridge.writeFieldSync(this.classObj, fieldName, value, instance);
  }

  /** Returns the direct superclass as a `ReflectedClass`, or `undefined` if Object/interface. */
  public async getSuperclass(): Promise<ReflectedClass | undefined> {
    const superCls = await this.bridge.getSuperclass(this.classObj);
    if (!superCls) return undefined;
    const name = await this.bridge.getClassName(superCls);
    return new ReflectedClass(superCls, name, this.bridge);
  }

  /** Sync twin of {@link getSuperclass}. */
  public getSuperclassSync(): ReflectedClass | undefined {
    const superCls = this.bridge.getSuperclassSync(this.classObj);
    if (!superCls) return undefined;
    const name = this.bridge.getClassNameSync(superCls);
    return new ReflectedClass(superCls, name, this.bridge);
  }

  /** Returns the entire superclass inheritance chain (from this class up to `java.lang.Object`). */
  public async getSuperclassChain(): Promise<string[]> {
    return await this.bridge.getSuperclassChain(this.classObj);
  }

  /** Sync twin of {@link getSuperclassChain}. */
  public getSuperclassChainSync(): string[] {
    return this.bridge.getSuperclassChainSync(this.classObj);
  }

  /** Returns all declared fields on this class as a list of `ReflectedField` handles. */
  public async getDeclaredFields(
    forceReload = false,
  ): Promise<ReflectedField[]> {
    if (!forceReload && this.cachedDeclaredFields)
      return this.cachedDeclaredFields;
    const map = await this.bridge.findReflectedFields(this.classObj);
    this.cachedDeclaredFields = Array.from(map.values());
    return this.cachedDeclaredFields;
  }

  /** Sync twin of {@link getDeclaredFields}. */
  public getDeclaredFieldsSync(forceReload = false): ReflectedField[] {
    if (!forceReload && this.cachedDeclaredFields)
      return this.cachedDeclaredFields;
    const map = this.bridge.findReflectedFieldsSync(this.classObj);
    this.cachedDeclaredFields = Array.from(map.values());
    return this.cachedDeclaredFields;
  }

  /** Returns all declared methods on this class as a list of `ReflectedMethod` handles. */
  public async getDeclaredMethods(
    forceReload = false,
  ): Promise<ReflectedMethod[]> {
    if (!forceReload && this.cachedDeclaredMethods)
      return this.cachedDeclaredMethods;
    const map = await this.bridge.findReflectedMethods(this.classObj);
    this.cachedDeclaredMethods = Array.from(map.values());
    return this.cachedDeclaredMethods;
  }

  /** Sync twin of {@link getDeclaredMethods}. */
  public getDeclaredMethodsSync(forceReload = false): ReflectedMethod[] {
    if (!forceReload && this.cachedDeclaredMethods)
      return this.cachedDeclaredMethods;
    const map = this.bridge.findReflectedMethodsSync(this.classObj);
    this.cachedDeclaredMethods = Array.from(map.values());
    return this.cachedDeclaredMethods;
  }

  /** Returns all methods on this class (including overloads) as `ReflectedMethod[]`. */
  public async getAllMethods(forceReload = false): Promise<ReflectedMethod[]> {
    if (!forceReload && this.cachedAllMethods) return this.cachedAllMethods;
    this.cachedAllMethods = await this.bridge.getAllReflectedMethods(
      this.classObj,
    );
    return this.cachedAllMethods;
  }

  /** Sync twin of {@link getAllMethods}. */
  public getAllMethodsSync(forceReload = false): ReflectedMethod[] {
    if (!forceReload && this.cachedAllMethods) return this.cachedAllMethods;
    this.cachedAllMethods = this.bridge.getAllReflectedMethodsSync(
      this.classObj,
    );
    return this.cachedAllMethods;
  }

  /** Returns all declared constructors on this class. */
  public async getDeclaredConstructors(
    forceReload = false,
  ): Promise<Array<{ ctorObj: bigint; paramTypes: readonly string[] }>> {
    if (!forceReload && this.cachedDeclaredConstructors)
      return this.cachedDeclaredConstructors;
    this.cachedDeclaredConstructors = await this.bridge.getAllConstructors(
      this.classObj,
    );
    return this.cachedDeclaredConstructors;
  }

  /** Sync twin of {@link getDeclaredConstructors}. */
  public getDeclaredConstructorsSync(
    forceReload = false,
  ): Array<{ ctorObj: bigint; paramTypes: readonly string[] }> {
    if (!forceReload && this.cachedDeclaredConstructors)
      return this.cachedDeclaredConstructors;
    this.cachedDeclaredConstructors = this.bridge.getAllConstructorsSync(
      this.classObj,
    );
    return this.cachedDeclaredConstructors;
  }
}

/**
 * Matches the best overloaded method given a list of candidate methods and argument values.
 */
export function matchMethodOverload(
  methods: readonly ReflectedMethod[],
  args: readonly any[],
): ReflectedMethod | undefined {
  const arityMatches = methods.filter(
    (m) => m.paramTypes.length === args.length,
  );
  if (arityMatches.length === 0) return undefined;
  if (arityMatches.length === 1) return arityMatches[0];

  let bestScore = -1;
  let bestMethod: ReflectedMethod | undefined;

  for (const m of arityMatches) {
    let score = 0;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const param = m.paramTypes[i];
      if (typeof arg === 'string') {
        if (param === 'java.lang.String' || param === 'java.lang.CharSequence')
          score += 10;
        else if (param === 'java.lang.Object') score += 5;
        else if (param === 'char' && arg.length === 1) score += 4;
      } else if (typeof arg === 'number') {
        if (Number.isInteger(arg)) {
          if (param === 'int' || param === 'java.lang.Integer') score += 10;
          else if (param === 'long' || param === 'short' || param === 'byte')
            score += 8;
          else if (param === 'double' || param === 'float') score += 6;
          else if (param === 'java.lang.Object') score += 2;
        } else {
          if (param === 'double' || param === 'float') score += 10;
          else if (param === 'java.lang.Object') score += 2;
        }
      } else if (typeof arg === 'boolean') {
        if (param === 'boolean' || param === 'java.lang.Boolean') score += 10;
        else if (param === 'java.lang.Object') score += 2;
      } else if (typeof arg === 'bigint') {
        if (param && !isPrimitiveTypeName(param)) score += 10;
        else if (param === 'long' || param === 'java.lang.Long') score += 8;
        else if (param === 'int') score += 2;
        else score += 1;
      } else {
        score += 5;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMethod = m;
    }
  }

  return bestMethod ?? arityMatches[0];
}

/**
 * Matches the best constructor given a list of candidate constructors and argument values.
 */
export function matchConstructorOverload(
  constructors: ReadonlyArray<{
    ctorObj: bigint;
    paramTypes: readonly string[];
  }>,
  args: readonly any[],
): { ctorObj: bigint; paramTypes: readonly string[] } | undefined {
  const arityMatches = constructors.filter(
    (c) => c.paramTypes.length === args.length,
  );
  if (arityMatches.length === 0) return undefined;
  if (arityMatches.length === 1) return arityMatches[0];

  let bestScore = -1;
  let bestCtor: { ctorObj: bigint; paramTypes: readonly string[] } | undefined;

  for (const c of arityMatches) {
    let score = 0;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const param = c.paramTypes[i];
      if (typeof arg === 'string') {
        if (param === 'java.lang.String' || param === 'java.lang.CharSequence')
          score += 10;
        else if (param === 'java.lang.Object') score += 5;
        else if (param === 'char' && arg.length === 1) score += 4;
      } else if (typeof arg === 'number') {
        if (Number.isInteger(arg)) {
          if (param === 'int' || param === 'java.lang.Integer') score += 10;
          else if (param === 'long' || param === 'short' || param === 'byte')
            score += 8;
          else if (param === 'double' || param === 'float') score += 6;
          else if (param === 'java.lang.Object') score += 2;
        } else {
          if (param === 'double' || param === 'float') score += 10;
          else if (param === 'java.lang.Object') score += 2;
        }
      } else if (typeof arg === 'boolean') {
        if (param === 'boolean' || param === 'java.lang.Boolean') score += 10;
        else if (param === 'java.lang.Object') score += 2;
      } else if (typeof arg === 'bigint') {
        if (param === 'long' || param === 'java.lang.Long') score += 10;
        else if (param === 'int') score += 8;
        else if (param === 'java.lang.Object') score += 2;
      } else {
        score += 5;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCtor = c;
    }
  }

  return bestCtor ?? arityMatches[0];
}
