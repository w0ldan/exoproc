import { existsSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import {
  encodeFrame,
  FrameDecoder,
  FrameType,
  matchesClientFilter,
  resolvePipeEndpoint,
  type IpcClientFilter,
  type IpcClientInfo,
  type IpcHelloPayload,
} from './protocol.js';

export interface IpcServerOptions {
  /**
   * Custom pipe name (e.g. "my_session" -> `\\.\pipe\my_session` on Windows)
   * or full pipe/socket path. If omitted, a unique per-process name is generated.
   */
  name?: string;
  /**
   * Explicit pipe/socket path override.
   */
  pipePath?: string;
  /**
   * Default RPC timeout in milliseconds (default: 15000).
   */
  timeoutMs?: number;
  /**
   * Whether to unref the underlying net.Server so an idle server does not
   * prevent short-lived CLI scripts from exiting (default: true).
   */
  unref?: boolean;
}

export interface IpcRequestOptions extends IpcClientFilter {
  timeoutMs?: number;
}

export interface IpcCallbackPayload {
  id: number;
  callbackId: string;
  method: string;
  args: any[];
}

export interface IpcCallbackResult {
  id?: number;
  success: boolean;
  result?: any;
  error?: string;
}

export type IpcCallbackHandler = (
  payload: IpcCallbackPayload,
  clientId: string,
) => IpcCallbackResult | undefined | Promise<IpcCallbackResult | undefined>;

export type IpcRawRequestHandler = (
  payload: Buffer,
  clientId: string,
  reqId: number,
) => Uint8Array | Buffer | Promise<Uint8Array | Buffer>;

export type IpcClientRpcHandler = (
  request: Record<string, any>,
  clientId: string,
  reqId: number,
) => Record<string, any> | Promise<Record<string, any>>;

export type IpcEventHandler = (event: any, clientId: string) => void;

interface ClientSession {
  info: IpcClientInfo;
  duplexSocket: net.Socket | null;
  s2cSocket: net.Socket | null;
  c2sSocket: net.Socket | null;
  ready: boolean;
}

interface PendingRpc {
  clientId: string;
  resolve: (payload: Buffer) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface ClientWaiter {
  filter?: IpcClientFilter;
  resolve: (info: IpcClientInfo) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const activeServersByPath = new Map<string, IpcServer>();
const activeServersByName = new Map<string, IpcServer>();
let sharedDefaultServer: IpcServer | null = null;

export class IpcServer {
  public readonly name: string;
  public readonly pipePath: string;
  public readonly timeoutMs: number;

  private netServer: net.Server | null = null;
  private listenPromise: Promise<string> | null = null;
  private closed = false;
  private nextReqId = 1;
  private readonly unrefServer: boolean;

  private readonly clients = new Map<string, ClientSession>();
  private readonly pendingReqs = new Map<number, PendingRpc>();
  private readonly waiters: ClientWaiter[] = [];

  private readonly callbackHandlers = new Set<IpcCallbackHandler>();
  private readonly rawRequestHandlers = new Set<IpcRawRequestHandler>();
  private readonly clientRpcHandlers = new Set<IpcClientRpcHandler>();
  private readonly eventHandlers = new Set<IpcEventHandler>();
  private readonly connectHandlers = new Set<(info: IpcClientInfo) => void>();
  private readonly disconnectHandlers = new Set<
    (info: IpcClientInfo) => void
  >();

  constructor(options: IpcServerOptions = {}) {
    const resolved = resolvePipeEndpoint(options.pipePath ?? options.name);
    this.name = resolved.name;
    this.pipePath = resolved.pipePath;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.unrefServer = options.unref ?? true;

    activeServersByPath.set(this.pipePath, this);
    activeServersByName.set(this.name, this);
  }

  public get isListening(): boolean {
    return Boolean(this.netServer?.listening) && !this.closed;
  }

  public get isClosed(): boolean {
    return this.closed;
  }

  public async listen(): Promise<string> {
    if (this.closed) {
      throw new Error(`IPC server on ${this.pipePath} is closed`);
    }
    if (this.netServer?.listening) {
      return this.pipePath;
    }
    if (this.listenPromise) {
      return await this.listenPromise;
    }

    this.listenPromise = new Promise<string>((resolve, reject) => {
      if (process.platform !== 'win32' && existsSync(this.pipePath)) {
        try {
          unlinkSync(this.pipePath);
        } catch {}
      }

      const srv = net.createServer((socket) => this.attachSocket(socket));
      if (this.unrefServer) {
        srv.unref();
      }

      const onError = (err: Error) => {
        this.listenPromise = null;
        reject(err);
      };

      srv.once('error', onError);
      srv.listen(this.pipePath, () => {
        srv.removeListener('error', onError);
        this.netServer = srv;
        resolve(this.pipePath);
      });
    });

    return await this.listenPromise;
  }

  private getWriteSocket(session: ClientSession): net.Socket | null {
    return session.s2cSocket ?? session.duplexSocket ?? null;
  }

  private selectClient(filter?: IpcClientFilter): ClientSession | null {
    if (filter?.clientId) {
      const exact = this.clients.get(filter.clientId);
      return exact && exact.ready ? exact : null;
    }

    let chosen: ClientSession | null = null;
    for (const session of this.clients.values()) {
      if (!session.ready) continue;
      if (matchesClientFilter(session.info, filter)) {
        if (!chosen || session.info.connectedAt >= chosen.info.connectedAt) {
          chosen = session;
        }
      }
    }
    return chosen;
  }

  private notifyWaiters(info: IpcClientInfo): void {
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const waiter = this.waiters[i];
      if (!waiter) continue;
      if (matchesClientFilter(info, waiter.filter)) {
        this.waiters.splice(i, 1);
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.resolve(info);
      }
    }
  }

  private cleanupSessionSocket(
    session: ClientSession,
    closedSocket: net.Socket,
  ): void {
    if (session.duplexSocket === closedSocket) session.duplexSocket = null;
    if (session.s2cSocket === closedSocket) session.s2cSocket = null;
    if (session.c2sSocket === closedSocket) session.c2sSocket = null;

    const stillActive = Boolean(
      session.duplexSocket || (session.s2cSocket && session.c2sSocket),
    );
    if (!stillActive && session.ready) {
      session.ready = false;
      this.clients.delete(session.info.clientId);

      for (const [reqId, pending] of this.pendingReqs.entries()) {
        if (pending.clientId === session.info.clientId) {
          this.pendingReqs.delete(reqId);
          if (pending.timer) clearTimeout(pending.timer);
          pending.reject(
            new Error(`IPC client ${session.info.clientId} disconnected`),
          );
        }
      }

      for (const h of this.disconnectHandlers) {
        try {
          h(session.info);
        } catch {}
      }
    }
  }

  private attachSocket(socket: net.Socket): void {
    if (this.unrefServer) {
      socket.unref();
    }

    const decoder = new FrameDecoder();
    let boundSession: ClientSession | null = null;

    socket.on('data', (chunk) => {
      let frames;
      try {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        frames = decoder.push(buf);
      } catch {
        socket.destroy();
        return;
      }

      for (const frame of frames) {
        if (frame.type === FrameType.HELLO) {
          let hello: IpcHelloPayload = {};
          try {
            hello = JSON.parse(frame.payload.toString('utf8'));
          } catch {}

          const clientId =
            hello.clientId ||
            `client_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const role = hello.role ?? 'duplex';

          let session = this.clients.get(clientId);
          if (!session) {
            session = {
              info: {
                clientId,
                kind: hello.kind ?? 'custom',
                pid: Number(hello.pid ?? 0),
                tid: hello.tid !== undefined ? Number(hello.tid) : undefined,
                buildId: hello.buildId,
                targetName: hello.targetName,
                metadata: hello.metadata,
                connectedAt: Date.now(),
              },
              duplexSocket: null,
              s2cSocket: null,
              c2sSocket: null,
              ready: false,
            };
            this.clients.set(clientId, session);
          } else {
            if (hello.buildId) session.info.buildId = hello.buildId;
            if (hello.pid) session.info.pid = Number(hello.pid);
            if (hello.targetName) session.info.targetName = hello.targetName;
            if (hello.kind) session.info.kind = hello.kind;
            if (hello.metadata) session.info.metadata = hello.metadata;
          }

          boundSession = session;
          if (role === 's2c') session.s2cSocket = socket;
          else if (role === 'c2s') session.c2sSocket = socket;
          else session.duplexSocket = socket;

          socket.write(
            encodeFrame(FrameType.HELLO_ACK, frame.reqId, {
              ok: true,
              clientId,
            }),
          );

          const nowReady = Boolean(
            session.duplexSocket || (session.s2cSocket && session.c2sSocket),
          );
          if (nowReady && !session.ready) {
            session.ready = true;
            session.info.connectedAt = Date.now();
            for (const h of this.connectHandlers) {
              try {
                h(session.info);
              } catch {}
            }
            this.notifyWaiters(session.info);
          }
          continue;
        }

        if (!boundSession) {
          const anonId = `anon_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          boundSession = {
            info: {
              clientId: anonId,
              kind: frame.type === FrameType.RAW_REQ ? 'shellcode' : 'custom',
              pid: 0,
              connectedAt: Date.now(),
            },
            duplexSocket: socket,
            s2cSocket: null,
            c2sSocket: null,
            ready: true,
          };
          this.clients.set(anonId, boundSession);
          for (const h of this.connectHandlers) {
            try {
              h(boundSession.info);
            } catch {}
          }
          this.notifyWaiters(boundSession.info);
        }

        const activeSession = boundSession;

        if (frame.type === FrameType.PING) {
          const outSock = this.getWriteSocket(activeSession) ?? socket;
          outSock.write(
            encodeFrame(FrameType.PONG, frame.reqId, frame.payload),
          );
          continue;
        }

        if (
          frame.type === FrameType.RPC_RES ||
          frame.type === FrameType.RAW_RES ||
          frame.type === FrameType.PONG
        ) {
          const pending = this.pendingReqs.get(frame.reqId);
          if (pending) {
            this.pendingReqs.delete(frame.reqId);
            if (pending.timer) clearTimeout(pending.timer);
            pending.resolve(frame.payload);
          }
          continue;
        }

        if (frame.type === FrameType.CALLBACK_REQ) {
          void this.dispatchCallbackFrame(
            activeSession,
            socket,
            frame.reqId,
            frame.payload,
          );
          continue;
        }

        if (frame.type === FrameType.RAW_REQ) {
          void this.dispatchRawFrame(
            activeSession,
            socket,
            frame.reqId,
            frame.payload,
          );
          continue;
        }

        if (frame.type === FrameType.RPC_REQ) {
          void this.dispatchClientRpcFrame(
            activeSession,
            socket,
            frame.reqId,
            frame.payload,
          );
          continue;
        }

        if (frame.type === FrameType.EVENT) {
          let parsed: any = frame.payload;
          try {
            parsed = JSON.parse(frame.payload.toString('utf8'));
          } catch {}
          for (const h of this.eventHandlers) {
            try {
              h(parsed, activeSession.info.clientId);
            } catch {}
          }
        }
      }
    });

    socket.on('close', () => {
      if (boundSession) {
        this.cleanupSessionSocket(boundSession, socket);
      }
    });

    socket.on('error', () => {
      if (boundSession) {
        this.cleanupSessionSocket(boundSession, socket);
      }
    });
  }

  private async dispatchCallbackFrame(
    session: ClientSession,
    fallbackSocket: net.Socket,
    reqId: number,
    payload: Buffer,
  ): Promise<void> {
    const outSock = this.getWriteSocket(session) ?? fallbackSocket;
    let parsed: IpcCallbackPayload;
    try {
      parsed = JSON.parse(payload.toString('utf8'));
    } catch (err: any) {
      if (!outSock.destroyed) {
        outSock.write(
          encodeFrame(FrameType.CALLBACK_RES, reqId, {
            id: 0,
            success: false,
            error: err?.message || 'Invalid callback JSON',
          }),
        );
      }
      return;
    }

    let outcome: IpcCallbackResult = {
      id: parsed.id,
      success: false,
      error: `No callback handler registered for ${parsed.callbackId}`,
    };

    for (const handler of this.callbackHandlers) {
      try {
        const res = await handler(parsed, session.info.clientId);
        if (res === undefined) continue;
        outcome = res;
        break;
      } catch (err: any) {
        outcome = {
          id: parsed.id,
          success: false,
          error: err?.message || String(err),
        };
        break;
      }
    }

    if (!outSock.destroyed) {
      outSock.write(
        encodeFrame(FrameType.CALLBACK_RES, reqId, {
          id: outcome.id ?? parsed.id,
          success: outcome.success,
          result: outcome.result ?? null,
          error: outcome.error,
        }),
      );
    }
  }

  private async dispatchRawFrame(
    session: ClientSession,
    fallbackSocket: net.Socket,
    reqId: number,
    payload: Buffer,
  ): Promise<void> {
    const outSock = this.getWriteSocket(session) ?? fallbackSocket;
    let responseBytes: Uint8Array | Buffer = Buffer.alloc(0);

    for (const handler of this.rawRequestHandlers) {
      try {
        responseBytes = await handler(payload, session.info.clientId, reqId);
        break;
      } catch {
        responseBytes = Buffer.alloc(0);
        break;
      }
    }

    if (!outSock.destroyed) {
      outSock.write(encodeFrame(FrameType.RAW_RES, reqId, responseBytes));
    }
  }

  private async dispatchClientRpcFrame(
    session: ClientSession,
    fallbackSocket: net.Socket,
    reqId: number,
    payload: Buffer,
  ): Promise<void> {
    const outSock = this.getWriteSocket(session) ?? fallbackSocket;
    let reqObj: Record<string, any> = {};
    try {
      reqObj = JSON.parse(payload.toString('utf8'));
    } catch {}

    let resObj: Record<string, any> = {
      success: false,
      error: 'No client RPC handler registered',
    };

    for (const handler of this.clientRpcHandlers) {
      try {
        resObj = await handler(reqObj, session.info.clientId, reqId);
        break;
      } catch (err: any) {
        resObj = { success: false, error: err?.message || String(err) };
        break;
      }
    }

    if (!outSock.destroyed) {
      outSock.write(encodeFrame(FrameType.RPC_RES, reqId, resObj));
    }
  }

  public getClients(filter?: IpcClientFilter): IpcClientInfo[] {
    const result: IpcClientInfo[] = [];
    for (const session of this.clients.values()) {
      if (session.ready && matchesClientFilter(session.info, filter)) {
        result.push(session.info);
      }
    }
    return result;
  }

  public async waitForClient(
    filter?: IpcClientFilter,
    timeoutMs = 10000,
  ): Promise<IpcClientInfo> {
    await this.listen();
    const existing = this.selectClient(filter);
    if (existing) {
      return existing.info;
    }

    return await new Promise<IpcClientInfo>((resolve, reject) => {
      const waiter: ClientWaiter = {
        filter,
        resolve,
        reject,
        timer: null,
      };
      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          const idx = this.waiters.indexOf(waiter);
          if (idx !== -1) this.waiters.splice(idx, 1);
          reject(
            new Error(
              `Timed out waiting for IPC agent connection on ${this.pipePath} after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
        waiter.timer.unref?.();
      }
      this.waiters.push(waiter);
    });
  }

  private sendClientFrame(
    frameType: number,
    payload: Uint8Array | Buffer | Record<string, any>,
    options: IpcRequestOptions = {},
  ): Promise<Buffer> {
    const session = this.selectClient(options);
    if (!session) {
      return Promise.reject(
        new Error(`No connected IPC agent found on pipe ${this.pipePath}`),
      );
    }

    const outSock = this.getWriteSocket(session);
    if (!outSock || outSock.destroyed) {
      return Promise.reject(
        new Error(
          `IPC write channel is closed for client ${session.info.clientId}`,
        ),
      );
    }

    const reqId = this.nextReqId++;
    if (this.nextReqId > 0x7fffffff) {
      this.nextReqId = 1;
    }

    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    return new Promise<Buffer>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              if (!this.pendingReqs.has(reqId)) return;
              this.pendingReqs.delete(reqId);
              reject(
                new Error(
                  `IPC request timed out after ${timeoutMs}ms on ${this.pipePath}`,
                ),
              );
            }, timeoutMs)
          : null;
      timer?.unref?.();

      this.pendingReqs.set(reqId, {
        clientId: session.info.clientId,
        resolve,
        reject,
        timer,
      });

      outSock.write(encodeFrame(frameType, reqId, payload));
    });
  }

  public async request<T = any>(
    action: string,
    params: Record<string, any> = {},
    options: IpcRequestOptions = {},
  ): Promise<T> {
    await this.listen();
    const resBuf = await this.sendClientFrame(
      FrameType.RPC_REQ,
      { ...params, action },
      options,
    );
    return JSON.parse(resBuf.toString('utf8')) as T;
  }

  public async requestRaw(
    payload: Uint8Array | Buffer,
    options: IpcRequestOptions = {},
  ): Promise<Buffer> {
    await this.listen();
    return await this.sendClientFrame(FrameType.RAW_REQ, payload, options);
  }

  public async ping(options: IpcRequestOptions = {}): Promise<boolean> {
    try {
      await this.listen();
      await this.sendClientFrame(FrameType.PING, Buffer.alloc(0), {
        ...options,
        timeoutMs: options.timeoutMs ?? 1500,
      });
      return true;
    } catch {
      return false;
    }
  }

  public onCallback(handler: IpcCallbackHandler): () => void {
    this.callbackHandlers.add(handler);
    return () => this.callbackHandlers.delete(handler);
  }

  public onRawRequest(handler: IpcRawRequestHandler): () => void {
    this.rawRequestHandlers.add(handler);
    return () => this.rawRequestHandlers.delete(handler);
  }

  public onClientRpc(handler: IpcClientRpcHandler): () => void {
    this.clientRpcHandlers.add(handler);
    return () => this.clientRpcHandlers.delete(handler);
  }

  public onEvent(handler: IpcEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  public onClientConnect(handler: (info: IpcClientInfo) => void): () => void {
    this.connectHandlers.add(handler);
    return () => this.connectHandlers.delete(handler);
  }

  public onClientDisconnect(
    handler: (info: IpcClientInfo) => void,
  ): () => void {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.listenPromise = null;

    activeServersByPath.delete(this.pipePath);
    activeServersByName.delete(this.name);
    if (sharedDefaultServer === this) {
      sharedDefaultServer = null;
    }

    for (const waiter of this.waiters.splice(0)) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(new Error(`IPC server on ${this.pipePath} closed`));
    }

    for (const [, pending] of this.pendingReqs) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new Error(`IPC server on ${this.pipePath} closed`));
    }
    this.pendingReqs.clear();

    for (const session of this.clients.values()) {
      session.ready = false;
      session.duplexSocket?.destroy();
      session.s2cSocket?.destroy();
      session.c2sSocket?.destroy();
    }
    this.clients.clear();

    if (this.netServer) {
      const srv = this.netServer;
      this.netServer = null;
      await new Promise<void>((resolve) => {
        srv.close(() => resolve());
      });
    }

    if (process.platform !== 'win32' && existsSync(this.pipePath)) {
      try {
        unlinkSync(this.pipePath);
      } catch {}
    }
  }
}

export function createIpcServer(options?: IpcServerOptions): IpcServer {
  return new IpcServer(options);
}

export function findIpcServer(nameOrPath?: string): IpcServer | undefined {
  if (!nameOrPath) return sharedDefaultServer ?? undefined;
  const direct =
    activeServersByPath.get(nameOrPath) ?? activeServersByName.get(nameOrPath);
  if (direct && !direct.isClosed) return direct;
  const resolved = resolvePipeEndpoint(nameOrPath);
  const byResolved =
    activeServersByPath.get(resolved.pipePath) ??
    activeServersByName.get(resolved.name);
  return byResolved && !byResolved.isClosed ? byResolved : undefined;
}

export function getOrCreateIpcServer(options?: IpcServerOptions): IpcServer {
  const key = options?.pipePath ?? options?.name;
  if (key) {
    const existing = findIpcServer(key);
    if (existing) return existing;
    return new IpcServer(options);
  }
  return getSharedIpcServer(options);
}

export function getSharedIpcServer(options?: IpcServerOptions): IpcServer {
  if (sharedDefaultServer && !sharedDefaultServer.isClosed) {
    return sharedDefaultServer;
  }
  sharedDefaultServer = new IpcServer(options);
  return sharedDefaultServer;
}

export async function closeAllIpcServers(): Promise<void> {
  const servers = Array.from(activeServersByPath.values());
  for (const s of servers) {
    await s.close();
  }
}
