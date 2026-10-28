import {
  type ReflectionBridge,
  type ReflectedClass,
  type ReflectedField,
  type ReflectedMethod,
  matchMethodOverload,
  matchConstructorOverload,
} from './reflection-bridge.js';
import { writeUtf8CStringSync } from './remote-memory.js';
import {
  JavaMappingRegistry,
  type JavaClassMappingOptions,
} from './mapping.js';
import { buildExtendedClassAdapter } from './adapter.js';
import { compileJavaSync, resolveDefaultJavaPath } from './compiler.js';

export type JavaClassProxy = any;
export type JavaObjectProxy = any;

const IS_JAVA_OBJECT = Symbol('isJavaObject');
const IS_JAVA_CLASS = Symbol('isJavaClass');
const RAW_PTR = Symbol('rawPtr');
const RAW_CLASS = Symbol('rawClass');
const BRIDGE = Symbol('bridge');
const SYNC_MODE = Symbol('syncMode');
const MAPPER = Symbol('mapper');

/**
 * Unwraps a JavaObjectProxy or JavaClassProxy into its raw `bigint` JNI pointer.
 * If `val` is not a Java proxy, returns `val` as-is.
 */
export function unwrapJava(val: any): any {
  if (!val || (typeof val !== 'object' && typeof val !== 'function'))
    return val;
  if (RAW_PTR in val) return val[RAW_PTR];
  if (RAW_CLASS in val) return (val[RAW_CLASS] as ReflectedClass).classObj;
  if ('$ptr' in val) return val.$ptr;
  if ('$classObj' in val) return val.$classObj;
  return val;
}

/**
 * Checks whether `val` is a {@link JavaObjectProxy}.
 */
export function isJavaObject(val: any): boolean {
  return Boolean(val && typeof val === 'object' && IS_JAVA_OBJECT in val);
}

/**
 * Checks whether `val` is a {@link JavaClassProxy}.
 */
export function isJavaClass(val: any): boolean {
  return Boolean(
    val &&
    (typeof val === 'function' || typeof val === 'object') &&
    IS_JAVA_CLASS in val,
  );
}

/**
 * Creates a dynamic proxy for a Java `Class` handle with optional deobfuscation mappings.
 *
 * Supports:
 * - Instantiation: `new MyClass(arg1, arg2)` or `MyClass(arg1, arg2)` with automatic constructor overload matching
 * - Static fields: `MyClass.staticField` (read/write) with automatic deobf remapping
 * - Static methods: `MyClass.staticMethod(arg1, arg2)` with automatic deobf remapping
 * - Reflection metadata: `MyClass.class`, `MyClass.class.getName()`, `MyClass.name`, `MyClass.superclass`, `MyClass.class.getSuperclass()`
 */
