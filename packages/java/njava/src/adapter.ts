/**
 * @exoproc/njava - Adapter & Morphed Argument Resolution
 * Resolves Source, JavaCode, and ScriptFunction arguments against target Java types.
 * Performs one-time builder setup and caching on the Source model (mapper'sız saf Java).
 * In Agent mode, registers callbacks and synthesizes adapter bodies invoking Exoproc.dispatchCallback.
 */

import { JavaClassBuilder } from 'exoproc-jjit';
import { getAgentJarSync } from 'njava-agent';

export type CallbackFunction = (...args: any[]) => any;

/**
 * Global registry of active callbacks keyed by unique callback ID.
 */
export const globalCallbackRegistry = new Map<string, CallbackFunction>();

let callbackCounter = 0;

export interface GeneratedAdapterResult {
  className: string;
  targetType: string;
  builder: JavaClassBuilder;
  source: string;
  callbackId?: string;
  __isGeneratedAdapter: true;
}

/**
 * Adapts an argument (such as a Source, JavaCode, or ScriptFunction) to a target Java parameter type.
 * - String: extracts string and caches it.
 * - Functional SAM (Runnable, Callable, etc.):
 *   - For ScriptFunction: registers callback in registry and creates Exoproc.dispatchCallback dispatch code.
 *   - For JavaCode: embeds raw user Java code.
 *   - Sets up a JavaClassBuilder (without mapper) and caches the generated adapter on the argument.
 */
