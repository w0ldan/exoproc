import { deflateSync } from 'node:zlib';
import {
  Difficulty,
  Dimension,
  GameMode,
  type JoinGameOptions,
  type PlayerPositionOptions,
  type ProbeMob,
} from '../types.js';
import type { VersionProfile } from './base.js';

/**
 * Encodes a string in the legacy Minecraft pre-1.7 format:
 * 2-byte unsigned big-endian character count followed by UTF-16BE (UCS-2) bytes.
 */
export function writeUtf16BeString(str: string): Buffer {
  const buf = Buffer.alloc(2 + str.length * 2);
  buf.writeUInt16BE(str.length, 0);
  for (let i = 0; i < str.length; i++) {
    buf.writeUInt16BE(str.charCodeAt(i), 2 + i * 2);
  }
  return buf;
}

/**
 * Decodes a legacy Minecraft pre-1.7 UTF-16BE string from a buffer.
 */
export function readUtf16BeString(
  buf: Buffer,
  offset: number = 0,
): { value: string; bytesRead: number } {
  if (buf.length < offset + 2) {
    return { value: '', bytesRead: 0 };
  }
  const len = buf.readUInt16BE(offset);
  if (buf.length < offset + 2 + len * 2) {
    return { value: '', bytesRead: 0 };
  }
  let str = '';
  for (let i = 0; i < len; i++) {
    str += String.fromCharCode(buf.readUInt16BE(offset + 2 + i * 2));
  }
  return { value: str, bytesRead: 2 + len * 2 };
}

// Pre-computed 1.5.2 section 0 chunk buffer (deflated with zlib)
// Section 0 (Y=0..15): 4096 bytes block IDs, 2048 metadata, 2048 block light, 2048 sky light, 256 biomes
const COMPRESSED_SECTION_0_1_5 = (() => {
  const uncompressed = Buffer.alloc(10496);
  // Block IDs (4096 bytes)
  for (let y = 0; y < 16; y++) {
    const blockId = y === 0 ? 7 : y <= 3 ? 3 : y === 4 ? 2 : 0;
    uncompressed.fill(blockId, y * 256, (y + 1) * 256);
  }
  // Sky light (8192..10239): 0xff daylight
  uncompressed.fill(0xff, 8192, 10240);
  // Biomes (10240..10495): 1 = Plains
  uncompressed.fill(1, 10240, 10496);

  return deflateSync(uncompressed);
})();

export class VersionProfile1_5 implements VersionProfile {
  public readonly protocolVersion = 61;
  public readonly minecraftVersion = '1.5.2';

  public createLoginSuccessPacket(_uuid: string, _username: string): Buffer {
    // In pre-1.7 protocols, there is no standalone LoginSuccess packet.
    // The server transitions directly to WorldClient upon receiving/sending Packet1Login.
    return Buffer.alloc(0);
  }

  public createJoinGamePacket(options: JoinGameOptions): Buffer {
    // 0x01 Login: [0x01, entityId: i32, levelType: utf16be, gameMode: u8, dimension: i8, difficulty: u8, worldHeight: u8, maxPlayers: u8]
    const levelTypeBuf = writeUtf16BeString(options.levelType ?? 'default');
    const buf = Buffer.alloc(1 + 4 + levelTypeBuf.length + 1 + 1 + 1 + 1 + 1);
    let offset = 0;
    buf.writeUInt8(0x01, offset++);
    buf.writeInt32BE(options.entityId ?? 1, offset);
    offset += 4;
    levelTypeBuf.copy(buf, offset);
    offset += levelTypeBuf.length;
    buf.writeUInt8(options.gameMode ?? GameMode.CREATIVE, offset++);
    buf.writeInt8(options.dimension ?? Dimension.OVERWORLD, offset++);
    buf.writeUInt8(options.difficulty ?? Difficulty.EASY, offset++);
    buf.writeUInt8(0, offset++); // worldHeight (unused in 1.5.2)
    buf.writeUInt8(options.maxPlayers ?? 60, offset++);
    return buf;
  }

  public createPlayerPositionPacket(options: PlayerPositionOptions): Buffer {
    // 0x0D PlayerPositionAndLook: [0x0D, x: f64, stance: f64, y: f64, z: f64, yaw: f32, pitch: f32, onGround: u8]
    // Sending this packet closes GuiDownloadTerrain on the 1.5.2 client and spawns the player!
    const buf = Buffer.alloc(42);
    buf.writeUInt8(0x0d, 0);
    buf.writeDoubleBE(options.x, 1);
    buf.writeDoubleBE(options.y + 1.62, 9); // stance (eye Y)
    buf.writeDoubleBE(options.y, 17); // feet Y
    buf.writeDoubleBE(options.z, 25);
    buf.writeFloatBE(options.yaw ?? 0.0, 33);
    buf.writeFloatBE(options.pitch ?? 0.0, 37);
    buf.writeUInt8(options.flags ? 1 : 0, 41); // onGround
    return buf;
  }

  public createKeepAlivePacket(keepAliveId: number | bigint): Buffer {
    // 0x00 KeepAlive: [0x00, id: i32]
    const buf = Buffer.alloc(5);
    buf.writeUInt8(0x00, 0);
    buf.writeInt32BE(Number(keepAliveId), 1);
    return buf;
  }