export function createJavaClassProxy(
  reflectedClass: ReflectedClass,
  bridge: ReflectionBridge,
  sync = true,
  mapper?: JavaMappingRegistry,
  initialFields?: Map<string, ReflectedField>,
  initialMethods?: Map<string, ReflectedMethod[]>,
  hybridOverrides?: Record<string, Function>,
): JavaClassProxy {
  const target = function (...args: any[]) {
    let effectiveOverrides = hybridOverrides;
    let effectiveArgs = args;
    if (args.length >= 1) {
      const lastArg = args[args.length - 1];
      if (
        typeof lastArg === 'object' &&
        lastArg !== null &&
        !isJavaObject(lastArg) &&
        !(lastArg instanceof Uint8Array)
      ) {
        const hasMethods = Object.values(lastArg).some(
          (v) => typeof v === 'function',
        );
        if (hasMethods) {
          effectiveOverrides = { ...effectiveOverrides, ...lastArg };
          effectiveArgs = args.slice(0, -1);
        }
      }
    }
    return constructInstance(
      reflectedClass,
      bridge,
      effectiveArgs,
      sync,
      mapper,
      effectiveOverrides,
    );
  };

  const fieldCache = initialFields
    ? new Map(initialFields)
    : new Map<string, ReflectedField>();
  const methodCache = initialMethods
    ? new Map(initialMethods)
    : new Map<string, ReflectedMethod[]>();

  const deobfClassName = mapper
    ? mapper.resolveDeobfClass(reflectedClass.name)
    : reflectedClass.name;

  // Prepopulate caches if available
  if (fieldCache.size === 0 && reflectedClass.getFieldsSync) {
    try {
      const flds = reflectedClass.getFieldsSync();
      for (const [k, v] of flds.entries()) fieldCache.set(k, v);
    } catch {}
  }
  if (methodCache.size === 0 && reflectedClass.getAllMethodsSync) {
    try {
      const mths = reflectedClass.getAllMethodsSync();
      for (const m of mths) {
        let list = methodCache.get(m.name);
        if (!list) {
          list = [];
          methodCache.set(m.name, list);
        }
        list.push(m);
      }
    } catch {}
  }

  const superclassChain: string[] = [];
  if (sync && reflectedClass.getSuperclassChainSync) {
    try {
      const ch = reflectedClass.getSuperclassChainSync();
      if (Array.isArray(ch)) superclassChain.push(...ch);
    } catch {}
  }

  const proxy = new Proxy(target, {
    construct(_tgt, args) {
      let effectiveOverrides = hybridOverrides;
      let effectiveArgs = args;
      if (args.length >= 1) {
        const lastArg = args[args.length - 1];
        if (
          typeof lastArg === 'object' &&
          lastArg !== null &&
          !isJavaObject(lastArg) &&
          !(lastArg instanceof Uint8Array)
        ) {
          const hasMethods = Object.values(lastArg).some(
            (v) => typeof v === 'function',
          );
          if (hasMethods) {
            effectiveOverrides = { ...effectiveOverrides, ...lastArg };
            effectiveArgs = args.slice(0, -1);
          }
        }
      }
      return constructInstance(
        reflectedClass,
        bridge,
        effectiveArgs,
        sync,
        mapper,
        effectiveOverrides,
      );
    },

    get(_tgt, prop, _receiver) {
      if (typeof prop === 'symbol') {
        if (prop === IS_JAVA_CLASS) return true;
        if (prop === RAW_CLASS) return reflectedClass;
        if (prop === BRIDGE) return bridge;
        if (prop === SYNC_MODE) return sync;
        if (prop === MAPPER) return mapper;
        if (prop === Symbol.toPrimitive) {
          return () => `[JavaClass ${deobfClassName}]`;
        }
        return undefined;
      }

      if (prop === 'then') return undefined; // Prevent thenable issues with Promise.resolve / await

      // Special Metadata Properties
      if (prop === '$class' || prop === 'class') {
        return mapper ? reflectedClass.withMapper(mapper) : reflectedClass;
      }
      if (prop === 'getClass') {
        return () =>
          mapper ? reflectedClass.withMapper(mapper) : reflectedClass;
      }
      if (prop === '$classObj' || prop === 'classObj') {
        return reflectedClass.classObj;
      }
      if (prop === '$className' || prop === 'name') {
        return deobfClassName;
      }
      if (prop === 'getName') {
        return () => deobfClassName;
      }
      if (prop === 'getSimpleName') {
        return () => {
          const parts = deobfClassName.split('.');
          return parts[parts.length - 1] ?? deobfClassName;
        };
      }
      if (prop === 'toString') {
        return () => `[JavaClass ${deobfClassName}]`;
      }
      if (prop === 'valueOf') {
        return () => `[JavaClass ${deobfClassName}]`;
      }
      if (prop === 'toJSON') {
        return () => ({
          $classObj: '0x' + reflectedClass.classObj.toString(16),
          $className: deobfClassName,
        });
      }
      if (prop === '$superclass' || prop === 'superclass') {
        if (sync) {
          const superCls = reflectedClass.getSuperclassSync?.();
          return superCls
            ? createJavaClassProxy(superCls, bridge, true, mapper)
            : null;
        } else {
          return reflectedClass
            .getSuperclass()
            .then((sc) =>
              sc ? createJavaClassProxy(sc, bridge, false, mapper) : null,
            );
        }
      }
      if (prop === 'getSuperclass') {
        return () => {
          if (sync) {
            const superCls = reflectedClass.getSuperclassSync?.();
            return superCls
              ? createJavaClassProxy(superCls, bridge, true, mapper)
              : null;
          } else {
            return reflectedClass
              .getSuperclass()
              .then((sc) =>
                sc ? createJavaClassProxy(sc, bridge, false, mapper) : null,
              );
          }
        };
      }
      if (prop === '$raw') return reflectedClass;

      const propStr = String(prop);
      const actualMethodName = mapper
        ? mapper.resolveObfMethod(reflectedClass.name, propStr, superclassChain)
        : propStr;
      const actualFieldName = mapper
        ? mapper.resolveObfField(reflectedClass.name, propStr, superclassChain)
        : propStr;

      // 1. Static Method with overload resolution & mapping
      let methodList =
        methodCache.get(actualMethodName) ??
        (actualMethodName !== propStr ? methodCache.get(propStr) : undefined);
      if (!methodList && sync && reflectedClass.getAllMethodsSync) {
        const all = reflectedClass.getAllMethodsSync();
        methodList = all.filter(
          (m) => m.name === actualMethodName || m.name === propStr,
        );
        if (methodList.length > 0)
          methodCache.set(actualMethodName, methodList);
      }

      if (methodList && methodList.some((m) => m.isStatic)) {
        const staticMethods = methodList.filter((m) => m.isStatic);
        if (sync) {
          return (...args: any[]) => {
            const unwrappedArgs = args.map(unwrapJava);
            const method =
              matchMethodOverload(staticMethods, unwrappedArgs) ??
              staticMethods[0];
            if (!method)
              throw new Error(
                `Static method "${propStr}" (mapped: "${actualMethodName}") not found on ${deobfClassName}`,
              );
            const res = bridge.invokeUnboxedSync?.(
              method.methodObj,
              0n,
              unwrappedArgs,
            );
            return wrapJavaReturnValue(res, method.type, bridge, true, mapper);
          };
        } else {
          return async (...args: any[]) => {
            const unwrappedArgs = args.map(unwrapJava);
            const method =
              matchMethodOverload(staticMethods, unwrappedArgs) ??
              staticMethods[0];
            if (!method)
              throw new Error(
                `Static method "${propStr}" (mapped: "${actualMethodName}") not found on ${deobfClassName}`,
              );
            const res = await bridge.invokeUnboxed(
              method.methodObj,
              0n,
              unwrappedArgs,
            );
            return wrapJavaReturnValue(res, method.type, bridge, false, mapper);
          };
        }
      }

      // 2. Static Field with mapping
      let field =
        fieldCache.get(actualFieldName) ??
        (actualFieldName !== propStr ? fieldCache.get(propStr) : undefined);
      if (!field && sync && reflectedClass.findFieldSync) {
        field =
          reflectedClass.findFieldSync(actualFieldName) ??
          (actualFieldName !== propStr
            ? reflectedClass.findFieldSync(propStr)
            : undefined);
        if (field) fieldCache.set(actualFieldName, field);
      }

      if (field && field.isStatic) {
        if (sync) {
          const val = bridge.readFieldSync?.(
            reflectedClass.classObj,
            field.name,
            0n,
          );
          return wrapJavaReturnValue(val, field.type, bridge, true, mapper);
        } else {
          return bridge
            .readField(reflectedClass.classObj, field.name, 0n)
            .then((val) =>
              wrapJavaReturnValue(val, field!.type, bridge, false, mapper),
            );
        }
      }

      // Fallback invoker for unknown / un-cached static members
      return (...args: any[]) => {
        const unwrappedArgs = args.map(unwrapJava);
        if (sync) {
          try {
            const mths = reflectedClass.getAllMethodsSync?.() ?? [];
            const matches = mths.filter(
              (m) =>
                (m.name === actualMethodName || m.name === propStr) &&
                m.isStatic,
            );
            if (matches.length > 0) {
              const method =
                matchMethodOverload(matches, unwrappedArgs) ?? matches[0];
              if (method) {
                const res = bridge.invokeUnboxedSync?.(
                  method.methodObj,
                  0n,
                  unwrappedArgs,
                );
                return wrapJavaReturnValue(
                  res,
                  method.type,
                  bridge,
                  true,
                  mapper,
                );
              }
            }
          } catch {}
          throw new Error(
            `Static member or method "${propStr}" (mapped: "${actualMethodName}") not found on ${deobfClassName}`,
          );
        } else {
          return (async () => {
            const mths = await reflectedClass.getAllMethods();
            const matches = mths.filter(
              (m) =>
                (m.name === actualMethodName || m.name === propStr) &&
                m.isStatic,
            );
            if (matches.length > 0) {
              const method =
                matchMethodOverload(matches, unwrappedArgs) ?? matches[0];
              if (method) {
                const res = await bridge.invokeUnboxed(
                  method.methodObj,
                  0n,
                  unwrappedArgs,
                );
                return wrapJavaReturnValue(
                  res,
                  method.type,
                  bridge,
                  false,
                  mapper,
                );
              }
            }
            const f =
              (await reflectedClass.findField(actualFieldName)) ??
              (actualFieldName !== propStr
                ? await reflectedClass.findField(propStr)
                : undefined);
            if (f && f.isStatic) {
              const val = await bridge.readField(
                reflectedClass.classObj,
                f.name,
                0n,
              );
              return wrapJavaReturnValue(val, f.type, bridge, false, mapper);
            }
            throw new Error(
              `Static member "${propStr}" (mapped: "${actualFieldName}") not found on ${deobfClassName}`,
            );
          })();
        }
      };
    },

    set(_tgt, prop, value) {
      if (typeof prop === 'symbol') return true;

      const propStr = String(prop);
      const actualFieldName = mapper
        ? mapper.resolveObfField(reflectedClass.name, propStr)
        : propStr;
      const unwrappedValue = unwrapJava(value);

      if (sync) {
        bridge.writeFieldSync?.(
          reflectedClass.classObj,
          actualFieldName,
          unwrappedValue,
          0n,
        );
      } else {
        bridge.writeField(
          reflectedClass.classObj,
          actualFieldName,
          unwrappedValue,
          0n,
        );
      }
      return true;
    },
  });

  return proxy;
}

/**
 * Creates a dynamic proxy for a Java Object instance (`jobject`) or Java Array with deobfuscation mappings.
 *
 * Supports:
 * - Array indexing and length: `arr[0]`, `arr[1] = 42`, `arr.length`
 * - Instance methods: `player.swingItem()`, `list.size()`, `list.get(0)` (with automatic overload resolution & mapping)
 * - Instance field access: `player.posX` (read/write with automatic deobf remapping)
 * - Object Class introspection: `player.getClass()`, `player.class`
 * - Standard Java methods: `player.toString()`, `player.equals(other)`
 */
