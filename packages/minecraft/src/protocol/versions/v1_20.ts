import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PacketBuffer, generateOfflineUuid } from '../buffer.js';
import { writeNbt } from '../nbt.js';
import {
  GameMode,
  type JoinGameOptions,
  type PlayerPositionOptions,
  type ProbeMob,
} from '../types.js';
import type { VersionProfile } from './base.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function loadCodec1_20(): Buffer {
  const candidates = [
    join(__dirname, 'codec_1_20.bin'),
    join(
      __dirname,
      '../../packages/minecraft/src/protocol/versions/codec_1_20.bin',
    ),
    join(
      __dirname,
      '../../../packages/minecraft/src/protocol/versions/codec_1_20.bin',
    ),
    join(
      process.cwd(),
      'packages/minecraft/src/protocol/versions/codec_1_20.bin',
    ),
  ];
  for (const p of candidates) {
    try {
      return readFileSync(p);
    } catch {}
  }
  return Buffer.alloc(0);
}
const CODEC_1_20_BUFFER = loadCodec1_20();

// Pre-computed 1.20 heightmaps
// In 1.18+, world minY is -64, so grass surface at Y=4 has relative height: 4 - (-64) + 1 = 69
const H = 69n;
const HEIGHT_VAL_7 =
  H |
  (H << 9n) |
  (H << 18n) |
  (H << 27n) |
  (H << 36n) |
  (H << 45n) |
  (H << 54n);
const HEIGHT_VAL_4 = H | (H << 9n) | (H << 18n) | (H << 27n);
export const HEIGHTS_ARRAY = new Array(37).fill(HEIGHT_VAL_7);
HEIGHTS_ARRAY[36] = HEIGHT_VAL_4;

export const HEIGHTMAPS_NBT_BUFFER = writeNbt({
  type: 'compound',
  value: {
    MOTION_BLOCKING: { type: 'longArray', value: HEIGHTS_ARRAY },
    WORLD_SURFACE: { type: 'longArray', value: HEIGHTS_ARRAY },
  },
});

// Pre-computed 24 sections for 1.20 chunk column (Y = -64..319)
export const CHUNK_DATA_1_20_BUFFER = (() => {
  const buf = new PacketBuffer();

  const writeEmptySection = () => {
    buf.writeShort(0); // blockCount: 0
    // block states: single-valued air (0)
    buf.writeUByte(0);
    buf.writeVarInt(0);
    buf.writeVarInt(0);
    // biomes: single-valued plains (0)
    buf.writeUByte(0);
    buf.writeVarInt(0);
    buf.writeVarInt(0);
  };

  // Sections 0..3: Y = -64..-1 (empty air below ground)
  for (let s = 0; s < 4; s++) writeEmptySection();

  // Section 4: Y = 0..15 (platform)
  buf.writeShort(1280); // blockCount
  buf.writeUByte(4); // bitsPerBlock
  buf.writeVarInt(4); // palette length
  buf.writeVarInt(0); // 0 = air
  buf.writeVarInt(79); // 1 = bedrock (state 79 in 1.20)
  buf.writeVarInt(10); // 2 = dirt (state 10 in 1.20)
  buf.writeVarInt(9); // 3 = grass_block (state 9 in 1.20)
  buf.writeVarInt(256); // 256 longs
  for (let i = 0; i < 16; i++) buf.writeLong(0x1111111111111111n); // Y=0: Bedrock
  for (let i = 0; i < 48; i++) buf.writeLong(0x2222222222222222n); // Y=1..3: Dirt
  for (let i = 0; i < 16; i++) buf.writeLong(0x3333333333333333n); // Y=4: Grass
  for (let i = 0; i < 176; i++) buf.writeLong(0n); // Y=5..15: Air
  // biomes in section 4
  buf.writeUByte(0);
  buf.writeVarInt(0);
  buf.writeVarInt(0);

  // Sections 5..23: Y = 16..319 (empty air above)
  for (let s = 5; s < 24; s++) writeEmptySection();

  return buf.toBuffer();
})();

