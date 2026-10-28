/**
 * @exoproc/njava-runtime - Script Executor
 * Executes JavaScript code in an async execution context with Java proxies,
 * print redirection, custom globals, and formatted logging.
 */

import { existsSync, readFileSync } from 'node:fs';
import { JavaRuntimeContext, createRuntimeContext } from '../context.js';
import {
  ClassLoader,
  UnsafeClassLoader,
  AgentClassLoader,
} from '../definer/index.js';

export interface ScriptExecutionOptions {
  /** Target Java proxy or JavaRuntimeContext instance */
  java?: any | JavaRuntimeContext;
  /** Optional target memory accessor for ambient native calls */
  accessor?: any;
  /** Custom global variables injected into the script scope */
  globals?: Record<string, any>;
  /** Execution timeout in milliseconds */
  timeoutMs?: number;
  /** Callback for each log line emitted via `print(...)` */
  onLog?: (msg: string) => void;
  /** Whether to prefer Unicode (W-suffix) Win32 calls */
  preferUnicode?: boolean;
}

export interface ScriptExecutionResult {
  success: boolean;
  result?: any;
  logs: string[];
  error?: string;
}

/**
 * Formats a value for `print(...)` logs, displaying Java proxy identity and structure nicely.
 */
export function formatPrintArg(arg: any): string {
  if (arg === null) return 'null';
  if (arg === undefined) return 'undefined';
  if (typeof arg === 'bigint') return `${arg.toString()}n`;
  if (typeof arg === 'function')
    return `[Function: ${arg.name || 'anonymous'}]`;

  if (typeof arg === 'object') {
    try {
      if ('$ptr' in arg || '$classObj' in arg || '$raw' in arg) {
        const clsName =
          arg.$className ||
          arg.$class?.name ||
          arg.getClass?.()?.getName?.() ||
          'Object';
        const ptr = arg.$ptr ?? arg.$classObj ?? arg.$raw ?? '';
        return `[Java ${clsName} @ ${ptr}]`;
      }
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }

  return String(arg);
}

/**
 * Executes a JavaScript script with `Java`, `print`, and optional custom globals.
 * Supports top-level `await`.
 */
export async function executeScript(
  sourceCode: string,
  options: ScriptExecutionOptions = {},
): Promise<ScriptExecutionResult> {
  const logs: string[] = [];

  const printFn = (...args: any[]) => {
    const line = args.map(formatPrintArg).join(' ');
    logs.push(line);
    options.onLog?.(line);
  };

  const javaInstance = options.java ?? createRuntimeContext();
  (javaInstance as any).ClassLoader = ClassLoader;
  (javaInstance as any).UnsafeClassLoader = UnsafeClassLoader;
  (javaInstance as any).AgentClassLoader = AgentClassLoader;

  const paramNames = [
    'Java',
    'print',
    'exports',
    'ClassLoader',
    'UnsafeClassLoader',
    'AgentClassLoader',
  ];
  const paramValues = [
    javaInstance,
    printFn,
    {},
    ClassLoader,
    UnsafeClassLoader,
    AgentClassLoader,
  ];

  if (options.globals && typeof options.globals === 'object') {
    for (const [key, value] of Object.entries(options.globals)) {
      if (key !== 'Java' && key !== 'print') {
        paramNames.push(key);
        paramValues.push(value);
      }
    }
  }

  // Transparently transpile TypeScript to JavaScript via Bun's fast native transpiler if available
  let codeToRun = sourceCode;
  if (typeof Bun !== 'undefined' && (Bun as any).Transpiler) {
    try {
      const transpiler = new (Bun as any).Transpiler({ loader: 'ts' });
      codeToRun = transpiler.transformSync(sourceCode);
    } catch {
      // Fallback to raw source code on parse error
    }
  }

  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

  try {
    const scriptFn = new AsyncFunction(...paramNames, codeToRun);
    let executionPromise: Promise<any>;

    const targetAccessor = options.accessor ?? (javaInstance as any)?.accessor;
    if (targetAccessor) {
      try {
        const pkg = 'bun-xffi';
        const { runOn } = (await import(pkg)) as any;
        executionPromise = runOn(
          targetAccessor,
          () => scriptFn(...paramValues),
          {
            preferUnicode: options.preferUnicode,
          },
        );
      } catch {
        executionPromise = scriptFn(...paramValues);
      }
    } else {
      executionPromise = scriptFn(...paramValues);
    }

    let result: any;
    if (options.timeoutMs && options.timeoutMs > 0) {
      let timer: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `Script execution timed out after ${options.timeoutMs}ms`,
              ),
            ),
          options.timeoutMs,
        );
      });
      try {
        result = await Promise.race([executionPromise, timeoutPromise]);
      } finally {
        clearTimeout(timer);
      }
    } else {
      result = await executionPromise;
    }

    return {
      success: true,
      result,
      logs,
    };
  } catch (err: any) {
    const errorMsg = err?.stack || err?.message || String(err);
    return {
      success: false,
      error: errorMsg,
      logs,
    };
  }
}

/**
 * Runs a script from file path or raw source code.
 */
export async function runScript(
  sourceCodeOrPath: string,
  options: ScriptExecutionOptions = {},
): Promise<ScriptExecutionResult> {
  let code = sourceCodeOrPath;
  if (typeof sourceCodeOrPath === 'string' && existsSync(sourceCodeOrPath)) {
    try {
      code = readFileSync(sourceCodeOrPath, 'utf8');
    } catch {}
  }
  return executeScript(code, options);
}

/**
 * Executes a TypeScript/JavaScript function or script code string within a Java context.
 * Injects `Java` and `print`, supporting both synchronous and asynchronous task returns.
 */
export async function runSync<T = any>(
  task:
    ((java: any, print: (...args: any[]) => void) => T | Promise<T>) | string,
  options: ScriptExecutionOptions = {},
): Promise<T> {
  if (typeof task === 'string') {
    const res = await runScript(task, options);
    if (!res.success) {
      throw new Error(res.error || 'Script execution failed');
    }
    return res.result;
  }

  const logs: string[] = [];
  const printFn = (...args: any[]) => {
    const line = args.map(formatPrintArg).join(' ');
    logs.push(line);
    options.onLog?.(line);
  };

  const javaInstance = options.java ?? createRuntimeContext();

  if (options.timeoutMs && options.timeoutMs > 0) {
    let timer: any;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`runSync timed out after ${options.timeoutMs}ms`)),
        options.timeoutMs,
      );
    });
    try {
      return await Promise.race([
        Promise.resolve(task(javaInstance, printFn)),
        timeoutPromise,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  return await task(javaInstance, printFn);
}
