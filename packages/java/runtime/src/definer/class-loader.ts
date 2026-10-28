/**
 * @exoproc/njava-runtime - ClassLoader JS Architecture
 * Models Java ClassLoader as a first-class JavaScript object, supporting
 * standard reflection, isolated URLClassLoader, Unsafe, and Agent loading modes.
 */

import type { IRuntimeExecutionContext } from '../types.js';
import type {
  ClassDefineOptions,
  ClassDefineContext,
  IClassDefinerStrategy,
  ClassDefinerStrategyName,
} from './types.js';
import { prepareBytecode } from './bytecode.js';

export interface ClassLoaderOptions {
  runtime?: IRuntimeExecutionContext;
  targetLoader?: any;
  parent?: any;
  isolated?: boolean;
  name?: string;
}

/**
 * Standard Java ClassLoader JS object.
 * Uses ClassLoader.defineClass(name, byte[], off, len) on the target process.
 */
export class ClassLoader implements IClassDefinerStrategy {
  public readonly name: ClassDefinerStrategyName = 'classLoader';
  public runtime?: IRuntimeExecutionContext;
  protected _targetLoader?: any;
  protected _parent?: any;
  protected _isolated: boolean = false;

  constructor(
    runtimeOrOptions?: IRuntimeExecutionContext | ClassLoaderOptions | any,
    targetLoaderOrOptions?: any,
  ) {
    if (
      runtimeOrOptions &&
      typeof (runtimeOrOptions as any).getClass === 'function'
    ) {
      this.runtime = runtimeOrOptions as IRuntimeExecutionContext;
      if (targetLoaderOrOptions && typeof targetLoaderOrOptions === 'object') {
        if (
          targetLoaderOrOptions.targetLoader ||
          targetLoaderOrOptions.parent ||
          targetLoaderOrOptions.isolated !== undefined
        ) {
          this._targetLoader = targetLoaderOrOptions.targetLoader;
          this._parent = targetLoaderOrOptions.parent;
          this._isolated = Boolean(targetLoaderOrOptions.isolated);
        } else {
          this._targetLoader = targetLoaderOrOptions;
        }
      }
    } else if (runtimeOrOptions && typeof runtimeOrOptions === 'object') {
      const opts = runtimeOrOptions as ClassLoaderOptions;
      this.runtime = opts.runtime;
      this._targetLoader = opts.targetLoader;
      this._parent = opts.parent;
      this._isolated = Boolean(opts.isolated);
    }
  }

  public isAvailable(runtime: IRuntimeExecutionContext): boolean {
    return Boolean(runtime.bridge);
  }

  /**
   * Resolves or initializes the live JVM ClassLoader proxy.
   */
  public getTargetLoader(): any {
    if (this._targetLoader) return this._targetLoader;

    // If isolated mode requested, instantiate a fresh java.net.URLClassLoader on target JVM
    if (this._isolated && this.runtime) {
      try {
        const URLClassLoader = this.runtime.type('java.net.URLClassLoader');
        const URLClass = this.runtime.type('java.net.URL');
        const ArrayClass = this.runtime.type('java.lang.reflect.Array');
        const emptyURLs = ArrayClass.newInstance(URLClass.class, 0);
        const parent = this._parent ?? this.resolveSystemOrContextLoader();
        this._targetLoader = new URLClassLoader(emptyURLs, parent ?? null);
        return this._targetLoader;
      } catch {
        // Fallback to standard loader on error
      }
    }

    if (this._parent) {
      this._targetLoader = this._parent;
      return this._targetLoader;
    }

    this._targetLoader = this.resolveSystemOrContextLoader();
    return this._targetLoader;
  }

  protected resolveSystemOrContextLoader(): any {
    if (!this.runtime) return undefined;
    try {
      const Thread = this.runtime.type('java.lang.Thread');
      return Thread.currentThread().getContextClassLoader();
    } catch {
      try {
        const ClassLoaderClass = this.runtime.type('java.lang.ClassLoader');
        return ClassLoaderClass.getSystemClassLoader();
      } catch {
        return undefined;
      }
    }
  }

  /**
   * Defines a Java class into this ClassLoader.
   * Accepts:
   * - Java source code string (`public class Foo { ... }`)
   * - JavaClassBuilder AST
   * - GeneratedAdapterResult (`Java.code`)
   * - Compiled bytecode (`Uint8Array` or `number[]`)
   */
  public defineClass(target: any, options: ClassDefineOptions = {}): any {
    const { className, bytecode } = prepareBytecode(target, options);
    const effectiveRuntime = this.runtime ?? (options as any).runtime;
    if (!effectiveRuntime) {
      throw new Error(
        `[ClassLoader] Cannot defineClass: no runtime execution context bound.`,
      );
    }

    const ctx: ClassDefineContext = {
      runtime: effectiveRuntime,
      className,
      bytecode,
      classLoader: options.classLoader ?? this.getTargetLoader(),
      protectionDomain: options.protectionDomain,
      options,
    };

    return this.define(ctx);
  }