export const FULL_LIGHT_SECTION = Buffer.alloc(2048, 0xff);

// 1.20 Mob Type IDs:
const MOB_TYPE_1_20: Record<number, number> = {
  54: 118, // Zombie
  50: 19, // Creeper
  51: 86, // Skeleton
  92: 18, // Cow
  90: 72, // Pig
};

export class VersionProfile1_20 implements VersionProfile {
  public readonly protocolVersion = 765;
  public readonly minecraftVersion = '1.20.x (1.20 - 1.20.4)';

  public createLoginSuccessPacket(uuid: string, username: string): Buffer {
    const buf = new PacketBuffer();
    buf.writeUUID(uuid);
    buf.writeString(username);
    buf.writeVarInt(0); // number of properties
    return PacketBuffer.framePacket(0x02, buf.toBuffer());
  }

  public createFinishConfigurationPacket(): Buffer {
    // 0x02 ClientboundFinishConfigurationPacket in 1.20.2 - 1.20.4
    return PacketBuffer.framePacket(0x02, Buffer.alloc(0));
  }

  public createJoinGamePacket(options: JoinGameOptions): Buffer {
    const buf = new PacketBuffer();
    buf.writeInt(options.entityId ?? 1);
    buf.writeBoolean(false); // isHardcore
    buf.writeUByte(options.gameMode ?? GameMode.CREATIVE);
    buf.writeByte(-1); // previousGameMode
    // worldNames
    buf.writeVarInt(1);
    buf.writeString('minecraft:overworld');
    // dimensionCodec NBT
    buf.writeBuffer(CODEC_1_20_BUFFER);
    buf.writeString('minecraft:overworld'); // worldType
    buf.writeString('minecraft:overworld'); // worldName
    buf.writeLong(0n); // hashedSeed
    buf.writeVarInt(options.maxPlayers ?? 60);
    buf.writeVarInt(10); // viewDistance
    buf.writeVarInt(10); // simulationDistance
    buf.writeBoolean(options.reducedDebugInfo ?? false);
    buf.writeBoolean(true); // enableRespawnScreen
    buf.writeBoolean(false); // isDebug
    buf.writeBoolean(true); // isFlat
    buf.writeBoolean(false); // has death location
    buf.writeVarInt(0); // portalCooldown
    const joinPkt = PacketBuffer.framePacket(0x28, buf.toBuffer());

    // In 1.20+, synchronize vanilla feature_flags (0x6b)
    const ffBuf = new PacketBuffer();
    ffBuf.writeVarInt(1); // 1 feature flag
    ffBuf.writeString('minecraft:vanilla');
    const ffPkt = PacketBuffer.framePacket(0x6b, ffBuf.toBuffer());

    return Buffer.concat([joinPkt, ffPkt]);
  }

  public createChunksLoadStartPacket(): Buffer {
    const buf = new PacketBuffer();
    buf.writeUByte(13); // reason 13: LEVEL_CHUNKS_LOAD_START
    buf.writeFloat(0.0); // value
    return PacketBuffer.framePacket(0x1f, buf.toBuffer());
  }

  public createSpawnPositionPacket(x: number, y: number, z: number): Buffer {
    const buf = new PacketBuffer();
    buf.writePositionModern(x, y, z);
    buf.writeFloat(0.0); // angle
    return PacketBuffer.framePacket(0x50, buf.toBuffer());
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
    return PacketBuffer.framePacket(0x3c, buf.toBuffer());
  }

  public createUpdateViewPositionPacket(
    chunkX: number,
    chunkZ: number,
  ): Buffer {
    const buf = new PacketBuffer();
    buf.writeVarInt(chunkX);
    buf.writeVarInt(chunkZ);
    return PacketBuffer.framePacket(0x4e, buf.toBuffer());
  }

