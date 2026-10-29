import { describe, expect, it } from 'bun:test';
import {
  loadDatabase,
  createPool,
  exportMappings,
  loadMappings,
} from '../../packages/java/mappings/src/index.js';

describe('njava-mappings: canonical database and obfuscated pool', () => {
  it('loads database directly from packages/minecraft/src/mappings/database.json syntax', () => {
    const db = loadDatabase();

    expect(db.size).toBeGreaterThanOrEqual(50);
    expect(db.has('Minecraft')).toBe(true);
    expect(db.has('net.minecraft.client.Minecraft')).toBe(true);
    expect(db.has('GuiScreen')).toBe(true);
    expect(db.has('net.minecraft.client.gui.GuiScreen')).toBe(true);
    expect(db.has('GuiButton')).toBe(true);

    const mcSchema = db.getClass('Minecraft');
    expect(mcSchema).toBeDefined();
    expect(mcSchema?.canonical).toBe('net.minecraft.client.Minecraft');
    const menuSchema = db.getClass('GuiMainMenu');
    expect(menuSchema?.superclass).toBe('GuiScreen');

    expect(mcSchema?.fields?.theMinecraft).toBe('Minecraft');
    expect(mcSchema?.fields?.thePlayer).toBe('EntityPlayerSP');
    expect(mcSchema?.fields?.theWorld).toBe('WorldClient');

    const getMcMethod = mcSchema?.methods?.getMinecraft as any;
    expect(getMcMethod).toBeDefined();
    expect(getMcMethod.params).toEqual([]);
    expect(getMcMethod.returnType).toBe('Minecraft');
    expect(getMcMethod.isStatic).toBe(true);
  });

  it('pool attaches canonical database and records detected obfuscated matches', () => {
    const db = loadDatabase();
    const pool = createPool({ name: 'session-1' });
    pool.useDatabase(db);

    pool.registerMatch({
      canonicalName: 'net.minecraft.client.gui.GuiScreen',
      simpleName: 'GuiScreen',
      realClassName: 'axu',
      fields: { buttonList: 'n' },
      methods: { actionPerformed: 'a' },
    });

    pool.registerMatch({
      canonicalName: 'net.minecraft.client.Minecraft',
      simpleName: 'Minecraft',
      realClassName: 'ave',
      fields: { thePlayer: 'h', theWorld: 'f' },
      methods: { getMinecraft: 'A' },
    });

    expect(pool.resolveClass('net.minecraft.client.gui.GuiScreen')).toBe('axu');
    expect(pool.resolveClass('GuiScreen')).toBe('axu');
    expect(pool.getCanonicalClass('axu')).toBe(
      'net.minecraft.client.gui.GuiScreen',
    );

    expect(
      pool.resolveField('net.minecraft.client.gui.GuiScreen', 'buttonList'),
    ).toBe('n');
    expect(
      pool.resolveMethod(
        'net.minecraft.client.gui.GuiScreen',
        'actionPerformed',
      ),
    ).toBe('a');

    expect(pool.resolveClass('net.minecraft.client.Minecraft')).toBe('ave');
    expect(pool.resolveClass('Minecraft')).toBe('ave');
    expect(pool.getCanonicalClass('ave')).toBe(
      'net.minecraft.client.Minecraft',
    );
    expect(
      pool.resolveField('net.minecraft.client.Minecraft', 'thePlayer'),
    ).toBe('h');
    expect(pool.getCanonicalField('net.minecraft.client.Minecraft', 'h')).toBe(
      'thePlayer',
    );
    expect(
      pool.resolveMethod('net.minecraft.client.Minecraft', 'getMinecraft'),
    ).toBe('A');
    expect(pool.getCanonicalMethod('net.minecraft.client.Minecraft', 'A')).toBe(
      'getMinecraft',
    );

    const detectedMc = pool.getDetected('Minecraft');
    expect(detectedMc?.schema).toBeDefined();
    expect(detectedMc?.schema?.canonical).toBe(
      'net.minecraft.client.Minecraft',
    );
    expect(detectedMc?.schema?.fields?.thePlayer).toBe('EntityPlayerSP');
  });

  it('loads authentic mappings-1.8.9.json into pool with database.json attached', () => {
    const db = loadDatabase();
    const pool = createPool();
    pool.useDatabase(db);

    loadMappings(undefined, pool);

    expect(pool.resolveClass('Minecraft')).toBe('ave');
    expect(pool.resolveClass('net.minecraft.client.Minecraft')).toBe('ave');
    expect(pool.getCanonicalClass('ave')).toBe(
      'net.minecraft.client.Minecraft',
    );

    expect(pool.resolveField('Minecraft', 'thePlayer')).toBe('h');
    expect(pool.resolveField('Minecraft', 'theWorld')).toBe('f');
    expect(pool.resolveMethod('Minecraft', 'getMinecraft')).toBe('A');

    expect(pool.resolveClass('GuiScreen')).toBe('axu');
    expect(pool.resolveField('GuiScreen', 'buttonList')).toBe('n');
    expect(pool.resolveMethod('GuiScreen', 'actionPerformed')).toBe('a');
  });

  it('createTypeFunction hooks into pool with callback', () => {
    const db = loadDatabase();
    const pool = createPool();
    pool.useDatabase(db);
    loadMappings(undefined, pool);

    const accessed: string[] = [];
    const typeFn = pool.createTypeFunction((ctx) => {
      accessed.push(ctx.requestedName);
      if (ctx.isMapped) {
        return {
          loadedClass: ctx.resolvedName,
          mapped: true,
          schema: ctx.schema,
        };
      }
      return {
        loadedClass: ctx.requestedName,
        mapped: false,
        schema: undefined,
      };
    });

    const res1 = typeFn('net.minecraft.client.Minecraft');
    expect(res1.loadedClass).toBe('ave');
    expect(res1.mapped).toBe(true);
    expect(res1.schema?.canonical).toBe('net.minecraft.client.Minecraft');

    const res2 = typeFn('java.lang.String');
    expect(res2.loadedClass).toBe('java.lang.String');
    expect(res2.mapped).toBe(false);

    expect(accessed).toEqual([
      'net.minecraft.client.Minecraft',
      'java.lang.String',
    ]);
  });

  it('exports and loads mappings accurately', () => {
    const pool = createPool();
    pool.registerMatch({
      canonicalName: 'net.minecraft.client.Minecraft',
      simpleName: 'Minecraft',
      realClassName: 'ave',
      fields: { thePlayer: 'h' },
      methods: { getMinecraft: 'A' },
    });

    const exported = exportMappings({
      pool,
      environment: {
        classpath: ['/path/to/minecraft.jar'],
        javaVersion: '1.8.0',
      },
    });

    expect(exported.formatVersion).toBe('1.0.0');
    expect(exported.environment?.classpath).toEqual(['/path/to/minecraft.jar']);
    expect(exported.classes['net.minecraft.client.Minecraft'].obf).toBe('ave');
    expect(
      exported.classes['net.minecraft.client.Minecraft'].fields?.thePlayer,
    ).toBe('h');

    const newPool = createPool();
    loadMappings(exported, newPool);

    expect(newPool.resolveClass('net.minecraft.client.Minecraft')).toBe('ave');
    expect(
      newPool.resolveField('net.minecraft.client.Minecraft', 'thePlayer'),
    ).toBe('h');
  });

  it('loads Tiny v1 mappings directly with loadTiny and pool.load', () => {
    const tinyData = [
      'v1\tnamed\tobf',
      'CLASS\torg/example/MyClass\ta/b/c',
      'FIELD\torg/example/MyClass\tI\tmyField\tf1',
      'METHOD\torg/example/MyClass\t()V\tmyMethod\tm1',
    ].join('\n');

    const pool = createPool();
    pool.loadTiny(tinyData);

    expect(pool.resolveClass('org.example.MyClass')).toBe('a.b.c');
    expect(pool.resolveClass('MyClass')).toBe('a.b.c');
    expect(pool.resolveField('org.example.MyClass', 'myField')).toBe('f1');
    expect(pool.resolveField('MyClass', 'myField')).toBe('f1');
    expect(pool.resolveMethod('MyClass', 'myMethod')).toBe('m1');
    expect(pool.getCanonicalField('MyClass', 'f1')).toBe('myField');
    expect(pool.getCanonicalMethod('MyClass', 'm1')).toBe('myMethod');

    // Test pool.load auto-detection for Tiny format
    const pool2 = createPool();
    pool2.load(tinyData);
    expect(pool2.resolveClass('MyClass')).toBe('a.b.c');
    expect(pool2.resolveField('MyClass', 'myField')).toBe('f1');
  });

  it('loads agent obfuscation mappings into pool with loadAgentMappings', async () => {
    const { loadAgentMappings } = await import('njava-agent');
    const pool = createPool();

    const tinyMappings = loadAgentMappings(pool);
    expect(tinyMappings).toContain('v1\tnamed\tobf');
    expect(tinyMappings).toContain('org/exoproc/njava/agent/utils/Exoproc');

    // Canonical & Simple name resolutions
    expect(pool.resolveClass('org.exoproc.njava.agent.utils.Exoproc')).toBe(
      'org.exoproc.njava.agent.utils.Exoproc',
    );
    expect(pool.resolveClass('Exoproc')).toBe(
      'org.exoproc.njava.agent.utils.Exoproc',
    );

    // Obfuscated field resolutions
    expect(pool.resolveField('Exoproc', 'instance')).toBe('a');
    expect(pool.resolveField('Exoproc', 'connected')).toBe('b');
    expect(
      pool.resolveField(
        'org.exoproc.njava.agent.utils.Exoproc',
        'targetLoader',
      ),
    ).toBe('c');

    // Obfuscated method resolutions
    expect(pool.resolveMethod('Exoproc', 'serializeValue')).toBe('a');
    expect(pool.resolveMethod('Exoproc', 'isMethodCompatible')).toBe('b');

    // Reverse deobfuscation
    expect(pool.getCanonicalField('Exoproc', 'a')).toBe('instance');
    expect(pool.getCanonicalField('Exoproc', 'b')).toBe('connected');
    expect(pool.getCanonicalMethod('Exoproc', 'a')).toBe('serializeValue');
  });
});
