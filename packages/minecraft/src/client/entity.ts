import type { ReflectionBridge, ReflectedClass } from 'bun-njava';
import type { MinecraftMappings } from '../mappings/types.js';

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface Rotation2D {
  yaw: number;
  pitch: number;
}

/**
 * Handle representing a reflected Minecraft Entity (`Entity.class`).
 */
export class MinecraftEntity {
  constructor(
    public readonly entityObj: bigint,
    protected readonly entityClass: ReflectedClass,
    protected readonly mappings: MinecraftMappings,
    protected readonly bridge: ReflectionBridge,
  ) {}

  /** Reads the entity's integer ID. */
  public async getId(): Promise<number> {
    const fName = this.mappings.Entity.fields.entityId ?? 'entityId';
    return (await this.entityClass.readField(fName, this.entityObj)) as number;
  }

  /** Reads the entity's position `(posX, posY, posZ)`. */
  public async getPos(): Promise<Vector3D> {
    const fx = this.mappings.Entity.fields.posX ?? 'posX';
    const fy = this.mappings.Entity.fields.posY ?? 'posY';
    const fz = this.mappings.Entity.fields.posZ ?? 'posZ';

    const x = (await this.entityClass.readField(fx, this.entityObj)) as number;
    const y = (await this.entityClass.readField(fy, this.entityObj)) as number;
    const z = (await this.entityClass.readField(fz, this.entityObj)) as number;

    return { x: x ?? 0, y: y ?? 0, z: z ?? 0 };
  }

  /** Sets the entity's position `(posX, posY, posZ)`. */
  public async setPos(x: number, y: number, z: number): Promise<void> {
    const fx = this.mappings.Entity.fields.posX ?? 'posX';
    const fy = this.mappings.Entity.fields.posY ?? 'posY';
    const fz = this.mappings.Entity.fields.posZ ?? 'posZ';

    await this.entityClass.writeField(fx, x, this.entityObj);
    await this.entityClass.writeField(fy, y, this.entityObj);
    await this.entityClass.writeField(fz, z, this.entityObj);
  }

  /** Reads the entity's motion velocity `(motionX, motionY, motionZ)`. */
  public async getMotion(): Promise<Vector3D> {
    const fx = this.mappings.Entity.fields.motionX ?? 'motionX';
    const fy = this.mappings.Entity.fields.motionY ?? 'motionY';
    const fz = this.mappings.Entity.fields.motionZ ?? 'motionZ';

    const x = (await this.entityClass.readField(fx, this.entityObj)) as number;
    const y = (await this.entityClass.readField(fy, this.entityObj)) as number;
    const z = (await this.entityClass.readField(fz, this.entityObj)) as number;

    return { x: x ?? 0, y: y ?? 0, z: z ?? 0 };
  }

  /** Sets the entity's motion velocity `(motionX, motionY, motionZ)`. */
  public async setMotion(x: number, y: number, z: number): Promise<void> {
    const fx = this.mappings.Entity.fields.motionX ?? 'motionX';
    const fy = this.mappings.Entity.fields.motionY ?? 'motionY';
    const fz = this.mappings.Entity.fields.motionZ ?? 'motionZ';

    await this.entityClass.writeField(fx, x, this.entityObj);
    await this.entityClass.writeField(fy, y, this.entityObj);
    await this.entityClass.writeField(fz, z, this.entityObj);
  }

  /** Reads the entity's rotation `(yaw, pitch)`. */
  public async getRotation(): Promise<Rotation2D> {
    const fyaw = this.mappings.Entity.fields.rotationYaw ?? 'rotationYaw';
    const fpitch = this.mappings.Entity.fields.rotationPitch ?? 'rotationPitch';

    const yaw = (await this.entityClass.readField(
      fyaw,
      this.entityObj,
    )) as number;
    const pitch = (await this.entityClass.readField(
      fpitch,
      this.entityObj,
    )) as number;

    return { yaw: yaw ?? 0, pitch: pitch ?? 0 };
  }

  /** Sets the entity's rotation `(yaw, pitch)`. */
  public async setRotation(yaw: number, pitch: number): Promise<void> {
    const fyaw = this.mappings.Entity.fields.rotationYaw ?? 'rotationYaw';
    const fpitch = this.mappings.Entity.fields.rotationPitch ?? 'rotationPitch';

    await this.entityClass.writeField(fyaw, yaw, this.entityObj);
    await this.entityClass.writeField(fpitch, pitch, this.entityObj);
  }

  /** Checks whether the entity is currently on ground. */
  public async isOnGround(): Promise<boolean> {
    const fName = this.mappings.Entity.fields.onGround ?? 'onGround';
    return Boolean(await this.entityClass.readField(fName, this.entityObj));
  }

  /** Sets the entity's onGround flag. */
  public async setOnGround(onGround: boolean): Promise<void> {
    const fName = this.mappings.Entity.fields.onGround ?? 'onGround';
    await this.entityClass.writeField(fName, onGround, this.entityObj);
  }

  /** Checks whether the entity is marked dead. */
  public async isDead(): Promise<boolean> {
    const fName = this.mappings.Entity.fields.isDead ?? 'isDead';
    return Boolean(await this.entityClass.readField(fName, this.entityObj));
  }

  /** Computes euclidean distance to another entity or 3D coordinate. */
  public async getDistanceTo(
    target: MinecraftEntity | Vector3D,
  ): Promise<number> {
    const pos = await this.getPos();
    let tx = 0,
      ty = 0,
      tz = 0;
    if (target instanceof MinecraftEntity) {
      const tPos = await target.getPos();
      tx = tPos.x;
      ty = tPos.y;
      tz = tPos.z;
    } else {
      tx = target.x;
      ty = target.y;
      tz = target.z;
    }
    const dx = pos.x - tx;
    const dy = pos.y - ty;
    const dz = pos.z - tz;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /** Checks whether this entity is a LivingBase (has health, etc.). */
  public async isLiving(): Promise<boolean> {
    const livingClass = await this.bridge.getClass(
      this.mappings.EntityLivingBase.realClassName,
    );
    const objClass = await this.bridge.getClassName(this.entityObj);
    const chain = await this.entityClass.getSuperclassChain();
    return (
      chain.includes(this.mappings.EntityLivingBase.realClassName) ||
      objClass === livingClass.name
    );
  }

  /** Reads the health if living entity, or returns undefined. */
  public async getHealth(): Promise<number | undefined> {
    if (!(await this.isLiving())) return undefined;
    const livingClass = await this.bridge.getClass(
      this.mappings.EntityLivingBase.realClassName,
    );
    const mName =
      this.mappings.EntityLivingBase.methods.getHealth ?? 'getHealth';
    try {
      const method = await livingClass.getMethod(mName);
      return (await method.call(this.entityObj)) as number;
    } catch {
      return undefined;
    }
  }
}
