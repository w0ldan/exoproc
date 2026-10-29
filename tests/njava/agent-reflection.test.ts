import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, type Subprocess } from 'bun';
import { createIpcServer, type IpcServer } from 'exoproc-ipc';
import {
  createAgentContext,
  AgentReflectionBridge,
} from '../../packages/java/njava/src/agent-bridge.js';
import { getAgentJarSync } from 'njava-agent';
import { getTestJavaPath } from './java-test-helpers.js';

describe('Agent Reflection RPC Bridge over Named Pipe (Standalone)', () => {
  let server: IpcServer;
  let agentProcess: Subprocess | null = null;

  beforeAll(async () => {
    server = createIpcServer({
      name: `test_agent_rpc_${process.pid}_${Date.now()}`,
    });
    await server.listen();

    const javaBin = getTestJavaPath(8);
    const agent = getAgentJarSync({
      javaVersion: 8,
      javaPath: javaBin,
      force: true,
    });
    agentProcess = spawn(
      [javaBin, '-jar', agent.jarPath, '--pipe', server.pipePath],
      {
        stdout: 'ignore',
        stderr: 'inherit',
      },
    );

    await server.waitForClient({ kind: 'java-agent' }, 15000);
  }, 30000);

  afterAll(async () => {
    if (agentProcess) {
      agentProcess.kill();
    }
    if (server) {
      await server.close();
    }
  });

  it('queries Exoproc host properties via reflection', async () => {
    const Java = createAgentContext({ server });
    const Exoproc = await Java.type('Exoproc');
    expect(Exoproc).toBeDefined();

    expect(await Exoproc.isAttached()).toBe(true);
    const pid = await Exoproc.getPid();
    expect(typeof pid).toBe('number');
    expect(pid).toBeGreaterThan(0);
    expect(typeof (await Exoproc.getTargetName())).toBe('string');
  });

  it('invokes static methods via Java.type', async () => {
    const Java = createAgentContext({ server });
    const System = Java.type('java.lang.System');

    expect(System).toBeDefined();

    const now = await System.currentTimeMillis();
    expect(typeof now).toBe('number');
    expect(now).toBeGreaterThan(1700000000000);

    const version = await System.getProperty('java.version');
    expect(typeof version).toBe('string');
    expect(version.length).toBeGreaterThan(0);
  });

  it('instantiates classes and calls instance methods', async () => {
    const Java = createAgentContext({ server });
    const ArrayList = Java.type('java.util.ArrayList');

    const list = await new ArrayList();
    expect(list).toBeDefined();
    expect(await list.size()).toBe(0);

    await list.add('First');
    await list.add('Second');

    expect(await list.size()).toBe(2);
    expect(await list.get(0)).toBe('First');
    expect(await list.get(1)).toBe('Second');
    expect(await list.toString()).toBe('[First, Second]');
  });

  it('supports Java.from conversion from Java list to native JS array', async () => {
    const Java = createAgentContext({ server });
    const ArrayList = Java.type('java.util.ArrayList');

    const list = await new ArrayList();
    await list.add('Alpha');
    await list.add('Beta');
    await list.add('Gamma');

    const jsArray = await Java.from(list);
    expect(Array.isArray(jsArray)).toBe(true);
    expect(jsArray).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('reads static fields and works with hybrid console output', async () => {
    const Java = createAgentContext({ server });

    const Integer = Java.type('java.lang.Integer');
    expect(await Integer.MAX_VALUE).toBe(2147483647);

    const System = await Java.type('java.lang.System');
    const out = await System.out;
    expect(out).toBeDefined();
    expect(typeof out.println).toBe('function');
  });

  it('works directly via AgentReflectionBridge', async () => {
    const bridge = new AgentReflectionBridge({ server });
    try {
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
    } finally {
      bridge.stopCallbackListener();
    }
  });

  it('executes tasks via Java.runSync and Java.runScript', async () => {
    const Java = createAgentContext({ server });

    const syncRes = await Java.runSync(async (ctx, print) => {
      const System = ctx.type('java.lang.System');
      const time = await System.currentTimeMillis();
      print('Agent reflection time:', time);
      return { ok: true, timeValid: time > 0 };
    });
    expect(syncRes.ok).toBe(true);
    expect(syncRes.timeValid).toBe(true);

    const scriptRes = await Java.runScript(`
      var System = Java.type('java.lang.System');
      var ver = await System.getProperty('java.version');
      print('Agent script run ' + ver);
      return { val: 99 };
    `);
    expect(scriptRes.success).toBe(true);
    expect(scriptRes.result.val).toBe(99);
    expect(scriptRes.logs[0]).toContain('Agent script run');
  });
});
