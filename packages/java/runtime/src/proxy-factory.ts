/**
 * @exoproc/njava-runtime - Proxy Factory
 * Creates dynamic Proxies for Java Classes and Java Objects with full Hybrid/Virtual/Native dispatch.
 */

import type { IRuntimeExecutionContext } from './types.js';
import {
  IS_RUNTIME_PROXY,
  IS_RUNTIME_CLASS,
  IS_RUNTIME_OBJECT,
  RUNTIME_CLASS,
  RUNTIME_OBJECT,
  RAW_HANDLE,
} from './types.js';
import type { RuntimeClass } from './class-model.js';

function resolveMethodArg(
  arg: any,
  targetType: string | undefined,
  context: IRuntimeExecutionContext,
): any {
  if (arg !== null && arg !== undefined) {
    let effectiveArg = arg;
    if (
      typeof arg === 'function' &&
      !arg.__isScriptFunction &&
      !arg.__isJavaCode
    ) {
      if (typeof (context as any).code === 'function') {
        effectiveArg = (context as any).code(arg);
      }
    }

    if (
      effectiveArg.__isJavaCode ||
      effectiveArg.__isScriptFunction ||
      (typeof effectiveArg === 'object' &&
        effectiveArg.$className?.startsWith('jdk.nashorn.internal.runtime.'))
    ) {
      if (
        context.bridge &&
        typeof context.bridge.adaptArgument === 'function'
      ) {
        const adapted = context.bridge.adaptArgument(
          effectiveArg,
          targetType,
          context,
        );
        return context.unwrap(adapted);
      }
      if (targetType === 'java.lang.String' || targetType === 'String') {
        return typeof effectiveArg.getString === 'function'
          ? effectiveArg.getString()
          : String(effectiveArg);
      }
    }
  }
  return context.unwrap(arg);
}

