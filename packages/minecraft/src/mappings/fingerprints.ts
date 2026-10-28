import type {
  ReflectedClass,
  ReflectedField,
  ReflectedConstructor,
} from 'bun-njava';

/**
 * Structural Fingerprint and Classification Engine for Minecraft Classes and Members.
 * Detects canonical Minecraft types purely from structure (inheritance chain,
 * constructor signatures, declared field counts/types) without assuming any obfuscated names.
 */
export class StructuralFingerprintEngine {
  constructor() {}

  public cleanTypeName(raw: string | null | undefined): string {
    if (!raw) return '';
    return raw.replace(/^(class|interface)\s+/, '').trim();
  }

  public extractArrayBaseType(
    raw: string | null | undefined,
  ): string | undefined {
    if (!raw) return undefined;
    const clean = this.cleanTypeName(raw);
    if (clean.endsWith('[]')) {
      return clean.slice(0, -2);
    }
    if (clean.startsWith('[L') && clean.endsWith(';')) {
      return clean.slice(2, -1);
    }
    return undefined;
  }

  /**
   * Checks if `cls` is the Minecraft root singleton class.
   * Signature: has static field of its own type and >= 30 declared fields.
   */
  public async isMinecraftRoot(
    cls: ReflectedClass,
    fields?: ReflectedField[],
  ): Promise<boolean> {
    const fList = fields ?? (await cls.getDeclaredFields());
    const selfStatic = fList.some(
      (f) =>
        f.isStatic && (f.type === cls.name || f.type === `class ${cls.name}`),
    );
    return selfStatic && fList.length >= 30;
  }

  /**
   * Checks if `cls` is EntityPlayerSP.
   * Signature: inheritance chain depth >= 5 (EntityPlayerSP -> AbstractClientPlayer -> EntityPlayer -> EntityLivingBase -> Entity -> Object).
   */
  public async isEntityPlayerSP(
    cls: ReflectedClass,
    chain?: string[],
  ): Promise<boolean> {
    const c = chain ?? (await cls.getSuperclassChain());
    return c.length >= 5;
  }

  /**
   * Checks if `cls` is WorldClient.
   * Signature: inheritance chain depth === 3 (WorldClient -> World -> Object) and superclass has List/Set fields.
   */
  public async isWorldClient(
    cls: ReflectedClass,
    chain?: string[],
  ): Promise<boolean> {
    const c = chain ?? (await cls.getSuperclassChain());
    if (c.length !== 3) return false;
    const superCls = await cls.getSuperclass();
    if (!superCls) return false;
    const superFields = await superCls.getDeclaredFields();
    const listFields = superFields.filter(
      (f) => f.type && (f.type.includes('List') || f.type.includes('Set')),
    );
    return listFields.length >= 2;
  }

  /**
   * Checks if `cls` is Timer.
   * Signature: constructor with 1 float parameter, declared fields include float and double.
   */
  public async isTimer(
    cls: ReflectedClass,
    ctors?: ReflectedConstructor[],
  ): Promise<boolean> {
    const cList = ctors ?? (await cls.getDeclaredConstructors());
    return cList.some(
      (c) => c.paramTypes.length === 1 && c.paramTypes[0] === 'float',
    );
  }

  /**
   * Checks if `cls` is GameSettings.
   * Signature: constructor with (Minecraft, File).
   */
  public async isGameSettings(
    cls: ReflectedClass,
    mcName: string,
    ctors?: ReflectedConstructor[],
  ): Promise<boolean> {
    const cList = ctors ?? (await cls.getDeclaredConstructors());
    return cList.some(
      (c) =>
        c.paramTypes.length === 2 &&
        (c.paramTypes[0] === mcName || c.paramTypes[0] === `class ${mcName}`) &&
        (c.paramTypes[1] === 'java.io.File' || c.paramTypes[1] === 'File'),
    );
  }

