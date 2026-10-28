/**
 * @exoproc/njava-runtime - JavaRuntimeContext
 * Orchestrates mapping pool, class registry, reflection class pool, and hybrid proxy creation.
 */

import {
  createPool,
  type MappingPool,
  type MappingDatabase,
} from 'exoproc-mappings';
import {
  createJavaCode,
  type JavaCode,
  type ScriptFunction,
} from 'exoproc-nashorn';
import type {
  IJavaBridge,
  IRuntimeExecutionContext,
  JavaClassDefinition,
} from './types.js';
import {
  IS_RUNTIME_CLASS,
  IS_RUNTIME_OBJECT,
  RUNTIME_CLASS,
  RUNTIME_OBJECT,
  RAW_HANDLE,
} from './types.js';
import { ClassRegistry } from './registry.js';
import { RuntimeClassPool } from './pool.js';
import { RuntimeClass } from './class-model.js';
import { createClassProxy, createObjectProxy } from './proxy-factory.js';
import { registerDefaultBuiltins } from './builtins/index.js';
import {
  runScript,
  runSync,
  type ScriptExecutionOptions,
  type ScriptExecutionResult,
} from './runner/executor.js';
import {
  defineClass,
  ClassLoader,
  AutoClassLoader,
  type ClassDefineOptions,
  type ClassLoaderOptions,
} from './definer/index.js';
import { JavaClassBuilder } from 'exoproc-jjit';

export interface JavaRuntimeContextOptions {
  pool?: MappingPool;
  registry?: ClassRegistry;
  bridge?: IJavaBridge;
  sync?: boolean;
}

export class JavaRuntimeContext implements IRuntimeExecutionContext {
  public readonly pool: MappingPool;
  public readonly registry: ClassRegistry;
  public readonly classPool: RuntimeClassPool;
  public readonly bridge?: IJavaBridge;
  public readonly sync: boolean;
  public readonly classLoader: ClassLoader;

  constructor(options: JavaRuntimeContextOptions = {}) {
    this.pool = options.pool ?? createPool();
    this.registry = options.registry ?? new ClassRegistry();
    this.bridge = options.bridge;
    this.sync = options.sync ?? true;

    // Register standard built-in hybrid classes (java.lang.Class, java.lang.System)
    registerDefaultBuiltins(this.registry);

    this.classPool = new RuntimeClassPool(
      this.pool,
      this.registry,
      this.bridge,
    );
    this.classLoader = new AutoClassLoader(this);
  }

  /**
   * Retrieves the singleton `RuntimeClass` instance for a class name.
   */
  public getClass(name: string): RuntimeClass {
    return this.classPool.getClass(name, this);
  }

  /**
   * Nashorn-compatible `Java.type(name)`:
   * Returns a dynamic class proxy supporting static members, constructors, and `.class`.
   */
  public type(classNameOrClass: string | RuntimeClass | any): any {
    let name: string;
    if (typeof classNameOrClass === 'string') {
      name = classNameOrClass;
    } else if (classNameOrClass && typeof classNameOrClass === 'object') {
      if (typeof classNameOrClass.getName === 'function') {
        name = classNameOrClass.getName();
      } else {
        name = classNameOrClass.name ?? classNameOrClass.$className;
      }
    } else {
      throw new Error(`Invalid class type argument: ${classNameOrClass}`);
    }

    const runtimeClass = this.getClass(name);
    return createClassProxy(runtimeClass, this);
  }

  /**
   * Registers a modular virtual, hybrid, or native class definition.
   */
  public registerClass(def: JavaClassDefinition): this {
    this.registry.register(def);
    return this;
  }

  /**
   * Attaches a canonical mapping database to the runtime pool.
   */
  public useDatabase(db: MappingDatabase): this {
    this.pool.useDatabase(db);
    return this;
  }

