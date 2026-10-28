export enum ConnectionState {
  HANDSHAKING = 0,
  STATUS = 1,
  LOGIN = 2,
  PLAY = 3,
  CONFIGURATION = 4,
  CLOSED = 5,
}

export enum GameMode {
  SURVIVAL = 0,
  CREATIVE = 1,
  ADVENTURE = 2,
  SPECTATOR = 3,
}

export enum Dimension {
  NETHER = -1,
  OVERWORLD = 0,
  END = 1,
}

export enum Difficulty {
  PEACEFUL = 0,
  EASY = 1,
  NORMAL = 2,
  HARD = 3,
}

export enum KnownProtocolVersion {
  V1_5_2 = 61,
  V1_7_10 = 5,
  V1_8_9 = 47,
  V1_9_4 = 110,
  V1_12_2 = 340,
  V1_14_4 = 498,
  V1_15_2 = 578,
  V1_16_5 = 754,
  V1_18_2 = 758,
  V1_19_4 = 762,
  V1_20_4 = 765,
  V1_20_6 = 766,
}

export const PROTOCOL_VERSION_NAMES: Record<number, string> = {
  // Pre-Netty / Classic / Beta / Early Release
  61: '1.5.2',
  60: '1.5 - 1.5.1',
  51: '1.4.6 - 1.4.7',
  49: '1.4.4 - 1.4.5',
  48: '1.4.2',
  39: '1.3.1 - 1.3.2',
  29: '1.2.4 - 1.2.5',
  28: '1.2.1 - 1.2.3',
  23: '1.1',
  22: '1.0.0 - 1.0.1',

  // Modern Netty (1.7 - 1.21+)
  4: '1.7.2 - 1.7.5',
  5: '1.7.6 - 1.7.10',
  47: '1.8 - 1.8.9',
  107: '1.9',
  108: '1.9.1',
  109: '1.9.2',
  110: '1.9.3 - 1.9.4',
  210: '1.10 - 1.10.2',
  315: '1.11',
  316: '1.11.1 - 1.11.2',
  335: '1.12',
  338: '1.12.1',
  340: '1.12.2',
  393: '1.13',
  401: '1.13.1',
  404: '1.13.2',
  477: '1.14',
  480: '1.14.1',
  485: '1.14.2',
  490: '1.14.3',
  498: '1.14.4',
  573: '1.15',
  575: '1.15.1',
  578: '1.15.2',
  735: '1.16',
  736: '1.16.1',
  751: '1.16.2',
  753: '1.16.3',
  754: '1.16.4 - 1.16.5',
  755: '1.17',
  756: '1.17.1',
  757: '1.18 - 1.18.1',
  758: '1.18.2',
  759: '1.19',
  760: '1.19.1 - 1.19.2',
  761: '1.19.3',
  762: '1.19.4',
  763: '1.20 - 1.20.1',
  764: '1.20.2',
  765: '1.20.3 - 1.20.4',
  766: '1.20.5 - 1.20.6',
  767: '1.21 - 1.21.1',
  768: '1.21.2 - 1.21.3',
  769: '1.21.4',
  770: '1.21.5+',
};

/**
 * Returns the exact Minecraft release version or version range for a given protocol number.
 */
export function getProtocolVersionName(protocolVersion: number): string {
  if (PROTOCOL_VERSION_NAMES[protocolVersion]) {
    return PROTOCOL_VERSION_NAMES[protocolVersion];
  }
  if (protocolVersion >= 767) return '1.21.x+';
  if (protocolVersion >= 763) return '1.20.x';
  if (protocolVersion >= 759) return '1.19.x';
  if (protocolVersion >= 757) return '1.18.x';
  if (protocolVersion >= 755) return '1.17.x';
  if (protocolVersion >= 735) return '1.16.x';
  if (protocolVersion >= 573) return '1.15.x';
  if (protocolVersion >= 477) return '1.14.x';
  if (protocolVersion >= 393) return '1.13.x';
  if (protocolVersion >= 335) return '1.12.x';
  if (protocolVersion >= 315) return '1.11.x';
  if (protocolVersion >= 210) return '1.10.x';
  if (protocolVersion >= 107) return '1.9.x';
  if (protocolVersion >= 47) return '1.8.x';
  if (protocolVersion >= 4) return '1.7.x';
  return `Protocol ${protocolVersion}`;
}

export interface HandshakePacket {
  protocolVersion: number;
  serverAddress: string;
  serverPort: number;
  nextState: ConnectionState;
}

export interface LoginStartPacket {
  username: string;
  uuid?: string;
}

export interface JoinGameOptions {
  entityId?: number;
  gameMode?: GameMode;
  dimension?: number;
  difficulty?: Difficulty;
  maxPlayers?: number;
  levelType?: string;
  reducedDebugInfo?: boolean;
}

export interface PlayerPositionOptions {
  x: number;
  y: number;
  z: number;
  yaw?: number;
  pitch?: number;
  flags?: number;
  teleportId?: number;
}

export interface ServerStatusOptions {
  versionName?: string;
  protocolVersion?: number;
  maxPlayers?: number;
  onlinePlayers?: number;
  description?: string;
  favicon?: string;
}

export interface ProbeMob {
  entityId: number;
  type: number; // 54=Zombie, 50=Creeper, 51=Skeleton, 92=Cow, 90=Pig
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
}

export const DEFAULT_CALIBRATION_SPAWN = {
  x: 1337.5,
  y: 5.0,
  z: 777.5,
  yaw: 0.0,
  pitch: 0.0,
};

export const DEFAULT_PROBE_MOBS: ProbeMob[] = [
  {
    entityId: 1001,
    type: 54, // Zombie
    name: '§c[ProbeZombie] §eHP: 18.5',
    x: 1337.5,
    y: 8.0,
    z: 771.5,
    yaw: 180.0,
    pitch: 10.0,
    health: 18.5,
  },
  {
    entityId: 1002,
    type: 50, // Creeper
    name: '§a[ProbeCreeper] §eHP: 14.25',
    x: 1332.5,
    y: 10.0,
    z: 774.5,
    yaw: 110.0,
    pitch: -15.0,
    health: 14.25,
  },
  {
    entityId: 1003,
    type: 51, // Skeleton
    name: '§7[ProbeSkeleton] §eHP: 11.75',
    x: 1342.5,
    y: 9.0,
    z: 774.5,
    yaw: -110.0,
    pitch: 20.0,
    health: 11.75,
  },
  {
    entityId: 1004,
    type: 92, // Cow
    name: '§6[ProbeCow] §eHP: 8.5',
    x: 1337.5,
    y: 12.0,
    z: 783.5,
    yaw: 0.0,
    pitch: -5.0,
    health: 8.5,
  },
  {
    entityId: 1005,
    type: 90, // Pig
    name: '§d[ProbePig] §eHP: 9.0',
    x: 1334.0,
    y: 6.5,
    z: 780.0,
    yaw: 35.0,
    pitch: 0.0,
    health: 9.0,
  },
];
