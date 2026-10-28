/**
 * @exoproc/njava-runtime - RuntimeClass Model
 * Pure TypeScript representation of java.lang.Class supporting virtual, hybrid, and native modes.
 */

import type {
  ClassMode,
  IJavaBridge,
  IRuntimeExecutionContext,
  JavaClassDefinition,
} from './types.js';
import { RuntimeMethod } from './member-model.js';
import { RuntimeField } from './member-model.js';

export interface RuntimeClassOptions {
  name: string;
  requestedName?: string;
  canonicalName?: string;
  mode?: ClassMode;
  obfName?: string;
  classObj?: bigint;
  definition?: JavaClassDefinition;
  bridge?: IJavaBridge;
  context: IRuntimeExecutionContext;
}

export class RuntimeClass {
  public readonly name: string;
  public readonly requestedName: string;
  public readonly canonicalName: string;
  public readonly simpleName: string;
  public readonly obfName: string;
  public readonly mode: ClassMode;
  public readonly definition?: JavaClassDefinition;

  private _classObj: bigint;
  private readonly bridge?: IJavaBridge;
  private readonly context: IRuntimeExecutionContext;

  private _cachedSuperclass?: RuntimeClass | null;
  private _cachedMethods?: RuntimeMethod[];
  private _cachedDeclaredMethods?: RuntimeMethod[];
  private _cachedFields?: RuntimeField[];
  private _cachedDeclaredFields?: RuntimeField[];

  constructor(options: RuntimeClassOptions) {
    this.canonicalName = options.canonicalName ?? options.name;
    this.requestedName = options.requestedName ?? options.name;
    this.name = this.requestedName;
    const baseForSimple = this.requestedName.includes('.')
      ? this.requestedName.split('.').pop()!
      : this.requestedName;
    this.simpleName = baseForSimple;
    this.mode = options.mode ?? options.definition?.mode ?? 'native';
    this.definition = options.definition;
    this.bridge = options.bridge;
    this.context = options.context;
    this._classObj = options.classObj ?? options.definition?.classObj ?? 0n;

    // Resolve obfName using the mapping pool if not explicitly given
    if (options.obfName) {
      this.obfName = options.obfName;
    } else {
      const match = this.context.pool.resolveClass(this.canonicalName);
      this.obfName = match || this.canonicalName;
    }
  }

  /**
   * Lazily loads and returns the native JVM `jclass` pointer if running with a live bridge.
   */
  public get classObj(): bigint {
    if (this._classObj && this._classObj !== 0n) {
      return this._classObj;
    }
    if (this.mode !== 'virtual' && this.bridge?.getClassSync) {
      try {
        const cls = this.bridge.getClassSync(this.obfName);
        if (cls && cls.classObj) {
          this._classObj = cls.classObj;
        }
      } catch {}
    }
    return this._classObj;
  }

  public set classObj(val: bigint) {
    this._classObj = val;
  }

  public get superclassName(): string | undefined {
    return this.definition?.superclassName;
  }

  // ── Standard java.lang.Class Reflection API ──────────────────────────────

  public getName(): string {
    return this.requestedName;
  }

  public getCanonicalName(): string {
    return this.canonicalName;
  }

  public getSimpleName(): string {
    return this.simpleName;
  }

  public getTypeName(): string {
    return this.canonicalName;
  }

  public equals(other: any): boolean {
    if (!other) return false;
    if (other === this) return true;
    const otherClass =
      other instanceof RuntimeClass ? other : (other.class ?? other.$class);
    if (!otherClass) return false;
    if (
      this.canonicalName &&
      otherClass.canonicalName &&
      this.canonicalName === otherClass.canonicalName
    ) {
      return true;
    }
    if (
      this.classObj &&
      otherClass.classObj &&
      this.classObj !== 0n &&
      this.classObj === otherClass.classObj
    ) {
      return true;
    }
    return false;
  }

  private getSchema(): any {
    const detected = this.context.pool.getDetected(this.canonicalName);
    if (detected?.schema) return detected.schema;
    for (const db of this.context.pool.getDatabases()) {
      const s = db.getClass(this.canonicalName) || db.getClass(this.simpleName);
      if (s) return s;
    }
    return undefined;
  }

