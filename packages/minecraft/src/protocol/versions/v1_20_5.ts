import { PacketBuffer, generateOfflineUuid } from '../buffer.js';
import { writeAnonymousNbt } from '../nbt.js';
import {
  GameMode,
  type JoinGameOptions,
  type PlayerPositionOptions,
  type ProbeMob,
} from '../types.js';
import type { VersionProfile } from './base.js';
import {
  CHUNK_DATA_1_20_BUFFER,
  FULL_LIGHT_SECTION,
  HEIGHTS_ARRAY,
} from './v1_20.js';

export const HEIGHTMAPS_NBT_1_20_5 = writeAnonymousNbt({
  type: 'compound',
  value: {
    MOTION_BLOCKING: { type: 'longArray', value: HEIGHTS_ARRAY },
    WORLD_SURFACE: { type: 'longArray', value: HEIGHTS_ARRAY },
  },
});

// 1.20.5 / 1.20.6 Mob Type IDs (verified against btc.class in minecraft-1.20.6-client.jar):
const MOB_TYPE_1_20_5: Record<number, number> = {
  54: 124, // Zombie
  50: 23, // Creeper
  51: 91, // Skeleton
  92: 22, // Cow
  90: 77, // Pig
};

/**
 * The 8 network-synchronized registries defined in ala.c in Minecraft 1.20.5/1.20.6.
 * When negotiated via KnownPacks (minecraft:core 1.20.6), the client loads all entries
 * from local assets with zero network NBT overhead (hasTag = false).
 */