export function createClassProxy(
  runtimeClass: RuntimeClass,
  context: IRuntimeExecutionContext,
): any {
  const target = function (...args: any[]) {
    return constructInstance(runtimeClass, context, args);
  };

  const proxy = new Proxy(target, {
    construct(_tgt, args) {
      return constructInstance(runtimeClass, context, args);
    },

    get(_tgt, prop, _receiver) {
      if (typeof prop === 'symbol') {
        if (prop === IS_RUNTIME_PROXY) return true;
        if (prop === IS_RUNTIME_CLASS) return true;
        if (prop === RUNTIME_CLASS) return runtimeClass;
        if (prop === RAW_HANDLE) return runtimeClass.classObj;
        if (prop === Symbol.toPrimitive) {
          return () => `[JavaClass ${runtimeClass.canonicalName}]`;
        }
        return undefined;
      }

      if (prop === 'then') return undefined; // Avoid accidental Promise unwrap

      // 1. Reflection metadata properties
      if (prop === 'class' || prop === '$class') return runtimeClass;
      if (prop === 'getClass') return () => runtimeClass;
      if (prop === 'classObj' || prop === '$classObj')
        return runtimeClass.classObj;
      if (prop === 'name' || prop === '$className')
        return runtimeClass.getName();
      if (prop === 'getName') return () => runtimeClass.getName();
      if (prop === 'getCanonicalName')
        return () => runtimeClass.getCanonicalName();
      if (prop === 'getSimpleName') return () => runtimeClass.getSimpleName();
      if (prop === 'getTypeName') return () => runtimeClass.getTypeName();
      if (prop === 'equals') return (other: any) => runtimeClass.equals(other);
      if (prop === 'getSuperclass') return () => runtimeClass.getSuperclass();
      if (prop === 'getMethods') return () => runtimeClass.getMethods();
      if (prop === 'getDeclaredMethods')
        return () => runtimeClass.getDeclaredMethods();
      if (prop === 'getFields') return () => runtimeClass.getFields();
      if (prop === 'getDeclaredFields')
        return () => runtimeClass.getDeclaredFields();
      if (prop === 'getField')
        return (name: string) => runtimeClass.getField(name);
      if (prop === 'getDeclaredField')
        return (name: string) => runtimeClass.getDeclaredField(name);
      if (prop === 'getMethod')
        return (name: string, ...paramTypes: string[]) =>
          runtimeClass.getMethod(name, paramTypes);
      if (prop === 'getDeclaredMethod')
        return (name: string, ...paramTypes: string[]) =>
          runtimeClass.getDeclaredMethod(name, paramTypes);
      if (prop === 'isInterface') return () => runtimeClass.isInterface();
      if (prop === 'isArray') return () => runtimeClass.isArray();
      if (prop === 'isPrimitive') return () => runtimeClass.isPrimitive();
      if (prop === 'isEnum') return () => runtimeClass.isEnum();
      if (prop === 'toString') return () => runtimeClass.toString();
      if (prop === 'valueOf')
        return () => `[JavaClass ${runtimeClass.getName()}]`;

      const propStr = String(prop);

      // 2. TypeScript Static Method Definition (Virtual or Hybrid)
      if (
        runtimeClass.definition?.staticMethods &&
        propStr in runtimeClass.definition.staticMethods
      ) {
        const handler = runtimeClass.definition.staticMethods[propStr];
        if (handler) {
          return (...args: any[]) => handler(context, ...args);
        }
      }

      // 3. TypeScript Static Field Definition (Virtual or Hybrid)
      if (
        runtimeClass.definition?.staticFields &&
        propStr in runtimeClass.definition.staticFields
      ) {
        const fieldVal = runtimeClass.definition.staticFields[propStr];
        return typeof fieldVal === 'function' ? fieldVal(context) : fieldVal;
      }

      // 4. Fallback to Native JVM static method or field via bridge
      if (
        runtimeClass.mode !== 'virtual' &&
        context.bridge &&
        runtimeClass.classObj
      ) {
        const allMethods =
          context.bridge?.getAllReflectedMethodsSync?.(runtimeClass.classObj) ??
          [];
        const matches = allMethods.filter(
          (m) =>
            (m.name === propStr || m.originalName === propStr) && m.isStatic,
        );
        if (matches.length > 0) {
          return (...args: any[]) => {
            const method =
              matches.find(
                (m) => (m.paramTypes?.length ?? 0) === args.length,
              ) ?? matches[0];
            const unwrappedArgs = args.map((a, idx) =>
              resolveMethodArg(a, method.paramTypes?.[idx], context),
            );
            const res = context.bridge?.invokeMethodSync?.(
              method.methodObj,
              0n,
              unwrappedArgs,
            );
            return context.wrap(res, method.type);
          };
        }

        // Check static fields
        const allFields = runtimeClass.getFields();
        const field = allFields.find(
          (f) => (f.name === propStr || f.rawName === propStr) && f.isStatic,
        );
        if (field) {
          return field.get(0n);
        }

        return (..._args: any[]) => {
          throw new Error(
            `Static member "${propStr}" not found on ${runtimeClass.canonicalName}`,
          );
        };
      }

      return undefined;
    },

    set(_tgt, prop, value) {
      if (typeof prop === 'symbol') return true;
      const propStr = String(prop);

      if (
        runtimeClass.definition?.staticFields &&
        propStr in runtimeClass.definition.staticFields
      ) {
        runtimeClass.definition.staticFields[propStr] = value;
        return true;
      }

      if (
        runtimeClass.mode !== 'virtual' &&
        context.bridge &&
        runtimeClass.classObj
      ) {
        const allFields = runtimeClass.getFields();
        const field = allFields.find(
          (f) => (f.name === propStr || f.rawName === propStr) && f.isStatic,
        );
        if (field) {
          field.set(0n, value);
          return true;
        }
        const unwrapped = context.unwrap(value);
        context.bridge.writeFieldSync?.(
          runtimeClass.classObj,
          propStr,
          unwrapped,
          0n,
        );
        return true;
      }

      return true;
    },
  });

  return proxy;
}