  /**
   * Wraps a live JVM `jobject` pointer into a hybrid or native JavaObjectProxy.
   */
  public wrap(val: any, typeHint?: string): any {
    if (val === null || val === undefined) return val;

    // If it's a raw bigint pointer
    if (typeof val === 'bigint' && val !== 0n) {
      let clsName = typeHint
        ? typeHint.replace(/^(class|interface)\s+/, '').trim()
        : '';

      if (!clsName && this.bridge?.getObjectClassSync) {
        try {
          const classObj = this.bridge.getObjectClassSync(val);
          if (classObj && classObj !== 0n) {
            clsName = this.bridge.getClassNameSync?.(classObj) ?? '';
          }
        } catch {}
      }

      const deobfName = clsName
        ? this.pool.resolveClass(clsName) || clsName
        : 'java.lang.Object';
      const runtimeClass = this.getClass(deobfName);
      return createObjectProxy(val, runtimeClass, this);
    }

    return val;
  }

  /**
   * Unwraps any proxy back to its underlying raw pointer, object, or value.
   */
  public unwrap(val: any): any {
    if (!val || (typeof val !== 'object' && typeof val !== 'function'))
      return val;
    if (RAW_HANDLE in val) return val[RAW_HANDLE];
    if (RUNTIME_OBJECT in val) return val[RUNTIME_OBJECT];
    if (RUNTIME_CLASS in val)
      return (val[RUNTIME_CLASS] as RuntimeClass).classObj;
    if ('$ptr' in val) return val.$ptr;
    if ('$address' in val) return val.$address;
    if ('$classObj' in val) return val.$classObj;
    if ('handle' in val) return val.handle;
    return val;
  }

  /**
   * Wraps a live object pointer with an ad-hoc hybrid TypeScript definition.
   */
  public wrapHybrid(
    objPtr: bigint,
    className: string,
    tsExtensions: {
      methods?: Record<
        string,
        (target: any, ctx: IRuntimeExecutionContext, ...args: any[]) => any
      >;
      fields?: Record<string, any>;
    },
  ): any {
    const runtimeClass = this.getClass(className);
    const hybridDef: JavaClassDefinition = {
      name: runtimeClass.canonicalName,
      mode: 'hybrid',
      instanceMethods: tsExtensions.methods,
      instanceFields: tsExtensions.fields,
    };
    const specializedClass = new RuntimeClass({
      name: runtimeClass.canonicalName,
      obfName: runtimeClass.obfName,
      mode: 'hybrid',
      definition: hybridDef,
      bridge: this.bridge,
      context: this,
    });
    return createObjectProxy(objPtr, specializedClass, this);
  }

  /**
   * Nashorn `Java.from(javaObj)`:
   * Converts a Java list, collection, or array into a native JavaScript Array.
   */
  public from(javaObj: any): any {
    if (!javaObj || javaObj === 0n) return null;
    if (Array.isArray(javaObj)) return javaObj;

    const proxy = typeof javaObj === 'bigint' ? this.wrap(javaObj) : javaObj;
    if (
      proxy &&
      typeof proxy.size === 'function' &&
      typeof proxy.get === 'function'
    ) {
      const len = proxy.size();
      const result: any[] = [];
      for (let i = 0; i < len; i++) {
        result.push(proxy.get(i));
      }
      return result;
    }
    return proxy;
  }

  /**
   * Nashorn `Java.to(jsArray, targetType)`:
   * Converts a JavaScript array into a Java List or Object Array.
   */
  public to(jsArray: any[], targetType = 'java.lang.Object[]'): any {
    if (!Array.isArray(jsArray)) return jsArray;
    if (
      targetType === 'java.util.List' ||
      targetType === 'java.util.ArrayList' ||
      targetType === 'List'
    ) {
      const ArrayList = this.type('java.util.ArrayList');
      const list = new ArrayList(jsArray.length);
      for (const item of jsArray) {
        list.add(item);
      }
      return list;
    }
    return jsArray;
  }

