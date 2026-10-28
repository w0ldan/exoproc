/**
 * @exoproc/njava-runtime - Standalone Script Runner Worker Thread
 * Dedicated worker thread executing JavaScript/Nashorn scripts
 * within a JavaRuntimeContext.
 */

import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { createRuntimeContext } from '../context.js';
import { executeScript, formatPrintArg } from './executor.js';

/**
 * Worker entry point executed on a dedicated worker thread.
 */
export async function runWorkerMain() {
  if (isMainThread || !parentPort) {
    return;
  }

  const data = (workerData || {}) as any;
  if (data.requirePid && (!data.pid || typeof data.pid !== 'number')) {
    parentPort.postMessage({
      type: 'error',
      error: 'Missing target PID in workerData',
    });
    return;
  }

  try {
    const Java = createRuntimeContext();
    (globalThis as any).Java = Java;

    const printFn = (...args: any[]) => {
      const line = args.map(formatPrintArg).join(' ');
      console.log(line);
      parentPort?.postMessage({ type: 'log', data: line });
    };
    (globalThis as any).print = printFn;

    // Expose custom globals
    if (data.globals && typeof data.globals === 'object') {
      for (const [key, value] of Object.entries(data.globals)) {
        (globalThis as any)[key] = value;
      }
    }

    // Resolve script source
    let sourceCode = data.scriptCode ?? '';
    if (!sourceCode && data.scriptPath) {
      sourceCode = readFileSync(data.scriptPath, 'utf8');
    }

    if (!sourceCode.trim()) {
      parentPort.postMessage({
        type: 'error',
        error: 'No script code or file provided',
      });
      return;
    }

    parentPort.postMessage({ type: 'ready' });

    const res = await executeScript(sourceCode, {
      java: Java,
      globals: data.globals,
      onLog: (line) => parentPort?.postMessage({ type: 'log', data: line }),
    });

    if (res.success) {
      parentPort.postMessage({ type: 'done', result: res.result });
    } else {
      parentPort.postMessage({ type: 'error', error: res.error });
    }
  } catch (err: any) {
    parentPort.postMessage({
      type: 'error',
      error: err?.message ?? String(err),
    });
  }
}

// Auto-run if running as worker thread
if (!isMainThread && parentPort) {
  runWorkerMain();
}