export function createObjectProxy(
  rawInstance: any,
  runtimeClass: RuntimeClass,
  context: IRuntimeExecutionContext,
): any {
  if (rawInstance === null || rawInstance === undefined || rawInstance === 0n)
    return null;

  const isPtr = typeof rawInstance === 'bigint';
  let objPtr = isPtr ? rawInstance : 0n;
  if (objPtr === 0n && runtimeClass.mode === 'hybrid') {
    objPtr = BigInt(Math.floor(Math.random() * 0x7fffffff) + 0x1000);
  }

  const target: Record<string, any> = {
    $ptr: objPtr,
    $address: objPtr,
    $class: runtimeClass,
    $className: runtimeClass.canonicalName,
    rawInstance,
  };

  const proxy = new Proxy(target, {
    get(_tgt, prop, _receiver) {
      if (typeof prop === 'symbol') {
        if (prop === IS_RUNTIME_PROXY) return true;
        if (prop === IS_RUNTIME_OBJECT) return true;
        if (prop === RUNTIME_CLASS) return runtimeClass;
        if (prop === RUNTIME_OBJECT) return rawInstance;
        if (prop === RAW_HANDLE) return objPtr;
        if (prop === Symbol.toPrimitive) {
          return () =>
            `[JavaObject ${runtimeClass.canonicalName}@0x${objPtr.toString(16)}]`;
        }
        return undefined;
      }

      if (prop === 'then') return undefined;

      // Metadata
      if (prop === 'class' || prop === '$class') return runtimeClass;
      if (prop === 'getClass') return () => runtimeClass;
      if (prop === '$ptr' || prop === '$address' || prop === 'address')
        return objPtr;
      if (prop === '$className') return runtimeClass.canonicalName;
      if (prop === 'toString') {
        return () => {
          if (context.bridge?.getAoStringSync && objPtr) {
            return context.bridge.getAoStringSync(objPtr);
          }
          return `[JavaObject ${runtimeClass.canonicalName}@0x${objPtr.toString(16)}]`;
        };
      }
      if (prop === 'equals') {
        return (other: any) => {
          const otherPtr = context.unwrap(other);
          return typeof otherPtr === 'bigint' && otherPtr === objPtr;
        };
      }

      const propStr = String(prop);

      // 1. TypeScript Instance Method Definition (Virtual or Hybrid)
      if (
        runtimeClass.definition?.instanceMethods &&
        propStr in runtimeClass.definition.instanceMethods
      ) {
        const handler = runtimeClass.definition.instanceMethods[propStr];
        if (handler) {
          const selfTarget =
            rawInstance && typeof (rawInstance as any).getName === 'function'
              ? rawInstance
              : proxy;
          return (...args: any[]) => handler(selfTarget, context, ...args);
        }
      }

      // 2. TypeScript Instance Field Definition (Virtual or Hybrid)
      if (
        runtimeClass.definition?.instanceFields &&
        propStr in runtimeClass.definition.instanceFields
      ) {
        const fieldVal = runtimeClass.definition.instanceFields[propStr];
        return typeof fieldVal === 'function'
          ? fieldVal(rawInstance, context)
          : fieldVal;
      }

      // 3. Fallback to Native JVM instance method or field via bridge
      if (runtimeClass.mode !== 'virtual' && context.bridge && objPtr) {
        const effectiveClassObj =
          runtimeClass.classObj ??
          (runtimeClass.superclassName
            ? context.bridge?.getClassSync?.(runtimeClass.superclassName)
                ?.classObj
            : undefined);
        const allMethods =
          (effectiveClassObj
            ? context.bridge?.getAllReflectedMethodsSync?.(effectiveClassObj)
            : undefined) ?? [];
        const matches = allMethods.filter(
          (m) =>
            (m.name === propStr || m.originalName === propStr) && !m.isStatic,
        );
        if (matches.length > 0) {
          return (...args: any[]) => {
            const method =
              matches.find(
                (m) => (m.paramTypes?.length ?? 0) === args.length,
              ) ?? matches[0];
            const unwrappedArgs = args.map((a, idx) =>
              resolveMethodArg(a, method.paramTypes?.[idx], context),
            );
            const res = context.bridge?.invokeMethodSync?.(
              method.methodObj,
              objPtr,
              unwrappedArgs,
            );
            return context.wrap(res, method.type);
          };
        }

        // Check instance fields
        const allFields = runtimeClass.getFields();
        const field = allFields.find(
          (f) => (f.name === propStr || f.rawName === propStr) && !f.isStatic,
        );
        if (field) {
          return field.get(objPtr);
        }

        return (..._args: any[]) => {
          throw new Error(
            `Instance member "${propStr}" not found on ${runtimeClass.canonicalName}`,
          );
        };
      }

      return undefined;
    },

    set(_tgt, prop, value) {
      if (typeof prop === 'symbol') return true;
      const propStr = String(prop);

      if (
        runtimeClass.definition?.instanceFields &&
        propStr in runtimeClass.definition.instanceFields
      ) {
        const fieldDef = runtimeClass.definition.instanceFields[propStr];
        if (typeof fieldDef === 'object' && fieldDef && 'set' in fieldDef) {
          (fieldDef as any).set(rawInstance, value, context);
        } else {
          runtimeClass.definition.instanceFields[propStr] = value;
        }
        return true;
      }

      if (runtimeClass.mode !== 'virtual' && context.bridge && objPtr) {
        const allFields = runtimeClass.getFields();
        const field = allFields.find(
          (f) => (f.name === propStr || f.rawName === propStr) && !f.isStatic,
        );
        if (field) {
          field.set(objPtr, value);
          return true;
        }
        const unwrapped = context.unwrap(value);
        context.bridge.writeFieldSync?.(
          runtimeClass.classObj,
          propStr,
          unwrapped,
          objPtr,
        );
        return true;
      }

      return true;
    },
  });

  return proxy;
}

