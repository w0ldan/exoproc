/**
 * @exoproc/njava-runtime - Core types for hybrid, virtual, and native Java runtime modeling.
 */

import type { MappingPool } from 'exoproc-mappings';

export type ClassMode = 'virtual' | 'hybrid' | 'native';

export interface ReflectedField {
  fieldObj: bigint;
  name: string;
  type: string | null;
  isStatic?: boolean;
  get(target?: bigint): Promise<any>;
  getSync?(target?: bigint): any;
  set(val: any, target?: bigint): Promise<void>;
  setSync?(val: any, target?: bigint): void;
  [key: string]: any;
}

export interface ReflectedMethod {
  methodObj: bigint;
  name: string;
  paramTypes: readonly string[];
  returnType: string | null;
  isStatic?: boolean;
  call(target?: bigint, ...args: any[]): Promise<any>;
  callSync?(target?: bigint, ...args: any[]): any;
  invoke(
    instanceOrArgs?: bigint | readonly any[],
    maybeArgs?: readonly any[],
  ): Promise<any>;
  invokeSync?(
    instanceOrArgs?: bigint | readonly any[],
    maybeArgs?: readonly any[],
  ): any;
  [key: string]: any;
}

export interface ReflectedConstructor {
  ctorObj: bigint;
  paramTypes: readonly string[];
  construct?(args?: readonly any[]): Promise<bigint>;
  constructSync?(args?: readonly any[]): bigint;
  [key: string]: any;
}

export interface ReflectedClass {
  classObj: bigint;
  name: string;
  getName(): string;
  getCanonicalName?(): string;
  getSimpleName?(): string;
  findField(name: string): Promise<ReflectedField | undefined>;
  findFieldSync?(name: string): ReflectedField | undefined;
  getField(name: string): Promise<ReflectedField>;
  getFieldSync?(name: string): ReflectedField;
  getFields(names?: readonly string[]): Promise<Map<string, ReflectedField>>;
  getFieldsSync?(names?: readonly string[]): Map<string, ReflectedField>;
  getDeclaredFields(forceReload?: boolean): Promise<ReflectedField[]>;
  getDeclaredFieldsSync?(forceReload?: boolean): ReflectedField[];
  findMethod(name: string): Promise<ReflectedMethod | undefined>;
  findMethodSync?(name: string): ReflectedMethod | undefined;
  getMethod(name: string): Promise<ReflectedMethod>;
  getMethodSync?(name: string): ReflectedMethod;
  getMethods(names?: readonly string[]): Promise<Map<string, ReflectedMethod>>;
  getMethodsSync?(names?: readonly string[]): Map<string, ReflectedMethod>;
  getDeclaredMethods(forceReload?: boolean): Promise<ReflectedMethod[]>;
  getDeclaredMethodsSync?(forceReload?: boolean): ReflectedMethod[];
  getAllMethods(forceReload?: boolean): Promise<ReflectedMethod[]>;
  getAllMethodsSync?(forceReload?: boolean): ReflectedMethod[];
  getDeclaredConstructors(
    forceReload?: boolean,
  ): Promise<ReflectedConstructor[]>;
  getDeclaredConstructorsSync?(forceReload?: boolean): ReflectedConstructor[];
  readField(name: string, target?: bigint): Promise<any>;
  readFieldSync?(name: string, target?: bigint): any;
  writeField(name: string, val: any, target?: bigint): Promise<void>;
  writeFieldSync?(name: string, val: any, target?: bigint): void;
  getSuperclass(): Promise<ReflectedClass | undefined>;
  getSuperclassSync?(): ReflectedClass | undefined;
  getSuperclassChain(): Promise<string[]>;
  getSuperclassChainSync?(): string[];
}

/**
 * Common bridge interface implemented by JNI/JVM accessors (like bun-njava's ReflectionBridge)
 * to communicate with the actual live process.
 */
export interface IJavaBridge {
  getClassSync?(name: string): ReflectedClass;
  getClass(name: string): Promise<ReflectedClass>;
  findClass?(name: string): Promise<bigint | ReflectedClass | undefined>;
  findClassSync?(name: string): bigint | ReflectedClass | undefined;

  invokeMethodSync?(methodObj: bigint, instance: bigint, args?: any): any;
  invokeMethod?(methodObj: bigint, instance: bigint, args?: any): Promise<any>;

  invokeSync?(methodObj: bigint, instance: bigint, args: readonly any[]): any;
  invoke?(
    methodObj: bigint,
    instance: bigint,
    args: readonly any[],
  ): Promise<any>;

  readFieldSync?(classObj: bigint, fieldName: string, instance?: bigint): any;
  readField?(
    classObj: bigint,
    fieldName: string,
    instance?: bigint,
  ): Promise<any>;

  writeFieldSync?(
    classObj: bigint,
    fieldName: string,
    value: any,
    instance?: bigint,
  ): void;
  writeField(
    classObj: bigint,
    fieldName: string,
    value: any,
    instance?: bigint,
  ): Promise<void>;

  constructSync?(ctorObj: bigint, args: any[]): bigint;
  construct(ctorObj: bigint, args: any[]): Promise<bigint>;