export const KNOWN_REGISTRIES_1_20_5: Record<string, string[]> = {
  'minecraft:dimension_type': [
    'minecraft:overworld',
    'minecraft:overworld_caves',
    'minecraft:the_end',
    'minecraft:the_nether',
  ],
  'minecraft:worldgen/biome': [
    'minecraft:badlands',
    'minecraft:bamboo_jungle',
    'minecraft:basalt_deltas',
    'minecraft:beach',
    'minecraft:birch_forest',
    'minecraft:cherry_grove',
    'minecraft:cold_ocean',
    'minecraft:crimson_forest',
    'minecraft:dark_forest',
    'minecraft:deep_cold_ocean',
    'minecraft:deep_dark',
    'minecraft:deep_frozen_ocean',
    'minecraft:deep_lukewarm_ocean',
    'minecraft:deep_ocean',
    'minecraft:desert',
    'minecraft:dripstone_caves',
    'minecraft:end_barrens',
    'minecraft:end_highlands',
    'minecraft:end_midlands',
    'minecraft:eroded_badlands',
    'minecraft:flower_forest',
    'minecraft:forest',
    'minecraft:frozen_ocean',
    'minecraft:frozen_peaks',
    'minecraft:frozen_river',
    'minecraft:grove',
    'minecraft:ice_spikes',
    'minecraft:jagged_peaks',
    'minecraft:jungle',
    'minecraft:lukewarm_ocean',
    'minecraft:lush_caves',
    'minecraft:mangrove_swamp',
    'minecraft:meadow',
    'minecraft:mushroom_fields',
    'minecraft:nether_wastes',
    'minecraft:ocean',
    'minecraft:old_growth_birch_forest',
    'minecraft:old_growth_pine_taiga',
    'minecraft:old_growth_spruce_taiga',
    'minecraft:plains',
    'minecraft:river',
    'minecraft:savanna',
    'minecraft:savanna_plateau',
    'minecraft:small_end_islands',
    'minecraft:snowy_beach',
    'minecraft:snowy_plains',
    'minecraft:snowy_slopes',
    'minecraft:snowy_taiga',
    'minecraft:soul_sand_valley',
    'minecraft:sparse_jungle',
    'minecraft:stony_peaks',
    'minecraft:stony_shore',
    'minecraft:sunflower_plains',
    'minecraft:swamp',
    'minecraft:taiga',
    'minecraft:the_end',
    'minecraft:the_void',
    'minecraft:warm_ocean',
    'minecraft:warped_forest',
    'minecraft:windswept_forest',
    'minecraft:windswept_gravelly_hills',
    'minecraft:windswept_hills',
    'minecraft:windswept_savanna',
    'minecraft:wooded_badlands',
  ],
  'minecraft:chat_type': [
    'minecraft:chat',
    'minecraft:emote_command',
    'minecraft:msg_command_incoming',
    'minecraft:msg_command_outgoing',
    'minecraft:say_command',
    'minecraft:team_msg_command_incoming',
    'minecraft:team_msg_command_outgoing',
  ],
  'minecraft:damage_type': [
    'minecraft:arrow',
    'minecraft:bad_respawn_point',
    'minecraft:cactus',
    'minecraft:cramming',
    'minecraft:dragon_breath',
    'minecraft:drown',
    'minecraft:dry_out',
    'minecraft:explosion',
    'minecraft:fall',
    'minecraft:falling_anvil',
    'minecraft:falling_block',
    'minecraft:falling_stalactite',
    'minecraft:fireball',
    'minecraft:fireworks',
    'minecraft:fly_into_wall',
    'minecraft:freeze',
    'minecraft:generic',
    'minecraft:generic_kill',
    'minecraft:hot_floor',
    'minecraft:in_fire',
    'minecraft:in_wall',
    'minecraft:indirect_magic',
    'minecraft:lava',
    'minecraft:lightning_bolt',
    'minecraft:magic',
    'minecraft:mob_attack',
    'minecraft:mob_attack_no_aggro',
    'minecraft:mob_projectile',
    'minecraft:on_fire',
    'minecraft:out_of_world',
    'minecraft:outside_border',
    'minecraft:player_attack',
    'minecraft:player_explosion',
    'minecraft:sonic_boom',
    'minecraft:spit',
    'minecraft:stalagmite',
    'minecraft:starve',
    'minecraft:sting',
    'minecraft:sweet_berry_bush',
    'minecraft:thorns',
    'minecraft:thrown',
    'minecraft:trident',
    'minecraft:unattributed_fireball',
    'minecraft:wither',
    'minecraft:wither_skull',
  ],
  'minecraft:banner_pattern': [
    'minecraft:base',
    'minecraft:border',
    'minecraft:bricks',
    'minecraft:circle',
    'minecraft:creeper',
    'minecraft:cross',
    'minecraft:curly_border',
    'minecraft:diagonal_left',
    'minecraft:diagonal_right',
    'minecraft:diagonal_up_left',
    'minecraft:diagonal_up_right',
    'minecraft:flower',
    'minecraft:globe',
    'minecraft:gradient',
    'minecraft:gradient_up',
    'minecraft:half_horizontal',
    'minecraft:half_horizontal_bottom',
    'minecraft:half_vertical',
    'minecraft:half_vertical_right',
    'minecraft:mojang',
    'minecraft:piglin',
    'minecraft:rhombus',
    'minecraft:skull',
    'minecraft:small_stripes',
    'minecraft:square_bottom_left',
    'minecraft:square_bottom_right',
    'minecraft:square_top_left',
    'minecraft:square_top_right',
    'minecraft:straight_cross',
    'minecraft:stripe_bottom',
    'minecraft:stripe_center',
    'minecraft:stripe_downleft',
    'minecraft:stripe_downright',
    'minecraft:stripe_left',
    'minecraft:stripe_middle',
    'minecraft:stripe_right',
    'minecraft:stripe_top',
    'minecraft:triangle_bottom',
    'minecraft:triangle_top',
    'minecraft:triangles_bottom',
    'minecraft:triangles_top',
  ],
  'minecraft:wolf_variant': [
    'minecraft:ashen',
    'minecraft:black',
    'minecraft:chestnut',
    'minecraft:pale',
    'minecraft:rusty',
    'minecraft:snowy',
    'minecraft:spotted',
    'minecraft:striped',
    'minecraft:woods',
  ],
  'minecraft:trim_material': [
    'minecraft:amethyst',
    'minecraft:copper',
    'minecraft:diamond',
    'minecraft:emerald',
    'minecraft:gold',
    'minecraft:iron',
    'minecraft:lapis',
    'minecraft:netherite',
    'minecraft:quartz',
    'minecraft:redstone',
  ],
  'minecraft:trim_pattern': [
    'minecraft:coast',
    'minecraft:dune',
    'minecraft:eye',
    'minecraft:host',
    'minecraft:raiser',
    'minecraft:rib',
    'minecraft:sentry',
    'minecraft:shaper',
    'minecraft:silence',
    'minecraft:snout',
    'minecraft:spire',
    'minecraft:tide',
    'minecraft:vex',
    'minecraft:ward',
    'minecraft:wayfinder',
    'minecraft:wild',
  ],
};

export class VersionProfile1_20_5 implements VersionProfile {
  public readonly protocolVersion = 766;
  public readonly minecraftVersion = '1.20.5 - 1.20.6';

  /**
   * Serializes LoginSuccess (0x02 in Login state).
   * In 1.20.5+, includes the 1-byte strictErrorHandling boolean.
   */
  public createLoginSuccessPacket(uuid: string, username: string): Buffer {
    const buf = new PacketBuffer();
    buf.writeUUID(uuid);
    buf.writeString(username);
    buf.writeVarInt(0); // number of properties
    buf.writeBoolean(true); // strictErrorHandling: true (1.20.5+)
    return PacketBuffer.framePacket(0x02, buf.toBuffer());
  }

