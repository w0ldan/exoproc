import net from 'node:net';
import {
  encodeFrame,
  FrameDecoder,
  FrameType,
  resolvePipeEndpoint,
  type AgentKind,
} from './protocol.js';

export interface IpcClientOptions {
  pipePath?: string;
  name?: string;
  clientId?: string;
  kind?: AgentKind;
  pid?: number;
  tid?: number;
  buildId?: string;
  targetName?: string;
  metadata?: Record<string, any>;
  connectTimeoutMs?: number;
}

/**
 * Node/Bun Named Pipe & Local Socket client speaking the Exoproc IPC frame protocol.
 * Useful for testing agent/shellcode topologies and multi-process Bun workers.
 */
export class IpcPipeClient {
  public readonly pipePath: string;
  public readonly clientId: string;
  public readonly kind: AgentKind;
  private socket: net.Socket | null = null;
  private nextReqId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (buf: Buffer) => void; reject: (err: Error) => void }
  >();
  private rpcHandler:
    | ((
        req: Record<string, any>,
      ) => Record<string, any> | Promise<Record<string, any>>)
    | null = null;
  private rawHandler:
    | ((payload: Buffer) => Buffer | Uint8Array | Promise<Buffer | Uint8Array>)
    | null = null;

  private readonly opts: IpcClientOptions;

  constructor(options: IpcClientOptions) {
    const resolved = resolvePipeEndpoint(options.pipePath ?? options.name);
    this.pipePath = resolved.pipePath;
    this.clientId =
      options.clientId ??
      `ipc_client_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    this.kind = options.kind ?? 'custom';
    this.opts = options;
  }

  public onRpc(
    handler: (
      req: Record<string, any>,
    ) => Record<string, any> | Promise<Record<string, any>>,
  ): void {
    this.rpcHandler = handler;
  }

  public onRaw(
    handler: (
      payload: Buffer,
    ) => Buffer | Uint8Array | Promise<Buffer | Uint8Array>,
  ): void {
    this.rawHandler = handler;
  }

  public async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    const timeoutMs = this.opts.connectTimeoutMs ?? 5000;
    const deadline = Date.now() + timeoutMs;

    let sock: net.Socket | null = null;
    let lastErr: any = null;

    while (Date.now() < deadline) {
      try {
        sock = await new Promise<net.Socket>((resolve, reject) => {
          const s = net.connect(this.pipePath);
          const onConnect = () => {
            s.removeListener('error', onErr);
            resolve(s);
          };
          const onErr = (err: Error) => {
            s.destroy();
            reject(err);
          };
          s.once('connect', onConnect);
          s.once('error', onErr);
        });
        break;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    if (!sock) {
      throw new Error(
        `Failed to connect to IPC pipe ${this.pipePath}: ${lastErr?.message || lastErr}`,
      );
    }

    const decoder = new FrameDecoder();
    this.socket = sock;

    sock.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const frames = decoder.push(buf);
      for (const frame of frames) {
        if (
          frame.type === FrameType.HELLO_ACK ||
          frame.type === FrameType.CALLBACK_RES ||
          frame.type === FrameType.RPC_RES ||
          frame.type === FrameType.RAW_RES ||
          frame.type === FrameType.PONG
        ) {
          const p = this.pending.get(frame.reqId);
          if (p) {
            this.pending.delete(frame.reqId);
            p.resolve(frame.payload);
          }
          continue;
        }

        if (frame.type === FrameType.PING) {
          sock.write(encodeFrame(FrameType.PONG, frame.reqId, frame.payload));
          continue;
        }

        if (frame.type === FrameType.RPC_REQ) {
          void (async () => {
            try {
              const req = JSON.parse(frame.payload.toString('utf8'));
              const res = this.rpcHandler
                ? await this.rpcHandler(req)
                : { success: false, error: 'No RPC handler on client' };
              sock.write(encodeFrame(FrameType.RPC_RES, frame.reqId, res));
            } catch (err: any) {
              sock.write(
                encodeFrame(FrameType.RPC_RES, frame.reqId, {
                  success: false,
                  error: err?.message || String(err),
                }),
              );
            }
          })();
          continue;
        }

        if (frame.type === FrameType.RAW_REQ) {
          void (async () => {
            try {
              const res = this.rawHandler
                ? await this.rawHandler(frame.payload)
                : Buffer.alloc(0);
              sock.write(encodeFrame(FrameType.RAW_RES, frame.reqId, res));
            } catch {
              sock.write(
                encodeFrame(FrameType.RAW_RES, frame.reqId, Buffer.alloc(0)),
              );
            }
          })();
        }
      }
    });

    sock.on('close', () => {
      for (const [, p] of this.pending) {
        p.reject(new Error('IPC socket closed'));
      }
      this.pending.clear();
    });

    const helloId = this.nextReqId++;
    const ackPromise = new Promise<Buffer>((resolve, reject) => {
      this.pending.set(helloId, { resolve, reject });
    });

    sock.write(
      encodeFrame(FrameType.HELLO, helloId, {
        clientId: this.clientId,
        role: 'duplex',
        kind: this.kind,
        pid: this.opts.pid ?? process.pid,
        tid: this.opts.tid,
        buildId: this.opts.buildId,
        targetName: this.opts.targetName,
        metadata: this.opts.metadata,
      }),
    );

    await ackPromise;
  }

  public async invokeCallback(
    callbackId: string,
    method: string,
    args: any[] = [],
  ): Promise<any> {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('IPC client is not connected');
    }
    const reqId = this.nextReqId++;
    const p = new Promise<Buffer>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
    });
    this.socket.write(
      encodeFrame(FrameType.CALLBACK_REQ, reqId, {
        id: reqId,
        callbackId,
        method,
        args,
      }),
    );
    const buf = await p;
    const res = JSON.parse(buf.toString('utf8'));
    if (!res.success) {
      throw new Error(res.error || 'Callback failed');
    }
    return res.result;
  }

  public async sendRaw(payload: Uint8Array): Promise<Buffer> {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('IPC client is not connected');
    }
    const reqId = this.nextReqId++;
    const p = new Promise<Buffer>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
    });
    this.socket.write(encodeFrame(FrameType.RAW_REQ, reqId, payload));
    return await p;
  }

  public emitEvent(event: Record<string, any>): void {
    if (!this.socket || this.socket.destroyed) return;
    this.socket.write(encodeFrame(FrameType.EVENT, 0, event));
  }

  public close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}