  getSuperclassSync?(classObj: bigint): bigint | undefined;
  getSuperclass?(classObj: bigint): Promise<bigint | undefined>;
  getSuperclassChain?(classObj: bigint): Promise<string[]>;
  getSuperclassChainSync?(classObj: bigint): string[];

  getClassNameSync?(classObj: bigint): string;
  getClassName(classObj: bigint): Promise<string>;

  getObjectClassName?(obj: bigint): Promise<string>;
  getObjectClassNameSync?(obj: bigint): string;

  findConstructor?(
    classObj: bigint,
    predicate: (paramTypes: readonly string[]) => boolean,
  ): Promise<bigint | undefined>;
  findConstructorSync?(
    classObj: bigint,
    predicate: (paramTypes: readonly string[]) => boolean,
  ): bigint | undefined;

  getObjectClassSync?(objPtr: bigint): bigint;
  getObjectClass?(objPtr: bigint): Promise<bigint>;

  getAoStringSync?(ptr: bigint): string;
  getAoString(ptr: bigint): Promise<string>;

  getAllReflectedMethodsSync?(classObj: bigint): any[];
  getAllReflectedMethods?(classObj: bigint): Promise<any[]>;

  getDeclaredReflectedMethodsSync?(classObj: bigint): any[];
  getDeclaredReflectedMethods?(classObj: bigint): Promise<any[]>;

  findReflectedFieldsSync?(
    classObj: bigint,
    names?: readonly string[],
  ): Map<string, any>;
  findReflectedFields?(
    classObj: bigint,
    names?: readonly string[],
  ): Promise<Map<string, any>>;

  getAllConstructorsSync?(classObj: bigint): any[];
  getAllConstructors?(classObj: bigint): Promise<any[]>;

  /**
   * Adapts/casts an argument (such as a Source, JavaCode, or ScriptFunction) to a target Java type.
   */
  adaptArgument?(arg: any, targetType?: string, context?: any): any;
}

export type ReflectionBridge = IJavaBridge;

/**
 * Context passed to TypeScript method / field interceptor handlers.
 */
export interface IRuntimeExecutionContext {
  readonly pool: MappingPool;
  readonly bridge?: IJavaBridge;
  readonly sync: boolean;
  getClass(name: string): any;
  wrap(val: any, typeHint?: string): any;
  unwrap(val: any): any;
  code(sourceOrFn: string | ((...args: any[]) => any), name?: string): any;
  type(classNameOrClass: string | any): any;
  defineClass?(target: any, options?: any): any;
}

/**
 * Definition for creating a virtual or hybrid Java class in TypeScript.
 */
export interface JavaClassDefinition<T = any> {
  /**
   * Full canonical or deobfuscated name of the class (e.g. "java.lang.Class", "java.lang.System", "EntityPlayerSP")
   */
  name: string;

  /**
   * Execution mode:
   * - 'virtual': Pure TypeScript class. Never invokes JVM JNI bridge.
   * - 'hybrid': TypeScript implementation prioritized; unhandled members fallback automatically to live JVM.
   * - 'native': Direct JVM class with deobfuscation and identity tracking.
   */
  mode: ClassMode;

  /**
   * Short names or aliases (e.g. ["Class", "String"])
   */
  aliases?: string[];

  /**
   * Name of the direct superclass (e.g. "java.lang.Object")
   */
  superclassName?: string;

  /**
   * Raw JVM class handle / pointer, if predefined or known.
   */
  classObj?: bigint;

  /**
   * Implemented interfaces
   */
  interfaces?: string[];

  /**
   * Custom TypeScript constructor when instantiated via `new MyClass(...)` or `MyClass(...)`.
   */
  construct?: (ctx: IRuntimeExecutionContext, ...args: any[]) => T;

  /**
   * Static methods defined in TypeScript.
   * In 'hybrid' mode, if a static method is not defined here, it falls back to native JVM invocation.
   */
  staticMethods?: Record<
    string,
    (ctx: IRuntimeExecutionContext, ...args: any[]) => any
  >;

  /**
   * Static fields or getters/setters defined in TypeScript.
   */
  staticFields?: Record<string, any | ((ctx: IRuntimeExecutionContext) => any)>;

  /**
   * Instance methods defined in TypeScript.
   * In 'hybrid' mode, if an instance method is not defined here, it falls back to native JVM invocation.
   */
  instanceMethods?: Record<
    string,
    (target: T, ctx: IRuntimeExecutionContext, ...args: any[]) => any
  >;

  /**
   * Instance fields or getters/setters defined in TypeScript.
   */
  instanceFields?: Record<
    string,
    any | ((target: T, ctx: IRuntimeExecutionContext) => any)
  >;
}

/**
 * Symbols used to identify runtime proxies and access underlying handles.
 */
export const IS_RUNTIME_PROXY = Symbol('isRuntimeProxy');
export const IS_RUNTIME_CLASS = Symbol('isRuntimeClass');
export const IS_RUNTIME_OBJECT = Symbol('isRuntimeObject');
export const RUNTIME_CLASS = Symbol('runtimeClass');
export const RUNTIME_OBJECT = Symbol('runtimeObject');
export const RAW_HANDLE = Symbol('rawHandle');
