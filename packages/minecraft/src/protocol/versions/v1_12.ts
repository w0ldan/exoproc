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
import { generateOfflineUuid } from '../buffer.js';

export class VersionProfile1_12 implements VersionProfile {
  public readonly protocolVersion = 340;
  public readonly minecraftVersion = '1.12.2';

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
    buf.writeInt(options.dimension ?? Dimension.OVERWORLD);
    buf.writeUByte(options.difficulty ?? Difficulty.EASY);
    buf.writeUByte(options.maxPlayers ?? 60);
    buf.writeString(options.levelType ?? 'flat');
    buf.writeBoolean(options.reducedDebugInfo ?? false);
    return PacketBuffer.framePacket(0x23, buf.toBuffer());
  }

  public createPlayerPositionPacket(options: PlayerPositionOptions): Buffer {
    const buf = new PacketBuffer();
    buf.writeDouble(options.x);
    buf.writeDouble(options.y);
    buf.writeDouble(options.z);
    buf.writeFloat(options.yaw ?? 0.0);
    buf.writeFloat(options.pitch ?? 0.0);
    buf.writeByte(options.flags ?? 0);
    buf.writeVarInt(options.teleportId ?? 1);
    return PacketBuffer.framePacket(0x2f, buf.toBuffer());
  }

  public createKeepAlivePacket(keepAliveId: number | bigint): Buffer {
    const buf = new PacketBuffer();
    buf.writeLong(BigInt(keepAliveId));
    return PacketBuffer.framePacket(0x1f, buf.toBuffer());
  }

  public parseKeepAliveResponse(payload: Buffer): number | bigint {
    const buf = new PacketBuffer(payload);
    return buf.readLong();
  }

  public createDisconnectPacket(reason: string): Buffer {
    const buf = new PacketBuffer();
    buf.writeString(JSON.stringify({ text: reason }));
    return PacketBuffer.framePacket(0x1a, buf.toBuffer());
  }

  public createFlatChunkPacket(chunkX: number, chunkZ: number): Buffer {
    const sectionBuf = new PacketBuffer();
    // 1. bitsPerBlock: 4 (minimum allowed for palette)
    sectionBuf.writeByte(4);
    // 2. paletteLength: 4
    sectionBuf.writeVarInt(4);
    // 3. palette entries:
    sectionBuf.writeVarInt(0); // 0: Air
    sectionBuf.writeVarInt(112); // 1: Bedrock (7 << 4)
    sectionBuf.writeVarInt(48); // 2: Dirt (3 << 4)
    sectionBuf.writeVarInt(32); // 3: Grass (2 << 4)

    // 4. dataArray: 256 longs (4096 * 4 / 64)
    sectionBuf.writeVarInt(256);
    const longs = new BigInt64Array(256);

    for (let y = 0; y < 16; y++) {
      let palIdx = 0n;
      if (y === 0)
        palIdx = 1n; // Bedrock
      else if (y >= 1 && y <= 3)
        palIdx = 2n; // Dirt
      else if (y === 4)
        palIdx = 3n; // Grass
      else palIdx = 0n; // Air

      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const blockIdx = (y * 16 + z) * 16 + x;
          const longIdx = Math.floor(blockIdx / 16);
          const bitOffset = BigInt((blockIdx % 16) * 4);
          longs[longIdx] = longs[longIdx]! | (palIdx << bitOffset);
        }
      }
    }

    for (let i = 0; i < 256; i++) {
      sectionBuf.writeLong(longs[i]!);
    }

    // 5. blockLight: 2048 bytes
    sectionBuf.writeBuffer(Buffer.alloc(2048, 0));
    // 6. skyLight: 2048 bytes (full daylight)
    sectionBuf.writeBuffer(Buffer.alloc(2048, 0xff));
    // 7. Biomes: 256 bytes (Plains = 1)
    sectionBuf.writeBuffer(Buffer.alloc(256, 1));

    const chunkData = sectionBuf.toBuffer();

    const pkt = new PacketBuffer();
    pkt.writeInt(chunkX);
    pkt.writeInt(chunkZ);
    pkt.writeBoolean(true); // groundUp
    pkt.writeVarInt(1); // bitMap: section 0 (Y=0..15)
    pkt.writeByteArray(chunkData);
    pkt.writeVarInt(0); // 0 block entities

    return PacketBuffer.framePacket(0x20, pkt.toBuffer());
  }

  public createChatMessagePacket(
    message: string,
    color: string = 'green',
  ): Buffer {
    const buf = new PacketBuffer();
    buf.writeString(JSON.stringify({ text: message, color }));
    buf.writeByte(0); // 0 = standard chat box
    return PacketBuffer.framePacket(0x0f, buf.toBuffer());
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
    return PacketBuffer.framePacket(0x2c, buf.toBuffer());
  }

  public createSpawnMobPacket(mob: ProbeMob): Buffer {
    const buf = new PacketBuffer();
    buf.writeVarInt(mob.entityId);
    buf.writeUUID(generateOfflineUuid('mob_' + mob.entityId));
    buf.writeVarInt(mob.type);
    buf.writeDouble(mob.x);
    buf.writeDouble(mob.y);
    buf.writeDouble(mob.z);
    buf.writeUByte(Math.floor(((mob.yaw % 360) * 256) / 360) & 0xff);
    buf.writeUByte(Math.floor(((mob.pitch % 360) * 256) / 360) & 0xff);
    buf.writeUByte(Math.floor(((mob.yaw % 360) * 256) / 360) & 0xff);
    buf.writeShort(0); // velocityX
    buf.writeShort(0); // velocityY
    buf.writeShort(0); // velocityZ

    // Metadata:
    // 1. Health (index 7, type 2=Float)
    if (mob.health !== undefined) {
      buf.writeUByte(7);
      buf.writeVarInt(2); // type float
      buf.writeFloat(mob.health);
    }
    // 2. Custom Name (index 2, type 3=String)
    if (mob.name) {
      buf.writeUByte(2);
      buf.writeVarInt(3); // type string
      buf.writeString(mob.name);
      // Custom Name Visible (index 3, type 6=Boolean)
      buf.writeUByte(3);
      buf.writeVarInt(6); // type boolean
      buf.writeBoolean(true);
    }
    // End of metadata
    buf.writeUByte(0xff);

    return PacketBuffer.framePacket(0x03, buf.toBuffer());
  }
}
