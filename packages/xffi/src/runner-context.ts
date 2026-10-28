import { AsyncLocalStorage } from 'node:async_hooks';
import type { IMemoryAccessor, ISyncMemoryAccessor } from './iaccessor.js';
import type { RunnerScope, RunOnOptions } from './win/symbols.js';

type ScopeFactory = (
  accessor: IMemoryAccessor | ISyncMemoryAccessor,
  options?: RunOnOptions,
) => RunnerScope;

let scopeFactory: ScopeFactory | null = null;

export function registerScopeFactory(factory: ScopeFactory): void {
  scopeFactory = factory;
}

export function resolveScope(
  accessor: IMemoryAccessor | ISyncMemoryAccessor,
  options?: RunOnOptions,
): RunnerScope {
  if (!scopeFactory) {
    throw new Error(
      'Scope factory not registered. Ensure win/symbols.js is loaded.',
    );
  }
  return scopeFactory(accessor, options);
}

export interface AccessorContext {
  readonly accessor: IMemoryAccessor;
  readonly isSync?: boolean;
  readonly inCall?: boolean;
  readonly preferUnicode?: boolean;
}

let accessorStorage: AsyncLocalStorage<AccessorContext> | undefined;
let currentSyncContext: AccessorContext | null = null;

function getStorage(): AsyncLocalStorage<AccessorContext> {
  if (!accessorStorage) {
    accessorStorage = new AsyncLocalStorage<AccessorContext>();
  }
  return accessorStorage;
}

/**
 * Returns the currently active accessor for the ambient execution context,
 * or `undefined` if no ambient accessor scope is active.
 */
export function getActiveAccessor(): IMemoryAccessor | undefined {
  return (accessorStorage?.getStore() ?? currentSyncContext)?.accessor;
}

/**
 * Returns the active AccessorContext if one is currently bound.
 */
export function getActiveContext(): AccessorContext | undefined {
  return accessorStorage?.getStore() ?? currentSyncContext ?? undefined;
}

/**
 * Runs an asynchronous callback or code snippet within the ambient context of the specified accessor.
 * Any Win32 CFunction invoked inside this scope without an explicit leading accessor
 * will automatically route its execution through `accessor.call(...)`.
 *
 * Scope variables and Win32 functions (e.g. `GetModuleHandle`, `MessageBox`, `VirtualAlloc`)
 * are passed as parameters into the callback, with dual A/W functions resolving to Unicode
 * (e.g. `MessageBox` -> `MessageBoxW`) by default.
 */
export async function runOn<T>(
  accessor: IMemoryAccessor,
  fn: ((scope: RunnerScope) => Promise<T> | T) | string,
  options: RunOnOptions = {},
): Promise<T> {
  if (typeof fn === 'string') {
    return execute(accessor, fn, options);
  }

  const preferUnicode = options.preferUnicode ?? options.unicode ?? true;
  const isSync = Boolean(options.sync);
  const ctx: AccessorContext = {
    accessor,
    isSync,
    inCall: false,
    preferUnicode,
  };
  const scope = resolveScope(accessor, options);
  const prevSync = currentSyncContext;
  if (isSync) {
    currentSyncContext = ctx;
  }

  if (options.timeoutMs && options.timeoutMs > 0) {
    let timer: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`Execution timed out after ${options.timeoutMs}ms`)),
        options.timeoutMs,
      );
    });
    try {
      return await Promise.race([
        getStorage().run(ctx, async () => fn(scope)),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timer);
      if (isSync) currentSyncContext = prevSync;
    }
  }

  try {
    return await getStorage().run(ctx, async () => {
      return await fn(scope);
    });
  } finally {
    if (isSync) currentSyncContext = prevSync;
  }
}

/**
 * Runs a synchronous callback within the ambient context of the specified accessor.
 * Any Win32 CFunction invoked inside this scope without an explicit leading accessor
 * will automatically route its execution through `accessor.callSync(...)`.
 */
export function runOnSync<T>(
  accessor: ISyncMemoryAccessor | IMemoryAccessor,
  fn: (scope: RunnerScope) => T,
  options: RunOnOptions = {},
): T {
  const prev = currentSyncContext;
  const preferUnicode = options.preferUnicode ?? options.unicode ?? true;
  const ctx: AccessorContext = {
    accessor,
    isSync: true,
    inCall: false,
    preferUnicode,
  };
  currentSyncContext = ctx;
  const scope = resolveScope(accessor, options);
  try {
    return getStorage().run(ctx, () => fn(scope));
  } finally {
    currentSyncContext = prev;
  }
}

/**
 * Executes a code snippet or function within the ambient accessor context.
 * All Win32 API functions, libraries, memory, accessor references, and optional
 * Java/print helpers are directly in scope as bare local variables.
 */
export async function execute<T = unknown>(
  accessor: IMemoryAccessor,
  codeOrFn: string | ((scope: RunnerScope) => Promise<T> | T),
  options: RunOnOptions = {},
): Promise<T> {
  if (typeof codeOrFn === 'function') {
    return runOn(accessor, codeOrFn, options);
  }

  const scope = resolveScope(accessor, options);
  let cleanCode = codeOrFn;
  const rawTrimmed = codeOrFn.trim();

  // Auto-return final expression if eligible (Nashorn / REPL style)
  const lines = rawTrimmed.split('\n');
  let lastIdx = lines.length - 1;
  while (lastIdx >= 0) {
    const line = lines[lastIdx];
    if (line !== undefined && line.trim() === '') {
      lastIdx--;
    } else {
      break;
    }
  }
  const lastLine = lines[lastIdx]?.trim();
  if (lastIdx >= 0 && lastLine !== undefined) {
    const isEligible =
      !lastLine.startsWith('return ') &&
      !lastLine.startsWith('const ') &&
      !lastLine.startsWith('let ') &&
      !lastLine.startsWith('var ') &&
      !lastLine.startsWith('//') &&
      !lastLine.startsWith('/*') &&
      !lastLine.startsWith('import ') &&
      !lastLine.startsWith('export ') &&
      !lastLine.endsWith(';') &&
      !lastLine.endsWith('}');
    if (isEligible) {
      lines[lastIdx] = `return (${lastLine});`;
      cleanCode = lines.join('\n');
    }
  }

  // Transparently transpile TypeScript to JavaScript via Bun if available
  if (typeof Bun !== 'undefined' && (Bun as any).Transpiler) {
    try {
      const transpiler = new (Bun as any).Transpiler({ loader: 'ts' });
      cleanCode = transpiler.transformSync(cleanCode);
    } catch {
      // Fallback to untranspiled code
    }
  }

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const argNames = Object.keys(scope);
  const argValues = Object.values(scope);
  const fn = new AsyncFunction(...argNames, cleanCode);

  return runOn(accessor, () => fn(...argValues), options);
}

/**
 * Executes a function with `inCall: true` flag set in the active context.
 * Used internally by CFunction wrappers to avoid re-entrant loops when an accessor
 * internally invokes helper CFunctions.
 */
export function executeInCall<T>(ctx: AccessorContext, fn: () => T): T {
  const callCtx: AccessorContext = { ...ctx, inCall: true };
  if (ctx.isSync) {
    const prev = currentSyncContext;
    currentSyncContext = callCtx;
    try {
      return getStorage().run(callCtx, fn);
    } finally {
      currentSyncContext = prev;
    }
  } else {
    return getStorage().run(callCtx, fn);
  }
}