  public isJavaObject(val: any): boolean {
    return Boolean(val && typeof val === 'object' && IS_RUNTIME_OBJECT in val);
  }

  public isJavaClass(val: any): boolean {
    return Boolean(
      val &&
      (typeof val === 'function' || typeof val === 'object') &&
      IS_RUNTIME_CLASS in val,
    );
  }

  /**
   * Creates a Source / JavaCode model or ScriptFunction model.
   * - If given a raw Java string: returns JavaCode (`jdk.nashorn.internal.runtime.Source`).
   * - If given a function: returns ScriptFunction (`jdk.nashorn.internal.runtime.ScriptFunction`).
   */
  public code(
    sourceOrFn: string | ((...args: any[]) => any),
    name?: string,
  ): JavaCode | ScriptFunction {
    return createJavaCode(sourceOrFn, name);
  }

  /**
   * Creates an initialized ClassLoader JS object bound to this runtime.
   */
  public createClassLoader(options?: ClassLoaderOptions | any): ClassLoader {
    return new ClassLoader(this, options);
  }

  /**
   * Defines a class in the target process.
   * Accepts:
   * - target: bytecode, Java source, JavaClassBuilder, or GeneratedAdapterResult
   * - loaderOrOptions: ClassLoader JS object, live JVM ClassLoader proxy, or ClassDefineOptions
   */
  public defineClass(
    target: any,
    loaderOrOptions?: ClassLoader | ClassDefineOptions | any,
  ): any {
    return defineClass(this, target, loaderOrOptions);
  }

  /**
   * Executes a TypeScript/JavaScript function or script code string directly
   * within this runtime context. Injects `this` as `Java` and a formatted `print`.
   */
  public async runSync<T = any>(
    task:
      | ((java: this, print: (...args: any[]) => void) => T | Promise<T>)
      | string,
    options?: Omit<ScriptExecutionOptions, 'java'>,
  ): Promise<T> {
    return runSync<T>(task as any, { ...options, java: this });
  }

  /**
   * Executes a script file or inline source code string directly within this runtime context.
   */
  public async runScript(
    sourceCodeOrPath: string,
    options?: Omit<ScriptExecutionOptions, 'java'>,
  ): Promise<ScriptExecutionResult> {
    return runScript(sourceCodeOrPath, { ...options, java: this });
  }