export function adaptBridgeArgument(
  arg: any,
  targetType?: string,
  bridge?: any,
  context?: any,
): any {
  if (!arg || (typeof arg !== 'object' && typeof arg !== 'function')) {
    return arg;
  }

  // Check if it's a Source / JavaCode / ScriptFunction / plain function
  const isFunction =
    typeof arg === 'function' || Boolean(arg.__isScriptFunction);
  const isSource = Boolean(
    arg.__isJavaCode ||
    isFunction ||
    (typeof arg === 'object' &&
      arg.$className?.startsWith('jdk.nashorn.internal.runtime.')),
  );

  if (!isSource) {
    return arg;
  }

  const normalizedTarget = targetType || 'java.lang.Object';

  // 1. If already cast and cached on this Source object, return cached result!
  if (typeof arg.hasCast === 'function' && arg.hasCast(normalizedTarget)) {
    return arg.getCast(normalizedTarget);
  }

  // 2. Target type is String:
  if (
    normalizedTarget === 'java.lang.String' ||
    normalizedTarget === 'String'
  ) {
    const strVal =
      typeof arg.getString === 'function'
        ? arg.getString()
        : String(arg.code || arg);
    if (typeof arg.setCast === 'function') {
      arg.setCast(normalizedTarget, strVal);
    }
    return strVal;
  }

  // 3. For Runnable, Callable, or other SAM interfaces:
  let callbackId: string | undefined;
  let bodyCode = '';

  if (isFunction) {
    const fn = typeof arg === 'function' ? arg : arg.fn;
    // Generate unique callback ID and register the JS function
    callbackId = `cb_${++callbackCounter}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    globalCallbackRegistry.set(callbackId, fn);
    if (bridge && typeof bridge.registerCallback === 'function') {
      bridge.registerCallback(callbackId, fn);
    }
  } else {
    // Pure user Java code
    bodyCode =
      typeof arg.getString === 'function'
        ? arg.getString()
        : String(arg.code || arg);
  }

  // Set up JavaClassBuilder without mapper (mapper'sız saf Java)!
  const className = `GeneratedAdapter_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const builder = new JavaClassBuilder(className).public();

  if (
    normalizedTarget === 'java.lang.Runnable' ||
    normalizedTarget === 'Runnable'
  ) {
    const runnableBody = isFunction
      ? `org.exoproc.njava.agent.utils.Exoproc.dispatchCallback("${callbackId}", "run", new Object[0]);`
      : bodyCode;

    builder
      .implements('Runnable')
      .method('run')
      .annotation('@Override')
      .public()
      .void()
      .body(runnableBody);
  } else if (
    normalizedTarget === 'java.util.concurrent.Callable' ||
    normalizedTarget === 'Callable'
  ) {
    const callableBody = isFunction
      ? `return org.exoproc.njava.agent.utils.Exoproc.dispatchCallback("${callbackId}", "call", new Object[0]);`
      : bodyCode.includes('return ')
        ? bodyCode
        : `return (${bodyCode});`;

    builder
      .implements('java.util.concurrent.Callable')
      .method('call')
      .annotation('@Override')
      .public()
      .returns('Object')
      .throws('Exception')
      .body(callableBody);
  } else {
    // Other interface / SAM
    builder.implements(normalizedTarget);
  }

  const source = builder.toSource();
  const castResult: GeneratedAdapterResult = {
    className,
    targetType: normalizedTarget,
    builder,
    source,
    callbackId,
    __isGeneratedAdapter: true,
  };

  // If a live execution context is available, automatically define the adapter
  // using the agent's ClassLoader and instantiate a live Java object on the remote JVM!
  const effectiveContext =
    context ?? bridge?.runtime ?? (bridge as any)?._runtime;
  if (effectiveContext && typeof effectiveContext.defineClass === 'function') {
    try {
      const AdapterClass = effectiveContext.defineClass(castResult, {
        classPath: getAgentJarSync().jarPath,
      });
      const javaInstance = new AdapterClass();
      if (typeof arg.setCast === 'function') {
        arg.setCast(normalizedTarget, javaInstance);
      }
      return javaInstance;
    } catch {
      // In unit test mocks or offline mode, fall back to castResult
    }
  }

  if (typeof arg.setCast === 'function') {
    arg.setCast(normalizedTarget, castResult);
  }

  return castResult;
}

export interface ExtendedClassBuildResult {
  className: string;
  parentClassName: string;
  isInterface: boolean;
  builder: JavaClassBuilder;
  source: string;
  hybridOverrides: Record<string, Function>;
  callbackIds: Map<string, string>;
}

/**
 * Builds an extended Java class AST and source code, registering hybrid callbacks for JS functions,
 * and generating __super_<method> bridges for calling the parent implementation via invokespecial.
 */
export function buildExtendedClassAdapter(
  parentClassOrProxy: any,
  overrides: Record<string, any> = {},
  options?: {
    className?: string;
    bridge?: any;
    mapper?: any;
  },
): ExtendedClassBuildResult {
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
    } else if (parentClassOrProxy.class) {
      parentClassName =
        typeof parentClassOrProxy.class.getName === 'function'
          ? parentClassOrProxy.class.getName()
          : parentClassOrProxy.class.name;
    } else {
      parentClassName = 'java.lang.Object';
    }
  } else {
    parentClassName = 'java.lang.Object';
  }

  const mapper = options?.mapper;
  const bridge = options?.bridge;
  const deobfParent = mapper
    ? mapper.resolveDeobfClass(parentClassName)
    : parentClassName;
  const obfParent = mapper
    ? mapper.resolveObfClass(parentClassName)
    : parentClassName;

  const simpleName = deobfParent.includes('.')
    ? deobfParent.split('.').pop()!
    : deobfParent;
  const subClassName =
    options?.className ??
    `Extended_${simpleName}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  let parentReflected: any;
  if (bridge?.findClassSync) {
    parentReflected =
      bridge.findClassSync(obfParent) ?? bridge.findClassSync(parentClassName);
  } else if (bridge?.getClassSync) {
    try {
      parentReflected =
        bridge.getClassSync(obfParent) ?? bridge.getClassSync(parentClassName);
    } catch {}
  }

  const isInterface = Boolean(
    parentReflected?.isInterface === true ||
    (typeof parentReflected?.modifiers === 'number' &&
      (parentReflected.modifiers & 0x0200) !== 0) ||
    deobfParent === 'java.lang.Runnable' ||
    deobfParent === 'Runnable' ||
    deobfParent === 'java.util.concurrent.Callable' ||
    deobfParent === 'Callable' ||
    deobfParent.endsWith('Listener') ||
    (parentReflected?.getDeclaredConstructorsSync &&
      parentReflected.getDeclaredConstructorsSync().length === 0),
  );

  const builder = new JavaClassBuilder(subClassName).public();
  if (isInterface) {
    builder.implements(deobfParent);
  } else {
    builder.extends(deobfParent);
  }

  // Constructors
  let hasZeroArgCtor = false;
  if (!isInterface && parentReflected) {
    const parentCtors = parentReflected.getDeclaredConstructorsSync?.() ?? [];
    if (parentCtors.length > 0) {
      for (const ctor of parentCtors) {
        const ctorParams = (ctor.paramTypes ?? []).map(
          (t: string, i: number) => ({ name: `p${i}`, type: t }),
        );
        const ctorArgs = ctorParams.map((p: any) => p.name).join(', ');
        builder.constructorDef(ctorParams, `super(${ctorArgs});`);
        if (ctorParams.length === 0) {
          hasZeroArgCtor = true;
        }
      }
    }
  }
  // Ensure default constructor
  if (isInterface || hasZeroArgCtor || !parentReflected) {
    builder.constructorDef([], isInterface ? '' : 'super();');
  }

  const hybridOverrides: Record<string, Function> = {};
  const callbackIds = new Map<string, string>();
  const parentMethods = parentReflected?.getAllMethodsSync?.() ?? [];

  for (const [methodName, fnOrCode] of Object.entries(overrides)) {
    if (!fnOrCode) continue;

    const match = parentMethods.find(
      (m: any) => m.name === methodName || m.originalName === methodName,
    );
    const returnType =
      match?.type ??
      (methodName === 'toString'
        ? 'String'
        : methodName === 'hashCode'
          ? 'int'
          : methodName === 'equals'
            ? 'boolean'
            : methodName === 'call'
              ? 'java.lang.Object'
              : 'void');
    let paramTypes = match?.paramTypes ?? [];
    if (!match && paramTypes.length === 0 && methodName === 'equals') {
      paramTypes = ['java.lang.Object'];
    }

    if (
      typeof fnOrCode === 'function' ||
      (fnOrCode as any)?.__isScriptFunction
    ) {
      const fn =
        typeof fnOrCode === 'function' ? fnOrCode : (fnOrCode as any).fn;
      hybridOverrides[methodName] = fn;

      const callbackId = `ext_cb_${++callbackCounter}_${methodName}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      callbackIds.set(methodName, callbackId);
      globalCallbackRegistry.set(callbackId, fn);
      if (bridge && typeof bridge.registerCallback === 'function') {
        bridge.registerCallback(callbackId, fn);
      }

      if (!match && paramTypes.length === 0 && fn.length > 0) {
        paramTypes = Array(fn.length).fill('java.lang.Object');
      }

      const paramDefs = paramTypes.map((t: string, i: number) => ({
        name: `p${i}`,
        type: t,
      }));
      const paramNames = paramDefs.map((p: any) => p.name);
      const argsArrayCode =
        paramNames.length > 0
          ? `new Object[]{ ${paramNames.join(', ')} }`
          : `new Object[0]`;

      let dispatchCode = '';
      if (returnType === 'void') {
        dispatchCode = `org.exoproc.njava.agent.utils.Exoproc.dispatchCallback("${callbackId}", "${methodName}", ${argsArrayCode});`;
      } else if (returnType === 'boolean' || returnType === 'Boolean') {
        dispatchCode = `Object __res = org.exoproc.njava.agent.utils.Exoproc.dispatchCallback("${callbackId}", "${methodName}", ${argsArrayCode});\nreturn __res != null ? ((Boolean) __res).booleanValue() : false;`;
      } else if (returnType === 'int' || returnType === 'Integer') {
        dispatchCode = `Object __res = org.exoproc.njava.agent.utils.Exoproc.dispatchCallback("${callbackId}", "${methodName}", ${argsArrayCode});\nreturn __res != null ? ((Number) __res).intValue() : 0;`;
      } else if (returnType === 'long' || returnType === 'Long') {
        dispatchCode = `Object __res = org.exoproc.njava.agent.utils.Exoproc.dispatchCallback("${callbackId}", "${methodName}", ${argsArrayCode});\nreturn __res != null ? ((Number) __res).longValue() : 0L;`;
      } else if (returnType === 'double' || returnType === 'Double') {
        dispatchCode = `Object __res = org.exoproc.njava.agent.utils.Exoproc.dispatchCallback("${callbackId}", "${methodName}", ${argsArrayCode});\nreturn __res != null ? ((Number) __res).doubleValue() : 0.0;`;
      } else if (returnType === 'float' || returnType === 'Float') {
        dispatchCode = `Object __res = org.exoproc.njava.agent.utils.Exoproc.dispatchCallback("${callbackId}", "${methodName}", ${argsArrayCode});\nreturn __res != null ? ((Number) __res).floatValue() : 0.0f;`;
      } else if (returnType === 'String' || returnType === 'java.lang.String') {
        dispatchCode = `Object __res = org.exoproc.njava.agent.utils.Exoproc.dispatchCallback("${callbackId}", "${methodName}", ${argsArrayCode});\nreturn __res != null ? __res.toString() : null;`;
      } else {
        dispatchCode = `Object __res = org.exoproc.njava.agent.utils.Exoproc.dispatchCallback("${callbackId}", "${methodName}", ${argsArrayCode});\nreturn (${returnType}) __res;`;
      }

      builder
        .method(methodName, returnType)
        .annotation('@Override')
        .public()
        .params(paramDefs)
        .body(dispatchCode);

      if (!isInterface) {
        const superCall =
          returnType === 'void'
            ? `super.${methodName}(${paramNames.join(', ')});`
            : `return super.${methodName}(${paramNames.join(', ')});`;

        builder
          .method(`__super_${methodName}`, returnType)
          .public()
          .params(paramDefs)
          .body(superCall);
      }
    } else {
      // User Java source string or JavaCode
      const javaBody =
        typeof fnOrCode === 'string'
          ? fnOrCode
          : typeof (fnOrCode as any).getString === 'function'
            ? (fnOrCode as any).getString()
            : String((fnOrCode as any).code);

      const paramDefs = paramTypes.map((t: string, i: number) => ({
        name: `p${i}`,
        type: t,
      }));
      const paramNames = paramDefs.map((p: any) => p.name);

      builder
        .method(methodName, returnType)
        .annotation('@Override')
        .public()
        .params(paramDefs)
        .body(javaBody);

      if (!isInterface) {
        const superCall =
          returnType === 'void'
            ? `super.${methodName}(${paramNames.join(', ')});`
            : `return super.${methodName}(${paramNames.join(', ')});`;

        builder
          .method(`__super_${methodName}`, returnType)
          .public()
          .params(paramDefs)
          .body(superCall);
      }
    }
  }

  const source = builder.toSource();
  return {
    className: subClassName,
    parentClassName: deobfParent,
    isInterface,
    builder,
    source,
    hybridOverrides,
    callbackIds,
  };
}
