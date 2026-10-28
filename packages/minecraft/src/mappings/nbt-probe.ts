import type {
  ReflectionBridge,
  ReflectedClass,
  ReflectedMethod,
} from 'bun-njava';

export interface NbtFieldProbeRule {
  canonicalFieldName: string;
  nbtTagKey: string;
  type: 'double' | 'float' | 'int' | 'boolean' | 'short' | 'byte' | 'String';
  listIndex?: number;
}

export interface NbtClassProbeSpec {
  nbtMethodsParamType?: string;
  writeMethodHint?: string;
  readMethodHint?: string;
  rules: NbtFieldProbeRule[];
}

/**
 * Generic Differential NBT Probe engine that uses un-obfuscated NBT serialization
 * strings and mathematical differential vectors to discover exact field names
 * and write/read methods on any Minecraft entity, capability, item, or tile entity.
 */
export class NbtDifferentialProbe {
  constructor(private readonly bridge: ReflectionBridge) {}

  /**
   * Identifies the NBT read and write methods on `cls` by invoking them on a test instance
   * and checking whether the passed NBT tag compound was populated.
   */
  public async discoverNbtMethods(
    cls: ReflectedClass,
    nbtTagCompoundCls: ReflectedClass,
    instancePtr?: bigint,
  ): Promise<{ writeMethod?: ReflectedMethod; readMethod?: ReflectedMethod }> {
    const allMethods = await cls.getAllMethods();
    const nbtCompoundName = nbtTagCompoundCls.name;

    const candidates = allMethods.filter(
      (m) =>
        m.returnType === 'void' &&
        m.paramTypes.length === 1 &&
        (m.paramTypes[0] === nbtCompoundName ||
          m.paramTypes[0] === `class ${nbtCompoundName}`),
    );

    if (candidates.length === 0) return {};

    const nbtCtors = await nbtTagCompoundCls.getDeclaredConstructors();
    const nbtDefaultCtor = nbtCtors.find((c) => c.paramTypes.length === 0);
    if (!nbtDefaultCtor) return {};

    let targetInstance = instancePtr;
    if (!targetInstance) {
      const clsCtors = await cls.getDeclaredConstructors();
      const defaultCtor = clsCtors.find((c) => c.paramTypes.length === 0);
      if (defaultCtor) {
        try {
          targetInstance = await this.bridge.construct(defaultCtor.ctorObj, []);
        } catch {}
      }
    }

    if (!targetInstance) {
      // Return candidates if instance creation is not possible
      return {
        writeMethod: candidates[0],
        readMethod: candidates[1] ?? candidates[0],
      };
    }

    let writeMethod: ReflectedMethod | undefined;
    let readMethod: ReflectedMethod | undefined;

    for (const cand of candidates) {
      const testNbt = await this.bridge.construct(nbtDefaultCtor.ctorObj, []);
      try {
        await cand.invoke(targetInstance, [testNbt]);
        const aoStr = await this.bridge.getAoString(testNbt);
        // Non-empty compound means it wrote data
        if (aoStr.includes(':') || aoStr.length > 20) {
          writeMethod = cand;
        } else {
          readMethod = cand;
        }
      } catch {}
    }

    if (!writeMethod && candidates.length > 0) writeMethod = candidates[0];
    if (!readMethod && candidates.length > 1) readMethod = candidates[1];

    return { writeMethod, readMethod };
  }

  /**
   * Performs differential vector probing on entity coordinates, motion, and rotation.
   * Leverages the un-obfuscated "Pos", "Motion", and "Rotation" NBT tag lists.
   */
  public async probeEntityVectors(
    entityCls: ReflectedClass,
    nbtTagCompoundCls: ReflectedClass,
    instancePtr?: bigint,
  ): Promise<{
    posX?: string;
    posY?: string;
    posZ?: string;
    motionX?: string;
    motionY?: string;
    motionZ?: string;
    rotationYaw?: string;
    rotationPitch?: string;
    onGround?: string;
  }> {
    const fields = await entityCls.getDeclaredFields();
    const doubleFields = fields.filter((f) => f.type === 'double');
    const floatFields = fields.filter((f) => f.type === 'float');
    const booleanFields = fields.filter((f) => f.type === 'boolean');

    const result: {
      posX?: string;
      posY?: string;
      posZ?: string;
      motionX?: string;
      motionY?: string;
      motionZ?: string;
      rotationYaw?: string;
      rotationPitch?: string;
      onGround?: string;
    } = {};

    // Standard MCP Entity declared field order:
    // In Entity.java:
    // index 0: renderDistanceWeight (double)
    // index 1..3: prevPosX, prevPosY, prevPosZ (double)
    // index 4..6: posX, posY, posZ (double)
    // index 7..9: motionX, motionY, motionZ (double)
    // index 0..1: rotationYaw, rotationPitch (float)
    // index 2..3: prevRotationYaw, prevRotationPitch (float)
    if (doubleFields.length >= 10) {
      // Find posX, posY, posZ at doubles[4..6] and motionX, motionY, motionZ at doubles[7..9]
      result.posX = doubleFields[4]?.name;
      result.posY = doubleFields[5]?.name;
      result.posZ = doubleFields[6]?.name;
      result.motionX = doubleFields[7]?.name;
      result.motionY = doubleFields[8]?.name;
      result.motionZ = doubleFields[9]?.name;
    } else if (doubleFields.length >= 6) {
      result.posX = doubleFields[0]?.name;
      result.posY = doubleFields[1]?.name;
      result.posZ = doubleFields[2]?.name;
      result.motionX = doubleFields[3]?.name;
      result.motionY = doubleFields[4]?.name;
      result.motionZ = doubleFields[5]?.name;
    }

    if (floatFields.length >= 2) {
      result.rotationYaw = floatFields[0]?.name;
      result.rotationPitch = floatFields[1]?.name;
    }

    if (booleanFields.length >= 2) {
      result.onGround = booleanFields[1]?.name;
    } else if (booleanFields.length >= 1) {
      result.onGround = booleanFields[0]?.name;
    }

    // If an active entity instance is available, refine with differential NBT probe
    if (instancePtr && instancePtr !== 0n) {
      const { writeMethod } = await this.discoverNbtMethods(
        entityCls,
        nbtTagCompoundCls,
        instancePtr,
      );
      const nbtCtors = await nbtTagCompoundCls.getDeclaredConstructors();
      const nbtDefaultCtor = nbtCtors.find((c) => c.paramTypes.length === 0);

      if (writeMethod && nbtDefaultCtor) {
        try {
          // Probe distinct doubles
          if (doubleFields.length >= 10) {
            await this.bridge.writeField(
              entityCls.classObj,
              doubleFields[4]!.name,
              111.11,
              instancePtr,
            );
            await this.bridge.writeField(
              entityCls.classObj,
              doubleFields[5]!.name,
              222.22,
              instancePtr,
            );
            await this.bridge.writeField(
              entityCls.classObj,
              doubleFields[6]!.name,
              333.33,
              instancePtr,
            );

            const nbtObj = await this.bridge.construct(
              nbtDefaultCtor.ctorObj,
              [],
            );
            await writeMethod.invoke(instancePtr, [nbtObj]);
            const str = await this.bridge.getAoString(nbtObj);

            if (str.includes('111.11') && str.includes('Pos')) {
              result.posX = doubleFields[4]!.name;
              result.posY = doubleFields[5]!.name;
              result.posZ = doubleFields[6]!.name;
            }
          }
        } catch {}
      }
    }

    return result;
  }
}
