import {
  runOn,
  runOnSync,
  getActiveAccessor,
  getActiveContext,
  type IMemoryAccessor,
  type ISyncMemoryAccessor,
} from 'bun-xffi';
import {
  createScope,
  type RunnerScope,
  type RunnerScopeOptions,
} from './scope.js';

export interface ExecuteOptions extends RunnerScopeOptions {
  timeoutMs?: number;
}

/**
 * ExoprocRunner encapsulates an accessor and provides convenient execution methods
 * where all Win32 CFunction calls naturally target the remote process.
 */
export class ExoprocRunner {
  constructor(public readonly accessor: IMemoryAccessor) {}

  /**
   * Retrieves the Java context if attached to this runner's accessor.
   */
  public get java(): any {
    if (typeof (this.accessor as any).getJavaSync === 'function') {
      return (this.accessor as any).getJavaSync();
    }
    return (this.accessor as any).java;
  }

  /**
   * Runs an asynchronous callback with this runner's accessor bound as the ambient context.
   * Any Win32 CFunction invoked inside `fn` will automatically route through this accessor.
   */
  public run<T>(
    fn: (scope: RunnerScope) => Promise<T> | T,
    options: RunnerScopeOptions = {},
  ): Promise<T> {
    const scope = createScope(this.accessor, options);
    return runOn(this.accessor, () => fn(scope), options);
  }

  /**
   * Runs a synchronous callback with this runner's accessor bound as the ambient context.
   * Any Win32 CFunction invoked inside `fn` will automatically route through this accessor.
   */
  public runSync<T>(
    fn: (scope: RunnerScope) => T,
    options: RunnerScopeOptions = {},
  ): T {
    const scope = createScope(this.accessor, options);
    return runOnSync(
      this.accessor as ISyncMemoryAccessor,
      () => fn(scope),
      options,
    );
  }

  /**
   * Executes a string code snippet or function within the ambient context.
   * Scope variables (Kernel32, Ntdll, User32, memory, accessor) are directly accessible.
   */
  public async execute<T = unknown>(
    codeOrFn: string | ((scope: RunnerScope) => Promise<T> | T),
    options: ExecuteOptions = {},
  ): Promise<T> {
    const { execute } = await import('bun-xffi');
    return execute(this.accessor, codeOrFn, options);
  }
}

/**
 * Creates an ExoprocRunner instance for the given memory accessor.
 */
export function createRunner(accessor: IMemoryAccessor): ExoprocRunner {
  return new ExoprocRunner(accessor);
}

/**
 * Convenience helper to create an accessor for a target PID and execute
 * a callback within its ambient runner context.
 */
export async function withProcess<T>(
  pid: number,
  fn: (runner: ExoprocRunner, scope: RunnerScope) => Promise<T> | T,
): Promise<T> {
  const { createAccessor } = await import('exoproc-accessors');
  const accessor = await createAccessor(pid);
  const runner = new ExoprocRunner(accessor);
  const scope = createScope(accessor);
  return runner.run(() => fn(runner, scope));
}

export { runOn, runOnSync, getActiveAccessor, getActiveContext };