  public getSuperclass(): RuntimeClass | null {
    if (this._cachedSuperclass !== undefined) {
      return this._cachedSuperclass;
    }

    // 1. If superclass is defined in TS definition, use it
    if (this.definition?.superclassName) {
      const res = this.context.getClass(this.definition.superclassName) ?? null;
      this._cachedSuperclass = res;
      return res;
    }

    // 2. If mapping schema defines a superclass, use it (0 JNI)
    const schema = this.getSchema();
    if (schema?.superclass) {
      const res = this.context.getClass(schema.superclass) ?? null;
      this._cachedSuperclass = res;
      return res;
    }

    // 3. Fallback to native bridge if hybrid/native
    if (
      this.mode !== 'virtual' &&
      this.bridge?.getSuperclassSync &&
      this.classObj
    ) {
      try {
        const superObj = this.bridge.getSuperclassSync(this.classObj);
        if (superObj && superObj !== 0n) {
          const rawName = this.bridge.getClassNameSync?.(superObj);
          if (rawName) {
            const deobf = this.context.pool.resolveClass(rawName) || rawName;
            const res = this.context.getClass(deobf) ?? null;
            if (res) {
              res.classObj = superObj;
            }
            this._cachedSuperclass = res;
            return res;
          }
        }
      } catch {}
    }

    // Default Object for non-primitive classes
    if (
      this.canonicalName !== 'java.lang.Object' &&
      !this.isPrimitive() &&
      !this.isInterface()
    ) {
      const res = this.context.getClass('java.lang.Object') ?? null;
      this._cachedSuperclass = res;
      return res;
    }

    this._cachedSuperclass = null;
    return null;
  }

  public getMethods(): RuntimeMethod[] {
    if (this._cachedMethods) return this._cachedMethods;

    const methodMap = new Map<string, RuntimeMethod>();

    // 1. Inherited methods from superclass
    const superCls = this.getSuperclass();
    if (superCls) {
      for (const m of superCls.getMethods()) {
        methodMap.set(m.name + '(' + m.paramTypes.join(',') + ')', m);
      }
    }

    // 2. Declared methods on this class override superclass
    for (const m of this.getDeclaredMethods()) {
      methodMap.set(m.name + '(' + m.paramTypes.join(',') + ')', m);
    }

    this._cachedMethods = Array.from(methodMap.values());
    return this._cachedMethods;
  }

  public getDeclaredMethods(): RuntimeMethod[] {
    if (this._cachedDeclaredMethods) return this._cachedDeclaredMethods;

    const list: RuntimeMethod[] = [];

    // 1. Methods defined in TS definition
    if (this.definition?.instanceMethods) {
      for (const [mName, handler] of Object.entries(
        this.definition.instanceMethods,
      )) {
        list.push(
          new RuntimeMethod({
            name: mName,
            declaringClassName: this.canonicalName,
            isStatic: false,
            tsHandler: handler,
            context: this.context,
          }),
        );
      }
    }
    if (this.definition?.staticMethods) {
      for (const [mName, handler] of Object.entries(
        this.definition.staticMethods,
      )) {
        list.push(
          new RuntimeMethod({
            name: mName,
            declaringClassName: this.canonicalName,
            isStatic: true,
            tsHandler: (_inst, ctx, ...args) => handler(ctx, ...args),
            context: this.context,
          }),
        );
      }
    }

    // 2. Native declared methods if hybrid / native
    if (this.mode !== 'virtual' && this.bridge && this.classObj) {
      const nativeMethods =
        this.bridge.getDeclaredReflectedMethodsSync?.(this.classObj) ??
        this.bridge.getAllReflectedMethodsSync?.(this.classObj) ??
        [];

      for (const nm of nativeMethods) {
        const rawName = nm.name ?? '';
        const schema = this.getSchema();
        const mappedName =
          schema?.methods?.[rawName]?.canonicalName ??
          (this.context.pool.resolveClass(nm.declaringClass ?? '') || rawName);

        // Don't overwrite TS-defined methods
        if (
          !list.some((existing) => existing.name === (mappedName || rawName))
        ) {
          list.push(
            new RuntimeMethod({
              name: mappedName || rawName,
              rawName,
              declaringClassName: this.canonicalName,
              returnType: nm.type ?? nm.returnType ?? null,
              paramTypes: nm.paramTypes ?? [],
              isStatic: nm.isStatic,
              methodObj: nm.methodObj,
              bridge: this.bridge,
              context: this.context,
            }),
          );
        }
      }
    }

    this._cachedDeclaredMethods = list;
    return this._cachedDeclaredMethods;
  }

