import { describe, expect, it } from 'bun:test';
import { Socket } from 'node:net';
import {
  ConnectionState,
  Difficulty,
  Dimension,
  GameMode,
  generateOfflineUuid,
  getProtocolVersionName,
  getVersionProfile,
  MinecraftConnection,
  MinecraftServer,
  PacketBuffer,
  readUtf16BeString,
  writeUtf16BeString,
  VersionProfile1_5,
  VersionProfile1_7,
  VersionProfile1_8,
  VersionProfile1_12,
  VersionProfile1_16,
  VersionProfile1_20,
  VersionProfile1_20_5,
  writeNbt,
} from '../../packages/minecraft/src/protocol/index.js';

describe('PacketBuffer Primitives', () => {
  it('should encode and decode VarInts correctly', () => {
    const testCases = [
      0, 1, 2, 127, 128, 255, 256, 2097151, 2097152, 2147483647, -1,
      -2147483648,
    ];
    for (const val of testCases) {
      const buf = new PacketBuffer();
      buf.writeVarInt(val);
      const readBuf = new PacketBuffer(buf.toBuffer());
      expect(readBuf.readVarInt()).toBe(val);
    }
  });

  it('should detect partial VarInts in streaming buffers', () => {
    const buf = new PacketBuffer();
    buf.writeVarInt(2097152); // multi-byte
    const raw = buf.toBuffer();

    // Partial chunk (1 byte only)
    const partial = raw.subarray(0, 1);
    expect(PacketBuffer.readVarIntFromBuffer(partial, 0)).toBeNull();

    // Full chunk
    const full = PacketBuffer.readVarIntFromBuffer(raw, 0);
    expect(full).not.toBeNull();
    expect(full?.value).toBe(2097152);
  });

  it('should encode and decode VarLongs correctly', () => {
    const testCases = [
      0n,
      1n,
      127n,
      128n,
      2147483647n,
      9223372036854775807n,
      -1n,
      -9223372036854775808n,
    ];
    for (const val of testCases) {
      const buf = new PacketBuffer();
      buf.writeVarLong(val);
      const readBuf = new PacketBuffer(buf.toBuffer());
      expect(readBuf.readVarLong()).toBe(val);
    }
  });

  it('should encode and decode UTF-8 Strings with length prefix', () => {
    const strings = [
      'Hello Minecraft',
      'Çiçekler ve Dünya',
      '🚀 Bun & ExoProc ⚡',
      '',
    ];
    for (const str of strings) {
      const buf = new PacketBuffer();
      buf.writeString(str);
      const readBuf = new PacketBuffer(buf.toBuffer());
      expect(readBuf.readString()).toBe(str);
    }
  });

  it('should encode and decode UUIDs', () => {
    const original = 'c0ffee00-1122-3344-5566-778899aabbcc';
    const buf = new PacketBuffer();
    buf.writeUUID(original);
    const readBuf = new PacketBuffer(buf.toBuffer());
    expect(readBuf.readUUID()).toBe(original);
  });

  it('should encode and decode packed 1.8 positions', () => {
    const buf = new PacketBuffer();
    buf.writePosition18(100, 64, -200);
    const raw = buf.toBuffer();
    expect(raw.length).toBe(8);
  });
});

describe('NBT Encoder', () => {
  it('should serialize compound and primitives', () => {
    const nbt = writeNbt({
      type: 'compound',
      value: {
        health: { type: 'float', value: 20.0 },
        score: { type: 'int', value: 1337 },
        name: { type: 'string', value: 'Steve' },
      },
    });

    expect(nbt.length).toBeGreaterThan(10);
    expect(nbt[0]).toBe(10); // TAG_Compound
  });
});

