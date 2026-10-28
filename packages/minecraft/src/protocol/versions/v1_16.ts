import { PacketBuffer, generateOfflineUuid } from '../buffer.js';
import { type NbtTag, writeNbt } from '../nbt.js';
import {
  GameMode,
  type JoinGameOptions,
  type PlayerPositionOptions,
  type ProbeMob,
} from '../types.js';
import type { VersionProfile } from './base.js';

const MINIMAL_DIMENSION_TYPE: Record<string, NbtTag> = {
  piglin_safe: { type: 'byte', value: 0 },
  natural: { type: 'byte', value: 1 },
  ambient_light: { type: 'float', value: 1.0 },
  infiniburn: { type: 'string', value: 'minecraft:infiniburn_overworld' },
  respawn_anchor_works: { type: 'byte', value: 0 },
  has_skylight: { type: 'byte', value: 1 },
  bed_works: { type: 'byte', value: 1 },
  effects: { type: 'string', value: 'minecraft:overworld' },
  has_raids: { type: 'byte', value: 1 },
  logical_height: { type: 'int', value: 256 },
  coordinate_scale: { type: 'double', value: 1.0 },
  ultrawarm: { type: 'byte', value: 0 },
  has_ceiling: { type: 'byte', value: 0 },
};

const MINIMAL_CODEC_NBT: NbtTag = {
  type: 'compound',
  value: {
    'minecraft:dimension_type': {
      type: 'compound',
      value: {
        type: { type: 'string', value: 'minecraft:dimension_type' },
        value: {
          type: 'list',
          value: {
            type: 'compound',
            value: [
              {
                name: { type: 'string', value: 'minecraft:overworld' },
                id: { type: 'int', value: 0 },
                element: {
                  type: 'compound',
                  value: MINIMAL_DIMENSION_TYPE,
                },
              },
            ],
          },
        },
      },
    },
    'minecraft:worldgen/biome': {
      type: 'compound',
      value: {
        type: { type: 'string', value: 'minecraft:worldgen/biome' },
        value: {
          type: 'list',
          value: {
            type: 'compound',
            value: [
              {
                name: { type: 'string', value: 'minecraft:plains' },
                id: { type: 'int', value: 0 },
                element: {
                  type: 'compound',
                  value: {
                    precipitation: { type: 'string', value: 'rain' },
                    depth: { type: 'float', value: 0.125 },
                    temperature: { type: 'float', value: 0.8 },
                    scale: { type: 'float', value: 0.05 },
                    downfall: { type: 'float', value: 0.4 },
                    category: { type: 'string', value: 'plains' },
                    effects: {
                      type: 'compound',
                      value: {
                        sky_color: { type: 'int', value: 7907327 },
                        water_fog_color: { type: 'int', value: 329011 },
                        fog_color: { type: 'int', value: 12638463 },
                        water_color: { type: 'int', value: 4159204 },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  },
};

const CODEC_BUFFER = writeNbt(MINIMAL_CODEC_NBT);
const DIMENSION_BUFFER = writeNbt({
  type: 'compound',
  value: MINIMAL_DIMENSION_TYPE,
});

// Pre-computed 1.16 heightmaps:
// 37 longs with 7 packed 9-bit heights of 5 in each long (and 4 in the 37th long)
const HEIGHT_VAL_7 =
  5n |
  (5n << 9n) |
  (5n << 18n) |
  (5n << 27n) |
  (5n << 36n) |
  (5n << 45n) |
  (5n << 54n);
const HEIGHT_VAL_4 = 5n | (5n << 9n) | (5n << 18n) | (5n << 27n);
const HEIGHTS_ARRAY = new Array(37).fill(HEIGHT_VAL_7);
HEIGHTS_ARRAY[36] = HEIGHT_VAL_4;

const HEIGHTMAPS_NBT_BUFFER = writeNbt({
  type: 'compound',
  value: {
    MOTION_BLOCKING: { type: 'longArray', value: HEIGHTS_ARRAY },
    WORLD_SURFACE: { type: 'longArray', value: HEIGHTS_ARRAY },
  },
});

// Pre-computed section 0 (Y=0..15):
// Bedrock at Y=0, Dirt at Y=1..3, Grass at Y=4, Air above
const SECTION_BUFFER = (() => {
  const sec = new PacketBuffer();
  sec.writeShort(1280); // solid block count (256 bedrock + 768 dirt + 256 grass)
  sec.writeUByte(4); // bitsPerBlock
  sec.writeVarInt(4); // palette length
  sec.writeVarInt(0); // 0 = air
  sec.writeVarInt(33); // 1 = bedrock
  sec.writeVarInt(10); // 2 = dirt
  sec.writeVarInt(9); // 3 = grass_block
  sec.writeVarInt(256); // 256 longs
  for (let i = 0; i < 16; i++) sec.writeLong(0x1111111111111111n); // Y=0: Bedrock
  for (let i = 0; i < 48; i++) sec.writeLong(0x2222222222222222n); // Y=1..3: Dirt
  for (let i = 0; i < 16; i++) sec.writeLong(0x3333333333333333n); // Y=4: Grass
  for (let i = 0; i < 176; i++) sec.writeLong(0n); // Y=5..15: Air
  return sec.toBuffer();
})();

// 1024 zeroes for biomes
const BIOMES_1024_BUFFER = Buffer.alloc(1024, 0);

// Pre-computed daylight buffer for 18 sections
const FULL_LIGHT_SECTION = Buffer.alloc(2048, 0xff);

// 1.16 Mob Type IDs:
const MOB_TYPE_1_16: Record<number, number> = {
  54: 102, // Zombie
  50: 12, // Creeper
  51: 73, // Skeleton
  92: 11, // Cow
  90: 59, // Pig
};

export class VersionProfile1_16 implements VersionProfile {
  public readonly protocolVersion = 754;
  public readonly minecraftVersion = '1.16.x (1.16.4 - 1.16.5)';

  public createLoginSuccessPacket(uuid: string, username: string): Buffer {
    const buf = new PacketBuffer();
    buf.writeUUID(uuid);
    buf.writeString(username);
    return PacketBuffer.framePacket(0x02, buf.toBuffer());
  }

  public createJoinGamePacket(options: JoinGameOptions): Buffer {
    const buf = new PacketBuffer();
    buf.writeInt(options.entityId ?? 1);
    buf.writeBoolean(false); // isHardcore
    buf.writeUByte(options.gameMode ?? GameMode.CREATIVE);
    buf.writeByte(-1); // previousGameMode
    // worldNames array
    buf.writeVarInt(1);
    buf.writeString('minecraft:overworld');
    // NBT dimension codec and dimension
    buf.writeBuffer(CODEC_BUFFER);
    buf.writeBuffer(DIMENSION_BUFFER);
    buf.writeString('minecraft:overworld');
    buf.writeLong(0n); // hashedSeed
    buf.writeVarInt(options.maxPlayers ?? 60);
    buf.writeVarInt(10); // viewDistance
    buf.writeBoolean(options.reducedDebugInfo ?? false);
    buf.writeBoolean(true); // enableRespawnScreen
    buf.writeBoolean(false); // isDebug
    buf.writeBoolean(true); // isFlat
    return PacketBuffer.framePacket(0x24, buf.toBuffer());
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
    return PacketBuffer.framePacket(0x34, buf.toBuffer());
  }

  public createUpdateViewPositionPacket(
    chunkX: number,
    chunkZ: number,
  ): Buffer {
    const buf = new PacketBuffer();
    buf.writeVarInt(chunkX);
    buf.writeVarInt(chunkZ);
    return PacketBuffer.framePacket(0x40, buf.toBuffer());
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
    return PacketBuffer.framePacket(0x19, buf.toBuffer());
  }

  public createChatMessagePacket(
    message: string,
    color: string = 'green',
  ): Buffer {
    const buf = new PacketBuffer();
    buf.writeString(JSON.stringify({ text: message, color }));
    buf.writeByte(0); // 0 = standard chat box
    buf.writeUUID('00000000-0000-0000-0000-000000000000'); // system sender UUID
    return PacketBuffer.framePacket(0x0e, buf.toBuffer());
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
    return PacketBuffer.framePacket(0x30, buf.toBuffer());
  }

  public createFlatChunkPacket(chunkX: number, chunkZ: number): Buffer {
    // 1. Packet 0x20: map_chunk
    const chunkPkt = new PacketBuffer();
    chunkPkt.writeInt(chunkX);
    chunkPkt.writeInt(chunkZ);
    chunkPkt.writeBoolean(true); // groundUp
    chunkPkt.writeVarInt(1); // bitMap: section 0
    chunkPkt.writeBuffer(HEIGHTMAPS_NBT_BUFFER);
    // Biomes:
    chunkPkt.writeVarInt(1024);
    chunkPkt.writeBuffer(BIOMES_1024_BUFFER);
    // Section 0 block states:
    chunkPkt.writeByteArray(SECTION_BUFFER);
    // Block entities:
    chunkPkt.writeVarInt(0);

    const framedChunk = PacketBuffer.framePacket(0x20, chunkPkt.toBuffer());

    // 2. Packet 0x23: update_light
    const lightPkt = new PacketBuffer();
    lightPkt.writeVarInt(chunkX);
    lightPkt.writeVarInt(chunkZ);
    lightPkt.writeBoolean(true); // trustEdges
    lightPkt.writeVarInt(0x3ffff); // skyLightMask: all 18 sections lit
    lightPkt.writeVarInt(0); // blockLightMask
    lightPkt.writeVarInt(0); // emptySkyLightMask
    lightPkt.writeVarInt(0x3ffff); // emptyBlockLightMask: 0 block light in all sections

    for (let s = 0; s < 18; s++) {
      lightPkt.writeVarInt(2048);
      lightPkt.writeBuffer(FULL_LIGHT_SECTION);
    }

    const framedLight = PacketBuffer.framePacket(0x23, lightPkt.toBuffer());

    return Buffer.concat([framedChunk, framedLight]);
  }

  public createSpawnMobPacket(mob: ProbeMob): Buffer {
    const buf = new PacketBuffer();
    buf.writeVarInt(mob.entityId);
    buf.writeUUID(generateOfflineUuid('mob_' + mob.entityId));
    buf.writeVarInt(MOB_TYPE_1_16[mob.type] ?? mob.type);
    buf.writeDouble(mob.x);
    buf.writeDouble(mob.y);
    buf.writeDouble(mob.z);
    buf.writeUByte(Math.floor(((mob.yaw % 360) * 256) / 360) & 0xff);
    buf.writeUByte(Math.floor(((mob.pitch % 360) * 256) / 360) & 0xff);
    buf.writeUByte(Math.floor(((mob.yaw % 360) * 256) / 360) & 0xff);
    buf.writeShort(0); // velocityX
    buf.writeShort(0); // velocityY
    buf.writeShort(0); // velocityZ

    const spawnPkt = PacketBuffer.framePacket(0x02, buf.toBuffer());

    // Metadata packet (0x44):
    const metaBuf = new PacketBuffer();
    metaBuf.writeVarInt(mob.entityId);

    // Health: index 9, type 2 (Float)
    if (mob.health !== undefined) {
      metaBuf.writeUByte(9);
      metaBuf.writeVarInt(2);
      metaBuf.writeFloat(mob.health);
    }

    // Custom Name: index 2, type 5 (OptChat)
    if (mob.name) {
      metaBuf.writeUByte(2);
      metaBuf.writeVarInt(5);
      metaBuf.writeBoolean(true); // present
      metaBuf.writeString(JSON.stringify({ text: mob.name }));

      // Custom Name Visible: index 3, type 7 (Boolean)
      metaBuf.writeUByte(3);
      metaBuf.writeVarInt(7);
      metaBuf.writeBoolean(true);
    }

    metaBuf.writeUByte(255); // end of metadata

    const metaPkt = PacketBuffer.framePacket(0x44, metaBuf.toBuffer());

    return Buffer.concat([spawnPkt, metaPkt]);
  }
}