  public createKeepAlivePacket(keepAliveId: number | bigint): Buffer {
    const buf = new PacketBuffer();
    buf.writeLong(BigInt(keepAliveId));
    return PacketBuffer.framePacket(0x23, buf.toBuffer());
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

  public createChatMessagePacket(
    message: string,
    color: string = 'green',
  ): Buffer {
    const buf = new PacketBuffer();
    buf.writeString(JSON.stringify({ text: message, color }));
    buf.writeBoolean(false); // isActionBar
    return PacketBuffer.framePacket(0x64, buf.toBuffer());
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
    return PacketBuffer.framePacket(0x34, buf.toBuffer());
  }

  public createFlatChunkPacket(chunkX: number, chunkZ: number): Buffer {
    // 0x24 map_chunk (with integrated light data in 1.20)
    const pkt = new PacketBuffer();
    pkt.writeInt(chunkX);
    pkt.writeInt(chunkZ);
    pkt.writeBuffer(HEIGHTMAPS_NBT_BUFFER);
    pkt.writeByteArray(CHUNK_DATA_1_20_BUFFER);
    pkt.writeVarInt(0); // 0 block entities

    // Light data:
    pkt.writeVarInt(1); // 1 long in skyLightMask
    pkt.writeLong(0x3ffffffn); // 26 bits set
    pkt.writeVarInt(0); // 0 longs in blockLightMask
    pkt.writeVarInt(0); // 0 longs in emptySkyLightMask
    pkt.writeVarInt(1); // 1 long in emptyBlockLightMask
    pkt.writeLong(0x3ffffffn);

    // 26 sky light sections (each 2048 bytes of 0xff daylight)
    pkt.writeVarInt(26);
    for (let i = 0; i < 26; i++) {
      pkt.writeByteArray(FULL_LIGHT_SECTION);
    }
    // 0 block light sections
    pkt.writeVarInt(0);

    return PacketBuffer.framePacket(0x24, pkt.toBuffer());
  }

  public createSpawnMobPacket(mob: ProbeMob): Buffer {
    const buf = new PacketBuffer();
    buf.writeVarInt(mob.entityId);
    buf.writeUUID(generateOfflineUuid('mob_' + mob.entityId));
    buf.writeVarInt(MOB_TYPE_1_20[mob.type] ?? mob.type);
    buf.writeDouble(mob.x);
    buf.writeDouble(mob.y);
    buf.writeDouble(mob.z);
    buf.writeUByte(Math.floor(((mob.pitch % 360) * 256) / 360) & 0xff);
    buf.writeUByte(Math.floor(((mob.yaw % 360) * 256) / 360) & 0xff);
    buf.writeUByte(Math.floor(((mob.yaw % 360) * 256) / 360) & 0xff);
    buf.writeVarInt(0); // objectData
    buf.writeShort(0); // velocityX
    buf.writeShort(0); // velocityY
    buf.writeShort(0); // velocityZ

    const spawnPkt = PacketBuffer.framePacket(0x01, buf.toBuffer());

    // Metadata packet (0x52):
    const metaBuf = new PacketBuffer();
    metaBuf.writeVarInt(mob.entityId);

    // Health: index 9, type 3 (Float in 1.20)
    if (mob.health !== undefined) {
      metaBuf.writeUByte(9);
      metaBuf.writeVarInt(3); // Float is type 3 in 1.20
      metaBuf.writeFloat(mob.health);
    }

    // Custom Name: index 2, type 6 (optional_component in 1.20)
    if (mob.name) {
      metaBuf.writeUByte(2);
      metaBuf.writeVarInt(6); // optional_component is type 6 in 1.20
      metaBuf.writeBoolean(true); // present
      metaBuf.writeString(JSON.stringify({ text: mob.name }));

      // Custom Name Visible: index 3, type 8 (Boolean in 1.20)
      metaBuf.writeUByte(3);
      metaBuf.writeVarInt(8); // Boolean is type 8 in 1.20
      metaBuf.writeBoolean(true);
    }

    metaBuf.writeUByte(255); // end of metadata

    const metaPkt = PacketBuffer.framePacket(0x52, metaBuf.toBuffer());

    return Buffer.concat([spawnPkt, metaPkt]);
  }
}