  /**
   * Serializes Update Enabled Features (0x0C in Configuration state for 1.20.5+).
   */
  public createUpdateEnabledFeaturesPacket(): Buffer {
    const buf = new PacketBuffer();
    buf.writeVarInt(1); // 1 feature
    buf.writeString('minecraft:vanilla');
    return PacketBuffer.framePacket(0x0c, buf.toBuffer());
  }

  /**
   * Serializes Select Known Packs (0x0E in Configuration state for 1.20.5+).
   */
  public createSelectKnownPacksPacket(version: string = '1.20.6'): Buffer {
    const buf = new PacketBuffer();
    buf.writeVarInt(2); // 2 known packs (1.20.6 and 1.20.5 fallback)
    buf.writeString('minecraft');
    buf.writeString('core');
    buf.writeString(version);

    buf.writeString('minecraft');
    buf.writeString('core');
    buf.writeString('1.20.5');
    return PacketBuffer.framePacket(0x0e, buf.toBuffer());
  }

  /**
   * Serializes Registry Data packets (0x07 in Configuration state for 1.20.5+).
   * Generates 8 packets for each synchronized registry.
   */
  public createRegistryDataPackets(): Buffer[] {
    const packets: Buffer[] = [];
    for (const [registryId, entries] of Object.entries(
      KNOWN_REGISTRIES_1_20_5,
    )) {
      const buf = new PacketBuffer();
      buf.writeString(registryId);
      buf.writeVarInt(entries.length);
      for (const entryId of entries) {
        buf.writeString(entryId);
        buf.writeBoolean(false); // hasTag = false (resolved locally via KnownPacks)
      }
      packets.push(PacketBuffer.framePacket(0x07, buf.toBuffer()));
    }
    return packets;
  }

  /**
   * Serializes FinishConfiguration (0x03 in Configuration state for 1.20.5+).
   */
  public createFinishConfigurationPacket(): Buffer {
    return PacketBuffer.framePacket(0x03, Buffer.alloc(0));
  }

  /**
   * Serializes JoinGame (0x2B in Play state for 1.20.5+).
   */
  public createJoinGamePacket(options: JoinGameOptions): Buffer {
    const buf = new PacketBuffer();
    buf.writeInt(options.entityId ?? 1);
    buf.writeBoolean(false); // isHardcore
    // worldNames: collection of dimension identifiers
    buf.writeVarInt(1);
    buf.writeString('minecraft:overworld');
    buf.writeVarInt(options.maxPlayers ?? 60);
    buf.writeVarInt(10); // viewDistance
    buf.writeVarInt(10); // simulationDistance
    buf.writeBoolean(options.reducedDebugInfo ?? false);
    buf.writeBoolean(true); // showDeathScreen
    buf.writeBoolean(false); // doLimitedCrafting

    // CommonPlayerSpawnInfo:
    buf.writeVarInt(0); // dimensionType ID in registry (0 = overworld)
    buf.writeString('minecraft:overworld'); // dimension identifier
    buf.writeLong(0n); // hashedSeed
    buf.writeUByte(options.gameMode ?? GameMode.CREATIVE);
    buf.writeByte(-1); // previousGameMode
    buf.writeBoolean(false); // isDebug
    buf.writeBoolean(true); // isFlat
    buf.writeBoolean(false); // has death location (Optional)
    buf.writeVarInt(0); // portalCooldown

    buf.writeBoolean(false); // enforcesSecureChat (1.20.5+)

    return PacketBuffer.framePacket(0x2b, buf.toBuffer());
  }

  /**
   * Serializes Game Event 13 (LEVEL_CHUNKS_LOAD_START, 0x22 in Play state).
   */
  public createChunksLoadStartPacket(): Buffer {
    const buf = new PacketBuffer();
    buf.writeUByte(13); // reason 13: LEVEL_CHUNKS_LOAD_START
    buf.writeFloat(0.0); // value
    return PacketBuffer.framePacket(0x22, buf.toBuffer());
  }

  /**
   * Serializes Set Default Spawn Position (0x56 in Play state).
   */
  public createSpawnPositionPacket(x: number, y: number, z: number): Buffer {
    const buf = new PacketBuffer();
    buf.writePositionModern(x, y, z);
    buf.writeFloat(0.0); // angle
    return PacketBuffer.framePacket(0x56, buf.toBuffer());
  }