  public parseKeepAliveResponse(payload: Buffer): number | bigint {
    // In raw 1.5.2, payload starts with the int32 ID (packetId 0x00 stripped)
    return payload.readInt32BE(0);
  }

  public createDisconnectPacket(reason: string): Buffer {
    // 0xFF Kick / Disconnect: [0xFF, reason: utf16be]
    const strBuf = writeUtf16BeString(reason);
    return Buffer.concat([Buffer.from([0xff]), strBuf]);
  }

  public createFlatChunkPacket(chunkX: number, chunkZ: number): Buffer {
    // 0x33 MapChunk: [0x33, x: i32, z: i32, groundUp: u8, bitMap: u16, addBitMap: u16, compLen: i32, deflatedData]
    const header = Buffer.alloc(18);
    header.writeUInt8(0x33, 0);
    header.writeInt32BE(chunkX, 1);
    header.writeInt32BE(chunkZ, 5);
    header.writeUInt8(1, 9); // groundUpContinuous
    header.writeUInt16BE(1, 10); // bitMap: section 0
    header.writeUInt16BE(0, 12); // addBitMap: 0
    header.writeInt32BE(COMPRESSED_SECTION_0_1_5.length, 14);
    return Buffer.concat([header, COMPRESSED_SECTION_0_1_5]);
  }

  public createChatMessagePacket(message: string): Buffer {
    // 0x03 Chat: [0x03, message: utf16be]
    const strBuf = writeUtf16BeString(message);
    return Buffer.concat([Buffer.from([0x03]), strBuf]);
  }

  public createPlayerAbilitiesPacket(
    isFlying: boolean = false,
    canFly: boolean = true,
    isCreative: boolean = true,
  ): Buffer {
    // 0xCA PlayerAbilities in 1.5.2: [0xCA, flags: u8, flySpeed: u8, walkSpeed: u8]
    let flags = 0;
    if (isCreative) flags |= 0x01 | 0x08; // invulnerable + creative
    if (canFly) flags |= 0x04;
    if (isFlying) flags |= 0x02;

    const buf = Buffer.alloc(4);
    buf.writeUInt8(0xca, 0);
    buf.writeUInt8(flags, 1);
    buf.writeUInt8(Math.floor(0.05 * 255), 2); // fly speed
    buf.writeUInt8(Math.floor(0.1 * 255), 3); // walk speed
    return buf;
  }

  public createSpawnPositionPacket(x: number, y: number, z: number): Buffer {
    // 0x06 SpawnPosition: [0x06, x: i32, y: i32, z: i32]
    const buf = Buffer.alloc(13);
    buf.writeUInt8(0x06, 0);
    buf.writeInt32BE(Math.floor(x), 1);
    buf.writeInt32BE(Math.floor(y), 5);
    buf.writeInt32BE(Math.floor(z), 9);
    return buf;
  }

  public createSpawnMobPacket(mob: ProbeMob): Buffer {
    // 0x18 MobSpawn:
    // [0x18, entityId: i32, type: u8, x: i32, y: i32, z: i32, yaw: u8, pitch: u8, headYaw: u8, velX: i16, velY: i16, velZ: i16, metadata]
    const header = Buffer.alloc(27);
    let offset = 0;
    header.writeUInt8(0x18, offset++);
    header.writeInt32BE(mob.entityId, offset);
    offset += 4;
    header.writeUInt8(mob.type & 0xff, offset++);
    header.writeInt32BE(Math.floor(mob.x * 32.0), offset);
    offset += 4;
    header.writeInt32BE(Math.floor(mob.y * 32.0), offset);
    offset += 4;
    header.writeInt32BE(Math.floor(mob.z * 32.0), offset);
    offset += 4;
    header.writeUInt8(
      Math.floor(((mob.yaw % 360) * 256) / 360) & 0xff,
      offset++,
    );
    header.writeUInt8(
      Math.floor(((mob.pitch % 360) * 256) / 360) & 0xff,
      offset++,
    );
    header.writeUInt8(
      Math.floor(((mob.yaw % 360) * 256) / 360) & 0xff,
      offset++,
    );
    header.writeInt16BE(0, offset);
    offset += 2;
    header.writeInt16BE(0, offset);
    offset += 2;
    header.writeInt16BE(0, offset);
    offset += 2;

    // Metadata:
    // In 1.5.2, mob custom name:
    // Index 10: String (Type 4: (4 << 5) | 10 = 0x8A)
    // Index 11: Byte (Type 0: (0 << 5) | 11 = 0x0B)
    // End: 0x7F (127)
    const metaParts: Buffer[] = [];
    if (mob.name) {
      const nameBuf = writeUtf16BeString(mob.name);
      const tagHeader = Buffer.from([(4 << 5) | 10]);
      const visibleTag = Buffer.from([(0 << 5) | 11, 1]);
      metaParts.push(tagHeader, nameBuf, visibleTag);
    }
    metaParts.push(Buffer.from([0x7f])); // 127 = end of DataWatcher

    return Buffer.concat([header, ...metaParts]);
  }
}
