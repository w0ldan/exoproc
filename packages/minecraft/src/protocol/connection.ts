import { EventEmitter } from 'node:events';
import { Socket } from 'node:net';
import { generateOfflineUuid, PacketBuffer } from './buffer.js';
import {
  ConnectionState,
  GameMode,
  type HandshakePacket,
  type JoinGameOptions,
  type LoginStartPacket,
  type PlayerPositionOptions,
  type ServerStatusOptions,
  DEFAULT_CALIBRATION_SPAWN,
  DEFAULT_PROBE_MOBS,
} from './types.js';
import type { VersionProfile } from './versions/base.js';
import { readUtf16BeString, writeUtf16BeString } from './versions/v1_5.js';
import { getVersionProfile } from './versions/registry.js';

export { generateOfflineUuid };

export interface MinecraftConnectionEvents {
  handshake: (packet: HandshakePacket) => void;
  loginStart: (packet: LoginStartPacket) => void;
  join: () => void;
  keepAliveResponse: (id: number | bigint) => void;
  chat: (data: { username: string; message: string }) => void;
  position: (pos: {
    x: number;
    y: number;
    z: number;
    yaw?: number;
    pitch?: number;
    onGround?: boolean;
  }) => void;
  close: () => void;
  error: (err: Error) => void;
}

export class MinecraftConnection extends EventEmitter {
  public readonly socket: Socket;
  public state: ConnectionState = ConnectionState.HANDSHAKING;
  public versionProfile?: VersionProfile;
  public protocolVersion?: number;

  public username?: string;
  public uuid?: string;
  public entityId: number = 1;
  public isLegacy: boolean = false;

  public statusOptions?: ServerStatusOptions;
  private incomingBuffer: Buffer = Buffer.alloc(0);
  private keepAliveInterval?: ReturnType<typeof setInterval>;
  private lastKeepAliveId: number = 0;

  constructor(socket: Socket, statusOptions?: ServerStatusOptions) {
    super();
    this.socket = socket;
    this.statusOptions = statusOptions;

    this.socket.on('data', (data: Buffer) => this.handleData(data));
    this.socket.on('close', () => {
      this.cleanup();
      this.emit('close');
    });
    this.socket.on('error', (err: Error) => {
      this.emit('error', err);
    });
  }