  /**
   * Nashorn `Java.extend(parentClass, overrides)`:
   * Extends a Java class or implements an interface with hybrid JavaScript method overrides.
   * Registers the class as hybrid, executes JS overrides locally with zero IPC,
   * and provides __super_<method> bridges for calling the parent implementation.
   */
  public extend(
    parentClassOrProxy: any,
    initialOverrides: Record<string, any> = {},
  ): any {
    let parentClassName: string;
    if (typeof parentClassOrProxy === 'string') {
      parentClassName = parentClassOrProxy;
    } else if (parentClassOrProxy && typeof parentClassOrProxy === 'object') {
      if (typeof parentClassOrProxy.getName === 'function') {
        parentClassName = parentClassOrProxy.getName();
      } else if (parentClassOrProxy.name) {
        parentClassName = parentClassOrProxy.name;
      } else if (parentClassOrProxy.$className) {
        parentClassName = parentClassOrProxy.$className;
      } else if (parentClassOrProxy.canonicalName) {
        parentClassName = parentClassOrProxy.canonicalName;
      } else {
        parentClassName = 'java.lang.Object';
      }
    } else {
      parentClassName = 'java.lang.Object';
    }

    const simpleName = parentClassName.includes('.')
      ? parentClassName.split('.').pop()!
      : parentClassName;
    const subClassName = `Extended_${simpleName}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    // 1. Wrap overrides so `this` is the proxy object
    const hybridMethods: Record<string, any> = {};
    for (const [methodName, fnOrCode] of Object.entries(initialOverrides)) {
      if (typeof fnOrCode === 'function') {
        hybridMethods[methodName] = (
          target: any,
          _ctx: any,
          ...args: any[]
        ) => {
          return fnOrCode.apply(target, args);
        };
      }
    }

    const parentClass = this.getClass(parentClassName);
    const parentClassObj =
      parentClass?.classObj ??
      this.bridge?.getClassSync?.(parentClassName)?.classObj ??
      100n;

    // 2. Register as a hybrid class in the runtime registry
    this.registerClass({
      name: subClassName,
      superclassName: parentClassName,
      classObj: parentClassObj,
      mode: 'hybrid',
      instanceMethods: hybridMethods,
    });

    // 3. Build Java adapter source with __super_ bridges and callback dispatches
    const builder = new JavaClassBuilder(subClassName).public();
    const isInterface =
      parentClassName === 'java.lang.Runnable' ||
      parentClassName === 'Runnable' ||
      parentClassName === 'java.util.concurrent.Callable' ||
      parentClassName === 'Callable' ||
      parentClassName.endsWith('Listener');

    if (isInterface) {
      builder.implements(parentClassName);
    } else {
      builder.extends(parentClassName);
    }
    builder.constructorDef([], isInterface ? '' : 'super();');

    for (const [methodName, fnOrCode] of Object.entries(initialOverrides)) {
      if (!fnOrCode) continue;
      if (
        typeof fnOrCode === 'function' ||
        (fnOrCode as any)?.__isScriptFunction
      ) {
        const cbId = `cb_ext_${Date.now()}_${methodName}_${Math.random().toString(36).slice(2, 7)}`;
        builder
          .method(methodName, 'void')
          .annotation('@Override')
          .public()
          .body(
            `org.exoproc.njava.agent.utils.Exoproc.dispatchCallback("${cbId}", "${methodName}", new Object[0]);`,
          );

        if (!isInterface) {
          builder
            .method(`__super_${methodName}`, 'void')
            .public()
            .body(`super.${methodName}();`);
        }
      } else {
        const javaBody =
          typeof fnOrCode === 'string' ? fnOrCode : String(fnOrCode);
        builder
          .method(methodName, 'void')
          .annotation('@Override')
          .public()
          .body(javaBody);

        if (!isInterface) {
          builder
            .method(`__super_${methodName}`, 'void')
            .public()
            .body(`super.${methodName}();`);
        }
      }
    }

    // Try defining in JVM if a definer is available
    try {
      this.defineClass(builder, { name: subClassName });
    } catch {
      // Offline/virtual fallback
    }

    return this.type(subClassName);
  }

  /**
   * Nashorn `Java.super(instance)`:
   * Returns a proxy that delegates method calls directly to the parent class implementation,
   * bypassing any JavaScript overrides using the generated `__super_<method>` bridge.
   */
  public super(instance: any): any {
    if (!instance) return instance;
    return new Proxy(instance, {
      get(target, prop, receiver) {
        if (typeof prop === 'symbol')
          return Reflect.get(target, prop, receiver);
        const propStr = String(prop);
        const superBridgeName = `__super_${propStr}`;
        if (typeof target[superBridgeName] === 'function') {
          return (...args: any[]) => target[superBridgeName](...args);
        }
        const superCls =
          target.$class?.getSuperclass?.() ?? target.class?.getSuperclass?.();
        if (superCls) {
          const parentMethod =
            superCls.getMethod?.(propStr) ??
            superCls.getDeclaredMethod?.(propStr);
          if (parentMethod) {
            return (...args: any[]) => parentMethod.invoke(target, ...args);
          }
        }
        throw new Error(
          `Super method "${propStr}" (or "${superBridgeName}") not found on parent of ${target.$className}`,
        );
      },
    });
  }
}

export function createRuntimeContext(
  options?: JavaRuntimeContextOptions,
): JavaRuntimeContext {
  return new JavaRuntimeContext(options);
}