  /**
   * Core definition mechanism: executes reflection on ClassLoader.defineClass.
   */
  public define(ctx: ClassDefineContext): any {
    const { runtime, className, bytecode } = ctx;
    let loader = ctx.classLoader ?? this.getTargetLoader();
    if (!loader) {
      loader = this.resolveSystemOrContextLoader();
    }
    if (!loader) {
      throw new Error(
        `[ClassLoader] Unable to locate target ClassLoader for ${className}`,
      );
    }

    const bytesArg = Array.from(
      bytecode instanceof Uint8Array ? bytecode : new Uint8Array(bytecode),
    );

    // 1. Direct defineClass method on loader proxy
    if (typeof loader.defineClass === 'function') {
      loader.defineClass(className, bytesArg, 0, bytesArg.length);
      return runtime.type(className);
    }

    // 2. Fallback: reflectively obtain Method from java.lang.ClassLoader
    const ClassClass = runtime.type('java.lang.Class');
    const clClass = ClassClass.forName('java.lang.ClassLoader');
    const methods = clClass.getDeclaredMethods();
    const defineMethod = methods.find(
      (m: any) =>
        m.getName() === 'defineClass' &&
        (m.getParameterTypes?.()?.length === 4 || m.paramTypes?.length === 4),
    );

    if (defineMethod) {
      defineMethod.setAccessible(true);
      defineMethod.invoke(loader, className, bytesArg, 0, bytesArg.length);
      return runtime.type(className);
    }

    throw new Error(
      `[ClassLoader] defineClass method not accessible on ClassLoader for ${className}`,
    );
  }

  /**
   * Loads an existing class by name through this ClassLoader.
   */
  public loadClass(name: string): any {
    if (!this.runtime) {
      throw new Error(`[ClassLoader] No runtime attached to loadClass.`);
    }
    const loader = this.getTargetLoader();
    if (loader && typeof loader.loadClass === 'function') {
      try {
        return loader.loadClass(name);
      } catch {}
    }
    return this.runtime.type(name);
  }

  // =========================================================================
  // Static ClassLoader Factories
  // =========================================================================

  public static getSystemClassLoader(
    runtime: IRuntimeExecutionContext,
  ): ClassLoader {
    let sysLoader: any = null;
    try {
      const ClassLoaderClass = runtime.type('java.lang.ClassLoader');
      sysLoader = ClassLoaderClass.getSystemClassLoader();
    } catch {}
    return new ClassLoader(runtime, sysLoader);
  }

  public static getContextClassLoader(
    runtime: IRuntimeExecutionContext,
  ): ClassLoader {
    let ctxLoader: any = null;
    try {
      const ThreadClass = runtime.type('java.lang.Thread');
      ctxLoader = ThreadClass.currentThread().getContextClassLoader();
    } catch {}
    return new ClassLoader(runtime, ctxLoader);
  }

  public static createIsolated(
    runtime: IRuntimeExecutionContext,
    parent?: any,
  ): ClassLoader {
    return new ClassLoader(runtime, { isolated: true, parent });
  }

  public static unsafe(
    runtime?: IRuntimeExecutionContext,
    options?: any,
  ): UnsafeClassLoader {
    return new UnsafeClassLoader(runtime, options);
  }

  public static agent(
    runtime?: IRuntimeExecutionContext,
    options?: any,
  ): AgentClassLoader {
    return new AgentClassLoader(runtime, options);
  }

  public static auto(
    runtime?: IRuntimeExecutionContext,
    options?: any,
  ): AutoClassLoader {
    return new AutoClassLoader(runtime, options);
  }

  public static from(
    targetLoader: any,
    runtime?: IRuntimeExecutionContext,
  ): ClassLoader {
    if (targetLoader instanceof ClassLoader) return targetLoader;
    return new ClassLoader(runtime, targetLoader);
  }
}

/**
 * Unsafe ClassLoader: Uses sun.misc.Unsafe.defineClass directly.
 */
export class UnsafeClassLoader extends ClassLoader {
  public override readonly name: ClassDefinerStrategyName = 'unsafe';

  public override isAvailable(runtime: IRuntimeExecutionContext): boolean {
    return Boolean(runtime.bridge);
  }

