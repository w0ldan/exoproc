import type { ISyncCallableMemoryAccessor, HostAccessor } from 'bun-xffi';
import type { ReflectionBridge, ReflectedClass } from 'bun-njava';
import type { MinecraftMappings, MatchOptions } from '../mappings/types.js';
import { MinecraftMatcher } from '../mappings/matcher.js';
import { MinecraftPlayer } from './player.js';
import { MinecraftWorld } from './world.js';
import { MinecraftSettings } from './settings.js';
import { MinecraftTimer } from './timer.js';

export interface MinecraftClientOptions extends MatchOptions {}

/**
 * Main high-level handle for inspecting and manipulating a live Minecraft process via reflection.
 */
export class MinecraftClient {
  private mcInstance: bigint = 0n;

  constructor(
    public readonly bridge: ReflectionBridge,
    public readonly mappings: MinecraftMappings,
    public readonly mcClass: ReflectedClass,
  ) {}

  /**
   * Attaches to a memory accessor with an active `NJavaAccessor`, matches all 25+ Minecraft classes,
   * and returns a ready-to-use `MinecraftClient`.
   */
  public static async attach(
    accessor: ISyncCallableMemoryAccessor,
    options: MinecraftClientOptions = {},
  ): Promise<MinecraftClient> {
    const { getNJava } = await import('bun-njava');
    const njava = getNJava(accessor);
    const bridge = await njava.getReflection();

    const matcher = new MinecraftMatcher(bridge);
    const mappings = await matcher.match(options);

    const mcClass = await bridge.getClass(mappings.Minecraft.realClassName);
    const client = new MinecraftClient(bridge, mappings, mcClass);
    await client.init();
    return client;
  }

  /**
   * Creates a MinecraftClient from any JavaContext or ReflectionBridge (e.g. from an HTTP Agent).
   * Pure cross-platform, zero native Windows dependencies.
   */
  public static async from(
    javaOrBridge: any,
    options: MinecraftClientOptions = {},
  ): Promise<MinecraftClient> {
    const bridge = javaOrBridge.bridge ?? javaOrBridge;
    const pool = javaOrBridge.pool ?? options.pool;
    const matcher = new MinecraftMatcher(bridge);
    const mappings = await matcher.match({ ...options, pool });

    const mcClass = await bridge.getClass(mappings.Minecraft.realClassName);
    const client = new MinecraftClient(bridge, mappings, mcClass);
    await client.init();
    return client;
  }

  /**
   * Shortcut for attaching from a {@link HostAccessor}.
   */
  public static async fromHost(
    host: HostAccessor,
    options: MinecraftClientOptions = {},
  ): Promise<MinecraftClient> {
    return await MinecraftClient.attach(host, options);
  }

  /**
   * Initializes the client instance pointer (`theMinecraft`).
   */
  public async init(): Promise<void> {
    const fTheMc =
      this.mappings.Minecraft.fields.theMinecraft ?? 'theMinecraft';
    const staticField = await this.mcClass.findField(fTheMc);
    if (staticField) {
      this.mcInstance = ((await staticField.get(0n)) as bigint) ?? 0n;
    }
    if (!this.mcInstance || this.mcInstance === 0n) {
      const mGetMc =
        this.mappings.Minecraft.methods.getMinecraft ?? 'getMinecraft';
      try {
        const getMcMethod = await this.mcClass.getMethod(mGetMc);
        this.mcInstance = ((await getMcMethod.call(0n)) as bigint) ?? 0n;
      } catch {}
    }
  }

  /** Gets the `theMinecraft` object reference. */
  public async getInstance(): Promise<bigint> {
    if (!this.mcInstance || this.mcInstance === 0n) {
      await this.init();
    }
    return this.mcInstance;
  }

