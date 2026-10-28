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

export class VersionProfile1_8 implements VersionProfile {
  public readonly protocolVersion = 47;
  public readonly minecraftVersion = '1.8.x (1.8 - 1.8.9)';

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
    buf.writeBoolean(options.reducedDebugInfo ?? false);
    return PacketBuffer.framePacket(0x01, buf.toBuffer());
  }

  public createPlayerPositionPacket(options: PlayerPositionOptions): Buffer {
    const buf = new PacketBuffer();
    buf.writeDouble(options.x);
    buf.writeDouble(options.y);
    buf.writeDouble(options.z);
    buf.writeFloat(options.yaw ?? 0.0);
    buf.writeFloat(options.pitch ?? 0.0);
    buf.writeByte(options.flags ?? 0);
    return PacketBuffer.framePacket(0x08, buf.toBuffer());
  }

  public createKeepAlivePacket(keepAliveId: number | bigint): Buffer {
    const buf = new PacketBuffer();
    buf.writeVarInt(Number(keepAliveId));
    return PacketBuffer.framePacket(0x00, buf.toBuffer());
  }

  public parseKeepAliveResponse(payload: Buffer): number | bigint {
    const buf = new PacketBuffer(payload);
    return buf.readVarInt();
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
    buf.writeBoolean(true); // groundUpContinuous
    buf.writeUShort(1); // primaryBitMask: section 0 (Y=0..15)

    const sectionData = Buffer.alloc(12544);
    // Fill block states (8192 bytes)
    for (let y = 0; y < 16; y++) {
      let blockId = 0;
      if (y === 0)
        blockId = 7; // Bedrock
      else if (y >= 1 && y <= 3)
        blockId = 3; // Dirt
      else if (y === 4)
        blockId = 2; // Grass
      else blockId = 0; // Air

      const val = blockId << 4;
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const idx = ((y * 16 + z) * 16 + x) * 2;
          sectionData.writeUInt16LE(val, idx);
        }
      }
    }

    // Sky light (10240..12287): full daylight
    sectionData.fill(0xff, 10240, 12288);
    // Biomes (12288..12543): 1 = Plains
    sectionData.fill(1, 12288, 12544);

    buf.writeByteArray(sectionData);
    return PacketBuffer.framePacket(0x21, buf.toBuffer());
  }

  public createChatMessagePacket(
    message: string,
    color: string = 'green',
  ): Buffer {
    const buf = new PacketBuffer();
    buf.writeString(JSON.stringify({ text: message, color }));
    buf.writeByte(0); // 0 = standard chat box
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
