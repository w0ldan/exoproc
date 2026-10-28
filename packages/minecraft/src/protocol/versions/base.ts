import type {
  JoinGameOptions,
  PlayerPositionOptions,
  ProbeMob,
} from '../types.js';

export interface VersionProfile {
  readonly protocolVersion: number;
  readonly minecraftVersion: string;

  /**
   * Serializes the LoginSuccess packet (State: Login -> Play or Login -> Configuration).
   */
  createLoginSuccessPacket(uuid: string, username: string): Buffer;

  /**
   * Serializes the FinishConfiguration packet (for 1.20.2+ Configuration state) (optional).
   */
  createFinishConfigurationPacket?(): Buffer;

  /**
   * Serializes the JoinGame / Login (Play) packet.
   */
  createJoinGamePacket(options: JoinGameOptions): Buffer;

  /**
   * Serializes the PlayerPositionAndLook packet to place the player in world.
   */
  createPlayerPositionPacket(options: PlayerPositionOptions): Buffer;

  /**
   * Serializes a KeepAlive packet (heartbeat).
   */
  createKeepAlivePacket(keepAliveId: number | bigint): Buffer;

  /**
   * Parses client KeepAlive response into a numeric ID.
   */
  parseKeepAliveResponse(payload: Buffer): number | bigint;

  /**
   * Serializes a Play-state Disconnect packet.
   */
  createDisconnectPacket(reason: string): Buffer;

  /**
   * Serializes a flat chunk for visual platform loading (optional).
   */
  createFlatChunkPacket?(chunkX: number, chunkZ: number): Buffer;

  /**
   * Serializes a chat message (optional).
   */
  createChatMessagePacket?(message: string, color?: string): Buffer;

  /**
   * Serializes player abilities (flying, speed) (optional).
   */
  createPlayerAbilitiesPacket?(
    isFlying?: boolean,
    canFly?: boolean,
    isCreative?: boolean,
  ): Buffer;

  /**
   * Serializes Update View Position (chunk cache center) packet for 1.14+ (optional).
   */
  createUpdateViewPositionPacket?(chunkX: number, chunkZ: number): Buffer;

  /**
   * Serializes Level Chunks Load Start (Game Event 13) for 1.20+ (optional).
   */
  createChunksLoadStartPacket?(): Buffer;

  /**
   * Serializes Set Default Spawn Position packet (optional).
   */
  createSpawnPositionPacket?(x: number, y: number, z: number): Buffer;

  /**
   * Serializes a living entity/mob spawn packet (optional).
   */
  createSpawnMobPacket?(mob: ProbeMob): Buffer;

  /**
   * Serializes Update Enabled Features packet for 1.20.5+ Configuration state (optional).
   */
  createUpdateEnabledFeaturesPacket?(): Buffer;

  /**
   * Serializes Select Known Packs packet for 1.20.5+ Configuration state (optional).
   */
  createSelectKnownPacksPacket?(version?: string): Buffer;

  /**
   * Serializes Registry Data packets for 1.20.5+ Configuration state (optional).
   */
  createRegistryDataPackets?(): Buffer[];
}
