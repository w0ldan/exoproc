import { EventEmitter } from 'node:events';
import { createServer, Server, Socket } from 'node:net';
import { MinecraftConnection } from './connection.js';

export interface MinecraftServerOptions {
  port?: number;
  host?: string;
  maxPlayers?: number;
  motd?: string;
}

export class MinecraftServer extends EventEmitter {
  private server: Server;
  private connections: Set<MinecraftConnection> = new Set();
  public readonly options: MinecraftServerOptions;
  public port: number;
  public host: string;

  constructor(options: MinecraftServerOptions = {}) {
    super();
    this.options = {
      port: 25565,
      host: '0.0.0.0',
      maxPlayers: 100,
      motd: 'ExoProc Analysis Lab Server',
      ...options,
    };
    this.port = this.options.port ?? 25565;
    this.host = this.options.host ?? '0.0.0.0';

    this.server = createServer((socket: Socket) =>
      this.handleNewSocket(socket),
    );
    (this.server as any).on('error', (err: Error) => {
      this.emit('error', err);
    });
  }

  private handleNewSocket(socket: Socket): void {
    const client = new MinecraftConnection(socket, {
      description: this.options.motd,
      maxPlayers: this.options.maxPlayers,
    });
    this.connections.add(client);

    this.emit('connection', client);

    client.on('join', () => {
      this.emit('join', client);
    });

    client.on('close', () => {
      this.connections.delete(client);
      this.emit('quit', client);
    });

    client.on('error', (err: any) => {
      this.emit('clientError', client, err);
    });
  }

  public listen(port?: number, host?: string): Promise<void> {
    if (port) this.port = port;
    if (host) this.host = host;

    return new Promise((resolve, reject) => {
      (this.server as any).once('error', reject);
      (this.server as any).listen(this.port, this.host, () => {
        (this.server as any).removeListener('error', reject);
        this.emit('listening', this.port, this.host);
        resolve();
      });
    });
  }

  public close(): Promise<void> {
    for (const client of this.connections) {
      client.close();
    }
    this.connections.clear();

    return new Promise((resolve, reject) => {
      (this.server as any).close((err: any) => {
        if (err) reject(err);
        else {
          this.emit('close');
          resolve();
        }
      });
    });
  }

  public getOnlineCount(): number {
    return Array.from(this.connections).filter((c) => c.state === 3).length;
  }

  public getClients(): MinecraftConnection[] {
    return Array.from(this.connections);
  }

  public broadcast(packetId: number, payload: Buffer): void {
    for (const client of this.connections) {
      if (client.state === 3) {
        client.sendPacket(packetId, payload);
      }
    }
  }
}
