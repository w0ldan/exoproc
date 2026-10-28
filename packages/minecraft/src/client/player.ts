import type { ReflectionBridge, ReflectedClass } from 'bun-njava';
import type { MinecraftMappings } from '../mappings/types.js';
import { MinecraftEntity } from './entity.js';
import { MinecraftInventory } from './inventory.js';

/**
 * Handle representing the local player (`EntityPlayerSP.class`).
 */
export class MinecraftPlayer extends MinecraftEntity {
  constructor(
    playerObj: bigint,
    playerClass: ReflectedClass,
    mappings: MinecraftMappings,
    bridge: ReflectionBridge,
  ) {
    super(playerObj, playerClass, mappings, bridge);
  }

  /** Gets the player's current health. */
  public override async getHealth(): Promise<number> {
    const livingClass = await this.bridge.getClass(
      this.mappings.EntityLivingBase.realClassName,
    );
    const mName =
      this.mappings.EntityLivingBase.methods.getHealth ?? 'getHealth';
    try {
      const method = await livingClass.getMethod(mName);
      return ((await method.call(this.entityObj)) as number) ?? 20;
    } catch {
      return 20;
    }
  }

  /** Sets the player's health. */
  public async setHealth(health: number): Promise<void> {
    const livingClass = await this.bridge.getClass(
      this.mappings.EntityLivingBase.realClassName,
    );
    const mName =
      this.mappings.EntityLivingBase.methods.setHealth ?? 'setHealth';
    try {
      const method = await livingClass.getMethod(mName);
      await method.call(this.entityObj, health);
    } catch {}
  }

  /** Gets the player's maximum health. */
  public async getMaxHealth(): Promise<number> {
    const livingClass = await this.bridge.getClass(
      this.mappings.EntityLivingBase.realClassName,
    );
    const mName =
      this.mappings.EntityLivingBase.methods.getMaxHealth ?? 'getMaxHealth';
    try {
      const method = await livingClass.getMethod(mName);
      return ((await method.call(this.entityObj)) as number) ?? 20;
    } catch {
      return 20;
    }
  }

  /** Checks whether the player is sneaking. */
  public async isSneaking(): Promise<boolean> {
    const entClass = await this.bridge.getClass(
      this.mappings.Entity.realClassName,
    );
    const mName = this.mappings.Entity.methods.isSneaking ?? 'isSneaking';
    try {
      const method = await entClass.getMethod(mName);
      return Boolean(await method.call(this.entityObj));
    } catch {
      return false;
    }
  }

  /** Sets the sneaking state. */
  public async setSneaking(sneaking: boolean): Promise<void> {
    const entClass = await this.bridge.getClass(
      this.mappings.Entity.realClassName,
    );
    const mName = this.mappings.Entity.methods.setSneaking ?? 'setSneaking';
    try {
      const method = await entClass.getMethod(mName);
      await method.call(this.entityObj, sneaking);
    } catch {}
  }

  /** Checks whether the player is sprinting. */
  public async isSprinting(): Promise<boolean> {
    const entClass = await this.bridge.getClass(
      this.mappings.Entity.realClassName,
    );
    const mName = this.mappings.Entity.methods.isSprinting ?? 'isSprinting';
    try {
      const method = await entClass.getMethod(mName);
      return Boolean(await method.call(this.entityObj));
    } catch {
      return false;
    }
  }

  /** Sets the sprinting state. */
  public async setSprinting(sprinting: boolean): Promise<void> {
    const entClass = await this.bridge.getClass(
      this.mappings.Entity.realClassName,
    );
    const mName = this.mappings.Entity.methods.setSprinting ?? 'setSprinting';
    try {
      const method = await entClass.getMethod(mName);
      await method.call(this.entityObj, sprinting);
    } catch {}
  }

  /** Sends a chat message or command as the local player. */
  public async sendChatMessage(message: string): Promise<void> {
    const mName =
      this.mappings.EntityPlayerSP.methods.sendChatMessage ?? 'sendChatMessage';
    try {
      const method = await this.entityClass.getMethod(mName);
      await method.call(this.entityObj, message);
    } catch {}
  }

