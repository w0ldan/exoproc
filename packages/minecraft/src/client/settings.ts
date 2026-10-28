import type { ReflectionBridge, ReflectedClass } from 'bun-njava';
import type { MinecraftMappings } from '../mappings/types.js';

export type MinecraftKeyAction =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sneak'
  | 'sprint'
  | 'attack'
  | 'use'
  | 'drop'
  | 'inventory'
  | 'chat';

/**
 * Handle representing Minecraft GameSettings (`GameSettings.class`).
 */
export class MinecraftSettings {
  constructor(
    public readonly settingsObj: bigint,
    protected readonly settingsClass: ReflectedClass,
    protected readonly mappings: MinecraftMappings,
    protected readonly bridge: ReflectionBridge,
  ) {}

  /**
   * Sets the pressed state of a specific KeyBinding (e.g. 'forward', 'jump', 'attack').
   */
  public async setKeyState(
    action: MinecraftKeyAction | string,
    pressed: boolean,
  ): Promise<void> {
    const fieldMap: Record<string, string> = {
      forward:
        this.mappings.GameSettings.fields.keyBindForward ?? 'keyBindForward',
      back: this.mappings.GameSettings.fields.keyBindBack ?? 'keyBindBack',
      left: this.mappings.GameSettings.fields.keyBindLeft ?? 'keyBindLeft',
      right: this.mappings.GameSettings.fields.keyBindRight ?? 'keyBindRight',
      jump: this.mappings.GameSettings.fields.keyBindJump ?? 'keyBindJump',
      sneak: this.mappings.GameSettings.fields.keyBindSneak ?? 'keyBindSneak',
      sprint:
        this.mappings.GameSettings.fields.keyBindSprint ?? 'keyBindSprint',
      attack:
        this.mappings.GameSettings.fields.keyBindAttack ?? 'keyBindAttack',
      use: this.mappings.GameSettings.fields.keyBindUseItem ?? 'keyBindUseItem',
      drop: this.mappings.GameSettings.fields.keyBindDrop ?? 'keyBindDrop',
      inventory:
        this.mappings.GameSettings.fields.keyBindInventory ??
        'keyBindInventory',
      chat: this.mappings.GameSettings.fields.keyBindChat ?? 'keyBindChat',
    };

    const targetFieldName = fieldMap[action] ?? action;
    const keyBindingObj = (await this.settingsClass.readField(
      targetFieldName,
      this.settingsObj,
    )) as bigint;
    if (!keyBindingObj || keyBindingObj === 0n) return;

    const kbClass = await this.bridge.getClass(
      this.mappings.KeyBinding.realClassName,
    );
    const fPressed = this.mappings.KeyBinding.fields.pressed ?? 'pressed';
    await kbClass.writeField(fPressed, pressed, keyBindingObj);

    // Also call static KeyBinding.setKeyBindState if keyCode is available
    const fCode = this.mappings.KeyBinding.fields.keyCode ?? 'keyCode';
    const keyCode = (await kbClass.readField(fCode, keyBindingObj)) as number;
    if (keyCode !== undefined) {
      const mSetState =
        this.mappings.KeyBinding.methods.setKeyBindState ?? 'setKeyBindState';
      try {
        const method = await kbClass.getMethod(mSetState);
        await method.call(0n, keyCode, pressed);
      } catch {}
    }
  }

  /**
   * Presses and holds a key for a given duration (default 50ms) then releases it.
   */
  public async pressKey(
    action: MinecraftKeyAction | string,
    durationMs = 50,
  ): Promise<void> {
    await this.setKeyState(action, true);
    await Bun.sleep(durationMs);
    await this.setKeyState(action, false);
  }

  /** Gets the Field of View setting. */
  public async getFov(): Promise<number> {
    const fName = this.mappings.GameSettings.fields.fovSetting ?? 'fovSetting';
    return (
      ((await this.settingsClass.readField(
        fName,
        this.settingsObj,
      )) as number) ?? 70
    );
  }

  /** Sets the Field of View setting. */
  public async setFov(fov: number): Promise<void> {
    const fName = this.mappings.GameSettings.fields.fovSetting ?? 'fovSetting';
    await this.settingsClass.writeField(fName, fov, this.settingsObj);
  }

  /** Gets the Gamma (brightness) setting. */
  public async getGamma(): Promise<number> {
    const fName =
      this.mappings.GameSettings.fields.gammaSetting ?? 'gammaSetting';
    return (
      ((await this.settingsClass.readField(
        fName,
        this.settingsObj,
      )) as number) ?? 1
    );
  }

  /** Sets the Gamma (brightness) setting. */
  public async setGamma(gamma: number): Promise<void> {
    const fName =
      this.mappings.GameSettings.fields.gammaSetting ?? 'gammaSetting';
    await this.settingsClass.writeField(fName, gamma, this.settingsObj);
  }
}