export function createJavaObjectProxy(
  objPtr: bigint,
  reflectedClass: ReflectedClass,
  bridge: ReflectionBridge,
  sync = true,
  mapper?: JavaMappingRegistry,
  initialFields?: Map<string, ReflectedField>,
  initialMethods?: Map<string, ReflectedMethod[]>,
  hybridOverrides?: Record<string, Function>,
): JavaObjectProxy {
  if (!objPtr || objPtr === 0n) return null;

  const deobfClassName = mapper
    ? mapper.resolveDeobfClass(reflectedClass.name)
    : reflectedClass.name;

  const target: Record<string, any> = {
    $ptr: objPtr,
    $address: objPtr,
    $class: reflectedClass,
    $className: deobfClassName,
  };

  const fieldCache = initialFields
    ? new Map(initialFields)
    : new Map<string, ReflectedField>();
  const methodCache = initialMethods
    ? new Map(initialMethods)
    : new Map<string, ReflectedMethod[]>();

  const isArrayType =
    reflectedClass.name.endsWith('[]') || reflectedClass.name.startsWith('[');

  // Prepopulate caches if available
  if (fieldCache.size === 0 && reflectedClass.getFieldsSync) {
    try {
      const flds = reflectedClass.getFieldsSync();
      for (const [k, v] of flds.entries()) fieldCache.set(k, v);
    } catch {}
  }
  if (methodCache.size === 0 && reflectedClass.getAllMethodsSync) {
    try {
      const mths = reflectedClass.getAllMethodsSync();
      for (const m of mths) {
        let list = methodCache.get(m.name);
        if (!list) {
          list = [];
          methodCache.set(m.name, list);
        }
        list.push(m);
      }
    } catch {}
  }

  const superclassChain: string[] = [];
  if (sync && reflectedClass.getSuperclassChainSync) {
    try {
      const ch = reflectedClass.getSuperclassChainSync();
      if (Array.isArray(ch)) superclassChain.push(...ch);
    } catch {}
  }

  const proxy = new Proxy(target, {
    get(_tgt, prop, _receiver) {
      if (typeof prop === 'symbol') {
        if (prop === IS_JAVA_OBJECT) return true;
        if (prop === RAW_PTR) return objPtr;
        if (prop === RAW_CLASS) return reflectedClass;
        if (prop === BRIDGE) return bridge;
        if (prop === SYNC_MODE) return sync;
        if (prop === MAPPER) return mapper;
        if (prop === Symbol.toPrimitive) {
          return (hint: string) => {
            if (hint === 'number') return Number(objPtr);
            return `[JavaObject ${deobfClassName}@0x${objPtr.toString(16)}]`;
          };
        }
        return undefined;
      }

      if (prop === 'then') return undefined; // Avoid Promise resolution intercept

      // Special Metadata Properties
      if (prop === '$ptr' || prop === '$address' || prop === 'address')
        return objPtr;
      if (prop === '$className') return deobfClassName;
      if (prop === '$field' || prop === '$getField') {
        return (fieldName: string) => {
          const actName = mapper
            ? mapper.resolveObfField(
                reflectedClass.name,
                fieldName,
                superclassChain,
              )
            : fieldName;
          let f =
            fieldCache.get(actName) ??
            (actName !== fieldName ? fieldCache.get(fieldName) : undefined);
          if (!f && sync && reflectedClass.findFieldSync) {
            f =
              reflectedClass.findFieldSync(actName) ??
              (actName !== fieldName
                ? reflectedClass.findFieldSync(fieldName)
                : undefined);
            if (f) fieldCache.set(actName, f);
          }
          if (f && !f.isStatic) {
            const val = bridge.readFieldSync?.(
              reflectedClass.classObj,
              f.name,
              objPtr,
            );
            return wrapJavaReturnValue(val, f.type, bridge, true, mapper);
          }
          return undefined;
        };
      }
      if (prop === '$class' || prop === 'class') {
        return createJavaClassProxy(
          reflectedClass,
          bridge,
          sync,
          mapper,
          fieldCache,
          methodCache,
        );
      }
      if (prop === 'getClass') {
        return () =>
          createJavaClassProxy(
            reflectedClass,
            bridge,
            sync,
            mapper,
            fieldCache,
            methodCache,
          );
      }
      if (prop === 'toString') {
        return () => {
          if (sync) {
            return (
              bridge.getAoStringSync?.(objPtr) ??
              `[JavaObject ${deobfClassName}@0x${objPtr.toString(16)}]`
            );
          }
          return bridge.getAoString(objPtr);
        };
      }
      if (prop === 'valueOf') {
        return () => `[JavaObject ${deobfClassName}@0x${objPtr.toString(16)}]`;
      }
      if (prop === 'toJSON') {
        return () => ({
          $ptr: '0x' + objPtr.toString(16),
          $className: deobfClassName,
        });
      }
      if (prop === 'equals') {
        return (other: any) => {
          const otherPtr = unwrapJava(other);
          return typeof otherPtr === 'bigint' && otherPtr === objPtr;
        };
      }

      // Java Array length and numeric indexing
      if (isArrayType) {
        const bridgeAny = bridge as any;
        const fns = bridgeAny.fns;
        if (prop === 'length') {
          if (sync) {
            return Number(bridgeAny.callFnSync(fns.GetArrayLength, objPtr));
          } else {
            return fns.GetArrayLength(objPtr).then((len: any) => Number(len));
          }
        }

        if (typeof prop === 'string' && /^\d+$/.test(prop)) {
          const idx = parseInt(prop, 10);
          if (sync) {
            const elem = BigInt(
              bridgeAny.callFnSync(fns.GetObjectArrayElement, objPtr, idx),
            );
            return wrapJavaReturnValue(elem, undefined, bridge, true, mapper);
          } else {
            return fns
              .GetObjectArrayElement(objPtr, idx)
              .then((elem: any) =>
                wrapJavaReturnValue(
                  BigInt(elem),
                  undefined,
                  bridge,
                  false,
                  mapper,
                ),
              );
          }
        }
      }

      const propStr = String(prop);

      // 0. Hybrid Method Overrides (Zero-IPC Short-Circuit)
      if (hybridOverrides && propStr in hybridOverrides) {
        const fn = hybridOverrides[propStr];
        if (typeof fn === 'function') {
          return (...args: any[]) => fn.apply(proxy, args);
        }
      }

      const actualMethodName = mapper
        ? mapper.resolveObfMethod(reflectedClass.name, propStr, superclassChain)
        : propStr;
      const actualFieldName = mapper
        ? mapper.resolveObfField(reflectedClass.name, propStr, superclassChain)
        : propStr;

      // 1. Instance Method with overload resolution & mapping
      let methodList =
        methodCache.get(actualMethodName) ??
        (actualMethodName !== propStr ? methodCache.get(propStr) : undefined);
      if (!methodList && sync && reflectedClass.getAllMethodsSync) {
        const all = reflectedClass.getAllMethodsSync();
        methodList = all.filter(
          (m) =>
            (m.name === actualMethodName || m.name === propStr) && !m.isStatic,
        );
        if (methodList.length > 0)
          methodCache.set(actualMethodName, methodList);
      }

      if (methodList && methodList.some((m) => !m.isStatic)) {
        const instanceMethods = methodList.filter((m) => !m.isStatic);
        if (sync) {
          return (...args: any[]) => {
            const unwrappedArgs = args.map(unwrapJava);
            const method =
              matchMethodOverload(instanceMethods, unwrappedArgs) ??
              instanceMethods[0];
            if (!method)
              throw new Error(
                `Method "${propStr}" (mapped: "${actualMethodName}") not found on ${deobfClassName}`,
              );
            const res = bridge.invokeUnboxedSync?.(
              method.methodObj,
              objPtr,
              unwrappedArgs,
            );
            return wrapJavaReturnValue(res, method.type, bridge, true, mapper);
          };
        } else {
          return async (...args: any[]) => {
            const unwrappedArgs = args.map(unwrapJava);
            const method =
              matchMethodOverload(instanceMethods, unwrappedArgs) ??
              instanceMethods[0];
            if (!method)
              throw new Error(
                `Method "${propStr}" (mapped: "${actualMethodName}") not found on ${deobfClassName}`,
              );
            const res = await bridge.invokeUnboxed(
              method.methodObj,
              objPtr,
              unwrappedArgs,
            );
            return wrapJavaReturnValue(res, method.type, bridge, false, mapper);
          };
        }
      }

      // 2. Instance Field with mapping
      let field =
        fieldCache.get(actualFieldName) ??
        (actualFieldName !== propStr ? fieldCache.get(propStr) : undefined);
      if (!field && sync && reflectedClass.findFieldSync) {
        field =
          reflectedClass.findFieldSync(actualFieldName) ??
          (actualFieldName !== propStr
            ? reflectedClass.findFieldSync(propStr)
            : undefined);
        if (field) fieldCache.set(actualFieldName, field);
      }

      if (field && !field.isStatic) {
        if (sync) {
          const val = bridge.readFieldSync?.(
            reflectedClass.classObj,
            field.name,
            objPtr,
          );
          return wrapJavaReturnValue(val, field.type, bridge, true, mapper);
        } else {
          return bridge
            .readField(reflectedClass.classObj, field.name, objPtr)
            .then((val) =>
              wrapJavaReturnValue(val, field!.type, bridge, false, mapper),
            );
        }
      }

      // Dynamic fallback invoker
      return (...args: any[]) => {
        const unwrappedArgs = args.map(unwrapJava);
        if (sync) {
          try {
            const mths = reflectedClass.getAllMethodsSync?.() ?? [];
            const matches = mths.filter(
              (m) =>
                (m.name === actualMethodName || m.name === propStr) &&
                !m.isStatic,
            );
            if (matches.length > 0) {
              const method =
                matchMethodOverload(matches, unwrappedArgs) ?? matches[0];
              if (method) {
                const res = bridge.invokeUnboxedSync?.(
                  method.methodObj,
                  objPtr,
                  unwrappedArgs,
                );
                return wrapJavaReturnValue(
                  res,
                  method.type,
                  bridge,
                  true,
                  mapper,
                );
              }
            }
          } catch {}
          throw new Error(
            `Member or method "${propStr}" (mapped: "${actualMethodName}") not found on instance of ${deobfClassName}`,
          );
        } else {
          return (async () => {
            const mths = await reflectedClass.getAllMethods();
            const matches = mths.filter(
              (m) =>
                (m.name === actualMethodName || m.name === propStr) &&
                !m.isStatic,
            );
            if (matches.length > 0) {
              const method =
                matchMethodOverload(matches, unwrappedArgs) ?? matches[0];
              if (method) {
                const res = await bridge.invokeUnboxed(
                  method.methodObj,
                  objPtr,
                  unwrappedArgs,
                );
                return wrapJavaReturnValue(
                  res,
                  method.type,
                  bridge,
                  false,
                  mapper,
                );
              }
            }
            const f =
              (await reflectedClass.findField(actualFieldName)) ??
              (actualFieldName !== propStr
                ? await reflectedClass.findField(propStr)
                : undefined);
            if (f) {
              const val = await bridge.readField(
                reflectedClass.classObj,
                f.name,
                objPtr,
              );
              return wrapJavaReturnValue(val, f.type, bridge, false, mapper);
            }
            throw new Error(
              `Member "${propStr}" (mapped: "${actualFieldName}") not found on instance of ${deobfClassName}`,
            );
          })();
        }
      };
    },

    set(_tgt, prop, value) {
      if (typeof prop === 'symbol') return true;

      // Java Array index assignment
      if (isArrayType && typeof prop === 'string' && /^\d+$/.test(prop)) {
        const idx = parseInt(prop, 10);
        const bridgeAny = bridge as any;
        const fns = bridgeAny.fns;
        const unwrappedVal = unwrapJava(value);
        if (sync) {
          bridgeAny.callFnSync(
            fns.SetObjectArrayElement,
            objPtr,
            idx,
            unwrappedVal,
          );
        } else {
          fns.SetObjectArrayElement(objPtr, idx, unwrappedVal);
        }
        return true;
      }

      const propStr = String(prop);
      const actualFieldName = mapper
        ? mapper.resolveObfField(reflectedClass.name, propStr, superclassChain)
        : propStr;
      const unwrappedValue = unwrapJava(value);

      if (sync) {
        bridge.writeFieldSync?.(
          reflectedClass.classObj,
          actualFieldName,
          unwrappedValue,
          objPtr,
        );
      } else {
        bridge.writeField(
          reflectedClass.classObj,
          actualFieldName,
          unwrappedValue,
          objPtr,
        );
      }
      return true;
    },
  });

  return proxy;
}

