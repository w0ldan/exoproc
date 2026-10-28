import type { ReflectedClass } from 'bun-njava';
import type { MinecraftMappings } from '../mappings/types.js';

/**
 * Handle representing Minecraft internal Timer (`Timer.class`).
 */
export class MinecraftTimer {
  constructor(
    public readonly timerObj: bigint,
    protected readonly timerClass: ReflectedClass,
    protected readonly mappings: MinecraftMappings,
  ) {}

  /** Gets the current timer speed multiplier (default 1.0f). */
  public async getTimerSpeed(): Promise<number> {
    const fName = this.mappings.Timer.fields.timerSpeed ?? 'timerSpeed';
    return (
      ((await this.timerClass.readField(fName, this.timerObj)) as number) ?? 1.0
    );
  }

  /** Sets the timer speed multiplier (e.g. 2.0 for 2x game speed, 0.5 for slow motion). */
  public async setTimerSpeed(speed: number): Promise<void> {
    const fName = this.mappings.Timer.fields.timerSpeed ?? 'timerSpeed';
    await this.timerClass.writeField(fName, speed, this.timerObj);
  }

  /** Gets the number of elapsed game ticks in this cycle. */
  public async getElapsedTicks(): Promise<number> {
    const fName = this.mappings.Timer.fields.elapsedTicks ?? 'elapsedTicks';
    return (
      ((await this.timerClass.readField(fName, this.timerObj)) as number) ?? 0
    );
  }

  /** Gets render partial ticks (fraction between 0.0 and 1.0). */
  public async getRenderPartialTicks(): Promise<number> {
    const fName =
      this.mappings.Timer.fields.renderPartialTicks ?? 'renderPartialTicks';
    return (
      ((await this.timerClass.readField(fName, this.timerObj)) as number) ?? 0.0
    );
  }
}