describe('Multi-Version Profiles & Registry', () => {
  it('should resolve exact profiles for known protocol versions', () => {
    expect(getVersionProfile(5)).toBeInstanceOf(VersionProfile1_7);
    expect(getVersionProfile(47)).toBeInstanceOf(VersionProfile1_8);
    expect(getVersionProfile(340)).toBeInstanceOf(VersionProfile1_12);
    expect(getVersionProfile(754)).toBeInstanceOf(VersionProfile1_16);
    expect(getVersionProfile(765)).toBeInstanceOf(VersionProfile1_20);
  });

  it('should map protocol numbers to exact version names and ranges', () => {
    expect(getProtocolVersionName(61)).toBe('1.5.2');
    expect(getProtocolVersionName(60)).toBe('1.5 - 1.5.1');
    expect(getProtocolVersionName(4)).toBe('1.7.2 - 1.7.5');
    expect(getProtocolVersionName(5)).toBe('1.7.6 - 1.7.10');
    expect(getProtocolVersionName(47)).toBe('1.8 - 1.8.9');
    expect(getProtocolVersionName(110)).toBe('1.9.3 - 1.9.4');
    expect(getProtocolVersionName(340)).toBe('1.12.2');
    expect(getProtocolVersionName(754)).toBe('1.16.4 - 1.16.5');
    expect(getProtocolVersionName(763)).toBe('1.20 - 1.20.1');
    expect(getProtocolVersionName(765)).toBe('1.20.3 - 1.20.4');
    expect(getProtocolVersionName(767)).toBe('1.21 - 1.21.1');
    expect(getProtocolVersionName(999)).toBe('1.21.x+');
  });

  it('should fallback to closest compatible era profile for non-exact versions', () => {
    // 1.7 era
    expect(getVersionProfile(4)).toBeInstanceOf(VersionProfile1_7);
    // 1.8 era
    expect(getVersionProfile(46)).toBeInstanceOf(VersionProfile1_8);
    // 1.9 era
    expect(getVersionProfile(110)).toBeInstanceOf(VersionProfile1_12);
    // 1.15 era
    expect(getVersionProfile(578)).toBeInstanceOf(VersionProfile1_16);
    // 1.20 era
    expect(getVersionProfile(764)).toBeInstanceOf(VersionProfile1_20);
    // 1.21+ era
    expect(getVersionProfile(999)).toBeInstanceOf(VersionProfile1_20_5);
  });

  it('should produce valid 1.8.9 JoinGame packet', () => {
    const profile = new VersionProfile1_8();
    const packet = profile.createJoinGamePacket({
      entityId: 42,
      gameMode: GameMode.SURVIVAL,
      dimension: Dimension.OVERWORLD,
      difficulty: Difficulty.NORMAL,
      maxPlayers: 20,
    });

    // Strip framing to check payload
    const buf = new PacketBuffer(packet);
    const len = buf.readVarInt();
    const id = buf.readVarInt();
    expect(id).toBe(0x01); // 1.8 JoinGame packet ID
    expect(buf.readInt()).toBe(42);
    expect(buf.readUByte()).toBe(GameMode.SURVIVAL);
    expect(buf.readByte()).toBe(Dimension.OVERWORLD);
  });

  it('should produce valid 1.16.5 JoinGame packet with NBT codec', () => {
    const profile = new VersionProfile1_16();
    const packet = profile.createJoinGamePacket({
      entityId: 99,
      gameMode: GameMode.CREATIVE,
    });

    const buf = new PacketBuffer(packet);
    const len = buf.readVarInt();
    const id = buf.readVarInt();
    expect(id).toBe(0x24); // 1.16.2-1.16.5 JoinGame packet ID
    expect(buf.readInt()).toBe(99);
  });
});