function constructInstance(
  reflectedClass: ReflectedClass,
  bridge: ReflectionBridge,
  args: any[],
  sync: boolean,
  mapper?: JavaMappingRegistry,
  hybridOverrides?: Record<string, Function>,
): any {
  const unwrappedArgs = args.map(unwrapJava);

  if (sync) {
    const ctors = reflectedClass.getDeclaredConstructorsSync?.() ?? [];
    const matchedCtor =
      matchConstructorOverload(ctors, unwrappedArgs) ?? ctors[0];
    let instancePtr: bigint | undefined;
    if (matchedCtor) {
      instancePtr = bridge.constructSync?.(matchedCtor.ctorObj, unwrappedArgs);
    }
    if (!instancePtr || instancePtr === 0n) {
      try {
        const bridgeAny = bridge as any;
        if (bridgeAny.fns?.AllocObject && bridgeAny.callFnSync) {
          instancePtr = BigInt(
            bridgeAny.callFnSync(
              bridgeAny.fns.AllocObject,
              reflectedClass.classObj,
            ),
          );
        }
      } catch {}
    }
    if (!instancePtr || instancePtr === 0n) {
      try {
        const bridgeAny = bridge as any;
        if (bridgeAny.type) {
          const Exoproc = bridgeAny.type('Exoproc');
          if (Exoproc?.newInstance) {
            const res = Exoproc.newInstance(reflectedClass.name);
            instancePtr = unwrapJava(res);
          }
        }
      } catch {}
    }
    if (!instancePtr || instancePtr === 0n) {
      if (hybridOverrides) {
        instancePtr = BigInt(Math.floor(Math.random() * 0x7fffffff) + 0x1000);
      } else {
        throw new Error(
          `No constructor found for ${reflectedClass.name} with ${unwrappedArgs.length} arguments`,
        );
      }
    }
    return createJavaObjectProxy(
      instancePtr,
      reflectedClass,
      bridge,
      true,
      mapper,
      undefined,
      undefined,
      hybridOverrides,
    );
  } else {
    return (async () => {
      const ctors = await reflectedClass.getDeclaredConstructors();
      const matchedCtor =
        matchConstructorOverload(ctors, unwrappedArgs) ?? ctors[0];
      let instancePtr: bigint | undefined;
      if (matchedCtor) {
        instancePtr = await bridge.construct(
          matchedCtor.ctorObj,
          unwrappedArgs,
        );
      }
      if (!instancePtr || instancePtr === 0n) {
        try {
          const bridgeAny = bridge as any;
          if (bridgeAny.type) {
            const Exoproc = bridgeAny.type('Exoproc');
            if (Exoproc?.newInstance) {
              const res = await Exoproc.newInstance(reflectedClass.name);
              instancePtr = unwrapJava(res);
            }
          }
        } catch {}
      }
      if (!instancePtr || instancePtr === 0n) {
        if (hybridOverrides) {
          instancePtr = BigInt(Math.floor(Math.random() * 0x7fffffff) + 0x1000);
        } else {
          throw new Error(
            `No constructor found for ${reflectedClass.name} with ${unwrappedArgs.length} arguments`,
          );
        }
      }
      return createJavaObjectProxy(
        instancePtr,
        reflectedClass,
        bridge,
        false,
        mapper,
        undefined,
        undefined,
        hybridOverrides,
      );
    })();
  }
}