  /** Triggers the arm swing animation / attack swing. */
  public async swingItem(): Promise<void> {
    const mName = this.mappings.EntityPlayerSP.methods.swingItem ?? 'swingItem';
    try {
      const method = await this.entityClass.getMethod(mName);
      await method.call(this.entityObj);
    } catch {}
  }

  /** Respawns the player if dead. */
  public async respawn(): Promise<void> {
    const mName =
      this.mappings.EntityPlayerSP.methods.respawnPlayer ?? 'respawnPlayer';
    try {
      const method = await this.entityClass.getMethod(mName);
      await method.call(this.entityObj);
    } catch {}
  }

  /** Closes any currently opened GUI container/screen on the player. */
  public async closeScreen(): Promise<void> {
    const mName =
      this.mappings.EntityPlayerSP.methods.closeScreen ?? 'closeScreen';
    try {
      const method = await this.entityClass.getMethod(mName);
      await method.call(this.entityObj);
    } catch {}
  }

  /** Accesses the player's inventory. */
  public async getInventory(): Promise<MinecraftInventory> {
    const playerClass = await this.bridge.getClass(
      this.mappings.EntityPlayer.realClassName,
    );
    const fInv = this.mappings.EntityPlayer.fields.inventory ?? 'inventory';
    const invObj = (await playerClass.readField(
      fInv,
      this.entityObj,
    )) as bigint;
    const invClass = await this.bridge.getClass(
      this.mappings.InventoryPlayer.realClassName,
    );
    return new MinecraftInventory(invObj, invClass, this.mappings, this.bridge);
  }
  public rawPlayer?: any;
  public capabilities?: any;

  /** Gets the player's capabilities (flight, invulnerability, speeds). */
  public async getCapabilities(): Promise<{
    disableDamage: boolean;
    isFlying: boolean;
    allowFlying: boolean;
    isCreativeMode: boolean;
    flySpeed: number;
    walkSpeed: number;
  }> {
    const rawCaps = this.rawPlayer?.capabilities || this.capabilities;
    if (rawCaps) {
      return {
        disableDamage: Boolean(rawCaps.disableDamage),
        isFlying: Boolean(rawCaps.isFlying),
        allowFlying: Boolean(rawCaps.allowFlying),
        isCreativeMode: Boolean(rawCaps.isCreativeMode),
        flySpeed: Number(rawCaps.flySpeed) || 0.05,
        walkSpeed: Number(rawCaps.walkSpeed) || 0.1,
      };
    }

    try {
      const fCaps =
        this.mappings.EntityPlayer?.fields?.capabilities ?? 'capabilities';
      let capsObj: bigint | null = null;
      try {
        capsObj = (await this.entityClass.readField(
          fCaps,
          this.entityObj,
        )) as bigint;
      } catch {}

      if (!capsObj && this.mappings.EntityPlayer?.realClassName) {
        try {
          const playerClass = await this.bridge.getClass(
            this.mappings.EntityPlayer.realClassName,
          );
          capsObj = (await playerClass.readField(
            fCaps,
            this.entityObj,
          )) as bigint;
        } catch {}
      }

      if (!capsObj || capsObj === 0n) {
        throw new Error('Player capabilities pointer is null');
      }

      const capsClassName =
        this.mappings.PlayerCapabilities?.realClassName ??
        'net.minecraft.entity.player.PlayerCapabilities';
      const capsClass = await this.bridge.getClass(capsClassName);
      const isFlying = Boolean(
        await capsClass.readField(
          this.mappings.PlayerCapabilities?.fields?.isFlying ?? 'isFlying',
          capsObj,
        ),
      );
      const allowFlying = Boolean(
        await capsClass.readField(
          this.mappings.PlayerCapabilities?.fields?.allowFlying ??
            'allowFlying',
          capsObj,
        ),
      );
      const disableDamage = Boolean(
        await capsClass.readField(
          this.mappings.PlayerCapabilities?.fields?.disableDamage ??
            'disableDamage',
          capsObj,
        ),
      );
      const isCreativeMode = Boolean(
        await capsClass.readField(
          this.mappings.PlayerCapabilities?.fields?.isCreativeMode ??
            'isCreativeMode',
          capsObj,
        ),
      );
      const flySpeed =
        Number(
          await capsClass.readField(
            this.mappings.PlayerCapabilities?.fields?.flySpeed ?? 'flySpeed',
            capsObj,
          ),
        ) || 0.05;
      const walkSpeed =
        Number(
          await capsClass.readField(
            this.mappings.PlayerCapabilities?.fields?.walkSpeed ?? 'walkSpeed',
            capsObj,
          ),
        ) || 0.1;

      return {
        disableDamage,
        isFlying,
        allowFlying,
        isCreativeMode,
        flySpeed,
        walkSpeed,
      };
    } catch {
      return {
        disableDamage: false,
        isFlying: false,
        allowFlying: false,
        isCreativeMode: false,
        flySpeed: 0.05,
        walkSpeed: 0.1,
      };
    }
  }

