/**
 * @exoproc/njava-runtime - Class Definer Types & Contracts
 */

import type { IRuntimeExecutionContext } from '../types.js';

export type ClassDefinerStrategyName =
  'classLoader' | 'unsafe' | 'agent' | 'auto';

export interface ClassDefineOptions {
  /**
   * Fully qualified binary/canonical class name (e.g. 'org.example.MyClass').
   * Optional if it can be inferred from the source code or builder.
   */
  name?: string;

  /**
   * Specific ClassLoader instance on the target process (proxy or handle).
   * Defaults to Thread.currentThread().getContextClassLoader().
   */
  classLoader?: any;
  loader?: any;

  /**
   * Optional classpath entries for compiling Java source code or adapters in-memory.
   */
  classPath?: string | string[];

  /**
   * ProtectionDomain to associate with the defined class.
   */
  protectionDomain?: any;

  /**
   * Strategy name: 'classLoader' (explicit reflection), 'unsafe', 'agent' (Exoproc helper), or 'auto'.
   * Default is 'auto' (tries classLoader first, then agent, then unsafe).
   */
  strategy?: ClassDefinerStrategyName;
}

export interface ClassDefineContext {
  runtime: IRuntimeExecutionContext;
  className: string;
  bytecode: Uint8Array | number[];
  classLoader?: any;
  protectionDomain?: any;
  options?: ClassDefineOptions;
}

export interface IClassDefinerStrategy {
  readonly name: ClassDefinerStrategyName;
  isAvailable(runtime: IRuntimeExecutionContext): boolean;
  define(ctx: ClassDefineContext): any;
}
