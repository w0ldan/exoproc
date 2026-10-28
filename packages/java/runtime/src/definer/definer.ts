/**
 * @exoproc/njava-runtime - Class Definer Manager & Dispatcher
 */

import type { IRuntimeExecutionContext } from '../types.js';
import type { ClassDefineOptions, IClassDefinerStrategy } from './types.js';
import {
  ClassLoader,
  UnsafeClassLoader,
  AgentClassLoader,
  AutoClassLoader,
} from './class-loader.js';
import { prepareBytecode } from './bytecode.js';

export * from './bytecode.js';

export class ClassDefinerRegistry {
  private readonly strategies = new Map<string, IClassDefinerStrategy>();

  constructor() {
    this.register(new ClassLoader());
    this.register(new AgentClassLoader());
    this.register(new UnsafeClassLoader());
    this.register(new AutoClassLoader());
  }

  public register(strategy: IClassDefinerStrategy): this {
    this.strategies.set(strategy.name, strategy);
    return this;
  }

  public get(name: string): IClassDefinerStrategy | undefined {
    return this.strategies.get(name);
  }

  public has(name: string): boolean {
    return this.strategies.has(name);
  }
}

export const defaultClassDefinerRegistry = new ClassDefinerRegistry();

/**
 * Defines a Java class in the target process.
 * Accepts:
 * - target: bytecode, Java source, JavaClassBuilder, or GeneratedAdapterResult
 * - loaderOrOptions: ClassLoader JS object, live JVM ClassLoader proxy, or ClassDefineOptions
 */
export function defineClass(
  runtime: IRuntimeExecutionContext,
  target: any,
  loaderOrOptions?: ClassLoader | ClassDefineOptions | any,
  optionsOrRegistry?: ClassDefineOptions | ClassDefinerRegistry,
): any {
  let loader: ClassLoader | undefined;
  let options: ClassDefineOptions = {};
  const registry =
    optionsOrRegistry instanceof ClassDefinerRegistry
      ? optionsOrRegistry
      : defaultClassDefinerRegistry;

  if (loaderOrOptions instanceof ClassLoader) {
    loader = loaderOrOptions;
    if (
      optionsOrRegistry &&
      !(optionsOrRegistry instanceof ClassDefinerRegistry)
    ) {
      options = optionsOrRegistry;
    }
  } else if (
    loaderOrOptions &&
    typeof loaderOrOptions.defineClass === 'function' &&
    typeof loaderOrOptions.define === 'function'
  ) {
    loader = loaderOrOptions;
    if (
      optionsOrRegistry &&
      !(optionsOrRegistry instanceof ClassDefinerRegistry)
    ) {
      options = optionsOrRegistry;
    }
  } else if (loaderOrOptions && typeof loaderOrOptions === 'object') {
    options = loaderOrOptions;
    const rawTargetLoader = options.classLoader ?? options.loader;

    if (options.strategy === 'unsafe') {
      loader = new UnsafeClassLoader(runtime, rawTargetLoader);
    } else if (options.strategy === 'agent') {
      loader = new AgentClassLoader(runtime, rawTargetLoader);
    } else if (options.strategy === 'classLoader') {
      loader = new ClassLoader(runtime, rawTargetLoader);
    } else if (rawTargetLoader instanceof ClassLoader) {
      loader = rawTargetLoader;
    } else if (rawTargetLoader) {
      loader = ClassLoader.from(rawTargetLoader, runtime);
    } else if (options.strategy) {
      const strat = registry.get(options.strategy);
      if (strat instanceof ClassLoader) {
        loader = strat;
      } else if (strat) {
        const { className, bytecode } = prepareBytecode(target, options);
        return strat.define({
          runtime,
          className,
          bytecode,
          classLoader: options.classLoader ?? options.loader,
          protectionDomain: options.protectionDomain,
          options,
        });
      }
    }
  }

  const effectiveLoader =
    loader ?? (runtime as any).classLoader ?? new AutoClassLoader(runtime);

  if (!effectiveLoader.runtime) {
    effectiveLoader.runtime = runtime;
  }

  return effectiveLoader.defineClass(target, options);
}