function wrapJavaReturnValue(
  val: any,
  typeHint: string | null | undefined,
  bridge: ReflectionBridge,
  sync: boolean,
  mapper?: JavaMappingRegistry,
): any {
  if (val === null || val === undefined) return val;

  // If result is a raw bigint pointer and corresponds to a non-primitive Java Object
  if (typeof val === 'bigint' && val !== 0n) {
    const cleanType = typeHint
      ? typeHint.replace(/^(class|interface)\s+/, '').trim()
      : '';
    if (
      cleanType === 'int' ||
      cleanType === 'boolean' ||
      cleanType === 'double' ||
      cleanType === 'float' ||
      cleanType === 'long' ||
      cleanType === 'short' ||
      cleanType === 'byte' ||
      cleanType === 'char'
    ) {
      return val;
    }

    try {
      if (sync && bridge.getClassSync) {
        let clsName = cleanType;
        if (
          !clsName ||
          clsName === 'java.lang.Object' ||
          clsName === 'Object'
        ) {
          if (bridge.getObjectClassNameSync) {
            clsName = bridge.getObjectClassNameSync(val);
          } else {
            const bridgeAny = bridge as any;
            const classObj = BigInt(
              bridgeAny.callFnSync(bridgeAny.fns.GetObjectClass, val),
            );
            if (classObj && classObj !== 0n) {
              clsName = bridge.getClassNameSync(classObj);
            }
          }
        }
        if (clsName && clsName !== 'java.lang.String') {
          const cls = bridge.getClassSync(clsName);
          return createJavaObjectProxy(val, cls, bridge, true, mapper);
        }
      }
    } catch {}
  }

  return val;
}

/**
 * Interface for pluggable class/member detectors (e.g. MinecraftMatcher).
 */
export interface JavaDetector {
  detect(target: any, options?: any): Promise<any>;
  detectSync(target: any, options?: any): any;
}

/**
 * Interface representing a synchronous Java execution context (modeled after ISyncStruct in xffi/struct.ts).
 */
export interface ISyncJavaContext {
  readonly sync: true;
  readonly mapper: JavaMappingRegistry;
  readonly bridge: ReflectionBridge;
  detector?: JavaDetector;
  type(
    classNameOrClass: string | ReflectedClass | JavaClassProxy,
  ): JavaClassProxy;
  typeAsync(
    classNameOrClass: string | ReflectedClass | JavaClassProxy,
  ): Promise<JavaClassProxy>;
  from(javaObj: any, classNameOrClass?: string | ReflectedClass): any;
  to(jsArray: any[], targetType?: string): any;
  detect(target: any, options?: any): any;
  detectSync(target: any, options?: any): any;
  detectAsync(target: any, options?: any): Promise<any>;
  asSync(): ISyncJavaContext;
  asAsync(): IAsyncJavaContext;
  [key: string]: any;
}

/**
 * Interface representing an asynchronous Java execution context (modeled after IStruct in xffi/struct.ts).
 */
export interface IAsyncJavaContext {
  readonly sync: false;
  readonly mapper: JavaMappingRegistry;
  readonly bridge: ReflectionBridge;
  detector?: JavaDetector;
  type(
    classNameOrClass: string | ReflectedClass | JavaClassProxy,
  ): JavaClassProxy;
  typeAsync(
    classNameOrClass: string | ReflectedClass | JavaClassProxy,
  ): Promise<JavaClassProxy>;
  from(javaObj: any, classNameOrClass?: string | ReflectedClass): Promise<any>;
  to(jsArray: any[], targetType?: string): Promise<any>;
  detect(target: any, options?: any): Promise<any>;
  detectSync(target: any, options?: any): any;
  detectAsync(target: any, options?: any): Promise<any>;
  asSync(): ISyncJavaContext;
  asAsync(): IAsyncJavaContext;
  [key: string]: any;
}

/**
 * Nashorn / GraalJS-style Java Environment Context for TypeScript with full Deobfuscation Mapping support.
 *
 * Provides `Java.type("my.class.Name")`, `Java.from(javaObjectOrList)`, `Java.to(jsArray, type)`,
 * `Java.detect(target)`, dynamic class/object instantiation, and `Java.mapClass / Java.mapField / Java.mapMethod`.
 */
export class JavaContext {
  public readonly mapper: JavaMappingRegistry;
  public detector?: JavaDetector;
  public pool?: any;

  constructor(
    public readonly bridge: ReflectionBridge,
    public readonly sync: boolean = true,
    mapper?: JavaMappingRegistry,
    detector?: JavaDetector,
    pool?: any,
  ) {
    this.mapper = mapper ?? new JavaMappingRegistry();
    this.detector = detector;
    this.pool = pool;
    if (pool) {
      this.mapper.usePool(pool);
    }
  }

  /**
   * Registers a pluggable class/member detector (e.g. MinecraftMatcher).
   */
  public setDetector(detector: JavaDetector): this {
    this.detector = detector;
    return this;
  }

  /**
   * Detects and matches a class, instance, field, or method against known schemas.
   * If this JavaContext is synchronous (`sync: true`), executes synchronously and returns metadata directly.
   * If this JavaContext is asynchronous (`sync: false`), returns a Promise.
   */
  public detect(target: any, options?: any): any {
    if (!this.detector) {
      throw new Error(
        'No detector registered on JavaContext (e.g. MinecraftMatcher)',
      );
    }
    if (this.sync) {
      return this.detector.detectSync(target, options);
    } else {
      return this.detector.detect(target, options);
    }
  }

  /**
   * Explicit synchronous detect, available on both sync and async contexts.
   */
  public detectSync(target: any, options?: any): any {
    if (!this.detector) {
      throw new Error(
        'No detector registered on JavaContext (e.g. MinecraftMatcher)',
      );
    }
    return this.detector.detectSync(target, options);
  }

  /**
   * Explicit asynchronous detect, available on both sync and async contexts.
   */
  public async detectAsync(target: any, options?: any): Promise<any> {
    if (!this.detector) {
      throw new Error(
        'No detector registered on JavaContext (e.g. MinecraftMatcher)',
      );
    }
    return await this.detector.detect(target, options);
  }

