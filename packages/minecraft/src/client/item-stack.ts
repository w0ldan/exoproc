import type { ReflectionBridge, ReflectedClass } from 'bun-njava';
import type { MinecraftMappings } from '../mappings/types.js';

/**
 * Handle representing a reflected Minecraft ItemStack (`ItemStack.class`).
 */
export class MinecraftItemStack {
  constructor(
    public readonly itemStackObj: bigint,
    protected readonly itemStackClass: ReflectedClass,
    protected readonly mappings: MinecraftMappings,
    protected readonly bridge: ReflectionBridge,
  ) {}

  /** Reads the stack size (count). */
  public async getStackSize(): Promise<number> {
    const fName = this.mappings.ItemStack.fields.stackSize ?? 'stackSize';
    return (
      ((await this.itemStackClass.readField(
        fName,
        this.itemStackObj,
      )) as number) ?? 0
    );
  }

  /** Reads the item damage / metadata. */
  public async getItemDamage(): Promise<number> {
    const fName = this.mappings.ItemStack.fields.itemDamage ?? 'itemDamage';
    return (
      ((await this.itemStackClass.readField(
        fName,
        this.itemStackObj,
      )) as number) ?? 0
    );
  }

  /** Reads the display name of the item stack. */
  public async getDisplayName(): Promise<string> {
    const mName =
      this.mappings.ItemStack.methods.getDisplayName ?? 'getDisplayName';
    try {
      const method = await this.itemStackClass.getMethod(mName);
      return ((await method.call(this.itemStackObj)) as string) ?? '';
    } catch {
      return '';
    }
  }

  /** Reads the numeric ID of the underlying Item. */
  public async getItemId(): Promise<number> {
    const itemClass = await this.bridge.getClass(
      this.mappings.Item.realClassName,
    );
    const mGetId = this.mappings.Item.methods.getIdFromItem ?? 'getIdFromItem';
    const fItem = this.mappings.ItemStack.fields.item ?? 'item';

    const itemObj = (await this.itemStackClass.readField(
      fItem,
      this.itemStackObj,
    )) as bigint;
    if (!itemObj || itemObj === 0n) return 0;

    try {
      const method = await itemClass.getMethod(mGetId);
      return ((await method.call(0n, itemObj)) as number) ?? 0;
    } catch {
      return 0;
    }
  }
}
