import { describe, expect, it } from 'bun:test';
import net from 'node:net';
import {
  createIpcServer,
  encodeFrame,
  FrameDecoder,
  FrameType,
  IpcPipeClient,
  resolvePipeEndpoint,
  toWindowsPipePath,
} from 'exoproc-ipc';

describe('exoproc-ipc: Named Pipe & Local Socket Hub', () => {
  it('resolves pipe names across platforms and encodes/decodes chunked frames', () => {
    expect(toWindowsPipePath('my_pipe')).toBe('\\\\.\\pipe\\my_pipe');
    expect(toWindowsPipePath('\\\\.\\pipe\\custom')).toBe(
      '\\\\.\\pipe\\custom',
    );

    const ep = resolvePipeEndpoint('unit_pipe_check');
    expect(ep.name).toBe('unit_pipe_check');
    if (process.platform === 'win32') {
      expect(ep.pipePath).toBe('\\\\.\\pipe\\unit_pipe_check');
    } else {
      expect(ep.pipePath.endsWith('.sock')).toBe(true);
    }

    const f1 = encodeFrame(FrameType.RPC_REQ, 42, { action: 'ping', x: 7 });
    const f2 = encodeFrame(FrameType.RAW_REQ, 99, new Uint8Array([1, 2, 3, 4]));
    const combined = Buffer.concat([f1, f2]);

    const decoder = new FrameDecoder();
    expect(decoder.push(combined.subarray(0, 5))).toEqual([]);
    const out = decoder.push(combined.subarray(5));
    expect(out.length).toBe(2);
    expect(out[0].type).toBe(FrameType.RPC_REQ);
    expect(out[0].reqId).toBe(42);
    expect(JSON.parse(out[0].payload.toString('utf8'))).toEqual({
      action: 'ping',
      x: 7,
    });
    expect(out[1].type).toBe(FrameType.RAW_REQ);
    expect(out[1].reqId).toBe(99);
    expect(Array.from(out[1].payload)).toEqual([1, 2, 3, 4]);
  });

  it('handles bidirectional RPC, callbacks, events, and raw binary frames for multiple clients', async () => {
    const server = createIpcServer({
      name: `ipc_hub_${process.pid}_${Date.now()}`,
    });
    await server.listen();

    try {
      const receivedEvents: Array<{ payload: any; clientId: string }> = [];
      server.onEvent((payload, clientId) => {
        receivedEvents.push({ payload, clientId });
      });

      server.onCallback(async (payload) => {
        if (payload.callbackId === 'cb_sum') {
          const total = (payload.args as number[]).reduce((a, b) => a + b, 0);
          return { id: payload.id, success: true, result: total };
        }
        return undefined;
      });

      server.onRawRequest((payload) => {
        const out = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) {
          out[i] = payload[i] ^ 0xff;
        }
        return out;
      });

      const javaClient = new IpcPipeClient({
        pipePath: server.pipePath,
        kind: 'java-agent',
        pid: 1234,
        buildId: 'b_test_java',
      });
      javaClient.onRpc((req) => ({
        success: true,
        echoAction: req.action,
        doubled: (req.value ?? 0) * 2,
      }));

      const shellcodeClient = new IpcPipeClient({
        pipePath: server.pipePath,
        kind: 'shellcode',
        pid: 5678,
      });
      shellcodeClient.onRaw((buf) => Buffer.from([...buf].reverse()));

      await Promise.all([javaClient.connect(), shellcodeClient.connect()]);

      const waitedJava = await server.waitForClient(
        { kind: 'java-agent', buildId: 'b_test_java' },
        3000,
      );
      expect(waitedJava.pid).toBe(1234);
      expect(server.getClients().length).toBe(2);

      // Server -> Java client RPC
      const rpcRes = await server.request(
        'compute',
        { value: 21 },
        { kind: 'java-agent' },
      );
      expect(rpcRes).toEqual({
        success: true,
        echoAction: 'compute',
        doubled: 42,
      });

      // Java client -> Server callback
      const cbRes = await javaClient.invokeCallback(
        'cb_sum',
        'apply',
        [10, 20, 12],
      );
      expect(cbRes).toBe(42);

      // Shellcode client -> Server raw binary request
      const xorRes = await shellcodeClient.sendRaw(
        new Uint8Array([0x00, 0x0f, 0xf0, 0xff]),
      );
      expect(Array.from(xorRes)).toEqual([0xff, 0xf0, 0x0f, 0x00]);

      // Server -> Shellcode client raw binary request
      const revRes = await server.requestRaw(new Uint8Array([1, 2, 3, 4]), {
        kind: 'shellcode',
      });
      expect(Array.from(revRes)).toEqual([4, 3, 2, 1]);

      // Event push & ping
      javaClient.emitEvent({ topic: 'loaded', count: 3 });
      await Bun.sleep(30);
      expect(receivedEvents.length).toBe(1);
      expect(receivedEvents[0].payload).toEqual({ topic: 'loaded', count: 3 });
      expect(await server.ping({ clientId: javaClient.clientId })).toBe(true);

      javaClient.close();
      shellcodeClient.close();
    } finally {
      await server.close();
    }
  });

  it('pairs dual s2c + c2s channels (Java RandomAccessFile mode)', async () => {
    const server = createIpcServer({
      name: `ipc_dual_${process.pid}_${Date.now()}`,
    });
    await server.listen();

    const s2c = net.connect(server.pipePath);
    const c2s = net.connect(server.pipePath);

    try {
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          s2c.once('connect', () => resolve());
          s2c.once('error', reject);
        }),
        new Promise<void>((resolve, reject) => {
          c2s.once('connect', () => resolve());
          c2s.once('error', reject);
        }),
      ]);

      const clientId = 'dual_raf_client_1';
      const s2cDecoder = new FrameDecoder();

      s2c.on('data', (chunk) => {
        const frames = s2cDecoder.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
        );
        for (const frame of frames) {
          if (frame.type === FrameType.RPC_REQ) {
            const req = JSON.parse(frame.payload.toString('utf8'));
            c2s.write(
              encodeFrame(FrameType.RPC_RES, frame.reqId, {
                alive: true,
                action: req.action,
              }),
            );
          }
        }
      });

      s2c.write(
        encodeFrame(FrameType.HELLO, 1, {
          clientId,
          role: 's2c',
          kind: 'java-agent',
          pid: 999,
        }),
      );
      c2s.write(
        encodeFrame(FrameType.HELLO, 2, {
          clientId,
          role: 'c2s',
          kind: 'java-agent',
          pid: 999,
        }),
      );

      const info = await server.waitForClient({ clientId }, 3000);
      expect(info.clientId).toBe(clientId);

      const status = await server.request('status', {}, { clientId });
      expect(status).toEqual({ alive: true, action: 'status' });
    } finally {
      s2c.destroy();
      c2s.destroy();
      await server.close();
    }
  });
});
