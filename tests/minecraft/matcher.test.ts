import { expect, test, describe } from 'bun:test';
import {
  MinecraftMatcher,
  MethodCascadeEngine,
  type MinecraftMappings,
} from 'exoproc-minecraft';

describe('exoproc-minecraft > MinecraftMatcher', () => {
  test('resolves standard deobfuscated Minecraft classes dynamically', async () => {
    const fakeReflection = {
      getClass: async (name: string) => ({
        name,
        getDeclaredFields: async () => [
          { name: 'theMinecraft', isStatic: true, type: name },
          {
            name: 'thePlayer',
            isStatic: false,
            type: 'net.minecraft.client.entity.EntityPlayerSP',
          },
        ],
        getDeclaredConstructors: async () => [],
        getSuperclassChain: async () => [name, 'java.lang.Object'],
      }),
    } as any;

    const matcher = new MinecraftMatcher(fakeReflection);
    const mappings = await matcher.match({
      minecraftClassName: 'net.minecraft.client.Minecraft',
    });

    expect(mappings.Minecraft.realClassName).toBe(
      'net.minecraft.client.Minecraft',
    );
    expect(mappings.Minecraft.fields.theMinecraft).toBe('theMinecraft');
  });

  test('registers all canonical Minecraft classes into JavaContext via registerTo', async () => {
    const fakeReflection = {} as any;
    const matcher = new MinecraftMatcher(fakeReflection);
    const mockMappings: any = {
      Minecraft: {
        realClassName: 'ave',
        fields: { thePlayer: 'h', theWorld: 'f' },
        methods: { runTick: 's' },
      },
      EntityPlayerSP: {
        realClassName: 'bew',
        fields: { movementInput: 'b' },
        methods: { sendChatMessage: 'e' },
      },
    };

    const registered: Array<{
      obf: string;
      deobf: string;
      fields: any;
      methods: any;
    }> = [];
    const fakeJavaContext = {
      mapClass(obf: string, deobf: string, options?: any) {
        registered.push({
          obf,
          deobf,
          fields: options?.fields,
          methods: options?.methods,
        });
      },
    };

    matcher.registerTo(fakeJavaContext, mockMappings);

    expect(
      registered.some((r) => r.obf === 'ave' && r.deobf === 'Minecraft'),
    ).toBe(true);
    expect(
      registered.some((r) => r.obf === 'bew' && r.deobf === 'EntityPlayerSP'),
    ).toBe(true);
    expect(
      registered.some(
        (r) =>
          r.obf === 'bew' &&
          r.deobf === 'net.minecraft.client.entity.EntityPlayerSP',
      ),
    ).toBe(true);
  });

  test('resolves full Minecraft graph starting from ONLY seeds: { RealmsBridge }', async () => {
    const fakeReflection = {
      getClass: async (name: string) => {
        if (name === 'custom.RealmsBridge') {
          return {
            name: 'custom.RealmsBridge',
            getDeclaredFields: async () => [
              { name: 'field_a', isStatic: false, type: 'custom.GuiScreen' },
            ],
            getDeclaredConstructors: async () => [],
            getSuperclassChain: async () => [name, 'java.lang.Object'],
          };
        }
        if (name === 'custom.GuiScreen') {
          return {
            name: 'custom.GuiScreen',
            getDeclaredFields: async () => [
              { name: 'field_mc', isStatic: false, type: 'custom.Minecraft' },
            ],
            getDeclaredConstructors: async () => [],
            getSuperclassChain: async () => [name, 'java.lang.Object'],
          };
        }
        if (name === 'custom.Minecraft') {
          return {
            name: 'custom.Minecraft',
            getDeclaredFields: async () => [
              { name: 'S', isStatic: true, type: 'custom.Minecraft' },
              { name: 'h', isStatic: false, type: 'custom.Player' },
              { name: 'f', isStatic: false, type: 'custom.WorldClient' },
            ],
            getDeclaredConstructors: async () => [],
            getSuperclassChain: async () => [name, 'java.lang.Object'],
          };
        }
        if (name === 'custom.Player') {
          return {
            name: 'custom.Player',
            getDeclaredConstructors: async () => [
              {
                paramTypes: [
                  'custom.Minecraft',
                  'custom.World',
                  'custom.NetHandler',
                  'custom.StatFileWriter',
                ],
              },
            ],
            getSuperclassChain: async () => [
              'custom.Player',
              'custom.AbstractPlayer',
              'custom.EntityPlayer',
              'custom.Living',
              'custom.Entity',
              'java.lang.Object',
            ],
            getDeclaredFields: async () => [],
          };
        }
        if (name === 'ave' || name === 'net.minecraft.client.Minecraft') {
          throw new Error(`ClassNotFoundException: ${name}`);
        }
        return {
          name,
          getDeclaredFields: async () => [],
          getDeclaredConstructors: async () => [],
          getSuperclassChain: async () => [name, 'java.lang.Object'],
        };
      },
    } as any;

    const matcher = new MinecraftMatcher(fakeReflection);
    const mappings = await matcher.match({
      seeds: { RealmsBridge: 'custom.RealmsBridge' },
    });

    expect(mappings.Minecraft.realClassName).toBe('custom.Minecraft');
    expect(mappings.Minecraft.fields.theMinecraft).toBe('S');
    expect(mappings.Minecraft.fields.thePlayer).toBe('h');
    expect(mappings.EntityPlayerSP.realClassName).toBe('custom.Player');
    expect(mappings.EntityPlayer.realClassName).toBe('custom.EntityPlayer');
    expect(mappings.Entity.realClassName).toBe('custom.Entity');
  });

  test('resolves full Minecraft graph starting from ONLY playerClassName', async () => {
    const fakeReflection = {
      getClass: async (name: string) => {
        if (name === 'custom.Player') {
          return {
            name: 'custom.Player',
            getDeclaredConstructors: async () => [
              {
                paramTypes: [
                  'custom.Minecraft',
                  'custom.World',
                  'custom.NetHandler',
                  'custom.StatFileWriter',
                ],
              },
            ],
            getSuperclassChain: async () => [
              'custom.Player',
              'custom.AbstractPlayer',
              'custom.EntityPlayer',
              'custom.Living',
              'custom.Entity',
              'java.lang.Object',
            ],
          };
        }
        if (name === 'custom.Minecraft') {
          return {
            name: 'custom.Minecraft',
            getDeclaredFields: async () => [
              { name: 'S', isStatic: true, type: 'custom.Minecraft' },
              { name: 'h', isStatic: false, type: 'custom.Player' },
              { name: 'f', isStatic: false, type: 'custom.WorldClient' },
              { name: 't', isStatic: false, type: 'custom.GameSettings' },
              { name: 'Y', isStatic: false, type: 'custom.Timer' },
            ],
          };
        }
        if (name === 'custom.WorldClient') {
          return {
            name: 'custom.WorldClient',
            getSuperclassChain: async () => [
              'custom.WorldClient',
              'custom.World',
              'java.lang.Object',
            ],
            getSuperclass: async () => ({
              name: 'custom.World',
              getDeclaredFields: async () => [
                { name: 'loadedEntityList', type: 'java.util.List' },
                { name: 'playerEntities', type: 'java.util.List' },
              ],
            }),
          };
        }
        if (name === 'custom.Timer') {
          return {
            name: 'custom.Timer',
            getSuperclassChain: async () => [
              'custom.Timer',
              'java.lang.Object',
            ],
            getDeclaredConstructors: async () => [{ paramTypes: ['float'] }],
            getDeclaredFields: async () => [
              { name: 'timerSpeed', type: 'float' },
              { name: 'renderPartialTicks', type: 'float' },
              { name: 'elapsedTicks', type: 'int' },
            ],
          };
        }
        if (name === 'custom.GameSettings') {
          return {
            name: 'custom.GameSettings',
            getSuperclassChain: async () => [
              'custom.GameSettings',
              'java.lang.Object',
            ],
            getDeclaredConstructors: async () => [
              { paramTypes: ['custom.Minecraft', 'java.io.File'] },
            ],
            getDeclaredFields: async () => [],
          };
        }
        if (name === 'custom.EntityPlayer') {
          return {
            name: 'custom.EntityPlayer',
            getDeclaredFields: async () => [
              { name: 'inventory', type: 'custom.Inventory' },
            ],
          };
        }
        if (name === 'custom.Living') {
          return {
            name: 'custom.Living',
            getDeclaredFields: async () => [],
          };
        }
        if (name === 'custom.Entity') {
          return {
            name: 'custom.Entity',
            getDeclaredFields: async () => [
              { name: 'posX', type: 'double' },
              { name: 'posY', type: 'double' },
              { name: 'posZ', type: 'double' },
              { name: 'motionX', type: 'double' },
              { name: 'motionY', type: 'double' },
              { name: 'motionZ', type: 'double' },
              { name: 'rotationYaw', type: 'float' },
              { name: 'rotationPitch', type: 'float' },
              { name: 'onGround', type: 'boolean' },
            ],
          };
        }
        return {
          name,
          getDeclaredFields: async () => [],
          getDeclaredConstructors: async () => [],
          getSuperclassChain: async () => [name, 'java.lang.Object'],
        };
      },
    } as any;

    const matcher = new MinecraftMatcher(fakeReflection);
    const mappings = await matcher.match({ playerClassName: 'custom.Player' });

    expect(mappings.Minecraft.realClassName).toBe('custom.Minecraft');
    expect(mappings.Minecraft.fields.theMinecraft).toBe('S');
    expect(mappings.Minecraft.fields.thePlayer).toBe('h');
    expect(mappings.EntityPlayerSP.realClassName).toBe('custom.Player');
    expect(mappings.EntityPlayer.realClassName).toBe('custom.EntityPlayer');
    expect(mappings.Entity.realClassName).toBe('custom.Entity');
    expect(mappings.World.realClassName).toBe('custom.World');
    expect(mappings.WorldClient.realClassName).toBe('custom.WorldClient');
    expect(mappings.Timer.realClassName).toBe('custom.Timer');
    expect(mappings.GameSettings.realClassName).toBe('custom.GameSettings');
  });

  test('discovers unknown classes via method parameter and return type cascading', async () => {
    const fakeReflection = {
      getClass: async (name: string) => {
        if (name === 'custom.World') {
          return {
            name: 'custom.World',
            getDeclaredConstructors: async () => [],
            getDeclaredFields: async () => [],
            getAllMethods: async () => [
              {
                name: 'func_rayTrace',
                paramTypes: ['custom.Vec3', 'custom.Vec3'],
                returnType: 'custom.MovingObjectPosition',
                isStatic: false,
              },
              {
                name: 'func_getBlockState',
                paramTypes: ['custom.BlockPos'],
                returnType: 'custom.IBlockState',
                isStatic: false,
              },
            ],
          };
        }
        return {
          name,
          getDeclaredConstructors: async () => [],
          getDeclaredFields: async () => [],
          getAllMethods: async () => [],
        };
      },
    } as any;

    const mappings: Partial<MinecraftMappings> = {
      World: {
        realClassName: 'custom.World',
        fields: {},
        methods: {},
      },
    };

    // Invoke method cascading
    const cascadeEngine = new MethodCascadeEngine(fakeReflection);
    await cascadeEngine.matchAndCascade(mappings);

    expect(mappings.World?.methods.rayTraceBlocks).toBe('func_rayTrace');
    expect(mappings.World?.methods.getBlockState).toBe('func_getBlockState');
    expect(mappings.Vec3?.realClassName).toBe('custom.Vec3');
    expect(mappings.MovingObjectPosition?.realClassName).toBe(
      'custom.MovingObjectPosition',
    );
    expect(mappings.BlockPos?.realClassName).toBe('custom.BlockPos');
    expect(mappings.IBlockState?.realClassName).toBe('custom.IBlockState');
  });

  test('reconstructs MinecraftMappings directly from MappingPool without reflection scans', async () => {
    const { createPool } = await import('exoproc-mappings');
    const { MinecraftClient } = await import('exoproc-minecraft');

    const pool = createPool();
    pool.registerMatch({
      canonicalName: 'net.minecraft.client.Minecraft',
      simpleName: 'Minecraft',
      realClassName: 'ave',
      fields: { thePlayer: 'h', theMinecraft: 'S' },
      methods: { getMinecraft: 'A' },
      confidence: 1.0,
    });
    pool.registerMatch({
      canonicalName: 'net.minecraft.client.entity.EntityPlayerSP',
      simpleName: 'EntityPlayerSP',
      realClassName: 'bew',
      fields: { movementInput: 'b' },
      methods: {},
      confidence: 1.0,
    });

    const poolMappings = MinecraftMatcher.mappingsFromPool(pool);
    expect(poolMappings).not.toBeNull();
    expect(poolMappings?.Minecraft.realClassName).toBe('ave');
    expect(poolMappings?.Minecraft.fields.thePlayer).toBe('h');
    expect(poolMappings?.EntityPlayerSP.realClassName).toBe('bew');

    // Verify MinecraftClient.from skips matcher when pool has Minecraft
    let scanAttempted = false;
    const fakeBridge = {
      getClass: async (name: string) => {
        if (name !== 'ave') {
          scanAttempted = true;
        }
        return {
          name,
          findField: async () => ({ get: async () => 0x1234n }),
          getMethod: async () => ({ call: async () => 0x1234n }),
        };
      },
    };

    const client = await MinecraftClient.from({ bridge: fakeBridge, pool });
    expect(client).toBeDefined();
    expect(client.mappings.Minecraft.realClassName).toBe('ave');
    expect(scanAttempted).toBe(false);
  });
});
