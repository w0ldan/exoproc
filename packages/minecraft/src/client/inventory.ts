import type { ReflectionBridge, ReflectedClass } from 'bun-njava';
import type { MinecraftMappings } from '../mappings/types.js';
import { MinecraftItemStack } from './item-stack.js';

/**
 * Handle representing a reflected Minecraft Player Inventory (`InventoryPlayer.class`).
 */
export class MinecraftInventory {
  constructor(
    public readonly inventoryObj: bigint,
    protected readonly inventoryClass: ReflectedClass,
    protected readonly mappings: MinecraftMappings,
    protected readonly bridge: ReflectionBridge,
  ) {}

  /** Gets the selected hotbar slot index (0-8). */
  public async getCurrentSlot(): Promise<number> {
    const fName =
      this.mappings.InventoryPlayer.fields.currentItem ?? 'currentItem';
    return (
      ((await this.inventoryClass.readField(
        fName,
        this.inventoryObj,
      )) as number) ?? 0
    );
  }

  /** Sets the selected hotbar slot index (0-8). */
  public async setCurrentSlot(slot: number): Promise<void> {
    const fName =
      this.mappings.InventoryPlayer.fields.currentItem ?? 'currentItem';
    await this.inventoryClass.writeField(fName, slot, this.inventoryObj);
  }

  /** Gets the currently held item stack, or null if empty hand. */
  public async getCurrentItem(): Promise<MinecraftItemStack | null> {
    const mName =
      this.mappings.InventoryPlayer.methods.getCurrentItem ?? 'getCurrentItem';
    try {
      const method = await this.inventoryClass.getMethod(mName);
      const stackObj = (await method.call(this.inventoryObj)) as bigint;
      if (!stackObj || stackObj === 0n) return null;
      const isClass = await this.bridge.getClass(
        this.mappings.ItemStack.realClassName,
      );
      return new MinecraftItemStack(
        stackObj,
        isClass,
        this.mappings,
        this.bridge,
      );
    } catch {
      return null;
    }
  }

  /** Gets the item stack at a specific inventory slot (0-35). */
  public async getStackInSlot(
    slot: number,
  ): Promise<MinecraftItemStack | null> {
    const mName =
      this.mappings.InventoryPlayer.methods.getStackInSlot ?? 'getStackInSlot';
    try {
      const method = await this.inventoryClass.getMethod(mName);
      const stackObj = (await method.call(this.inventoryObj, slot)) as bigint;
      if (!stackObj || stackObj === 0n) return null;
      const isClass = await this.bridge.getClass(
        this.mappings.ItemStack.realClassName,
      );
      return new MinecraftItemStack(
        stackObj,
        isClass,
        this.mappings,
        this.bridge,
      );
    } catch {
      return null;
    }
  }
}
