import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export const FRAME_HEADER_SIZE = 9;
export const DEFAULT_PIPE_PREFIX = 'exoproc';

export const FrameType = {
  HELLO: 0x01,
  HELLO_ACK: 0x02,
  RPC_REQ: 0x10,
  RPC_RES: 0x11,
  EVENT: 0x12,
  CALLBACK_REQ: 0x20,
  CALLBACK_RES: 0x21,
  RAW_REQ: 0x30,
  RAW_RES: 0x31,
  PING: 0xfe,
  PONG: 0xff,
} as const;

export type FrameTypeCode = (typeof FrameType)[keyof typeof FrameType];

export type AgentKind =
  'java-agent' | 'shellcode' | 'minhook' | 'native' | 'custom';

export type ChannelRole = 'duplex' | 's2c' | 'c2s';

export interface IpcHelloPayload {
  clientId?: string;
  role?: ChannelRole;
  kind?: AgentKind;
  pid?: number;
  tid?: number;
  buildId?: string;
  targetName?: string;
  metadata?: Record<string, any>;
}

export interface IpcClientInfo {
  clientId: string;
  kind: AgentKind;
  pid: number;
  tid?: number;
  buildId?: string;
  targetName?: string;
  metadata?: Record<string, any>;
  connectedAt: number;
}

export interface IpcClientFilter {
  clientId?: string;
  kind?: AgentKind;
  pid?: number;
  buildId?: string;
}

export interface IpcFrame {
  type: number;
  reqId: number;
  payload: Buffer;
}

export function generatePipeName(prefix = DEFAULT_PIPE_PREFIX): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36).slice(-4);
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'exoproc';
  return `${cleanPrefix}_${process.pid}_${time}_${rand}`;
}

export function toWindowsPipePath(nameOrPath: string): string {
  if (nameOrPath.startsWith('\\\\.\\pipe\\')) {
    return nameOrPath;
  }
  const clean = nameOrPath
    .replace(/^\/tmp\//, '')
    .replace(/\.sock$/, '')
    .replace(/[^a-zA-Z0-9_.-]/g, '_');
  return `\\\\.\\pipe\\${clean || 'exoproc'}`;
}

export function resolvePipeEndpoint(
  nameOrPath?: string,
  platform: NodeJS.Platform = process.platform,
): { name: string; pipePath: string } {
  const raw = nameOrPath?.trim() || process.env.EXOPROC_PIPE?.trim();

  if (!raw) {
    const name = generatePipeName();
    return {
      name,
      pipePath:
        platform === 'win32'
          ? `\\\\.\\pipe\\${name}`
          : join(tmpdir(), `${name}.sock`),
    };
  }

  if (raw.startsWith('\\\\.\\pipe\\')) {
    const name = raw.slice('\\\\.\\pipe\\'.length);
    return { name, pipePath: raw };
  }

  if (raw.startsWith('/') || raw.endsWith('.sock') || raw.includes('\\')) {
    const name = basename(raw).replace(/\.sock$/, '');
    return { name, pipePath: raw };
  }

  const sanitized = raw.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return {
    name: sanitized,
    pipePath:
      platform === 'win32'
        ? `\\\\.\\pipe\\${sanitized}`
        : join(tmpdir(), `${sanitized}.sock`),
  };
}

export function matchesClientFilter(
  client: IpcClientInfo,
  filter?: IpcClientFilter,
): boolean {
  if (!filter) return true;
  if (filter.clientId !== undefined && client.clientId !== filter.clientId) {
    return false;
  }
  if (filter.kind !== undefined && client.kind !== filter.kind) {
    return false;
  }
  if (filter.pid !== undefined && client.pid !== filter.pid) {
    return false;
  }
  if (filter.buildId !== undefined && client.buildId !== filter.buildId) {
    return false;
  }
  return true;
}

export function encodeFrame(
  type: number,
  reqId: number,
  payload?: Uint8Array | string | Record<string, any> | null,
): Buffer {
  let body: Buffer;
  if (!payload) {
    body = Buffer.alloc(0);
  } else if (Buffer.isBuffer(payload)) {
    body = payload;
  } else if (payload instanceof Uint8Array) {
    body = Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  } else if (typeof payload === 'string') {
    body = Buffer.from(payload, 'utf8');
  } else {
    body = Buffer.from(JSON.stringify(payload), 'utf8');
  }

  const out = Buffer.allocUnsafe(FRAME_HEADER_SIZE + body.length);
  out.writeUInt32LE(body.length, 0);
  out.writeUInt8(type & 0xff, 4);
  out.writeUInt32LE(reqId >>> 0, 5);
  if (body.length > 0) {
    body.copy(out, FRAME_HEADER_SIZE);
  }
  return out;
}

export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  private offset = 0;

  public push(chunk: Buffer | Uint8Array): IpcFrame[] {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (incoming.length === 0) return [];

    if (this.offset >= this.buffer.length) {
      this.buffer = incoming;
      this.offset = 0;
    } else {
      const unread = this.buffer.subarray(this.offset);
      this.buffer = Buffer.concat([unread, incoming]);
      this.offset = 0;
    }

    const frames: IpcFrame[] = [];
    while (this.buffer.length - this.offset >= FRAME_HEADER_SIZE) {
      const length = this.buffer.readUInt32LE(this.offset);
      if (this.buffer.length - this.offset < FRAME_HEADER_SIZE + length) {
        break;
      }
      const type = this.buffer.readUInt8(this.offset + 4);
      const reqId = this.buffer.readUInt32LE(this.offset + 5);
      const start = this.offset + FRAME_HEADER_SIZE;
      const payload = Buffer.from(this.buffer.subarray(start, start + length));
      this.offset = start + length;
      frames.push({ type, reqId, payload });
    }

    if (this.offset > 0 && this.offset === this.buffer.length) {
      this.buffer = Buffer.alloc(0);
      this.offset = 0;
    }

    return frames;
  }

  public reset(): void {
    this.buffer = Buffer.alloc(0);
    this.offset = 0;
  }
}