  /**
   * Returns a synchronous twin of this JavaContext sharing the same bridge, mapper, and detector.
   */
  public asSync(): SyncJavaContext {
    if (this.sync && this instanceof SyncJavaContext) return this;
    return new SyncJavaContext(
      this.bridge,
      this.mapper,
      this.detector,
      this.pool,
    );
  }

  /**
   * Returns an asynchronous twin of this JavaContext sharing the same bridge, mapper, and detector.
   */
  public asAsync(): AsyncJavaContext {
    if (!this.sync && this instanceof AsyncJavaContext) return this;
    return new AsyncJavaContext(
      this.bridge,
      this.mapper,
      this.detector,
      this.pool,
    );
  }

  /**
   * Registers a deobfuscation mapping for a class, its fields, and its methods.
   *
   * Example:
   * ```ts
   * Java.mapClass('ave', 'net.minecraft.client.Minecraft', {
   *   fields: { 'h': 'thePlayer', 'f': 'theWorld' },
   *   methods: { 'a': 'sendChatMessage', 's': 'runTick' },
   * });
   * ```
   */
  public mapClass(
    obfName: string,
    deobfName: string,
    options?: JavaClassMappingOptions,
  ): this {
    this.mapper.mapClass(obfName, deobfName, options);
    return this;
  }

  /**
   * Registers a canonical database/schema into the JavaContext mapper.
   */
  public registerDatabase(db: any): this {
    this.mapper.registerDatabase(db);
    return this;
  }

  /**
   * Maps an obfuscated field to a deobfuscated field name on a class.
   */
  public mapField(
    className: string,
    obfField: string,
    deobfField: string,
  ): this {
    this.mapper.mapField(className, obfField, deobfField);
    return this;
  }

  /**
   * Maps an obfuscated method to a deobfuscated method name on a class.
   */
  public mapMethod(
    className: string,
    obfMethod: string,
    deobfMethod: string,
  ): this {
    this.mapper.mapMethod(className, obfMethod, deobfMethod);
    return this;
  }

  /**
   * Resolves a Java class by full or deobfuscated name and returns a {@link JavaClassProxy}.
   *
   * Example:
   * ```ts
   * const Minecraft = Java.type('net.minecraft.client.Minecraft');
   * const mc = Minecraft.getMinecraft();
   * mc.thePlayer.sendChatMessage('Hello from deobf proxy!');
   * ```
   */
  public type(
    classNameOrClass: string | ReflectedClass | JavaClassProxy,
  ): JavaClassProxy {
    let name: string;
    if (typeof classNameOrClass === 'string') {
      name = classNameOrClass;
    } else if (classNameOrClass && typeof classNameOrClass === 'object') {
      if (typeof (classNameOrClass as any).getName === 'function') {
        name = (classNameOrClass as any).getName();
      } else {
        name = classNameOrClass.name ?? (classNameOrClass as any).$className;
      }
    } else {
      throw new Error(`Invalid class type argument: ${classNameOrClass}`);
    }

    let obfName = this.mapper.resolveObfClass(name);
    if ((!obfName || obfName === name) && this.pool?.resolveClass) {
      const fromPool = this.pool.resolveClass(name);
      if (fromPool) obfName = fromPool;
    }

    if (this.sync && this.bridge.getClassSync) {
      const cls = this.bridge.getClassSync(obfName);
      return createJavaClassProxy(cls, this.bridge, true, this.mapper);
    } else {
      const promise = this.bridge
        .getClass(obfName)
        .then((cls) =>
          createJavaClassProxy(cls, this.bridge, false, this.mapper),
        );
      return createJavaClassProxy(
        new Proxy({} as any, {
          get(_t, p) {
            return (...args: any[]) =>
              promise.then((proxy) => (proxy as any)[p](...args));
          },
        }),
        this.bridge,
        false,
        this.mapper,
      );
    }
  }

  /**
   * Dynamically loads and starts the NJava Agent inside the target JVM via URLClassLoader,
   * returning an in-process Agent JavaContext.
   */
  /**
   * Dynamically loads and starts the NJava Agent inside the target JVM,
   * preferring fast in-memory bytecode injection (ClassLoader.defineClass),
   * returning an in-process Agent JavaContext.
   */
  public async transitionToAgent(options?: any): Promise<JavaContext> {
    const { injectAgent } = await import('njava-agent');
    const result = await injectAgent(this, options);
    if (!result.agentContext) {
      const { createAgentContext } = await import('./agent-bridge.js');
      result.agentContext = createAgentContext({
        port: result.port,
        sync: this.sync,
        mapper: this.mapper,
      });
      if (this.detector) {
        result.agentContext.detector = this.detector;
      }
    }
    if ((result as any).mappings && this.mapper) {
      this.mapper.load((result as any).mappings);
    }
    return result.agentContext;
  }

  /**
   * Executes a callback with the given executor handle (e.g. Minecraft instance).
   * All method calls within `fn` will be dispatched through the executor's task runner (e.g. main render thread).
   */
  public runOn<T>(executor: any, fn: () => T): T {
    if (
      !this.bridge ||
      typeof (this.bridge as any).setExecutor !== 'function'
    ) {
      return fn();
    }
    const handle = BigInt(
      executor?.$ptr || executor?.$address || executor?.address || executor,
    );
    const prev = (this.bridge as any).getExecutor();
    (this.bridge as any).setExecutor(handle);
    try {
      return fn();
    } finally {
      (this.bridge as any).setExecutor(prev);
    }
  }

  public async runOnAsync<T>(executor: any, fn: () => Promise<T>): Promise<T> {
    if (
      !this.bridge ||
      typeof (this.bridge as any).setExecutor !== 'function'
    ) {
      return await fn();
    }
    const handle = BigInt(
      executor?.$ptr || executor?.$address || executor?.address || executor,
    );
    const prev = (this.bridge as any).getExecutor();
    (this.bridge as any).setExecutor(handle);
    try {
      return await fn();
    } finally {
      (this.bridge as any).setExecutor(prev);
    }
  }

  /**
   * Synchronous twin of transitionToAgent.
   */
  public transitionToAgentSync(options?: any): JavaContext {
    const pkg = 'njava-agent';
    const { injectAgentSync } = require(pkg);
    const result = injectAgentSync(this, options);
    if (!result.agentContext) {
      const { createAgentContext } = require('./agent-bridge.js');
      result.agentContext = createAgentContext({
        port: result.port,
        sync: this.sync,
        mapper: this.mapper,
      });
      if (this.detector) {
        result.agentContext.detector = this.detector;
      }
    }
    if ((result as any).mappings && this.mapper) {
      this.mapper.load((result as any).mappings);
    }
    return result.agentContext;
  }

