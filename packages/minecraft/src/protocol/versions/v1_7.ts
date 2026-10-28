import { deflateSync } from 'node:zlib';
import { PacketBuffer } from '../buffer.js';
import {
  Difficulty,
  Dimension,
  GameMode,
  type JoinGameOptions,
  type PlayerPositionOptions,
  type ProbeMob,
} from '../types.js';
import type { VersionProfile } from './base.js';

// Pre-computed 1.7.10 section 0 chunk buffer (deflated with zlib)
// Section 0 (Y=0..15): 4096 bytes block IDs, 2048 metadata, 2048 block light, 2048 sky light, 256 biomes
const COMPRESSED_SECTION_0_1_7 = (() => {
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

export class VersionProfile1_7 implements VersionProfile {
  public readonly protocolVersion = 5;
  public readonly minecraftVersion = '1.7.x (1.7.6 - 1.7.10)';

  public createLoginSuccessPacket(uuid: string, username: string): Buffer {
    const buf = new PacketBuffer();
    buf.writeString(uuid);
    buf.writeString(username);
    return PacketBuffer.framePacket(0x02, buf.toBuffer());
  }

  public createJoinGamePacket(options: JoinGameOptions): Buffer {
    const buf = new PacketBuffer();
    buf.writeInt(options.entityId ?? 1);
    buf.writeUByte(options.gameMode ?? GameMode.CREATIVE);
    buf.writeByte(options.dimension ?? Dimension.OVERWORLD);
    buf.writeUByte(options.difficulty ?? Difficulty.EASY);
    buf.writeUByte(options.maxPlayers ?? 60);
    buf.writeString(options.levelType ?? 'flat');
    // NOTE: 1.7.10 does NOT have reducedDebugInfo!
    return PacketBuffer.framePacket(0x01, buf.toBuffer());
  }

  public createPlayerPositionPacket(options: PlayerPositionOptions): Buffer {
    const buf = new PacketBuffer();
    buf.writeDouble(options.x);
    buf.writeDouble(options.y);
    buf.writeDouble(options.z);
    buf.writeFloat(options.yaw ?? 0.0);
    buf.writeFloat(options.pitch ?? 0.0);
    buf.writeBoolean(false); // onGround (in 1.7 this is boolean, not flags byte!)
    return PacketBuffer.framePacket(0x08, buf.toBuffer());
  }

  public createKeepAlivePacket(keepAliveId: number | bigint): Buffer {
    const buf = new PacketBuffer();
    buf.writeInt(Number(keepAliveId)); // 1.7 uses Int (not VarInt)
    return PacketBuffer.framePacket(0x00, buf.toBuffer());
  }

  public parseKeepAliveResponse(payload: Buffer): number | bigint {
    const buf = new PacketBuffer(payload);
    return buf.readInt(); // 1.7 uses Int (not VarInt)
  }

  public createDisconnectPacket(reason: string): Buffer {
    const buf = new PacketBuffer();
    buf.writeString(JSON.stringify({ text: reason }));
    return PacketBuffer.framePacket(0x40, buf.toBuffer());
  }

  public createFlatChunkPacket(chunkX: number, chunkZ: number): Buffer {
    const buf = new PacketBuffer();
    buf.writeInt(chunkX);
    buf.writeInt(chunkZ);
    buf.writeBoolean(true); // groundUp
    buf.writeUShort(1); // bitMap: section 0 (Y=0..15)
    buf.writeUShort(0); // addBitMap: 0
    buf.writeInt(COMPRESSED_SECTION_0_1_7.length);
    buf.writeBuffer(COMPRESSED_SECTION_0_1_7);
    return PacketBuffer.framePacket(0x21, buf.toBuffer());
  }

  public createChatMessagePacket(
    message: string,
    color: string = 'green',
  ): Buffer {
    const buf = new PacketBuffer();
    buf.writeString(JSON.stringify({ text: message, color }));
    // NOTE: 1.7 chat packet does NOT have position byte!
    return PacketBuffer.framePacket(0x02, buf.toBuffer());
  }

  public createPlayerAbilitiesPacket(
    isFlying: boolean = false,
    canFly: boolean = true,
    isCreative: boolean = true,
  ): Buffer {
    const buf = new PacketBuffer();
    let flags = 0;
    if (isCreative) flags |= 0x01 | 0x08; // invulnerable + creative
    if (canFly) flags |= 0x04;
    if (isFlying) flags |= 0x02;

    buf.writeByte(flags);
    buf.writeFloat(0.05); // fly speed
    buf.writeFloat(0.1); // walk speed
    return PacketBuffer.framePacket(0x39, buf.toBuffer());
  }

  public createSpawnPositionPacket(x: number, y: number, z: number): Buffer {
    const buf = new PacketBuffer();
    buf.writeInt(Math.floor(x));
    buf.writeInt(Math.floor(y));
    buf.writeInt(Math.floor(z));
    return PacketBuffer.framePacket(0x05, buf.toBuffer());
  }

  public createSpawnMobPacket(mob: ProbeMob): Buffer {
    const buf = new PacketBuffer();
    buf.writeVarInt(mob.entityId);
    buf.writeUByte(mob.type & 0xff);
    buf.writeInt(Math.floor(mob.x * 32.0));
    buf.writeInt(Math.floor(mob.y * 32.0));
    buf.writeInt(Math.floor(mob.z * 32.0));
    buf.writeUByte(Math.floor(((mob.yaw % 360) * 256) / 360) & 0xff);
    buf.writeUByte(Math.floor(((mob.pitch % 360) * 256) / 360) & 0xff);
    buf.writeUByte(Math.floor(((mob.yaw % 360) * 256) / 360) & 0xff);
    buf.writeShort(0); // velocityX
    buf.writeShort(0); // velocityY
    buf.writeShort(0); // velocityZ

    // Metadata:
    // 1. Health: float (type 3, index 6)
    if (mob.health !== undefined) {
      buf.writeUByte((3 << 5) | 6);
      buf.writeFloat(mob.health);
    }
    // 2. Custom Name: string (type 4, index 2)
    if (mob.name) {
      buf.writeUByte((4 << 5) | 2);
      buf.writeString(mob.name);
      // Custom Name Visible: byte 1 (type 0, index 3)
      buf.writeUByte((0 << 5) | 3);
      buf.writeByte(1);
    }
    // End of metadata
    buf.writeUByte(127);

    return PacketBuffer.framePacket(0x0f, buf.toBuffer());
  }
}