  /**
   * Serializes Player Position and Look (0x40 in Play state).
   */
  public createPlayerPositionPacket(options: PlayerPositionOptions): Buffer {
    const buf = new PacketBuffer();
    buf.writeDouble(options.x);
    buf.writeDouble(options.y);
    buf.writeDouble(options.z);
    buf.writeFloat(options.yaw ?? 0.0);
    buf.writeFloat(options.pitch ?? 0.0);
    buf.writeByte(options.flags ?? 0);
    buf.writeVarInt(options.teleportId ?? 1);
    return PacketBuffer.framePacket(0x40, buf.toBuffer());
  }

  /**
   * Serializes Set Chunk Cache Center (Update View Position, 0x54 in Play state).
   */
  public createUpdateViewPositionPacket(
    chunkX: number,
    chunkZ: number,
  ): Buffer {
    const buf = new PacketBuffer();
    buf.writeVarInt(chunkX);
    buf.writeVarInt(chunkZ);
    return PacketBuffer.framePacket(0x54, buf.toBuffer());
  }

  /**
   * Serializes KeepAlive (0x26 in Play state).
   */
  public createKeepAlivePacket(keepAliveId: number | bigint): Buffer {
    const buf = new PacketBuffer();
    buf.writeLong(BigInt(keepAliveId));
    return PacketBuffer.framePacket(0x26, buf.toBuffer());
  }

  /**
   * Parses serverbound KeepAlive response (0x18 in Play state).
   */
  public parseKeepAliveResponse(payload: Buffer): number | bigint {
    const buf = new PacketBuffer(payload);
    return buf.readLong();
  }

  /**
   * Serializes Disconnect (0x1D in Play state) using NBT Component format.
   */
  public createDisconnectPacket(reason: string): Buffer {
    const nbtBuf = writeAnonymousNbt({
      type: 'compound',
      value: {
        text: { type: 'string', value: reason },
      },
    });
    return PacketBuffer.framePacket(0x1d, nbtBuf);
  }

  /**
   * Serializes System Chat (0x6C in Play state) using NBT Component format.
   */
  public createChatMessagePacket(
    message: string,
    color: string = 'green',
  ): Buffer {
    const nbtBuf = writeAnonymousNbt({
      type: 'compound',
      value: {
        text: { type: 'string', value: message },
        color: { type: 'string', value: color },
      },
    });
    const buf = new PacketBuffer();
    buf.writeBuffer(nbtBuf);
    buf.writeBoolean(false); // isActionBar
    return PacketBuffer.framePacket(0x6c, buf.toBuffer());
  }

  /**
   * Serializes Player Abilities (0x38 in Play state).
   */
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
    return PacketBuffer.framePacket(0x38, buf.toBuffer());
  }

  /**
   * Serializes Level Chunk with Light (0x27 in Play state).
   */
  public createFlatChunkPacket(chunkX: number, chunkZ: number): Buffer {
    const pkt = new PacketBuffer();
    pkt.writeInt(chunkX);
    pkt.writeInt(chunkZ);
    pkt.writeBuffer(HEIGHTMAPS_NBT_1_20_5);
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

    return PacketBuffer.framePacket(0x27, pkt.toBuffer());
  }

  /**
   * Serializes Spawn Mob (0x01 add_entity) + Metadata (0x58 set_entity_data).
   */
  public createSpawnMobPacket(mob: ProbeMob): Buffer {
    const buf = new PacketBuffer();
    buf.writeVarInt(mob.entityId);
    buf.writeUUID(generateOfflineUuid('mob_' + mob.entityId));
    buf.writeVarInt(MOB_TYPE_1_20_5[mob.type] ?? mob.type);
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

    // Metadata packet (0x58 in 1.20.5+):
    const metaBuf = new PacketBuffer();
    metaBuf.writeVarInt(mob.entityId);

    // Health: index 9, type 3 (Float)
    if (mob.health !== undefined) {
      metaBuf.writeUByte(9);
      metaBuf.writeVarInt(3); // Float is type 3
      metaBuf.writeFloat(mob.health);
    }

    // Custom Name: index 2, type 6 (optional_component)
    if (mob.name) {
      metaBuf.writeUByte(2);
      metaBuf.writeVarInt(6); // optional_component is type 6
      metaBuf.writeBoolean(true); // present
      const nameNbt = writeAnonymousNbt({
        type: 'compound',
        value: {
          text: { type: 'string', value: mob.name },
        },
      });
      metaBuf.writeBuffer(nameNbt);

      // Custom Name Visible: index 3, type 8 (Boolean)
      metaBuf.writeUByte(3);
      metaBuf.writeVarInt(8); // Boolean is type 8
      metaBuf.writeBoolean(true);
    }

    metaBuf.writeUByte(255); // end of metadata

    const metaPkt = PacketBuffer.framePacket(0x58, metaBuf.toBuffer());

    return Buffer.concat([spawnPkt, metaPkt]);
  }
}