describe('End-to-End MinecraftServer Multi-Version Connection', () => {
  it('should accept 1.8.9 client, negotiate handshake, and send world-join packets', async () => {
    const server = new MinecraftServer({ port: 0 }); // ephemeral port
    await server.listen();
    const serverPort = (server as any).server.address().port;

    let handshakeReceived = false;
    let loginReceived = false;
    let clientJoined = false;

    server.on('connection', (client) => {
      client.on('handshake', (pkt: any) => {
        expect(pkt.protocolVersion).toBe(47);
        expect(pkt.nextState).toBe(ConnectionState.LOGIN);
        handshakeReceived = true;
      });

      client.on('loginStart', (pkt: any) => {
        expect(pkt.username).toBe('Tester18');
        loginReceived = true;
      });

      client.on('join', () => {
        clientJoined = true;
      });
    });

    // Connect mock client
    const socket = new Socket();
    await new Promise<void>((resolve) =>
      socket.connect(serverPort, '127.0.0.1', resolve),
    );

    // Send 1.8 Handshake: VarInt(47), String("localhost"), UShort(25565), VarInt(2 = Login)
    const hsBuf = new PacketBuffer();
    hsBuf.writeVarInt(47);
    hsBuf.writeString('127.0.0.1');
    hsBuf.writeUShort(serverPort);
    hsBuf.writeVarInt(2);
    socket.write(PacketBuffer.framePacket(0x00, hsBuf.toBuffer()));

    // Send 1.8 LoginStart: String("Tester18")
    const lsBuf = new PacketBuffer();
    lsBuf.writeString('Tester18');
    socket.write(PacketBuffer.framePacket(0x00, lsBuf.toBuffer()));

    // Receive packets from server
    const receivedPacketIds: number[] = [];
    await new Promise<void>((resolve) => {
      let incoming = Buffer.alloc(0);
      socket.on('data', (data) => {
        incoming = Buffer.concat([incoming, Buffer.from(data)]);
        while (incoming.length > 0) {
          const parsed = PacketBuffer.readVarIntFromBuffer(incoming, 0);
          if (!parsed) break;
          const total = parsed.size + parsed.value;
          if (incoming.length < total) break;

          const packetData = incoming.subarray(parsed.size, total);
          incoming = incoming.subarray(total);

          const pBuf = new PacketBuffer(packetData);
          const pId = pBuf.readVarInt();
          receivedPacketIds.push(pId);

          // We expect LoginSuccess (0x02), JoinGame (0x01), PlayerPosition (0x08)
          if (receivedPacketIds.length >= 3) {
            resolve();
          }
        }
      });
    });

    socket.destroy();
    await server.close();

    expect(handshakeReceived).toBe(true);
    expect(loginReceived).toBe(true);
    expect(clientJoined).toBe(true);
    expect(receivedPacketIds).toContain(0x02); // LoginSuccess
    expect(receivedPacketIds).toContain(0x01); // 1.8 JoinGame
    expect(receivedPacketIds).toContain(0x08); // 1.8 PlayerPositionAndLook
  });

  it('should adapt dynamically to 1.16.5 client handshake on the same server', async () => {
    const server = new MinecraftServer({ port: 0 });
    await server.listen();
    const serverPort = (server as any).server.address().port;

    server.on('connection', (client) => {
      client.on('handshake', (pkt: any) => {
        expect(pkt.protocolVersion).toBe(754);
      });
    });

    const socket = new Socket();
    await new Promise<void>((resolve) =>
      socket.connect(serverPort, '127.0.0.1', resolve),
    );

    // Send 1.16.5 Handshake (protocol 754)
    const hsBuf = new PacketBuffer();
    hsBuf.writeVarInt(754);
    hsBuf.writeString('127.0.0.1');
    hsBuf.writeUShort(serverPort);
    hsBuf.writeVarInt(2);
    socket.write(PacketBuffer.framePacket(0x00, hsBuf.toBuffer()));

    // Send LoginStart
    const lsBuf = new PacketBuffer();
    lsBuf.writeString('ModernTester');
    socket.write(PacketBuffer.framePacket(0x00, lsBuf.toBuffer()));

    const receivedPacketIds: number[] = [];
    await new Promise<void>((resolve) => {
      let incoming = Buffer.alloc(0);
      socket.on('data', (data) => {
        incoming = Buffer.concat([incoming, Buffer.from(data)]);
        while (incoming.length > 0) {
          const parsed = PacketBuffer.readVarIntFromBuffer(incoming, 0);
          if (!parsed) break;
          const total = parsed.size + parsed.value;
          if (incoming.length < total) break;

          const packetData = incoming.subarray(parsed.size, total);
          incoming = incoming.subarray(total);

          const pBuf = new PacketBuffer(packetData);
          const pId = pBuf.readVarInt();
          receivedPacketIds.push(pId);

          if (receivedPacketIds.includes(0x34)) {
            resolve();
          }
        }
      });
    });

    socket.destroy();
    await server.close();

    // 1.16.5 packets:
    expect(receivedPacketIds).toContain(0x02); // LoginSuccess
    expect(receivedPacketIds).toContain(0x24); // 1.16 JoinGame (0x24)
    expect(receivedPacketIds).toContain(0x34); // 1.16 PlayerPositionAndLook (0x34)
  });

  it('should respond to Server List Ping (Status state)', async () => {
    const server = new MinecraftServer({
      port: 0,
      motd: 'Custom Multi-Version Test MOTD',
    });
    await server.listen();
    const serverPort = (server as any).server.address().port;

    const socket = new Socket();
    await new Promise<void>((resolve) =>
      socket.connect(serverPort, '127.0.0.1', resolve),
    );

    // Send Handshake with nextState = 1 (STATUS)
    const hsBuf = new PacketBuffer();
    hsBuf.writeVarInt(47);
    hsBuf.writeString('127.0.0.1');
    hsBuf.writeUShort(serverPort);
    hsBuf.writeVarInt(1); // Status
    socket.write(PacketBuffer.framePacket(0x00, hsBuf.toBuffer()));

    // Send Status Request (packet 0x00, empty payload)
    socket.write(PacketBuffer.framePacket(0x00, Buffer.alloc(0)));

    let statusJson: any = null;
    await new Promise<void>((resolve) => {
      let incoming = Buffer.alloc(0);
      socket.on('data', (data) => {
        incoming = Buffer.concat([incoming, Buffer.from(data)]);
        const parsed = PacketBuffer.readVarIntFromBuffer(incoming, 0);
        if (parsed) {
          const total = parsed.size + parsed.value;
          if (incoming.length >= total) {
            const packetData = incoming.subarray(parsed.size, total);
            const pBuf = new PacketBuffer(packetData);
            const pId = pBuf.readVarInt();
            if (pId === 0x00) {
              const str = pBuf.readString();
              statusJson = JSON.parse(str);
              resolve();
            }
          }
        }
      });
    });

    socket.destroy();
    await server.close();

    expect(statusJson).not.toBeNull();
    expect(statusJson.version.protocol).toBe(47);
    expect(statusJson.description.text).toBe('Custom Multi-Version Test MOTD');
  });

  it('should generate valid 1.16.5 chunk (0x20) and update_light (0x23) packets', () => {
    const profile = new VersionProfile1_16();
    expect(profile.createFlatChunkPacket).toBeDefined();

    const chunkData = profile.createFlatChunkPacket!(0, 0);
    expect(chunkData.length).toBeGreaterThan(10000);

    // Parse packets from buffer
    const p1Length = PacketBuffer.readVarIntFromBuffer(chunkData, 0);
    expect(p1Length).not.toBeNull();
    const p1Id = new PacketBuffer(
      chunkData.subarray(p1Length!.size, p1Length!.size + p1Length!.value),
    ).readVarInt();
    expect(p1Id).toBe(0x20); // map_chunk

    const offset2 = p1Length!.size + p1Length!.value;
    const p2Length = PacketBuffer.readVarIntFromBuffer(chunkData, offset2);
    expect(p2Length).not.toBeNull();
    const p2Id = new PacketBuffer(
      chunkData.subarray(
        offset2 + p2Length!.size,
        offset2 + p2Length!.size + p2Length!.value,
      ),
    ).readVarInt();
    expect(p2Id).toBe(0x23); // update_light
  });

  it('should generate valid 1.16.5 update_view_position and probe mob spawn packets', () => {
    const profile = new VersionProfile1_16();
    expect(profile.createUpdateViewPositionPacket).toBeDefined();

    const uvp = profile.createUpdateViewPositionPacket!(83, 48);
    const uvpLen = PacketBuffer.readVarIntFromBuffer(uvp, 0);
    const uvpId = new PacketBuffer(uvp.subarray(uvpLen!.size)).readVarInt();
    expect(uvpId).toBe(0x40);

    const mobPkt = profile.createSpawnMobPacket!({
      entityId: 101,
      type: 54, // Zombie
      x: 1337.5,
      y: 8.0,
      z: 771.5,
      yaw: 0,
      pitch: 0,
      health: 18.5,
      name: 'Probe-Zombie',
    });

    // 1.16 mob packet contains spawn_entity_living (0x02) and entity_metadata (0x44)
    const m1Len = PacketBuffer.readVarIntFromBuffer(mobPkt, 0);
    const m1Id = new PacketBuffer(
      mobPkt.subarray(m1Len!.size, m1Len!.size + m1Len!.value),
    ).readVarInt();
    expect(m1Id).toBe(0x02);

    const offsetM2 = m1Len!.size + m1Len!.value;
    const m2Len = PacketBuffer.readVarIntFromBuffer(mobPkt, offsetM2);
    const m2Id = new PacketBuffer(
      mobPkt.subarray(offsetM2 + m2Len!.size),
    ).readVarInt();
    expect(m2Id).toBe(0x44);
  });

  it('should adapt dynamically to 1.20.1 client and send 0x28 login, chunk with light, and position packets', async () => {
    const server = new MinecraftServer({ port: 0 });
    await server.listen();
    const serverPort = (server as any).server.address().port;

    const socket = new Socket();
    await new Promise<void>((resolve) =>
      socket.connect(serverPort, '127.0.0.1', resolve),
    );

    // Send 1.20.1 Handshake (protocol 763)
    const hsBuf = new PacketBuffer();
    hsBuf.writeVarInt(763);
    hsBuf.writeString('127.0.0.1');
    hsBuf.writeUShort(serverPort);
    hsBuf.writeVarInt(2); // NextState = LOGIN
    socket.write(PacketBuffer.framePacket(0x00, hsBuf.toBuffer()));

    // Send LoginStart
    const lsBuf = new PacketBuffer();
    lsBuf.writeString('Woldann');
    lsBuf.writeUUID('354605a4-f4b9-3ef6-9804-eec0fc9b9b25');
    socket.write(PacketBuffer.framePacket(0x00, lsBuf.toBuffer()));

    const receivedPacketIds: number[] = [];
    await new Promise<void>((resolve) => {
      let incoming = Buffer.alloc(0);
      socket.on('data', (data) => {
        incoming = Buffer.concat([incoming, Buffer.from(data)]);
        while (incoming.length > 0) {
          const parsed = PacketBuffer.readVarIntFromBuffer(incoming, 0);
          if (!parsed) break;
          const total = parsed.size + parsed.value;
          if (incoming.length < total) break;

          const packetData = incoming.subarray(parsed.size, total);
          incoming = incoming.subarray(total);

          const pBuf = new PacketBuffer(packetData);
          const pId = pBuf.readVarInt();
          receivedPacketIds.push(pId);

          // In 1.20.1, PlayerPositionAndLook is 0x3c
          if (receivedPacketIds.includes(0x3c)) {
            resolve();
          }
        }
      });
    });

    socket.destroy();
    await server.close();

    // 1.20.1 packets:
    expect(receivedPacketIds).toContain(0x02); // LoginSuccess
    expect(receivedPacketIds).toContain(0x28); // 1.20 Login (0x28)
    expect(receivedPacketIds).toContain(0x6b); // FeatureFlags (0x6b)
    expect(receivedPacketIds).toContain(0x34); // Abilities (0x34)
    expect(receivedPacketIds).toContain(0x4e); // UpdateViewPosition (0x4e)
    expect(receivedPacketIds).toContain(0x50); // SpawnPosition (0x50)
    expect(receivedPacketIds).toContain(0x1f); // GameStateChange - LevelChunksLoadStart (0x1f)
    expect(receivedPacketIds).toContain(0x24); // MapChunk with light (0x24)
    expect(receivedPacketIds).toContain(0x3c); // PlayerPosition (0x3c)
  });

  it('should adapt dynamically to 1.20.6 client (protocol 766), negotiate CONFIGURATION state, and transition smoothly to PLAY state with 0x2B JoinGame, 0x27 Chunks, and brand detection', async () => {
    const server = new MinecraftServer({ port: 0 });
    let detectedBrand = '';
    server.on('connection', (c) => {
      c.on('brand', (b: string) => {
        detectedBrand = b;
      });
    });
    await server.listen();
    const serverPort = (server as any).server.address().port;

    const socket = new Socket();
    await new Promise<void>((resolve) =>
      socket.connect(serverPort, '127.0.0.1', resolve),
    );

    // Send 1.20.6 Handshake (protocol 766, nextState 2 = LOGIN)
    const hsBuf = new PacketBuffer();
    hsBuf.writeVarInt(766);
    hsBuf.writeString('127.0.0.1');
    hsBuf.writeUShort(serverPort);
    hsBuf.writeVarInt(2);
    socket.write(PacketBuffer.framePacket(0x00, hsBuf.toBuffer()));

    // Send 1.20.6 LoginStart (0x00)
    const lsBuf = new PacketBuffer();
    lsBuf.writeString('Woldann');
    lsBuf.writeUUID('354605a4-f4b9-3ef6-9804-eec0fc9b9b25');
    socket.write(PacketBuffer.framePacket(0x00, lsBuf.toBuffer()));

    const receivedPacketIds: number[] = [];
    let loginSuccessStrictErrorHandling: boolean | undefined;

    await new Promise<void>((resolve) => {
      let incoming = Buffer.alloc(0);
      let clientState = ConnectionState.LOGIN;

      socket.on('data', (data) => {
        incoming = Buffer.concat([incoming, Buffer.from(data)]);
        while (incoming.length > 0) {
          const parsed = PacketBuffer.readVarIntFromBuffer(incoming, 0);
          if (!parsed) break;
          const total = parsed.size + parsed.value;
          if (incoming.length < total) break;

          const packetData = incoming.subarray(parsed.size, total);
          incoming = incoming.subarray(total);

          const pBuf = new PacketBuffer(packetData);
          const pId = pBuf.readVarInt();
          receivedPacketIds.push(pId);

          if (clientState === ConnectionState.LOGIN && pId === 0x02) {
            // LoginSuccess (0x02). Read UUID, string, properties count, and strictErrorHandling boolean
            pBuf.readUUID();
            pBuf.readString();
            pBuf.readVarInt(); // properties count
            loginSuccessStrictErrorHandling = pBuf.readBoolean();

            // Client acknowledges login and switches to CONFIGURATION
            clientState = ConnectionState.CONFIGURATION;
            socket.write(PacketBuffer.framePacket(0x03, Buffer.alloc(0))); // ServerboundLoginAcknowledgedPacket
          } else if (clientState === ConnectionState.CONFIGURATION) {
            if (pId === 0x0e) {
              // SelectKnownPacks (0x0E in 1.20.6)
              // Client sends brand plugin message (0x02 in 1.20.6)
              const brandBuf = new PacketBuffer();
              brandBuf.writeString('minecraft:brand');
              brandBuf.writeString('vanilla');
              socket.write(PacketBuffer.framePacket(0x02, brandBuf.toBuffer()));

              // Client acknowledges known packs (0x07 in 1.20.6)
              const packBuf = new PacketBuffer();
              packBuf.writeVarInt(1);
              packBuf.writeString('minecraft');
              packBuf.writeString('core');
              packBuf.writeString('1.20.6');
              socket.write(PacketBuffer.framePacket(0x07, packBuf.toBuffer()));
            } else if (pId === 0x03) {
              // ClientboundFinishConfigurationPacket (0x03 in 1.20.6)
              // Client sends finish configuration acknowledgement (0x03 in 1.20.6)
              clientState = ConnectionState.PLAY;
              socket.write(PacketBuffer.framePacket(0x03, Buffer.alloc(0)));
            }
          } else if (clientState === ConnectionState.PLAY) {
            // Check for 1.20.6 PlayerPosition (0x40)
            if (receivedPacketIds.includes(0x40)) {
              resolve();
            }
          }
        }
      });
    });

    socket.destroy();
    await server.close();

    // Verify 1.20.6 protocol features:
    expect(loginSuccessStrictErrorHandling).toBe(true);
    expect(detectedBrand).toBe('vanilla');
    expect(receivedPacketIds).toContain(0x02); // LoginSuccess
    expect(receivedPacketIds).toContain(0x0c); // UpdateEnabledFeatures (0x0C)
    expect(receivedPacketIds).toContain(0x0e); // SelectKnownPacks (0x0E)
    expect(receivedPacketIds).toContain(0x07); // RegistryData (0x07)
    expect(receivedPacketIds).toContain(0x03); // FinishConfiguration (0x03)
    expect(receivedPacketIds).toContain(0x2b); // 1.20.6 JoinGame (0x2B)
    expect(receivedPacketIds).toContain(0x27); // 1.20.6 FlatChunk with light (0x27)
    expect(receivedPacketIds).toContain(0x40); // 1.20.6 PlayerPosition (0x40)
    expect(receivedPacketIds).toContain(0x38); // 1.20.6 PlayerAbilities (0x38)
    expect(receivedPacketIds).toContain(0x56); // 1.20.6 SpawnPosition (0x56)
    expect(receivedPacketIds).toContain(0x54); // 1.20.6 UpdateViewPosition (0x54)
    expect(receivedPacketIds).toContain(0x22); // 1.20.6 ChunksLoadStart (0x22)
  });

  it('should adapt dynamically to 1.7.10 client (protocol 5) without 1-byte reducedDebugInfo overflow', async () => {
    const profile = new VersionProfile1_7();
    const joinPkt = profile.createJoinGamePacket({ entityId: 42 });
    // In 1.7, packet 0x01 JoinGame payload is exactly:
    // VarInt(len) + VarInt(1) + Int(42) + UByte(1) + Byte(0) + UByte(1) + UByte(60) + VarInt(4) + "flat"
    // = 1 + 1 + 4 + 1 + 1 + 1 + 1 + 1 + 4 = 15 bytes (14 bytes payload + 1 byte id)
    // In 1.8 it was 16 bytes due to reducedDebugInfo boolean!
    const buf = new PacketBuffer(joinPkt);
    const len = buf.readVarInt();
    const id = buf.readVarInt();
    expect(id).toBe(0x01);
    expect(len).toBe(14); // Exactly 14 bytes (no extra boolean)

    // Test live connection with protocol 5:
    const server = new MinecraftServer({ port: 0 });
    await server.listen();
    const serverPort = (server as any).server.address().port;

    const socket = new Socket();
    await new Promise<void>((resolve) =>
      socket.connect(serverPort, '127.0.0.1', resolve),
    );

    // Send 1.7.10 Handshake (protocol 5)
    const hsBuf = new PacketBuffer();
    hsBuf.writeVarInt(5);
    hsBuf.writeString('127.0.0.1');
    hsBuf.writeUShort(serverPort);
    hsBuf.writeVarInt(2); // LOGIN
    socket.write(PacketBuffer.framePacket(0x00, hsBuf.toBuffer()));

    // Send LoginStart
    const lsBuf = new PacketBuffer();
    lsBuf.writeString('Tester17');
    socket.write(PacketBuffer.framePacket(0x00, lsBuf.toBuffer()));

    const receivedPacketIds: number[] = [];
    await new Promise<void>((resolve) => {
      let incoming = Buffer.alloc(0);
      socket.on('data', (data) => {
        incoming = Buffer.concat([incoming, Buffer.from(data)]);
        while (incoming.length > 0) {
          const parsed = PacketBuffer.readVarIntFromBuffer(incoming, 0);
          if (!parsed) break;
          const total = parsed.size + parsed.value;
          if (incoming.length < total) break;

          const packetData = incoming.subarray(parsed.size, total);
          incoming = incoming.subarray(total);

          const pBuf = new PacketBuffer(packetData);
          const pId = pBuf.readVarInt();
          receivedPacketIds.push(pId);

          if (receivedPacketIds.includes(0x08)) {
            resolve();
          }
        }
      });
    });

    socket.destroy();
    await server.close();

    // 1.7.10 packets:
    expect(receivedPacketIds).toContain(0x02); // LoginSuccess
    expect(receivedPacketIds).toContain(0x01); // 1.7 JoinGame (0x01)
    expect(receivedPacketIds).toContain(0x39); // Abilities (0x39)
    expect(receivedPacketIds).toContain(0x05); // SpawnPosition (0x05)
    expect(receivedPacketIds).toContain(0x21); // MapChunk (0x21)
    expect(receivedPacketIds).toContain(0x08); // PlayerPosition (0x08)
  });

  it('should encode and decode legacy pre-1.7 UTF-16BE strings correctly', () => {
    const original = 'Woldann - §aAnalysis Lab!';
    const encoded = writeUtf16BeString(original);
    expect(encoded.length).toBe(2 + original.length * 2);
    expect(encoded.readUInt16BE(0)).toBe(original.length);

    const decoded = readUtf16BeString(encoded, 0);
    expect(decoded.value).toBe(original);
    expect(decoded.bytesRead).toBe(encoded.length);
  });

  it('should produce valid 1.5.2 raw packets without VarInt framing', () => {
    const profile = new VersionProfile1_5();
    expect(profile.protocolVersion).toBe(61);
    expect(profile.minecraftVersion).toBe('1.5.2');

    // JoinGame: 0x01 (26 bytes)
    const joinPkt = profile.createJoinGamePacket({
      entityId: 42,
      gameMode: GameMode.CREATIVE,
      dimension: Dimension.OVERWORLD,
      difficulty: Difficulty.EASY,
      maxPlayers: 60,
      levelType: 'default',
    });
    expect(joinPkt[0]).toBe(0x01);
    expect(joinPkt.readInt32BE(1)).toBe(42);
    expect(joinPkt.length).toBe(26);

    // PlayerPosition: 0x0D (42 bytes)
    const posPkt = profile.createPlayerPositionPacket({
      x: 1337.5,
      y: 5.0,
      z: 777.5,
      yaw: 90.0,
      pitch: 0.0,
    });
    expect(posPkt[0]).toBe(0x0d);
    expect(posPkt.readDoubleBE(1)).toBe(1337.5);
    expect(posPkt.readDoubleBE(9)).toBeCloseTo(6.62, 2); // stance (eye Y = y + 1.62)
    expect(posPkt.readDoubleBE(17)).toBe(5.0); // feet Y
    expect(posPkt.readDoubleBE(25)).toBe(777.5);
    expect(posPkt.readFloatBE(33)).toBe(90.0);
    expect(posPkt.readFloatBE(37)).toBe(0.0);
    expect(posPkt.length).toBe(42);

    // SpawnPosition: 0x06 (13 bytes)
    const spawnPkt = profile.createSpawnPositionPacket(100, 64, -200);
    expect(spawnPkt[0]).toBe(0x06);
    expect(spawnPkt.readInt32BE(1)).toBe(100);
    expect(spawnPkt.readInt32BE(5)).toBe(64);
    expect(spawnPkt.readInt32BE(9)).toBe(-200);
    expect(spawnPkt.length).toBe(13);

    // MapChunk: 0x33
    const chunkPkt = profile.createFlatChunkPacket(83, 48);
    expect(chunkPkt[0]).toBe(0x33);
    expect(chunkPkt.readInt32BE(1)).toBe(83);
    expect(chunkPkt.readInt32BE(5)).toBe(48);
    expect(chunkPkt.readUInt8(9)).toBe(1); // groundUp
    expect(chunkPkt.readUInt16BE(10)).toBe(1); // bitMap section 0
    expect(chunkPkt.length).toBeGreaterThan(50);
  });

  it('should adapt dynamically to pre-1.7 (1.5.2) client handshake (0x02) and send raw world-loading packets', async () => {
    const server = new MinecraftServer({ port: 0 });
    await server.listen();
    const serverPort = (server as any).server.address().port;

    const socket = new Socket();
    await new Promise<void>((resolve) =>
      socket.connect(serverPort, '127.0.0.1', resolve),
    );

    // Construct 1.5.2 raw 0x02 Handshake packet:
    // [0x02, protocolVersion: u8(61), username: utf16be, host: utf16be, port: i32BE]
    const userBuf = writeUtf16BeString('Woldann');
    const hostBuf = writeUtf16BeString('127.0.0.1');
    const hsBuf = Buffer.alloc(1 + 1 + userBuf.length + hostBuf.length + 4);
    let offset = 0;
    hsBuf.writeUInt8(0x02, offset++);
    hsBuf.writeUInt8(61, offset++);
    userBuf.copy(hsBuf, offset);
    offset += userBuf.length;
    hostBuf.copy(hsBuf, offset);
    offset += hostBuf.length;
    hsBuf.writeInt32BE(serverPort, offset);

    // Send raw packet without VarInt framing
    socket.write(hsBuf);

    const receivedPacketIds: number[] = [];
    await new Promise<void>((resolve) => {
      let incoming = Buffer.alloc(0);
      socket.on('data', (data) => {
        incoming = Buffer.concat([incoming, Buffer.from(data)]);
        while (incoming.length > 0) {
          const pId = incoming[0];
          receivedPacketIds.push(pId);
          let packetLen = 1;
          if (pId === 0x01) {
            packetLen = 26;
          } else if (pId === 0x06) {
            packetLen = 13;
          } else if (pId === 0xca) {
            packetLen = 4;
          } else if (pId === 0x33) {
            if (incoming.length < 18) break;
            const compLen = incoming.readInt32BE(14);
            packetLen = 18 + compLen;
          } else if (pId === 0x0d) {
            packetLen = 42;
          } else if (pId === 0x03) {
            if (incoming.length < 3) break;
            const sLen = incoming.readUInt16BE(1);
            packetLen = 3 + sLen * 2;
          } else if (pId === 0x18) {
            // MobSpawn: find next packet or approximate
            packetLen = 23;
          }
          if (incoming.length < packetLen) break;
          incoming = incoming.subarray(packetLen);

          if (
            receivedPacketIds.includes(0x0d) &&
            receivedPacketIds.includes(0x33)
          ) {
            resolve();
            return;
          }
        }
      });
    });

    socket.destroy();
    await server.close();

    // 1.5.2 raw world loading packets:
    expect(receivedPacketIds).toContain(0x01); // Packet1Login
    expect(receivedPacketIds).toContain(0x06); // Packet6SpawnPosition
    expect(receivedPacketIds).toContain(0x33); // Packet51MapChunk
    expect(receivedPacketIds).toContain(0x0d); // Packet13PlayerLookMove (closes GuiDownloadTerrain)
  });

  it('should respond to legacy Server List Ping (0xFE) with 0xFF kick packet containing server info', async () => {
    const server = new MinecraftServer({
      port: 0,
      motd: 'ExoProc Legacy Lab',
    });
    await server.listen();
    const serverPort = (server as any).server.address().port;

    const socket = new Socket();
    await new Promise<void>((resolve) =>
      socket.connect(serverPort, '127.0.0.1', resolve),
    );

    // Send 0xFE (Server List Ping)
    socket.write(Buffer.from([0xfe]));

    let responseString = '';
    await new Promise<void>((resolve) => {
      socket.on('data', (data) => {
        if (data[0] === 0xff) {
          // Packet 255 Disconnect / Server List Info
          const decoded = readUtf16BeString(Buffer.from(data), 1);
          responseString = decoded.value;
          resolve();
        }
      });
    });

    socket.destroy();
    await server.close();

    expect(responseString).toContain(['§1', '61', '1.5.2'].join('\0'));
    expect(responseString).toContain('ExoProc Legacy Lab');
  });
});