  public override define(ctx: ClassDefineContext): any {
    const { runtime, className, bytecode, protectionDomain } = ctx;
    const loader = ctx.classLoader ?? this.getTargetLoader();
    const bytesArg = Array.from(
      bytecode instanceof Uint8Array ? bytecode : new Uint8Array(bytecode),
    );

    try {
      let unsafeInstance: any = null;

      // 1. Direct static field access on sun.misc.Unsafe proxy
      try {
        const UnsafeClass = runtime.type('sun.misc.Unsafe');
        if (UnsafeClass && UnsafeClass.theUnsafe) {
          unsafeInstance = UnsafeClass.theUnsafe;
        }
      } catch {}

      // 2. Reflection: Class.forName("sun.misc.Unsafe").getDeclaredField("theUnsafe")
      if (!unsafeInstance) {
        try {
          const ClassClass = runtime.type('java.lang.Class');
          const unsafeReflected = ClassClass.forName('sun.misc.Unsafe');
          const theUnsafeField =
            typeof unsafeReflected?.getDeclaredField === 'function'
              ? unsafeReflected.getDeclaredField('theUnsafe')
              : null;
          if (theUnsafeField) {
            if (typeof theUnsafeField.setAccessible === 'function') {
              theUnsafeField.setAccessible(true);
            }
            unsafeInstance =
              typeof theUnsafeField.get === 'function'
                ? theUnsafeField.get(null)
                : theUnsafeField;
          }
        } catch {}
      }

      if (!unsafeInstance) {
        throw new Error('Could not acquire sun.misc.Unsafe instance');
      }

      unsafeInstance.defineClass(
        className,
        bytesArg,
        0,
        bytesArg.length,
        loader ?? null,
        protectionDomain ?? null,
      );

      return runtime.type(className);
    } catch (err: any) {
      throw new Error(
        `[UnsafeClassLoader] Failed to define ${className} via Unsafe: ${err?.message || err}`,
      );
    }
  }
}

/**
 * Agent ClassLoader: Uses org.exoproc.njava.agent.utils.Exoproc.defineClass helper.
 */
export class AgentClassLoader extends ClassLoader {
  public override readonly name: ClassDefinerStrategyName = 'agent';

  public override isAvailable(runtime: IRuntimeExecutionContext): boolean {
    if (!runtime.bridge) return false;
    try {
      const exoprocClass = runtime.getClass(
        'org.exoproc.njava.agent.utils.Exoproc',
      );
      return Boolean(exoprocClass && exoprocClass.classObj);
    } catch {
      return false;
    }
  }

  public override define(ctx: ClassDefineContext): any {
    const { runtime, className, bytecode } = ctx;
    const loader = ctx.classLoader ?? this.getTargetLoader();
    const bytesArg = Array.from(
      bytecode instanceof Uint8Array ? bytecode : new Uint8Array(bytecode),
    );

    try {
      const Exoproc = runtime.type('org.exoproc.njava.agent.utils.Exoproc');
      Exoproc.defineClass(className, bytesArg, loader ?? null);
      return runtime.type(className);
    } catch (err: any) {
      throw new Error(
        `[AgentClassLoader] Failed to define ${className} via Exoproc: ${err?.message || err}`,
      );
    }
  }
}

/**
 * Auto ClassLoader: Cascades across standard ClassLoader -> Agent -> Unsafe.
 */
export class AutoClassLoader extends ClassLoader {
  public override readonly name: ClassDefinerStrategyName = 'auto';

  private readonly standardLoader: ClassLoader;
  private readonly agentLoader: AgentClassLoader;
  private readonly unsafeLoader: UnsafeClassLoader;

  constructor(
    runtimeOrOptions?: IRuntimeExecutionContext | ClassLoaderOptions | any,
    targetLoaderOrOptions?: any,
  ) {
    super(runtimeOrOptions, targetLoaderOrOptions);
    this.standardLoader = new ClassLoader(this.runtime, this._targetLoader);
    this.agentLoader = new AgentClassLoader(this.runtime, this._targetLoader);
    this.unsafeLoader = new UnsafeClassLoader(this.runtime, this._targetLoader);
  }

  public override isAvailable(runtime: IRuntimeExecutionContext): boolean {
    return (
      this.standardLoader.isAvailable(runtime) ||
      this.agentLoader.isAvailable(runtime) ||
      this.unsafeLoader.isAvailable(runtime)
    );
  }

  public override define(ctx: ClassDefineContext): any {
    const errors: string[] = [];

    // 1. Try standard ClassLoader.defineClass first ("ilki en açık olan")
    if (this.standardLoader.isAvailable(ctx.runtime)) {
      try {
        return this.standardLoader.define(ctx);
      } catch (err: any) {
        errors.push(`classLoader: ${err?.message || err}`);
      }
    }

    // 2. Try Agent/Exoproc if attached
    if (this.agentLoader.isAvailable(ctx.runtime)) {
      try {
        return this.agentLoader.define(ctx);
      } catch (err: any) {
        errors.push(`agent: ${err?.message || err}`);
      }
    }

    // 3. Fallback to Unsafe
    if (this.unsafeLoader.isAvailable(ctx.runtime)) {
      try {
        return this.unsafeLoader.define(ctx);
      } catch (err: any) {
        errors.push(`unsafe: ${err?.message || err}`);
      }
    }

    throw new Error(
      `[AutoClassLoader] All class definition attempts failed for ${ctx.className}:\n  ${errors.join('\n  ')}`,
    );
  }
}

// Aliases for strategy-based nomenclature
export { ClassLoader as ClassLoaderDefiner };
export { UnsafeClassLoader as UnsafeDefiner };
export { AgentClassLoader as AgentDefiner };
export { AutoClassLoader as AutoDefiner };