  /**
   * Checks if `cls` is PlayerControllerMP.
   * Signature: constructor with (Minecraft, NetHandlerPlayClient).
   */
  public async isPlayerControllerMP(
    cls: ReflectedClass,
    mcName: string,
    netHandlerName: string,
    ctors?: ReflectedConstructor[],
  ): Promise<boolean> {
    const cList = ctors ?? (await cls.getDeclaredConstructors());
    return cList.some(
      (c) =>
        c.paramTypes.length === 2 &&
        (c.paramTypes[0] === mcName || c.paramTypes[0] === `class ${mcName}`) &&
        (c.paramTypes[1] === netHandlerName ||
          c.paramTypes[1] === `class ${netHandlerName}`),
    );
  }

  /**
   * Checks if `cls` is KeyBinding.
   * Signature: constructor with (String, int, String).
   */
  public async isKeyBinding(
    cls: ReflectedClass,
    ctors?: ReflectedConstructor[],
  ): Promise<boolean> {
    const cList = ctors ?? (await cls.getDeclaredConstructors());
    return cList.some(
      (c) =>
        c.paramTypes.length === 3 &&
        (c.paramTypes[0] === 'java.lang.String' ||
          c.paramTypes[0] === 'String') &&
        c.paramTypes[1] === 'int' &&
        (c.paramTypes[2] === 'java.lang.String' ||
          c.paramTypes[2] === 'String'),
    );
  }

  /**
   * Matches MovementInput structural fingerprint: 2 float fields (strafe, forward) and 2+ boolean fields (jump, sneak).
   */
  public matchMovementInput(fields: ReflectedField[]):
    | {
        moveStrafe?: string;
        moveForward?: string;
        jump?: string;
        sneak?: string;
      }
    | undefined {
    const floats = fields.filter((f) => f.type === 'float');
    const bools = fields.filter((f) => f.type === 'boolean');
    if (floats.length === 2 && bools.length >= 2 && fields.length <= 4) {
      return {
        moveStrafe: floats[0]?.name,
        moveForward: floats[1]?.name,
        jump: bools[0]?.name,
        sneak: bools[1]?.name,
      };
    }
    return undefined;
  }

  /**
   * Matches FoodStats structural fingerprint: 2 floats and 3 ints.
   */
  public matchFoodStats(fields: ReflectedField[]):
    | {
        foodLevel?: string;
        foodSaturationLevel?: string;
        foodExhaustionLevel?: string;
        foodTimer?: string;
        prevFoodLevel?: string;
      }
    | undefined {
    const floats = fields.filter((f) => f.type === 'float');
    const ints = fields.filter((f) => f.type === 'int');
    if (floats.length === 2 && ints.length >= 3 && fields.length <= 5) {
      return {
        foodLevel: ints[0]?.name,
        foodSaturationLevel: floats[0]?.name,
        foodExhaustionLevel: floats[1]?.name,
        foodTimer: ints[1]?.name,
        prevFoodLevel: ints[2]?.name,
      };
    }
    return undefined;
  }

  /**
   * Matches AxisAlignedBB structural fingerprint: 6 double fields (minX, minY, minZ, maxX, maxY, maxZ).
   */
  public matchAxisAlignedBB(fields: ReflectedField[]):
    | {
        minX?: string;
        minY?: string;
        minZ?: string;
        maxX?: string;
        maxY?: string;
        maxZ?: string;
      }
    | undefined {
    const doubles = fields.filter((f) => f.type === 'double');
    if (doubles.length >= 6) {
      return {
        minX: doubles[0]?.name,
        minY: doubles[1]?.name,
        minZ: doubles[2]?.name,
        maxX: doubles[3]?.name,
        maxY: doubles[4]?.name,
        maxZ: doubles[5]?.name,
      };
    }
    return undefined;
  }

  /**
   * Matches Vec3 structural fingerprint: 3 double fields (xCoord, yCoord, zCoord).
   */
  public matchVec3(fields: ReflectedField[]):
    | {
        xCoord?: string;
        yCoord?: string;
        zCoord?: string;
      }
    | undefined {
    const doubles = fields.filter((f) => f.type === 'double');
    if (doubles.length === 3) {
      return {
        xCoord: doubles[0]?.name,
        yCoord: doubles[1]?.name,
        zCoord: doubles[2]?.name,
      };
    }
    return undefined;
  }
}