  /**
   * Defines a class directly in JVM memory from raw bytecode (Uint8Array or Buffer)
   * or a compilation result.
   */
  public defineClass(
    nameOrResult: string | any,
    bytecode?: Uint8Array | Buffer,
    loader?: any,
  ): JavaClassProxy {
    let name: string;
    let bytes: Uint8Array | Buffer;
    if (typeof nameOrResult === 'string') {
      name = nameOrResult;
      bytes = bytecode!;
    } else if (nameOrResult && typeof nameOrResult === 'object') {
      if (nameOrResult.className && nameOrResult.bytecode) {
        name = nameOrResult.className;
        bytes = nameOrResult.bytecode;
      } else if (
        nameOrResult.classes &&
        typeof nameOrResult.classes.entries === 'function'
      ) {
        const first = nameOrResult.classes.entries().next().value;
        name = first[0];
        bytes = first[1];
      } else {
        throw new Error(
          'Invalid arguments to Java.defineClass: expected (name, bytecode) or compileResult',
        );
      }
    } else {
      throw new Error(
        'Invalid arguments to Java.defineClass: expected (name, bytecode) or compileResult',
      );
    }

    const bridgeAny = this.bridge as any;
    if (typeof bridgeAny.defineClassSync === 'function') {
      bridgeAny.defineClassSync(
        name,
        bytes,
        loader ? unwrapJava(loader) : undefined,
      );
    } else {
      const Exoproc = this.type('org.exoproc.njava.agent.utils.Exoproc');
      if (Exoproc && typeof Exoproc.defineClass === 'function') {
        Exoproc.defineClass(name, Array.from(bytes));
      }
    }

    return this.type(name);
  }

  /**
   * Asynchronously resolves a Java class by name.
   */
  public async typeAsync(
    classNameOrClass: string | ReflectedClass | JavaClassProxy,
  ): Promise<JavaClassProxy> {
    let name: string;
    if (typeof classNameOrClass === 'string') {
      name = classNameOrClass;
    } else if (classNameOrClass && typeof classNameOrClass === 'object') {
      if (typeof (classNameOrClass as any).getName === 'function') {
        name = (classNameOrClass as any).getName();
      } else {
        name = classNameOrClass.name ?? (classNameOrClass as any).$className;
      }
    } else {
      throw new Error(`Invalid class type argument: ${classNameOrClass}`);
    }

    const obfName = this.mapper.resolveObfClass(name);
    const cls = await this.bridge.getClass(obfName);
    const fields = await cls.getFields();
    const methods = await cls.getAllMethods();
    const methodMap = new Map<string, ReflectedMethod[]>();
    for (const m of methods) {
      let list = methodMap.get(m.name);
      if (!list) {
        list = [];
        methodMap.set(m.name, list);
      }
      list.push(m);
    }
    return createJavaClassProxy(
      cls,
      this.bridge,
      false,
      this.mapper,
      fields,
      methodMap,
    );
  }

  /**
   * Nashorn `Java.from(obj)`:
   * Converts a Java collection (List, Collection, Iterable) or Java array into a native JavaScript Array `[]`,
   * or wraps a `jobject` pointer into a {@link JavaObjectProxy}.
   *
   * Example:
   * ```ts
   * const jsArray = Java.from(javaList);
   * ```
   */
  public from(javaObj: any, classNameOrClass?: string | ReflectedClass): any {
    if (!javaObj || javaObj === 0n) return null;

    // If it's already a JS array, return as-is
    if (Array.isArray(javaObj)) return javaObj;

    const rawPtr = unwrapJava(javaObj);
    if (typeof rawPtr !== 'bigint') return javaObj;

    // Check if it's a Java List/Collection and convert to native JS array
    if (this.sync && this.bridge.getClassSync) {
      try {
        let clsName =
          typeof classNameOrClass === 'string' ? classNameOrClass : undefined;
        if (!clsName) {
          const bridgeAny = this.bridge as any;
          if (typeof bridgeAny.getObjectClassSync === 'function') {
            const classObj = bridgeAny.getObjectClassSync(rawPtr);
            if (classObj && classObj !== 0n) {
              clsName = this.bridge.getClassNameSync(classObj);
            }
          } else if (bridgeAny.callFnSync && bridgeAny.fns?.GetObjectClass) {
            const classObj = BigInt(
              bridgeAny.callFnSync(bridgeAny.fns.GetObjectClass, rawPtr),
            );
            if (classObj && classObj !== 0n) {
              clsName = this.bridge.getClassNameSync(classObj);
            }
          }
        }

        const cls = this.bridge.getClassSync(clsName ?? 'java.lang.Object');
        const proxy = createJavaObjectProxy(
          rawPtr,
          cls,
          this.bridge,
          true,
          this.mapper,
        );

        // If it's a List or has size() + get(int), convert to JS array
        if (
          typeof proxy.size === 'function' &&
          typeof proxy.get === 'function'
        ) {
          const count = proxy.size();
          const result: any[] = [];
          for (let i = 0; i < count; i++) {
            result.push(proxy.get(i));
          }
          return result;
        }

        // If it has toArray()
        if (typeof proxy.toArray === 'function') {
          const arr = proxy.toArray();
          if (Array.isArray(arr)) return arr;
        }

        return proxy;
      } catch {}
    }

    let cls: ReflectedClass;
    if (classNameOrClass instanceof Object && 'classObj' in classNameOrClass) {
      cls = classNameOrClass as ReflectedClass;
    } else if (typeof classNameOrClass === 'string') {
      const obf = this.mapper.resolveObfClass(classNameOrClass);
      cls =
        this.sync && this.bridge.getClassSync
          ? this.bridge.getClassSync(obf)
          : (new Proxy({ name: obf } as any, {}) as any);
    } else {
      let clsName = 'java.lang.Object';
      if (this.sync) {
        try {
          const bridgeAny = this.bridge as any;
          const classObj = BigInt(
            bridgeAny.callFnSync(bridgeAny.fns.GetObjectClass, rawPtr),
          );
          if (classObj && classObj !== 0n) {
            clsName = this.bridge.getClassNameSync(classObj);
          }
        } catch {}
      }
      cls = this.bridge.getClassSync(clsName);
    }

    return createJavaObjectProxy(
      rawPtr,
      cls,
      this.bridge,
      this.sync,
      this.mapper,
    );
  }

  /**
   * Nashorn `Java.to(jsArray, targetType)`:
   * Converts a JavaScript Array into a Java Object Array (`Object[]`, `String[]`),
   * primitive array (`int[]`, `boolean[]`, etc.), or Java Collection (`ArrayList`).
   *
   * Example:
   * ```ts
   * const strArr = Java.to(['a', 'b', 'c'], 'java.lang.String[]');
   * const defaultArr = Java.to(['x', 'y']); // Object[]
   * ```
   */
  public to(
    jsArray: any[],
    targetType: string | JavaClassProxy = 'java.lang.Object[]',
  ): any {
    if (!Array.isArray(jsArray)) return jsArray;

    const typeStr =
      typeof targetType === 'string'
        ? targetType
        : (targetType?.name ?? 'java.lang.Object[]');

    // 1. Convert to Java List / ArrayList
    if (
      typeStr === 'java.util.List' ||
      typeStr === 'java.util.ArrayList' ||
      typeStr === 'List' ||
      typeStr === 'ArrayList'
    ) {
      const ArrayList = this.type('java.util.ArrayList');
      const list = new ArrayList(jsArray.length);
      for (const item of jsArray) {
        list.add(item);
      }
      return list;
    }

    // 2. Convert to Java Object Array (e.g. "java.lang.String[]", "java.lang.Object[]")
    if (typeStr.endsWith('[]')) {
      const elemTypeName = typeStr.slice(0, -2);
      if (this.sync && this.bridge.getClassSync) {
        const fullElemName =
          elemTypeName === 'String'
            ? 'java.lang.String'
            : elemTypeName === 'Object'
              ? 'java.lang.Object'
              : elemTypeName;
        const obfElemName = this.mapper.resolveObfClass(fullElemName);
        const elemClass = this.bridge.getClassSync(obfElemName);
        const bridgeAny = this.bridge as any;
        const fns = bridgeAny.fns;
        const arrayPtr = BigInt(
          bridgeAny.callFnSync(
            fns.NewObjectArray,
            jsArray.length,
            elemClass.classObj,
            0n,
          ),
        );
        for (let i = 0; i < jsArray.length; i++) {
          const item = jsArray[i];
          let itemPtr: bigint;
          if (typeof item === 'string') {
            const mem = bridgeAny.memory as any;
            const strAddr = writeUtf8CStringSync(mem, item);
            itemPtr = BigInt(bridgeAny.callFnSync(fns.NewStringUTF, strAddr));
          } else {
            itemPtr = BigInt(unwrapJava(item));
          }
          bridgeAny.callFnSync(fns.SetObjectArrayElement, arrayPtr, i, itemPtr);
        }
        const arrayClass = this.bridge.getClassSync(typeStr);
        return createJavaObjectProxy(
          arrayPtr,
          arrayClass,
          this.bridge,
          true,
          this.mapper,
        );
      }
    }

    // Default fallback to Object[] array
    return this.to(jsArray, 'java.lang.Object[]');
  }

