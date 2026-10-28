/**
 * @exoproc/njava-runtime - Script Runner Spawner
 * Spawns and supervises a dedicated worker thread executing JavaScript/Nashorn scripts.
 */

import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ScriptRunnerOptions {
  /** Target process PID to attach to */
  pid?: number;
  /** Path to the script file (.js or .ts) */
  scriptPath?: string;
  /** Inline script code to execute directly */
  scriptCode?: string;
  /** Pre-resolved Minecraft / Java mappings */
  mappings?: any;
  /** Additional global variables to expose */
  globals?: Record<string, any>;
  /** Optional execution timeout in milliseconds */
  timeoutMs?: number;
  /** Callback for logs produced by `print(...)` in the script */
  onLog?: (msg: string) => void;
  /** Callback for worker readiness */
  onReady?: () => void;
  /** Optional module path for custom domain-specific setup */
  initModule?: string;
  /** Override path to worker file */
  workerPath?: string | URL;
  /** Whether PID is strictly required (defaults to false) */
  requirePid?: boolean;
}

/**
 * Resolves the path to the script worker file across development (.ts), bundle (.js),
 * and monorepo layouts.
 */
export function resolveWorkerPath(): URL | string {
  const currentDir = import.meta.dirname;
  if (currentDir) {
    const candidates = [
      join(currentDir, 'worker.bundle.js'),
      join(currentDir, 'worker.js'),
      join(currentDir, 'worker.ts'),
      join(currentDir, '..', 'script-worker.bundle.js'),
      join(currentDir, '..', 'script-worker.js'),
      join(currentDir, '..', 'script-worker.ts'),
      join(currentDir, 'runner', 'worker.bundle.js'),
      join(currentDir, 'runner', 'worker.js'),
      join(currentDir, 'runner', 'worker.ts'),
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  }

  const rootCandidates = [
    join(
      process.cwd(),
      'packages',
      'njava-runtime',
      'dist',
      'runner',
      'worker.bundle.js',
    ),
    join(
      process.cwd(),
      'packages',
      'njava-runtime',
      'dist',
      'runner',
      'worker.js',
    ),
    join(
      process.cwd(),
      'packages',
      'njava-runtime',
      'dist',
      'script-worker.js',
    ),
    join(
      process.cwd(),
      'packages',
      'njava-runtime',
      'src',
      'runner',
      'worker.ts',
    ),
    join(process.cwd(), 'packages', 'njava-runtime', 'src', 'script-worker.ts'),
    join(process.cwd(), 'dist-tests', 'exoproc', 'worker.js'),
    join(
      process.cwd(),
      'packages',
      'exoproc',
      'dist',
      'script-runner',
      'worker.bundle.js',
    ),
    join(
      process.cwd(),
      'packages',
      'exoproc',
      'dist',
      'script-runner',
      'worker.js',
    ),
    join(
      process.cwd(),
      'packages',
      'exoproc',
      'src',
      'script-runner',
      'worker.ts',
    ),
  ];
  for (const rc of rootCandidates) {
    if (existsSync(rc)) return rc;
  }

  try {
    return new URL('./worker.bundle.js', import.meta.url);
  } catch {
    return new URL('./worker.js', import.meta.url);
  }
}

/**
 * Runs a JavaScript / Nashorn script in a dedicated background worker thread
 * with synchronous Java accessor access, runtime class proxies, and global `Java`.
 */
export async function runScriptInWorker(
  options: ScriptRunnerOptions,
): Promise<any> {
  if (options.requirePid && (!options.pid || typeof options.pid !== 'number')) {
    throw new Error(
      'runScriptInWorker: "pid" is strictly required when requirePid is set',
    );
  }
  if (!options.scriptPath && !options.scriptCode) {
    throw new Error(
      'runScriptInWorker: either "scriptPath" or "scriptCode" must be provided',
    );
  }

  const targetWorkerPath = options.workerPath ?? resolveWorkerPath();
  const workerData = {
    pid: options.pid,
    scriptPath: options.scriptPath,
    scriptCode: options.scriptCode,
    mappings: options.mappings,
    globals: options.globals,
    initModule: options.initModule,
    requirePid: options.requirePid,
  };

  return new Promise((resolve, reject) => {
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const worker = new Worker(targetWorkerPath, { workerData });

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        worker.terminate();
        reject(
          new Error(`Script execution timed out after ${options.timeoutMs}ms`),
        );
      }, options.timeoutMs);
    }

    const anyWorker = worker as any;
    anyWorker.on('message', (msg: any) => {
      if (!msg) return;
      if (msg.type === 'ready') {
        options.onReady?.();
      } else if (msg.type === 'log') {
        options.onLog?.(msg.data);
      } else if (msg.type === 'done') {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        resolve(msg.result);
      } else if (msg.type === 'error') {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        reject(new Error(msg.error));
      }
    });

    anyWorker.on('error', (err: any) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      reject(err);
    });

    anyWorker.on('exit', (code: any) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}
