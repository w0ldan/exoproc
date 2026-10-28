/**
 * @exoproc/njava-runtime - Reflection Member Models
 * Represents java.lang.reflect.Method and java.lang.reflect.Field with hybrid TS/JVM dispatch.
 */

import type { IJavaBridge, IRuntimeExecutionContext } from './types.js';

export interface RuntimeMethodOptions {
  name: string;
  rawName?: string;
  declaringClassName: string;
  returnType?: string | null;
  paramTypes?: readonly string[];
  isStatic?: boolean;
  modifiers?: number;
  methodObj?: bigint;
  tsHandler?: (
    instance: any,
    ctx: IRuntimeExecutionContext,
    ...args: any[]
  ) => any;
  bridge?: IJavaBridge;
  context?: IRuntimeExecutionContext;
}

export class RuntimeMethod {
  public readonly name: string;
  public readonly rawName: string;
  public readonly declaringClassName: string;
  public readonly returnType: string | null;
  public readonly paramTypes: readonly string[];
  public readonly isStatic: boolean;
  public readonly modifiers: number;
  public readonly methodObj: bigint;
  public readonly tsHandler?: (
    instance: any,
    ctx: IRuntimeExecutionContext,
    ...args: any[]
  ) => any;
  private readonly bridge?: IJavaBridge;
  private readonly context?: IRuntimeExecutionContext;

  constructor(options: RuntimeMethodOptions) {
    this.name = options.name;
    this.rawName = options.rawName ?? options.name;
    this.declaringClassName = options.declaringClassName;
    this.returnType = options.returnType ?? null;
    this.paramTypes = options.paramTypes ?? [];
    this.isStatic = Boolean(options.isStatic);
    this.modifiers = options.modifiers ?? (this.isStatic ? 9 : 1);
    this.methodObj = options.methodObj ?? 0n;
    this.tsHandler = options.tsHandler;
    this.bridge = options.bridge;
    this.context = options.context;
  }

  public getName(): string {
    return this.name;
  }

  public getDeclaringClass(): any {
    return (
      this.context?.getClass(this.declaringClassName) ?? this.declaringClassName
    );
  }

  public getReturnType(): string | null {
    return this.returnType;
  }

  public getType(): string | null {
    return this.returnType;
  }

  public getParameterTypes(): readonly string[] {
    return this.paramTypes;
  }

  public getModifiers(): number {
    return this.modifiers;
  }

  public setAccessible(_flag = true): void {
    // Permissive reflection: accessible by default in TS/agent runtime
  }

  public invoke(instance: any, ...args: any[]): any {
    if (this.tsHandler && this.context) {
      return this.tsHandler(instance, this.context, ...args);
    }
    if (this.methodObj && this.bridge?.invokeMethodSync) {
      const unwrappedInstance = this.context?.unwrap(instance) ?? instance;
      const unwrappedArgs = args.map((a) => this.context?.unwrap(a) ?? a);
      const res = this.bridge.invokeMethodSync(
        this.methodObj,
        unwrappedInstance,
        unwrappedArgs,
      );
      return this.context?.wrap(res, this.returnType ?? undefined) ?? res;
    }
    throw new Error(
      `Cannot invoke method ${this.declaringClassName}.${this.name}: no handler or native method handle.`,
    );
  }

  public toString(): string {
    return `${this.returnType ?? 'void'} ${this.declaringClassName}.${this.name}(${this.paramTypes.join(', ')})`;
  }
}

export interface RuntimeFieldOptions {
  name: string;
  rawName?: string;
  declaringClassName: string;
  type?: string | null;
  isStatic?: boolean;
  modifiers?: number;
  fieldObj?: bigint;
  tsGetter?: (instance: any, ctx: IRuntimeExecutionContext) => any;
  tsSetter?: (instance: any, val: any, ctx: IRuntimeExecutionContext) => void;
  bridge?: IJavaBridge;
  context?: IRuntimeExecutionContext;
}

export class RuntimeField {
  public readonly name: string;
  public readonly rawName: string;
  public readonly declaringClassName: string;
  public readonly type: string | null;
  public readonly isStatic: boolean;
  public readonly modifiers: number;
  public readonly fieldObj: bigint;
  public readonly tsGetter?: (
    instance: any,
    ctx: IRuntimeExecutionContext,
  ) => any;
  public readonly tsSetter?: (
    instance: any,
    val: any,
    ctx: IRuntimeExecutionContext,
  ) => void;
  private readonly bridge?: IJavaBridge;
  private readonly context?: IRuntimeExecutionContext;

  constructor(options: RuntimeFieldOptions) {
    this.name = options.name;
    this.rawName = options.rawName ?? options.name;
    this.declaringClassName = options.declaringClassName;
    this.type = options.type ?? null;
    this.isStatic = Boolean(options.isStatic);
    this.modifiers = options.modifiers ?? (this.isStatic ? 9 : 1);
    this.fieldObj = options.fieldObj ?? 0n;
    this.tsGetter = options.tsGetter;
    this.tsSetter = options.tsSetter;
    this.bridge = options.bridge;
    this.context = options.context;
  }

  public getName(): string {
    return this.name;
  }

  public getDeclaringClass(): any {
    return (
      this.context?.getClass(this.declaringClassName) ?? this.declaringClassName
    );
  }

  public getType(): string | null {
    return this.type;
  }

  public getModifiers(): number {
    return this.modifiers;
  }

  public setAccessible(_flag = true): void {
    // Permissive reflection: accessible by default in TS/agent runtime
  }

  public get(instance?: any): any {
    if (this.tsGetter && this.context) {
      return this.tsGetter(instance, this.context);
    }
    if (this.bridge?.readFieldSync && this.context) {
      const classObj =
        (this.context.getClass(this.declaringClassName) as any)?.classObj ?? 0n;
      const unwrappedInstance = instance ? this.context.unwrap(instance) : 0n;
      const val = this.bridge.readFieldSync(
        classObj,
        this.rawName,
        unwrappedInstance,
      );
      return this.context.wrap(val, this.type ?? undefined);
    }
    return undefined;
  }

  public set(instance: any, value: any): void {
    if (this.tsSetter && this.context) {
      this.tsSetter(instance, value, this.context);
      return;
    }
    if (this.bridge?.writeFieldSync && this.context) {
      const classObj =
        (this.context.getClass(this.declaringClassName) as any)?.classObj ?? 0n;
      const unwrappedInstance = instance ? this.context.unwrap(instance) : 0n;
      const unwrappedVal = this.context.unwrap(value);
      this.bridge.writeFieldSync(
        classObj,
        this.rawName,
        unwrappedVal,
        unwrappedInstance,
      );
      return;
    }
  }

  public toString(): string {
    return `${this.type ?? 'Object'} ${this.declaringClassName}.${this.name}`;
  }
}