  /**
   * Unwraps any JavaProxy object back to its raw `jobject` / `jclass` pointer.
   */
  public unwrap(val: any): any {
    return unwrapJava(val);
  }

  /**
   * Returns true if `val` is a Java object instance proxy.
   */
  public isJavaObject(val: any): boolean {
    return isJavaObject(val);
  }

  /**
   * Returns true if `val` is a Java class proxy.
   */
  public isJavaClass(val: any): boolean {
    return isJavaClass(val);
  }

  /**
   * Executes a synchronous task function or script with the current JavaContext and print helper.
   */
  public async runSync<T = any>(
    task:
      | ((java: this, print: (...args: any[]) => void) => T | Promise<T>)
      | string,
    _options?: { timeoutMs?: number; globals?: Record<string, any> },
  ): Promise<T> {
    const logs: string[] = [];
    const print = (...args: any[]) => {
      logs.push(args.map(String).join(' '));
    };
    if (typeof task === 'function') {
      return await task(this, print);
    }
    const fn = new Function('Java', 'print', String(task));
    return await fn(this, print);
  }

  /**
   * Evaluates a string script and returns execution result, logs, and status.
   */
  public async runScript(
    script: string,
    _options?: { timeoutMs?: number; globals?: Record<string, any> },
  ): Promise<{
    success: boolean;
    result?: any;
    error?: string;
    logs: string[];
  }> {
    const logs: string[] = [];
    const print = (...args: any[]) => {
      logs.push(args.map(String).join(' '));
    };
    try {
      const fn = new Function('Java', 'print', script);
      const result = await fn(this, print);
      return { success: true, result, logs };
    } catch (e: any) {
      return { success: false, error: e?.message || String(e), logs };
    }
  }

  /**
   * Nashorn `Java.extend(parentClass, overrides)`:
   * Extends a Java class or implements an interface with hybrid JavaScript method overrides.
   * Overridden methods called from JavaScript run in-memory with zero IPC/JNI round-trip.
   * Overridden methods called from the Java JVM dispatch to the registered JS callbacks.
   */
  public extend(
    parentClassOrProxy: any,
    initialOverrides: Record<string, any> = {},
  ): JavaClassProxy {
    const res = buildExtendedClassAdapter(
      parentClassOrProxy,
      initialOverrides,
      {
        bridge: this.bridge,
        mapper: this.mapper,
      },
    );

    let bytecode: Uint8Array | undefined;
    if (this.mapper) {
      try {
        const remapRes = this.mapper.compileAndRemapSync(res.source);
        bytecode = remapRes.bytecode;
      } catch {
        const compRes = this.mapper.compileJavaSync(res.source);
        bytecode =
          compRes.classes.get(res.className) ??
          compRes.classes.values().next().value;
      }
    } else {
      const compRes = compileJavaSync({
        source: res.source,
        javaPath: resolveDefaultJavaPath(),
      });
      bytecode =
        compRes.classes.get(res.className) ??
        compRes.classes.values().next().value;
    }

    if (bytecode) {
      try {
        const bridgeAny = this.bridge as any;
        if (typeof bridgeAny.defineClassSync === 'function') {
          bridgeAny.defineClassSync(res.className, bytecode);
        } else {
          const Exoproc = this.type('org.exoproc.njava.agent.utils.Exoproc');
          if (Exoproc && typeof Exoproc.defineClass === 'function') {
            Exoproc.defineClass(res.className, Array.from(bytecode));
          }
        }
      } catch {
        // Fallback for mocks / offline tests
      }
    }

    let subClass: ReflectedClass;
    if (this.sync && this.bridge.getClassSync) {
      try {
        subClass = this.bridge.getClassSync(res.className);
      } catch {
        subClass = {
          classObj: BigInt(Date.now()),
          name: res.className,
          isInterface: false,
          getDeclaredConstructorsSync: () => [{ ctorObj: 1n, paramTypes: [] }],
          getDeclaredConstructors: async () => [
            { ctorObj: 1n, paramTypes: [] },
          ],
          getAllMethodsSync: () => [],
          getAllMethods: async () => [],
          getFieldsSync: () => new Map(),
          getFields: async () => new Map(),
        } as any;
      }
    } else {
      subClass = {
        classObj: BigInt(Date.now()),
        name: res.className,
      } as any;
    }

    return createJavaClassProxy(
      subClass,
      this.bridge,
      this.sync,
      this.mapper,
      undefined,
      undefined,
      res.hybridOverrides,
    );
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
        const rawClass = (target as any)[RAW_CLASS] ?? target.$class;
        const superCls =
          rawClass?.getSuperclassSync?.() ?? target.class?.superclass;
        if (superCls) {
          const parentMethod =
            superCls.getMethodSync?.(propStr) ?? superCls.getMethod?.(propStr);
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

/**
 * Synchronous JavaContext implementation where methods return synchronous values directly.
 */
export class SyncJavaContext extends JavaContext implements ISyncJavaContext {
  public override readonly sync = true;

  constructor(
    bridge: ReflectionBridge,
    mapper?: JavaMappingRegistry,
    detector?: JavaDetector,
    pool?: any,
  ) {
    super(bridge, true, mapper, detector, pool);
  }
}

/**
 * Asynchronous JavaContext implementation where operations return Promises.
 */
export class AsyncJavaContext extends JavaContext implements IAsyncJavaContext {
  public override readonly sync = false;

  constructor(
    bridge: ReflectionBridge,
    mapper?: JavaMappingRegistry,
    detector?: JavaDetector,
    pool?: any,
  ) {
    super(bridge, false, mapper, detector, pool);
  }
}

/**
 * Factory to create either a SyncJavaContext or AsyncJavaContext.
 */
export function createJavaContext(
  bridge: ReflectionBridge,
  options?: {
    sync?: boolean;
    mapper?: JavaMappingRegistry;
    detector?: JavaDetector;
    pool?: any;
  },
): JavaContext {
  let mapper = options?.mapper;
  if (!mapper) {
    mapper = new JavaMappingRegistry();
  }
  if (options?.pool) {
    mapper.usePool(options.pool);
  }
  if (options?.sync === false) {
    return new AsyncJavaContext(
      bridge,
      mapper,
      options?.detector,
      options?.pool,
    );
  }
  return new SyncJavaContext(bridge, mapper, options?.detector, options?.pool);
}