  /** Accesses the local player (`thePlayer`). */
  public async getPlayer(): Promise<MinecraftPlayer> {
    const inst = await this.getInstance();
    const fPlayer = this.mappings.Minecraft.fields.thePlayer ?? 'thePlayer';
    const playerObj = (await this.mcClass.readField(fPlayer, inst)) as bigint;
    if (!playerObj || playerObj === 0n) {
      throw new Error(
        'thePlayer is currently null (player not in world or loaded yet)',
      );
    }
    const playerClass = await this.bridge.getClass(
      this.mappings.EntityPlayerSP.realClassName,
    );
    return new MinecraftPlayer(
      playerObj,
      playerClass,
      this.mappings,
      this.bridge,
    );
  }

  /** Accesses the client world (`theWorld`). */
  public async getWorld(): Promise<MinecraftWorld> {
    const inst = await this.getInstance();
    const fWorld = this.mappings.Minecraft.fields.theWorld ?? 'theWorld';
    const worldObj = (await this.mcClass.readField(fWorld, inst)) as bigint;
    if (!worldObj || worldObj === 0n) {
      throw new Error('theWorld is currently null (world not loaded yet)');
    }
    const worldClass = await this.bridge.getClass(
      this.mappings.WorldClient.realClassName,
    );
    return new MinecraftWorld(worldObj, worldClass, this.mappings, this.bridge);
  }

  /** Accesses game settings (`gameSettings`). */
  public async getSettings(): Promise<MinecraftSettings> {
    const inst = await this.getInstance();
    const fSettings =
      this.mappings.Minecraft.fields.gameSettings ?? 'gameSettings';
    const settingsObj = (await this.mcClass.readField(
      fSettings,
      inst,
    )) as bigint;
    const settingsClass = await this.bridge.getClass(
      this.mappings.GameSettings.realClassName,
    );
    return new MinecraftSettings(
      settingsObj,
      settingsClass,
      this.mappings,
      this.bridge,
    );
  }

  /** Accesses the internal game timer (`timer`). */
  public async getTimer(): Promise<MinecraftTimer> {
    const inst = await this.getInstance();
    const fTimer = this.mappings.Minecraft.fields.timer ?? 'timer';
    const timerObj = (await this.mcClass.readField(fTimer, inst)) as bigint;
    const timerClass = await this.bridge.getClass(
      this.mappings.Timer.realClassName,
    );
    return new MinecraftTimer(timerObj, timerClass, this.mappings);
  }

  /** Triggers left click (attack / break block). */
  public async clickMouse(): Promise<void> {
    const inst = await this.getInstance();
    const mClick = this.mappings.Minecraft.methods.clickMouse ?? 'clickMouse';
    try {
      const method = await this.mcClass.getMethod(mClick);
      await method.call(inst);
    } catch {}
  }

  /** Triggers right click (use item / place block). */
  public async rightClickMouse(): Promise<void> {
    const inst = await this.getInstance();
    const mClick =
      this.mappings.Minecraft.methods.rightClickMouse ?? 'rightClickMouse';
    try {
      const method = await this.mcClass.getMethod(mClick);
      await method.call(inst);
    } catch {}
  }

  /** Displays a GUI screen, or null/0n to close current screen. */
  public async displayGuiScreen(screenObj: bigint): Promise<void> {
    const inst = await this.getInstance();
    const mDisplay =
      this.mappings.Minecraft.methods.displayGuiScreen ?? 'displayGuiScreen';
    try {
      const method = await this.mcClass.getMethod(mDisplay);
      await method.call(inst, screenObj);
    } catch {}
  }

  /** Focuses the game mouse cursor. */
  public async setIngameFocus(): Promise<void> {
    const inst = await this.getInstance();
    const mFocus =
      this.mappings.Minecraft.methods.setIngameFocus ?? 'setIngameFocus';
    try {
      const method = await this.mcClass.getMethod(mFocus);
      await method.call(inst);
    } catch {}
  }

  /** Unfocuses the game mouse cursor. */
  public async setIngameNotInFocus(): Promise<void> {
    const inst = await this.getInstance();
    const mUnfocus =
      this.mappings.Minecraft.methods.setIngameNotInFocus ??
      'setIngameNotInFocus';
    try {
      const method = await this.mcClass.getMethod(mUnfocus);
      await method.call(inst);
    } catch {}
  }
}
