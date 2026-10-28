import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, type Subprocess } from 'bun';
import {
  createAgentContext,
  AgentReflectionBridge,
} from '../../packages/java/njava/src/agent-bridge.js';
import { getAgentJarSync } from 'njava-agent';
import { getTestJavaPath } from './java-test-helpers.js';

const TEST_PORT = 43391;

describe('Agent Reflection RPC Bridge (Standalone)', () => {
  let agentProcess: Subprocess | null = null;

  beforeAll(async () => {
    const javaBin = getTestJavaPath(8);
    const agent = getAgentJarSync({ javaVersion: 8, javaPath: javaBin });
    agentProcess = spawn(
      [javaBin, '-jar', agent.jarPath, '--port', String(TEST_PORT)],
      {
        stdout: 'ignore',
        stderr: 'inherit',
      },
    );

    // Wait for the agent HTTP server to respond on /reflection/class
    const startTime = Date.now();
    let ready = false;
    while (Date.now() - startTime < 10000) {
      try {
        const res = await fetch(
          `http://127.0.0.1:${TEST_PORT}/reflection/class`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'java.lang.Object' }),
            signal: AbortSignal.timeout(500),
          },
        );
        if (res.ok) {
          const body = (await res.json()) as any;
          if (body.success) {
            ready = true;
            break;
          }
        }
      } catch {}
      await Bun.sleep(100);
    }

    if (!ready) {
      agentProcess.kill();
      throw new Error(
        `Standalone agent failed to start on port ${TEST_PORT} within 10s`,
      );
    }
  }, 25000);

  afterAll(() => {
    if (agentProcess) {
      agentProcess.kill();
    }
  });

  it('queries Exoproc host properties via reflection', () => {
    const Java = createAgentContext({ port: TEST_PORT, sync: true });
    const Exoproc = Java.type('Exoproc');
    expect(Exoproc).toBeDefined();

    expect(Exoproc.isAttached()).toBe(true);
    expect(typeof Exoproc.getPid()).toBe('number');
    expect(Exoproc.getPid()).toBeGreaterThan(0);
    expect(typeof Exoproc.getTargetName()).toBe('string');
  });

  it('invokes static methods synchronously via Java.type', () => {
    const Java = createAgentContext({ port: TEST_PORT, sync: true });
    const System = Java.type('java.lang.System');

    expect(System).toBeDefined();
    expect(System.name).toBe('java.lang.System');

    // System.currentTimeMillis()
    const now = System.currentTimeMillis();
    expect(typeof now).toBe('number');
    expect(now).toBeGreaterThan(1700000000000);

    // System.getProperty('java.version')
    const version = System.getProperty('java.version');
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });

  it('instantiates classes and calls instance methods', () => {
    const Java = createAgentContext({ port: TEST_PORT, sync: true });
    const ArrayList = Java.type('java.util.ArrayList');

    const list = new ArrayList();
    expect(list).toBeDefined();
    expect(list.size()).toBe(0);

    list.add('First');
    list.add('Second');

    expect(list.size()).toBe(2);
    expect(list.get(0)).toBe('First');
    expect(list.get(1)).toBe('Second');
    expect(list.toString()).toBe('[First, Second]');
  });

  it('supports Java.from conversion from Java list to native JS array', () => {
    const Java = createAgentContext({ port: TEST_PORT, sync: true });
    const ArrayList = Java.type('java.util.ArrayList');

    const list = new ArrayList();
    list.add('Alpha');
    list.add('Beta');
    list.add('Gamma');

    const jsArray = Java.from(list);
    expect(Array.isArray(jsArray)).toBe(true);
    expect(jsArray).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('reads static fields and works with hybrid console output', () => {
    const Java = createAgentContext({ port: TEST_PORT, sync: true });

    // JVM static field on Integer
    const Integer = Java.type('java.lang.Integer');
    expect(Integer.MAX_VALUE).toBe(2147483647);

    // Hybrid System.out
    const System = Java.type('java.lang.System');
    const out = System.out;
    expect(out).toBeDefined();
    expect(typeof out.println).toBe('function');
  });

  it('works in asynchronous mode with top-level await', async () => {
    const bridge = new AgentReflectionBridge({ port: TEST_PORT });
    const SystemClass = await bridge.getClass('java.lang.System');

    expect(SystemClass.name).toBe('java.lang.System');
    const methods = await SystemClass.getAllMethods();
    const currentTimeMillisMethod = methods.find(
      (m) => m.name === 'currentTimeMillis',
    );
    expect(currentTimeMillisMethod).toBeDefined();

    const now = await currentTimeMillisMethod!.invoke(0n);
    expect(typeof now).toBe('number');
    expect(now).toBeGreaterThan(1700000000000);
  });

  it('executes tasks directly via Java.runSync and Java.runScript', async () => {
    const Java = createAgentContext({ port: TEST_PORT, sync: true });

    // Functional runSync mode
    const syncRes = await Java.runSync((ctx, print) => {
      const System = ctx.type('java.lang.System');
      const time = System.currentTimeMillis();
      print('Agent reflection time:', time);
      return { ok: true, timeValid: time > 0n };
    });
    expect(syncRes.ok).toBe(true);
    expect(syncRes.timeValid).toBe(true);

    // String script mode via runScript
    const scriptRes = await Java.runScript(`
      var System = Java.type('java.lang.System');
      print('Agent script run');
      return { val: 99 };
    `);
    expect(scriptRes.success).toBe(true);
    expect(scriptRes.result.val).toBe(99);
    expect(scriptRes.logs).toContain('Agent script run');
  });
});
