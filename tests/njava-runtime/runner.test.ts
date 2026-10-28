import { describe, it, expect } from 'bun:test';
import {
  executeScript,
  runScript,
  runSync,
  runScriptInWorker,
  createRuntimeContext,
} from '../../packages/java/runtime/src/index.js';

describe('njava-runtime > Script Runner & Worker', () => {
  it('executes script in-thread with executeScript, supporting Java and print', async () => {
    const ctx = createRuntimeContext();
    const script = `
      var System = Java.type('java.lang.System');
      var time = System.currentTimeMillis();
      print('Current time: ' + time);
      return { success: true, time: time > 0n };
    `;

    const logs: string[] = [];
    const res = await executeScript(script, {
      java: ctx,
      onLog: (l) => logs.push(l),
    });

    expect(res.success).toBe(true);
    expect(res.result?.success).toBe(true);
    expect(res.result?.time).toBe(true);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toContain('Current time:');
  });

  it('handles errors and timeout in executeScript', async () => {
    const res = await executeScript('throw new Error("test error");');
    expect(res.success).toBe(false);
    expect(res.error).toContain('test error');

    const timeoutRes = await executeScript(
      'await new Promise(r => setTimeout(r, 200));',
      {
        timeoutMs: 50,
      },
    );
    expect(timeoutRes.success).toBe(false);
    expect(timeoutRes.error).toContain('timed out');
  });

  it('runs script inside dedicated worker thread via runScriptInWorker', async () => {
    const logs: string[] = [];
    const script = `
      var System = Java.type('java.lang.System');
      var time = System.currentTimeMillis();
      print('Worker time: ' + time);
      return { inWorker: true, validTime: time > 0n };
    `;

    const result = await runScriptInWorker({
      scriptCode: script,
      onLog: (msg) => logs.push(msg),
    });

    expect(result).toBeDefined();
    expect(result.inWorker).toBe(true);
    expect(result.validTime).toBe(true);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toContain('Worker time:');
  });

  it('rejects in runScriptInWorker if requirePid is set and pid is missing', async () => {
    expect(
      runScriptInWorker({
        pid: 0,
        scriptCode: 'print(1);',
        requirePid: true,
      }),
    ).rejects.toThrow('pid');
  });

  it('executes TypeScript code with interfaces, types, and type assertions', async () => {
    const tsScript = `
      interface UserResult {
        id: number;
        name: string;
        active: boolean;
      }

      type Tag = 'admin' | 'guest';

      const tag: Tag = 'admin';
      const user: UserResult = {
        id: 101,
        name: 'Neo',
        active: true,
      };

      print('TS User: ' + (user.name as string) + ' with tag ' + tag);

      return {
        user,
        tag,
        valid: user.id > 100,
      };
    `;

    const logs: string[] = [];
    const res = await executeScript(tsScript, {
      onLog: (l) => logs.push(l),
    });

    expect(res.success).toBe(true);
    expect(res.result?.user?.name).toBe('Neo');
    expect(res.result?.tag).toBe('admin');
    expect(res.result?.valid).toBe(true);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toContain('TS User: Neo with tag admin');
  });

  it('runs TypeScript script inside worker thread via runScriptInWorker', async () => {
    const tsWorkerScript = `
      interface Stats {
        fps: number;
        title: string;
      }

      const stats: Stats = {
        fps: 60,
        title: 'Exoproc TS Worker',
      };

      print('TS Worker: ' + (stats.title as string) + ' @ ' + stats.fps + ' fps');
      return { success: true, stats };
    `;

    const logs: string[] = [];
    const result = await runScriptInWorker({
      scriptCode: tsWorkerScript,
      onLog: (m) => logs.push(m),
    });

    expect(result.success).toBe(true);
    expect(result.stats.fps).toBe(60);
    expect(result.stats.title).toBe('Exoproc TS Worker');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toContain('TS Worker: Exoproc TS Worker @ 60 fps');
  });

  it('executes functional TypeScript tasks directly on runtime.runSync with Java and print', async () => {
    const runtime = createRuntimeContext();
    const logs: string[] = [];

    const result = await runtime.runSync(
      (Java, print) => {
        const System = Java.type('java.lang.System');
        const time = System.currentTimeMillis();
        print('Sync time:', time);
        return {
          hasTime: time > 0n,
          tag: 'synchronous-function-mode',
        };
      },
      {
        onLog: (l) => logs.push(l),
      },
    );

    expect(result.hasTime).toBe(true);
    expect(result.tag).toBe('synchronous-function-mode');
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toContain('Sync time:');
  });

  it('executes string scripts directly on runtime.runSync', async () => {
    const runtime = createRuntimeContext();
    const script = `
      var System = Java.type('java.lang.System');
      return { val: 42, timeOk: System.currentTimeMillis() > 0n };
    `;

    const result = await runtime.runSync(script);
    expect(result.val).toBe(42);
    expect(result.timeOk).toBe(true);
  });

  it('executes script strings and files directly on runtime.runScript', async () => {
    const runtime = createRuntimeContext();
    const logs: string[] = [];
    const script = `
      print('Running via runtime.runScript');
      return 'done';
    `;

    const res = await runtime.runScript(script, {
      onLog: (l) => logs.push(l),
    });

    expect(res.success).toBe(true);
    expect(res.result).toBe('done');
    expect(logs).toContain('Running via runtime.runScript');
  });

  it('supports standalone runSync and runScript helper functions', async () => {
    const fnResult = await runSync((_Java, print) => {
      print('Standalone runSync working');
      return 100;
    });
    expect(fnResult).toBe(100);

    const scriptResult = await runScript(
      "print('Standalone runScript'); return 'ok';",
    );
    expect(scriptResult.success).toBe(true);
    expect(scriptResult.result).toBe('ok');
    expect(scriptResult.logs).toContain('Standalone runScript');
  });
});