function constructInstance(
  runtimeClass: RuntimeClass,
  context: IRuntimeExecutionContext,
  args: any[],
): any {
  let effectiveArgs = args;
  let inlineOverrides: Record<string, any> | undefined;
  if (args.length >= 1) {
    const lastArg = args[args.length - 1];
    if (
      typeof lastArg === 'object' &&
      lastArg !== null &&
      !(lastArg instanceof Uint8Array)
    ) {
      const hasMethods = Object.values(lastArg).some(
        (v) => typeof v === 'function',
      );
      if (hasMethods) {
        inlineOverrides = lastArg;
        effectiveArgs = args.slice(0, -1);
      }
    }
  }

  if (inlineOverrides && runtimeClass.definition) {
    runtimeClass.definition.instanceMethods =
      runtimeClass.definition.instanceMethods ?? {};
    for (const [k, v] of Object.entries(inlineOverrides)) {
      if (typeof v === 'function') {
        runtimeClass.definition.instanceMethods[k] = (
          target: any,
          _ctx: any,
          ...callArgs: any[]
        ) => {
          return v.apply(target, callArgs);
        };
      }
    }
  }

  // 1. Virtual / Hybrid TS construct function
  if (runtimeClass.definition?.construct) {
    const instance = runtimeClass.definition.construct(
      context,
      ...effectiveArgs,
    );
    return createObjectProxy(instance, runtimeClass, context);
  }

  // 2. Native bridge construct
  if (
    runtimeClass.mode !== 'virtual' &&
    context.bridge &&
    runtimeClass.classObj
  ) {
    const ctors =
      context.bridge.getAllConstructorsSync?.(runtimeClass.classObj) ?? [];
    const matchedCtor =
      ctors.find((c) => (c.paramTypes?.length ?? 0) === effectiveArgs.length) ??
      ctors[0];
    const unwrappedArgs = effectiveArgs.map((a, idx) =>
      resolveMethodArg(a, matchedCtor?.paramTypes?.[idx], context),
    );
    if (matchedCtor && context.bridge.constructSync) {
      const ptr = context.bridge.constructSync(
        matchedCtor.ctorObj,
        unwrappedArgs,
      );
      return createObjectProxy(ptr, runtimeClass, context);
    }
  }

  // Default virtual plain object
  const plainObj: Record<string, any> = {};
  return createObjectProxy(plainObj, runtimeClass, context);
}