  /** Modifies the player's capabilities in memory. */
  public async setCapabilities(caps: {
    disableDamage?: boolean;
    isFlying?: boolean;
    allowFlying?: boolean;
    flySpeed?: number;
    walkSpeed?: number;
  }): Promise<void> {
    // 1. Fast sync path via Java proxy capabilities
    const rawCaps = this.rawPlayer?.capabilities || this.capabilities;
    if (rawCaps) {
      try {
        if (caps.allowFlying !== undefined)
          rawCaps.allowFlying = caps.allowFlying;
        if (caps.isFlying !== undefined) rawCaps.isFlying = caps.isFlying;
        if (caps.disableDamage !== undefined)
          rawCaps.disableDamage = caps.disableDamage;
        if (caps.flySpeed !== undefined) rawCaps.flySpeed = caps.flySpeed;
        if (caps.walkSpeed !== undefined) rawCaps.walkSpeed = caps.walkSpeed;
        return;
      } catch {}
    }

    // 2. Reflection bridge memory accessor path
    try {
      const fCaps =
        this.mappings.EntityPlayer?.fields?.capabilities ?? 'capabilities';
      let capsObj: bigint | null = null;
      try {
        capsObj = (await this.entityClass.readField(
          fCaps,
          this.entityObj,
        )) as bigint;
      } catch {}

      if (!capsObj && this.mappings.EntityPlayer?.realClassName) {
        try {
          const playerClass = await this.bridge.getClass(
            this.mappings.EntityPlayer.realClassName,
          );
          capsObj = (await playerClass.readField(
            fCaps,
            this.entityObj,
          )) as bigint;
        } catch {}
      }

      if (!capsObj || capsObj === 0n) return;

      const capsClassName =
        this.mappings.PlayerCapabilities?.realClassName ??
        'net.minecraft.entity.player.PlayerCapabilities';
      const capsClass = await this.bridge.getClass(capsClassName);

      if (caps.allowFlying !== undefined) {
        await capsClass
          .writeField(
            this.mappings.PlayerCapabilities?.fields?.allowFlying ??
              'allowFlying',
            caps.allowFlying,
            capsObj,
          )
          .catch(() => {});
      }
      if (caps.isFlying !== undefined) {
        await capsClass
          .writeField(
            this.mappings.PlayerCapabilities?.fields?.isFlying ?? 'isFlying',
            caps.isFlying,
            capsObj,
          )
          .catch(() => {});
      }
      if (caps.disableDamage !== undefined) {
        await capsClass
          .writeField(
            this.mappings.PlayerCapabilities?.fields?.disableDamage ??
              'disableDamage',
            caps.disableDamage,
            capsObj,
          )
          .catch(() => {});
      }
      if (caps.flySpeed !== undefined) {
        await capsClass
          .writeField(
            this.mappings.PlayerCapabilities?.fields?.flySpeed ?? 'flySpeed',
            caps.flySpeed,
            capsObj,
          )
          .catch(() => {});
      }
      if (caps.walkSpeed !== undefined) {
        await capsClass
          .writeField(
            this.mappings.PlayerCapabilities?.fields?.walkSpeed ?? 'walkSpeed',
            caps.walkSpeed,
            capsObj,
          )
          .catch(() => {});
      }
    } catch {}
  }
}
