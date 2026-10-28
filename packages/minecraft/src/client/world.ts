import type { ReflectionBridge, ReflectedClass } from 'bun-njava';
import type { MinecraftMappings } from '../mappings/types.js';
import { MinecraftEntity } from './entity.js';
import { MinecraftPlayer } from './player.js';

/**
 * Handle representing the client-side world (`WorldClient.class` / `World.class`).
 */
export class MinecraftWorld {
  constructor(
    public readonly worldObj: bigint,
    protected readonly worldClass: ReflectedClass,
    protected readonly mappings: MinecraftMappings,
    protected readonly bridge: ReflectionBridge,
  ) {}

  /**
   * Retrieves all currently loaded entities in the client's world.
   */
  public async getLoadedEntities(): Promise<MinecraftEntity[]> {
    const worldBaseClass = await this.bridge.getClass(
      this.mappings.World.realClassName,
    );
    const fList =
      this.mappings.World.fields.loadedEntityList ?? 'loadedEntityList';
    const listObj = (await worldBaseClass.readField(
      fList,
      this.worldObj,
    )) as bigint;
    if (!listObj || listObj === 0n) return [];

    const entities: MinecraftEntity[] = [];
    const listClass = await this.bridge.getClass('java.util.List');
    const sizeMethod = await listClass.getMethod('size');
    const getMethod = await listClass.getMethod('get');

    const size = ((await sizeMethod.call(listObj)) as number) ?? 0;
    const entityClass = await this.bridge.getClass(
      this.mappings.Entity.realClassName,
    );

    for (let i = 0; i < size; i++) {
      const entObj = (await getMethod.call(listObj, i)) as bigint;
      if (entObj && entObj !== 0n) {
        entities.push(
          new MinecraftEntity(entObj, entityClass, this.mappings, this.bridge),
        );
      }
    }

    return entities;
  }

  /**
   * Retrieves all currently loaded player entities in the client's world.
   */
  public async getLoadedPlayers(): Promise<MinecraftPlayer[]> {
    const worldBaseClass = await this.bridge.getClass(
      this.mappings.World.realClassName,
    );
    const fList = this.mappings.World.fields.playerEntities ?? 'playerEntities';
    const listObj = (await worldBaseClass.readField(
      fList,
      this.worldObj,
    )) as bigint;
    if (!listObj || listObj === 0n) return [];

    const players: MinecraftPlayer[] = [];
    const listClass = await this.bridge.getClass('java.util.List');
    const sizeMethod = await listClass.getMethod('size');
    const getMethod = await listClass.getMethod('get');

    const size = ((await sizeMethod.call(listObj)) as number) ?? 0;
    const playerClass = await this.bridge.getClass(
      this.mappings.EntityPlayer.realClassName,
    );

    for (let i = 0; i < size; i++) {
      const pObj = (await getMethod.call(listObj, i)) as bigint;
      if (pObj && pObj !== 0n) {
        players.push(
          new MinecraftPlayer(pObj, playerClass, this.mappings, this.bridge),
        );
      }
    }

    return players;
  }

  /**
   * Reads the numeric block ID at the specified world coordinate `(x, y, z)`.
   */
  public async getBlockId(x: number, y: number, z: number): Promise<number> {
    try {
      const blockPosClass = await this.bridge.getClass(
        this.mappings.BlockPos.realClassName,
      );
      // Instantiate BlockPos(int x, int y, int z)
      const ctor = await this.bridge.findConstructor(
        blockPosClass.classObj,
        (p: readonly string[]) =>
          p.length === 3 && p[0] === 'int' && p[1] === 'int' && p[2] === 'int',
      );
      if (!ctor) return 0;

      const posObj = await this.bridge.construct(ctor, [x, y, z]);
      const worldBaseClass = await this.bridge.getClass(
        this.mappings.World.realClassName,
      );
      const mGetState =
        this.mappings.World.methods.getBlockState ?? 'getBlockState';
      const getStateMethod = await worldBaseClass.getMethod(mGetState);

      const blockStateObj = (await getStateMethod.call(
        this.worldObj,
        posObj,
      )) as bigint;
      if (!blockStateObj || blockStateObj === 0n) return 0;

      const blockStateClass = await this.bridge.getClass(
        this.mappings.IBlockState.realClassName,
      );
      const mGetBlock =
        this.mappings.IBlockState.methods.getBlock ?? 'getBlock';
      const getBlockMethod = await blockStateClass.getMethod(mGetBlock);

      const blockObj = (await getBlockMethod.call(blockStateObj)) as bigint;
      if (!blockObj || blockObj === 0n) return 0;

      const blockClass = await this.bridge.getClass(
        this.mappings.Block.realClassName,
      );
      const mGetId =
        this.mappings.Block.methods.getIdFromBlock ?? 'getIdFromBlock';
      const getIdMethod = await blockClass.getMethod(mGetId);

      return ((await getIdMethod.call(0n, blockObj)) as number) ?? 0;
    } catch {
      return 0;
    }
  }
}