  public getFields(): RuntimeField[] {
    if (this._cachedFields) return this._cachedFields;

    const fieldMap = new Map<string, RuntimeField>();

    const superCls = this.getSuperclass();
    if (superCls) {
      for (const f of superCls.getFields()) {
        fieldMap.set(f.name, f);
      }
    }

    for (const f of this.getDeclaredFields()) {
      fieldMap.set(f.name, f);
    }

    this._cachedFields = Array.from(fieldMap.values());
    return this._cachedFields;
  }

  public getDeclaredField(name: string): RuntimeField | undefined {
    return this.getDeclaredFields().find(
      (f) => f.name === name || f.rawName === name,
    );
  }

  public getField(name: string): RuntimeField | undefined {
    return this.getFields().find((f) => f.name === name || f.rawName === name);
  }

  public getDeclaredMethod(
    name: string,
    paramTypes?: string[],
  ): RuntimeMethod | undefined {
    const matches = this.getDeclaredMethods().filter(
      (m) => m.name === name || m.rawName === name,
    );
    if (!paramTypes || paramTypes.length === 0) return matches[0];
    return (
      matches.find((m) => m.paramTypes.length === paramTypes.length) ??
      matches[0]
    );
  }

  public getMethod(
    name: string,
    paramTypes?: string[],
  ): RuntimeMethod | undefined {
    const matches = this.getMethods().filter(
      (m) => m.name === name || m.rawName === name,
    );
    if (!paramTypes || paramTypes.length === 0) return matches[0];
    return (
      matches.find((m) => m.paramTypes.length === paramTypes.length) ??
      matches[0]
    );
  }

  public getDeclaredFields(): RuntimeField[] {
    if (this._cachedDeclaredFields) return this._cachedDeclaredFields;

    const list: RuntimeField[] = [];

    // 1. TS-defined fields
    if (this.definition?.instanceFields) {
      for (const [fName, fieldDef] of Object.entries(
        this.definition.instanceFields,
      )) {
        list.push(
          new RuntimeField({
            name: fName,
            declaringClassName: this.canonicalName,
            isStatic: false,
            tsGetter:
              typeof fieldDef === 'function' ? fieldDef : () => fieldDef,
            context: this.context,
          }),
        );
      }
    }
    if (this.definition?.staticFields) {
      for (const [fName, fieldDef] of Object.entries(
        this.definition.staticFields,
      )) {
        list.push(
          new RuntimeField({
            name: fName,
            declaringClassName: this.canonicalName,
            isStatic: true,
            tsGetter:
              typeof fieldDef === 'function' ? fieldDef : () => fieldDef,
            context: this.context,
          }),
        );
      }
    }

    // 2. Native declared fields if hybrid/native
    if (this.mode !== 'virtual' && this.bridge && this.classObj) {
      const nativeFieldsMap = this.bridge.findReflectedFieldsSync?.(
        this.classObj,
      );
      if (nativeFieldsMap) {
        for (const [rawName, nf] of nativeFieldsMap.entries()) {
          const schema = this.getSchema();
          const mappedName =
            schema?.fields?.[rawName]?.canonicalName ?? rawName;

          if (
            !list.some((existing) => existing.name === (mappedName || rawName))
          ) {
            list.push(
              new RuntimeField({
                name: mappedName || rawName,
                rawName,
                declaringClassName: this.canonicalName,
                type: nf.type ?? null,
                isStatic: nf.isStatic,
                fieldObj: nf.fieldObj,
                bridge: this.bridge,
                context: this.context,
              }),
            );
          }
        }
      }
    }

    this._cachedDeclaredFields = list;
    return this._cachedDeclaredFields;
  }

  public isInterface(): boolean {
    const raw = this.bridge?.getAoStringSync?.(this.classObj);
    return Boolean(raw?.startsWith('interface '));
  }

  public isArray(): boolean {
    return this.name.endsWith('[]') || this.name.startsWith('[');
  }

  public isPrimitive(): boolean {
    return (
      this.name === 'int' ||
      this.name === 'boolean' ||
      this.name === 'byte' ||
      this.name === 'char' ||
      this.name === 'short' ||
      this.name === 'long' ||
      this.name === 'float' ||
      this.name === 'double' ||
      this.name === 'void'
    );
  }

  public isEnum(): boolean {
    return this.getSuperclass()?.getName() === 'java.lang.Enum';
  }

  public toString(): string {
    if (this.isInterface()) return `interface ${this.canonicalName}`;
    if (this.isPrimitive()) return this.canonicalName;
    return `class ${this.canonicalName}`;
  }
}
