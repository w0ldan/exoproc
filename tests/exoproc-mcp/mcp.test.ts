import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMcpServer,
  listProcesses,
  disassembleBytes,
  listHooks,
  executeLocalCode,
  spawnProcess,
  executeCommand,
  listWindows,
  openAccessor,
  closeAccessor,
  executeCode,
  readMemory,
  writeMemory,
  allocateMemory,
} from 'exoproc-mcp';
import { DummyProcess } from 'exoproc-dummy';

describe('exoproc-mcp', () => {
  it('creates MCP server instance with all tools registered', () => {
    const server = createMcpServer();
    assert.ok(server);
  });

  it('spawns a process via spawnProcess', async () => {
    const isWin = process.platform === 'win32';
    const res = await spawnProcess({
      command: isWin ? 'cmd.exe' : 'echo',
      args: isWin ? ['/c', 'echo', 'hello'] : ['hello'],
    });
    assert.equal(res.success, true);
    assert.ok(typeof res.pid === 'number');
    assert.ok(res.pid > 0);
  });

  it('executes a command via executeCommand', async () => {
    const res = await executeCommand({
      command: 'echo "hello from mcp command test"',
    });
    assert.equal(res.success, true);
    assert.match(res.stdout, /hello from mcp command test/);
    assert.equal(res.exitCode, 0);
  });

  it('executes local code snippet and captures logs via executeLocalCode', async () => {
    const res = await executeLocalCode({
      code: `
        print("Executing AI test snippet...");
        const a = 100;
        const b = 200;
        print("Result computation:", a + b);
        ({ sum: a + b, ok: true })
      `,
    });

    assert.equal(res.success, true);
    assert.deepEqual(res.result, { sum: 300, ok: true });
    assert.equal(res.logs.length, 2);
    assert.equal(res.logs[0], 'Executing AI test snippet...');
    assert.equal(res.logs[1], 'Result computation: 300');
  });

  it('lists host processes', async () => {
    const procs = await listProcesses();
    assert.ok(Array.isArray(procs));
    assert.ok(procs.length > 0);
    assert.ok(typeof procs[0]?.pid === 'number');
  });

  it('disassembles machine code via Capstone', async () => {
    const res = await disassembleBytes({
      bytesHex: '48b82a000000000000004883c00ac3',
    });
    assert.equal(res.success, true);
    assert.ok(res.instructions.length >= 1);
  });

  it('lists active hooks correctly when none installed', () => {
    const hooks = listHooks();
    assert.deepEqual(hooks, { minhooks: [] });
  });

  it('lists desktop windows', async () => {
    const windows = await listWindows();
    assert.ok(Array.isArray(windows));
  });

  it(
    'manages accessor session lifecycle and runs remote code via executeCode and readMemory',
    { timeout: 40000 },
    async () => {
      const proc = new DummyProcess();
      try {
        const session = await openAccessor({ pid: proc.pid });

        assert.equal(session.success, true);
        assert.equal(session.pid, proc.pid);
        assert.ok(session.sessionId);
        assert.ok(session.sessionFile);
        assert.ok(session.sessionData);

        // Execute remote code with sessionId
        const execRes = await executeCode({
          session: session.sessionId,
          code: 'const a = 123; const b = 456; return { sum: a + b };',
        });
        assert.equal(execRes.success, true);
        assert.deepEqual(execRes.result, { sum: 579 });

        // Execute remote code with sessionFile
        const execFileRes = await executeCode({
          session: session.sessionFile,
          code: 'return 77 + 33;',
        });
        assert.equal(execFileRes.success, true);
        assert.equal(execFileRes.result, 110);

        // Allocate memory in remote process
        const allocRes = await allocateMemory({
          session: session.sessionId,
          size: 64,
        });
        assert.ok(allocRes.address);

        // Write memory
        const writeRes = await writeMemory({
          session: session.sessionId,
          address: allocRes.address,
          hex: '12345678',
        });
        assert.equal(writeRes.success, true);

        // Read memory back
        const memRes = await readMemory({
          session: session.sessionId,
          address: allocRes.address,
          size: 4,
        });
        assert.equal(memRes.size, 4);
        assert.equal(memRes.hex, '12345678');

        // Close session
        const closeRes = await closeAccessor({ session: session.sessionId });
        assert.equal(closeRes.success, true);
      } finally {
        await proc.stop();
      }
    },
  );
});