  private cleanup(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = undefined;
    }
    this.state = ConnectionState.CLOSED;
  }

  public close(): void {
    this.cleanup();
    this.socket.destroy();
  }

  public setVersionProfile(profile: VersionProfile): void {
    this.versionProfile = profile;
    if (this.protocolVersion === undefined) {
      this.protocolVersion = profile.protocolVersion;
    }
  }

  public sendPacket(packetId: number, payload: Buffer): void {
    if (this.state === ConnectionState.CLOSED || this.socket.destroyed) return;
    if (this.isLegacy) {
      this.socket.write(Buffer.concat([Buffer.from([packetId]), payload]));
      return;
    }
    const framed = PacketBuffer.framePacket(packetId, payload);
    this.socket.write(framed);
  }

  public sendRaw(buffer: Buffer): void {
    if (this.state === ConnectionState.CLOSED || this.socket.destroyed) return;
    this.socket.write(buffer);
  }

  public disconnect(reason: string): void {
    if (this.versionProfile) {
      this.socket.write(this.versionProfile.createDisconnectPacket(reason));
    } else {
      // Login or Handshake disconnect
      const buf = new PacketBuffer();
      buf.writeString(JSON.stringify({ text: reason }));
      this.sendPacket(0x00, buf.toBuffer());
    }
    this.close();
  }

  public startKeepAlive(intervalMs: number = 5000): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }
    this.keepAliveInterval = setInterval(() => {
      if (this.state === ConnectionState.PLAY && this.versionProfile) {
        this.lastKeepAliveId = (this.lastKeepAliveId + 1) & 0x7fffffff;
        const packet = this.versionProfile.createKeepAlivePacket(
          this.lastKeepAliveId,
        );
        this.socket.write(packet);
      }
    }, intervalMs);
  }

  public sendLoginSuccess(uuid?: string, username?: string): void {
    if (!this.versionProfile) {
      throw new Error(
        'Cannot send LoginSuccess without an active versionProfile',
      );
    }
    if (uuid) this.uuid = uuid;
    if (username) this.username = username;

    const finalUuid =
      this.uuid ?? generateOfflineUuid(this.username ?? 'Player');
    const finalUsername = this.username ?? 'Player';
    this.uuid = finalUuid;
    this.username = finalUsername;

    const packet = this.versionProfile.createLoginSuccessPacket(
      finalUuid,
      finalUsername,
    );
    this.socket.write(packet);
    if ((this.protocolVersion ?? 0) < 764) {
      this.state = ConnectionState.PLAY;
    }
  }

  public sendFinishConfiguration(): void {
    if (this.versionProfile?.createFinishConfigurationPacket) {
      this.socket.write(this.versionProfile.createFinishConfigurationPacket());
    }
  }

  public sendJoinGame(options: JoinGameOptions = {}): void {
    if (!this.versionProfile) {
      throw new Error('Cannot send JoinGame without an active versionProfile');
    }
    options.entityId = options.entityId ?? this.entityId;
    options.gameMode = options.gameMode ?? GameMode.CREATIVE;
    const packet = this.versionProfile.createJoinGamePacket(options);
    this.socket.write(packet);
  }

  public sendPlayerPosition(options: PlayerPositionOptions): void {
    if (!this.versionProfile) {
      throw new Error(
        'Cannot send PlayerPosition without an active versionProfile',
      );
    }
    const packet = this.versionProfile.createPlayerPositionPacket(options);
    this.socket.write(packet);
  }

  public sendStatusResponse(options: ServerStatusOptions = {}): void {
    const status = {
      version: {
        name:
          options.versionName ??
          this.versionProfile?.minecraftVersion ??
          'ExoProc-MultiVersion',
        protocol: options.protocolVersion ?? this.protocolVersion ?? 47,
      },
      players: {
        max: options.maxPlayers ?? 100,
        online: options.onlinePlayers ?? 0,
        sample: [],
      },
      description: {
        text: options.description ?? 'ExoProc Analysis Lab Server',
      },
      ...(options.favicon ? { favicon: options.favicon } : {}),
    };

    const buf = new PacketBuffer();
    buf.writeString(JSON.stringify(status));
    this.sendPacket(0x00, buf.toBuffer());
  }

  public sendChatMessage(message: string, color: string = 'green'): void {
    if (
      this.state === ConnectionState.PLAY &&
      this.versionProfile?.createChatMessagePacket
    ) {
      this.socket.write(
        this.versionProfile.createChatMessagePacket(message, color),
      );
    }
  }

  public sendPong(payload: bigint | number): void {
    const buf = new PacketBuffer();
    buf.writeLong(BigInt(payload));
    this.sendPacket(0x01, buf.toBuffer());
  }

  private handleData(chunk: Buffer): void {
    this.incomingBuffer = Buffer.concat([this.incomingBuffer, chunk]);

    // Pre-1.7 legacy connection check (Handshake 0x02 or Server List Ping 0xFE)
    if (
      this.state === ConnectionState.HANDSHAKING &&
      !this.isLegacy &&
      this.incomingBuffer.length > 0
    ) {
      const firstByte = this.incomingBuffer[0];
      if (firstByte === 0x02) {
        this.isLegacy = true;
        this.protocolVersion = 61;
        this.setVersionProfile(getVersionProfile(61));
      } else if (firstByte === 0xfe) {
        // Pre-1.7 Server List Ping
        const motd =
          this.statusOptions?.description ?? '§aExoProc Analysis Lab';
        const maxPlayers = this.statusOptions?.maxPlayers ?? 60;
        const onlinePlayers = this.statusOptions?.onlinePlayers ?? 0;
        const infoStr = [
          '§1',
          '61',
          '1.5.2',
          motd,
          String(onlinePlayers),
          String(maxPlayers),
        ].join('\0');
        const strBuf = writeUtf16BeString(infoStr);
        const resp = Buffer.concat([Buffer.from([0xff]), strBuf]);
        this.socket.write(resp);
        this.close();
        return;
      }
    }

    if (this.isLegacy) {
      this.handleLegacyData();
      return;
    }

    while (this.incomingBuffer.length > 0) {
      const parsedLength = PacketBuffer.readVarIntFromBuffer(
        this.incomingBuffer,
        0,
      );
      if (!parsedLength) {
        // Incomplete length VarInt, wait for more data
        break;
      }

      const totalPacketLength = parsedLength.size + parsedLength.value;
      if (this.incomingBuffer.length < totalPacketLength) {
        // Incomplete packet payload, wait for more data
        break;
      }

      // Extract full packet buffer
      const packetData = this.incomingBuffer.subarray(
        parsedLength.size,
        totalPacketLength,
      );
      this.incomingBuffer = this.incomingBuffer.subarray(totalPacketLength);

      this.processPacket(packetData);
    }
  }

  private handleLegacyData(): void {
    while (this.incomingBuffer.length > 0) {
      const packetId = this.incomingBuffer[0]!;
      const packetSize = this.getLegacyPacketSize(
        packetId,
        this.incomingBuffer,
      );
      if (packetSize === -1 || this.incomingBuffer.length < packetSize) {
        // Incomplete packet, wait for more data
        break;
      }

      const packetData = this.incomingBuffer.subarray(0, packetSize);
      this.incomingBuffer = this.incomingBuffer.subarray(packetSize);

      this.processLegacyPacket(packetId, packetData);
    }
  }

  private getLegacyPacketSize(packetId: number, buf: Buffer): number {
    switch (packetId) {
      case 0x00: // KeepAlive: [0x00, id: i32]
        return 5;
      case 0x02: {
        // Handshake: [0x02, ver: u8, user: str, host: str, port: i32]
        if (buf.length < 2) return -1;
        const { bytesRead: uBytes } = readUtf16BeString(buf, 2);
        if (uBytes === 0) return -1;
        if (buf.length < 2 + uBytes + 2) return -1;
        const { bytesRead: hBytes } = readUtf16BeString(buf, 2 + uBytes);
        if (hBytes === 0) return -1;
        const total = 2 + uBytes + hBytes + 4;
        return buf.length >= total ? total : -1;
      }
      case 0x03: {
        // Chat: [0x03, msg: str]
        if (buf.length < 3) return -1;
        const { bytesRead } = readUtf16BeString(buf, 1);
        if (bytesRead === 0) return -1;
        const total = 1 + bytesRead;
        return buf.length >= total ? total : -1;
      }
      case 0x0a: // Flying: [0x0A, onGround: u8]
        return 2;
      case 0x0b: // PlayerPosition: [0x0B, x: f64, y: f64, stance: f64, z: f64, onGround: u8]
        return 34;
      case 0x0c: // PlayerLook: [0x0C, yaw: f32, pitch: f32, onGround: u8]
        return 10;
      case 0x0d: // PlayerLookMove: [0x0D, x: f64, y: f64, stance: f64, z: f64, yaw: f32, pitch: f32, onGround: u8]
        return 42;
      case 0x0e: // BlockDig: [0x0E, status: u8, x: i32, y: u8, z: i32, face: u8]
        return 12;
      case 0x10: // HeldItemChange: [0x10, slot: i16]
        return 3;
      case 0x12: // Animation: [0x12, entityId: i32, animate: u8]
        return 6;
      case 0x13: // EntityAction: [0x13, entityId: i32, action: u8]
        return 6;
      case 0xcd: // ClientCommand: [0xCD, payload: u8]
        return 2;
      case 0xfa: {
        // CustomPayload: [0xFA, channel: str, len: i16, data: bytes]
        if (buf.length < 3) return -1;
        const { bytesRead } = readUtf16BeString(buf, 1);
        if (bytesRead === 0) return -1;
        if (buf.length < 1 + bytesRead + 2) return -1;
        const dataLen = buf.readInt16BE(1 + bytesRead);
        const total = 1 + bytesRead + 2 + Math.max(0, dataLen);
        return buf.length >= total ? total : -1;
      }
      case 0xff: {
        // Disconnect: [0xFF, reason: str]
        if (buf.length < 3) return -1;
        const { bytesRead } = readUtf16BeString(buf, 1);
        if (bytesRead === 0) return -1;
        const total = 1 + bytesRead;
        return buf.length >= total ? total : -1;
      }
      default:
        // Skip 1 unhandled byte to avoid getting stuck
        return 1;
    }
  }

  private processLegacyPacket(packetId: number, packetData: Buffer): void {
    if (packetId === 0x02) {
      // 0x02 Handshake
      const protocolVersion = packetData[1];
      const { value: username, bytesRead: uBytes } = readUtf16BeString(
        packetData,
        2,
      );
      const { value: serverAddress, bytesRead: hBytes } = readUtf16BeString(
        packetData,
        2 + uBytes,
      );
      const serverPort = packetData.readInt32BE(2 + uBytes + hBytes);

      this.username = username;
      this.uuid = generateOfflineUuid(username);

      this.emit('handshake', {
        protocolVersion,
        serverAddress,
        serverPort,
        nextState: ConnectionState.PLAY,
      });

      this.emit('loginStart', {
        username,
        uuid: this.uuid,
      });

      // Transition to PLAY state immediately
      this.state = ConnectionState.PLAY;
      this.sendJoinGame();

      // Spawn position
      if (this.versionProfile?.createSpawnPositionPacket) {
        this.socket.write(
          this.versionProfile.createSpawnPositionPacket(
            DEFAULT_CALIBRATION_SPAWN.x,
            DEFAULT_CALIBRATION_SPAWN.y,
            DEFAULT_CALIBRATION_SPAWN.z,
          ),
        );
      }

      // Abilities (flying allowed in creative)
      if (this.versionProfile?.createPlayerAbilitiesPacket) {
        this.socket.write(
          this.versionProfile.createPlayerAbilitiesPacket(false, true, true),
        );
      }

      // Flat platform chunks (3x3 grid around calibration spawn)
      if (this.versionProfile?.createFlatChunkPacket) {
        const centerChunkX = Math.floor(DEFAULT_CALIBRATION_SPAWN.x / 16);
        const centerChunkZ = Math.floor(DEFAULT_CALIBRATION_SPAWN.z / 16);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            this.socket.write(
              this.versionProfile.createFlatChunkPacket(
                centerChunkX + dx,
                centerChunkZ + dz,
              ),
            );
          }
        }
      }

      // Position the player (closes GuiDownloadTerrain on 1.5.2 client)
      this.sendPlayerPosition(DEFAULT_CALIBRATION_SPAWN);

      // Floating probe mobs
      if (this.versionProfile?.createSpawnMobPacket) {
        for (const mob of DEFAULT_PROBE_MOBS) {
          this.socket.write(this.versionProfile.createSpawnMobPacket(mob));
        }
      }

      // Welcome message in chat
      if (this.versionProfile?.createChatMessagePacket) {
        this.socket.write(
          this.versionProfile.createChatMessagePacket(
            `§a[ExoProc Analysis Lab] §fCalibrated at §e(${DEFAULT_CALIBRATION_SPAWN.x}, ${DEFAULT_CALIBRATION_SPAWN.y}, ${DEFAULT_CALIBRATION_SPAWN.z}) §fwith §b${DEFAULT_PROBE_MOBS.length} Probe Mobs!`,
          ),
        );
      }

      this.startKeepAlive();
      this.emit('join');
    } else if (packetId === 0x00) {
      // 0x00 KeepAlive response
      const id = packetData.readInt32BE(1);
      this.emit('keepAliveResponse', id);
    } else if (packetId === 0x03) {
      // 0x03 Chat message
      const { value: message } = readUtf16BeString(packetData, 1);
      this.emit('chat', { username: this.username ?? 'Player', message });
      this.sendChatMessage(`§e[Echo] §f${message}`);
    } else if (packetId === 0x0a) {
      // 0x0A Flying
      const onGround = packetData[1] === 1;
      this.emit('position', { ...DEFAULT_CALIBRATION_SPAWN, onGround });
    } else if (packetId === 0x0b) {
      // 0x0B PlayerPosition: [0x0B, x: f64, y: f64, stance: f64, z: f64, onGround: u8]
      const x = packetData.readDoubleBE(1);
      const y = packetData.readDoubleBE(9);
      const z = packetData.readDoubleBE(25);
      const onGround = packetData[33] === 1;
      this.emit('position', { x, y, z, onGround });
    } else if (packetId === 0x0c) {
      // 0x0C PlayerLook: [0x0C, yaw: f32, pitch: f32, onGround: u8]
      const yaw = packetData.readFloatBE(1);
      const pitch = packetData.readFloatBE(5);
      const onGround = packetData[9] === 1;
      this.emit('position', {
        ...DEFAULT_CALIBRATION_SPAWN,
        yaw,
        pitch,
        onGround,
      });
    } else if (packetId === 0x0d) {
      // 0x0D PlayerLookMove: [0x0D, x: f64, y: f64, stance: f64, z: f64, yaw: f32, pitch: f32, onGround: u8]
      const x = packetData.readDoubleBE(1);
      const y = packetData.readDoubleBE(9);
      const z = packetData.readDoubleBE(25);
      const yaw = packetData.readFloatBE(33);
      const pitch = packetData.readFloatBE(37);
      const onGround = packetData[41] === 1;
      this.emit('position', { x, y, z, yaw, pitch, onGround });
    } else if (packetId === 0xfa) {
      // 0xFA PluginMessage (e.g. MC|Brand)
      try {
        const { value: channel, bytesRead } = readUtf16BeString(packetData, 1);
        if (channel === 'MC|Brand') {
          const dataLen = packetData.readInt16BE(1 + bytesRead);
          const payloadData = packetData.subarray(
            1 + bytesRead + 2,
            1 + bytesRead + 2 + dataLen,
          );
          const { value: brand } = readUtf16BeString(payloadData, 0);
          this.emit('brand', brand);
        }
      } catch {}
    } else if (packetId === 0xff) {
      // 0xFF Disconnect
      this.close();
    }
  }

  private processPacket(packetData: Buffer): void {
    const buffer = new PacketBuffer(packetData);
    const packetId = buffer.readVarInt();
    const payload = packetData.subarray(buffer.getOffset());

    this.emit('packet', packetId, payload, this.state);

    switch (this.state) {
      case ConnectionState.HANDSHAKING:
        this.handleHandshakeState(packetId, payload);
        break;
      case ConnectionState.STATUS:
        this.handleStatusState(packetId, payload);
        break;
      case ConnectionState.LOGIN:
        this.handleLoginState(packetId, payload);
        break;
      case ConnectionState.CONFIGURATION:
        this.handleConfigurationState(packetId, payload);
        break;
      case ConnectionState.PLAY:
        this.handlePlayState(packetId, payload);
        break;
      default:
        break;
    }
  }

  private handleHandshakeState(packetId: number, payload: Buffer): void {
    if (packetId === 0x00) {
      // 0x00 Handshake: VarInt protocolVersion, String serverAddress, UShort serverPort, VarInt nextState
      const buf = new PacketBuffer(payload);
      const protocolVersion = buf.readVarInt();
      const serverAddress = buf.readString();
      const serverPort = buf.readUShort();
      const nextState = buf.readVarInt() as ConnectionState;

      this.protocolVersion = protocolVersion;
      this.setVersionProfile(getVersionProfile(protocolVersion));
      this.state = nextState;

      const packet: HandshakePacket = {
        protocolVersion,
        serverAddress,
        serverPort,
        nextState,
      };

      this.emit('handshake', packet);
    }
  }

  private handleStatusState(packetId: number, _payload: Buffer): void {
    if (packetId === 0x00) {
      // 0x00 Request
      this.sendStatusResponse(this.statusOptions);
    } else if (packetId === 0x01) {
      // 0x01 Ping: Long time
      const buf = new PacketBuffer(_payload);
      const pingTime = buf.readLong();
      this.sendPong(pingTime);
    }
  }

  private handleLoginState(packetId: number, payload: Buffer): void {
    if (packetId === 0x00) {
      // 0x00 LoginStart: String username (and optional UUID in modern)
      const buf = new PacketBuffer(payload);
      const username = buf.readString();
      this.username = username;
      this.uuid = generateOfflineUuid(username);

      const packet: LoginStartPacket = {
        username,
        uuid: this.uuid,
      };

      this.emit('loginStart', packet);

      // Send LoginSuccess
      this.sendLoginSuccess(this.uuid, this.username);

      const isModernConfig = (this.protocolVersion ?? 0) >= 764;
      if (!isModernConfig) {
        // Automatically enter PLAY state for pre-1.20.2:
        this.enterPlayState();
      }
      // For modern 1.20.2+ (>= 764), client remains in LOGIN state until sending 0x03 (ServerboundLoginAcknowledgedPacket)
    } else if (packetId === 0x03) {
      // 0x03 ServerboundLoginAcknowledgedPacket (1.20.2+)
      this.state = ConnectionState.CONFIGURATION;
      if (this.versionProfile?.createSelectKnownPacksPacket) {
        if (this.versionProfile.createUpdateEnabledFeaturesPacket) {
          this.socket.write(
            this.versionProfile.createUpdateEnabledFeaturesPacket(),
          );
        }
        this.socket.write(
          this.versionProfile.createSelectKnownPacksPacket('1.20.6'),
        );
      } else {
        this.sendFinishConfiguration();
      }
    }
  }

  private handleConfigurationState(packetId: number, payload: Buffer): void {
    const ver = this.protocolVersion ?? 765;
    const is766 = ver >= 766;

    // Client Information (0x00): ignore or record
    if (packetId === 0x00) {
      return;
    }

    // Custom Payload / Brand (0x02 in Configuration state for 766+)
    const isPluginMsg = is766 ? packetId === 0x02 : packetId === 0x01;
    if (isPluginMsg) {
      try {
        const buf = new PacketBuffer(payload);
        const channel = buf.readString();
        if (channel === 'minecraft:brand' || channel === 'MC|Brand') {
          const brand = buf.readString();
          this.emit('brand', brand);
        }
      } catch {}
      return;
    }

    // ServerboundSelectKnownPacks (0x07 in 766+)
    if (is766 && packetId === 0x07) {
      if (this.versionProfile?.createRegistryDataPackets) {
        for (const regPkt of this.versionProfile.createRegistryDataPackets()) {
          this.socket.write(regPkt);
        }
      }
      this.sendFinishConfiguration();
      return;
    }

    // ServerboundFinishConfigurationPacket (0x03 in Configuration state for 766+)
    const isFinishAck = is766 ? packetId === 0x03 : packetId === 0x02;
    if (isFinishAck) {
      this.state = ConnectionState.PLAY;
      this.enterPlayState();
      return;
    }
  }

  public enterPlayState(): void {
    this.sendJoinGame();

    // Abilities (flying allowed, creative)
    if (this.versionProfile?.createPlayerAbilitiesPacket) {
      this.socket.write(
        this.versionProfile.createPlayerAbilitiesPacket(false, true, true),
      );
    }

    // Update view position (chunk center for 1.14+)
    if (this.versionProfile?.createUpdateViewPositionPacket) {
      const centerChunkX = Math.floor(DEFAULT_CALIBRATION_SPAWN.x / 16);
      const centerChunkZ = Math.floor(DEFAULT_CALIBRATION_SPAWN.z / 16);
      this.socket.write(
        this.versionProfile.createUpdateViewPositionPacket(
          centerChunkX,
          centerChunkZ,
        ),
      );
    }

    // Set default spawn position
    if (this.versionProfile?.createSpawnPositionPacket) {
      this.socket.write(
        this.versionProfile.createSpawnPositionPacket(
          DEFAULT_CALIBRATION_SPAWN.x,
          DEFAULT_CALIBRATION_SPAWN.y,
          DEFAULT_CALIBRATION_SPAWN.z,
        ),
      );
    }

    // Signal chunks load start (1.20+ game event 13)
    if (this.versionProfile?.createChunksLoadStartPacket) {
      this.socket.write(this.versionProfile.createChunksLoadStartPacket());
    }

    // Flat platform chunks (3x3 grid around calibration spawn)
    if (this.versionProfile?.createFlatChunkPacket) {
      const centerChunkX = Math.floor(DEFAULT_CALIBRATION_SPAWN.x / 16);
      const centerChunkZ = Math.floor(DEFAULT_CALIBRATION_SPAWN.z / 16);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          this.socket.write(
            this.versionProfile.createFlatChunkPacket(
              centerChunkX + dx,
              centerChunkZ + dz,
            ),
          );
        }
      }
    }

    // Position the player at special calibration coordinates
    this.sendPlayerPosition(DEFAULT_CALIBRATION_SPAWN);

    // Spawn probe entities in the air around the player
    if (this.versionProfile?.createSpawnMobPacket) {
      for (const mob of DEFAULT_PROBE_MOBS) {
        this.socket.write(this.versionProfile.createSpawnMobPacket(mob));
      }
    }

    // Welcome message in chat
    if (this.versionProfile?.createChatMessagePacket) {
      this.socket.write(
        this.versionProfile.createChatMessagePacket(
          `§a[ExoProc Analysis Lab] §fCalibrated at §e(${DEFAULT_CALIBRATION_SPAWN.x}, ${DEFAULT_CALIBRATION_SPAWN.y}, ${DEFAULT_CALIBRATION_SPAWN.z}) §fwith §b${DEFAULT_PROBE_MOBS.length} Probe Mobs!`,
        ),
      );
    }

    this.startKeepAlive();
    this.emit('join');
  }

  private handlePlayState(packetId: number, payload: Buffer): void {
    const ver = this.protocolVersion ?? 47;
    const isModern = ver >= 340;

    // KeepAlive response:
    // 1.8: 0x00
    // 1.12: 0x0c (or 0x0b)
    // 1.16: 0x10
    // 1.20: 0x12
    // 1.20.6: 0x18
    const isKeepAlive =
      ver < 340
        ? packetId === 0x00
        : ver === 340
          ? packetId === 0x0c || packetId === 0x0b
          : ver === 754
            ? packetId === 0x10
            : ver >= 766
              ? packetId === 0x18
              : packetId === 0x12;

    if (isKeepAlive && this.versionProfile) {
      try {
        const id = this.versionProfile.parseKeepAliveResponse(payload);
        this.emit('keepAliveResponse', id);
      } catch {}
    }

    // Teleport Confirm (1.9+ packet 0x00)
    if (isModern && packetId === 0x00) {
      try {
        const buf = new PacketBuffer(payload);
        const teleportId = buf.readVarInt();
        this.emit('teleportConfirm', teleportId);
      } catch {}
    }

    // Chat packet:
    // 1.8: 0x01
    // 1.12: 0x03
    // 1.16: 0x03
    // 1.20: 0x05
    // 1.20.6: 0x06
    const isChat =
      ver < 340
        ? packetId === 0x01
        : ver === 340 || ver === 754
          ? packetId === 0x03
          : ver >= 766
            ? packetId === 0x06
            : packetId === 0x05;
    if (isChat) {
      try {
        const buf = new PacketBuffer(payload);
        const msg = buf.readString();
        this.emit('chat', {
          username: this.username ?? 'Player',
          message: msg,
        });
        this.sendChatMessage(`§e[Echo] §f${msg}`);
      } catch {}
    }

    // Custom Payload / Plugin Message across all Minecraft versions:
    const candidatePluginPacketIds = [
      0x17, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x12,
    ];
    if (candidatePluginPacketIds.includes(packetId)) {
      try {
        const buf = new PacketBuffer(payload);
        const channel = buf.readString();
        if (channel === 'MC|Brand' || channel === 'minecraft:brand') {
          const brand = buf.readString();
          this.emit('brand', brand);
        }
      } catch {}
    }

    // Position packets:
    // 1.8: 0x04 (pos), 0x06 (pos & look)
    // 1.12: 0x0e (pos), 0x0f (pos & look)
    // 1.16: 0x12 (pos), 0x13 (pos & look)
    // 1.20: 0x14 (pos), 0x15 (pos & look)
    // 1.20.6: 0x1a (pos), 0x1b (pos & look)
    const isPosOnly =
      ver < 340
        ? packetId === 0x04
        : ver === 340
          ? packetId === 0x0e
          : ver === 754
            ? packetId === 0x12
            : ver >= 766
              ? packetId === 0x1a
              : packetId === 0x14;

    const isPosLook =
      ver < 340
        ? packetId === 0x06
        : ver === 340
          ? packetId === 0x0f
          : ver === 754
            ? packetId === 0x13
            : ver >= 766
              ? packetId === 0x1b
              : packetId === 0x15;

    const is17 = ver <= 5;
    if (isPosOnly) {
      try {
        const buf = new PacketBuffer(payload);
        const x = buf.readDouble();
        const y = buf.readDouble();
        if (is17) buf.readDouble(); // skip stance in 1.7
        const z = buf.readDouble();
        const onGround = buf.readBoolean();
        this.emit('position', { x, y, z, onGround });
      } catch {}
    } else if (isPosLook) {
      try {
        const buf = new PacketBuffer(payload);
        const x = buf.readDouble();
        const y = buf.readDouble();
        if (is17) buf.readDouble(); // skip stance in 1.7
        const z = buf.readDouble();
        const yaw = buf.readFloat();
        const pitch = buf.readFloat();
        const onGround = buf.readBoolean();
        this.emit('position', { x, y, z, yaw, pitch, onGround });
      } catch {}
    }
  }
}
