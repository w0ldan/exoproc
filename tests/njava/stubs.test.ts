import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JavaStubProject } from '../../packages/java/njava/src/stubs/project.js';
import {
  generateClassStub,
  resolveJavaType,
} from '../../packages/java/njava/src/stubs/stub-generator.js';
import { compileJavaSync } from '../../packages/java/njava/src/compiler.js';
import { JavaMappingRegistry } from '../../packages/java/njava/src/mapping.js';
import { getTestJavaPath } from './java-test-helpers.js';
import db from '../../packages/minecraft/src/mappings/database.json';

describe('njava stubs', () => {
  const javaPath = getTestJavaPath(8);

  it('resolves Java types correctly', () => {
    const catalog = {
      Minecraft: 'net.minecraft.client.Minecraft',
      EntityPlayerSP: 'net.minecraft.client.entity.EntityPlayerSP',
    };

    expect(resolveJavaType('int', catalog)).toBe('int');
    expect(resolveJavaType('String', catalog)).toBe('java.lang.String');
    expect(resolveJavaType('List', catalog)).toBe('java.util.List');
    expect(resolveJavaType('Minecraft', catalog)).toBe(
      'net.minecraft.client.Minecraft',
    );
    expect(resolveJavaType('EntityPlayerSP[]', catalog)).toBe(
      'net.minecraft.client.entity.EntityPlayerSP[]',
    );
    expect(resolveJavaType('FontRenderer', catalog)).toBe(
      'net.minecraft.client.gui.FontRenderer',
    );
  });

  it('generates valid stub Java source from class schema', () => {
    const schema = {
      canonical: 'net.minecraft.client.Minecraft',
      fields: {
        thePlayer: 'EntityPlayerSP',
        leftClickCounter: 'int',
      },
      methods: {
        getMinecraft: { params: [], returnType: 'Minecraft', isStatic: true },
        runTick: { params: [], returnType: 'void' },
      },
    };

    const catalog = {
      Minecraft: 'net.minecraft.client.Minecraft',
      EntityPlayerSP: 'net.minecraft.client.entity.EntityPlayerSP',
    };

    const stub = generateClassStub('Minecraft', schema, catalog);
    expect(stub.relativePath).toBe('net/minecraft/client/Minecraft.java');
    expect(stub.fqcn).toBe('net.minecraft.client.Minecraft');
    expect(stub.source).toContain('package net.minecraft.client;');
    expect(stub.source).toContain('public class Minecraft');
    expect(stub.source).toContain(
      'public net.minecraft.client.entity.EntityPlayerSP thePlayer;',
    );
    expect(stub.source).toContain('public int leftClickCounter;');
    expect(stub.source).toContain(
      'public static net.minecraft.client.Minecraft getMinecraft()',
    );
    expect(stub.source).toContain('public void runTick()');
  });

  it('initializes a virtual Gradle workspace directory structure', () => {
    const project = new JavaStubProject({ javaPath, javaVersion: 8 });
    try {
      expect(existsSync(project.workspaceDir)).toBe(true);
      expect(existsSync(project.srcDir)).toBe(true);
      expect(existsSync(project.classesDir)).toBe(true);
      expect(project.getClassPath()).toBe(project.classesDir);
      expect(project.getSrcDir()).toBe(project.srcDir);
    } finally {
      project.cleanup();
    }
  });

  it('loads database.json and batch-compiles all stubs into build/classes/java/main', () => {
    const project = new JavaStubProject({ javaPath, javaVersion: 8 });
    try {
      project.loadDatabase(db);

      const generatedFiles = project.getGeneratedFiles();
      expect(generatedFiles.size).toBeGreaterThanOrEqual(54);

      // Verify source files exist on disk
      const mcJava = join(
        project.srcDir,
        'net',
        'minecraft',
        'client',
        'Minecraft.java',
      );
      expect(existsSync(mcJava)).toBe(true);

      const res = project.compileSync();
      expect(res.success).toBe(true);
      expect(res.classes.size).toBeGreaterThanOrEqual(54);

      // Verify compiled class file exists on disk
      const mcClass = join(
        project.classesDir,
        'net',
        'minecraft',
        'client',
        'Minecraft.class',
      );
      expect(existsSync(mcClass)).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  it('allows dynamically adding a new class stub', () => {
    const project = new JavaStubProject({ javaPath, javaVersion: 8 });
    try {
      const stub = project.addClass('CustomHelper', {
        canonical: 'com.example.util.CustomHelper',
        methods: {
          compute: { params: ['int'], returnType: 'int', isStatic: true },
        },
      });

      expect(stub.relativePath).toBe('com/example/util/CustomHelper.java');
      const helperJava = join(
        project.srcDir,
        'com',
        'example',
        'util',
        'CustomHelper.java',
      );
      expect(existsSync(helperJava)).toBe(true);

      const res = project.compileSync();
      expect(res.success).toBe(true);
      expect(res.classes.has('com.example.util.CustomHelper')).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  it('allows user Java code to compile cleanly against the stub project classpath', () => {
    const project = new JavaStubProject({ javaPath, javaVersion: 8 });
    try {
      project.loadDatabase(db);
      project.compileSync();

      const userCode = `
        package my.mod;
        import net.minecraft.client.Minecraft;
        import net.minecraft.client.entity.EntityPlayerSP;

        public class MyAction {
            public static void send() {
                Minecraft mc = Minecraft.getMinecraft();
                EntityPlayerSP player = mc.thePlayer;
                player.sendChatMessage("Hello world");
            }
        }
      `;

      const res = compileJavaSync({
        source: userCode,
        classPath: project.getClassPath(),
        javaPath,
        javaVersion: 8,
      });

      expect(res.success).toBe(true);
      expect(res.classes.has('my.mod.MyAction')).toBe(true);
      const bytecode = res.classes.get('my.mod.MyAction');
      expect(bytecode).toBeDefined();
      expect(bytecode!.length).toBeGreaterThan(100);
    } finally {
      project.cleanup();
    }
  });

  it('generates and packages build/libs/stubs.jar upon compilation', () => {
    const project = new JavaStubProject({ javaPath, javaVersion: 8 });
    try {
      project.addClass('SimpleEntity', {
        canonical: 'com.game.SimpleEntity',
        fields: {
          id: 'int',
        },
      });

      const res = project.compileSync();
      expect(res.success).toBe(true);

      const jarPath = project.getJarPath();
      expect(existsSync(jarPath)).toBe(true);
      expect(jarPath.endsWith('stubs.jar')).toBe(true);

      // Verify jar file has non-zero size
      const jarBytes = readFileSync(jarPath);
      expect(jarBytes.length).toBeGreaterThan(100);
    } finally {
      project.cleanup();
    }
  });

  it('automatically emits and compiles class stubs only when all schema requirements are completed', () => {
    const registry = new JavaMappingRegistry({ javaPath, javaVersion: 8 });
    try {
      registry.registerDatabase({
        Player: {
          canonicalClassName: 'com.game.Player',
          fields: {
            health: 'float',
            name: 'String',
          },
          methods: {
            heal: { params: ['float'], returnType: 'void' },
          },
        },
      });

      const stubProject = registry.getStubProject();
      const playerJava = join(stubProject.srcDir, 'com', 'game', 'Player.java');
      const playerClass = join(
        stubProject.classesDir,
        'com',
        'game',
        'Player.class',
      );

      // 1. Initially class is not complete
      expect(registry.isClassComplete('Player', { strict: true })).toBe(false);
      expect(existsSync(playerJava)).toBe(false);

      // 2. Map class and 1 field -> still strictly incomplete
      registry.mapClass('p_obf', 'com.game.Player', {
        fields: { f_health: 'health' },
      });
      expect(registry.isClassComplete('Player', { strict: true })).toBe(false);
      // But stub is dynamically emitted!
      expect(existsSync(playerJava)).toBe(true);

      // 3. Map second field -> still strictly incomplete (heal method missing)
      registry.mapField('com.game.Player', 'f_name', 'name');
      expect(registry.isClassComplete('Player', { strict: true })).toBe(false);

      // 4. Map the remaining method -> NOW strictly complete!
      registry.mapMethod('com.game.Player', 'm_heal', 'heal');
      expect(registry.isClassComplete('Player', { strict: true })).toBe(true);

      // Verify .java stub was updated with all members
      expect(existsSync(playerJava)).toBe(true);
      const javaSource = readFileSync(playerJava, 'utf8');
      expect(javaSource).toContain('public class Player');
      expect(javaSource).toContain('public float health;');
      expect(javaSource).toContain('public java.lang.String name;');
      expect(javaSource).toContain('public void heal(float p0)');

      // Verify .class was compiled and stubs.jar was created
      expect(existsSync(playerClass)).toBe(true);
      expect(existsSync(stubProject.getJarPath())).toBe(true);
    } finally {
      registry.getStubProject().cleanup();
    }
  });

  it('syncPool batch-matches pool data, emits stubs, and enables compileAndRemap', () => {
    const registry = new JavaMappingRegistry({ javaPath, javaVersion: 8 });
    try {
      registry.registerDatabase({
        TargetBot: {
          canonicalClassName: 'com.bot.TargetBot',
          fields: {
            score: 'int',
          },
          methods: {
            attack: { params: [], returnType: 'void' },
          },
        },
      });

      // Simulate a reflected/detected pool
      const mockPool = new Map<string, any>();
      mockPool.set('TargetBot', {
        kind: 'class',
        realClassName: 'bot_obf',
        canonicalClassName: 'com.bot.TargetBot',
        fields: {
          score: { originalName: 'score', realName: 'f_score' },
        },
        methods: {
          attack: { originalName: 'attack', realName: 'm_attack' },
        },
      });

      registry.syncPool(mockPool);

      expect(registry.isClassComplete('TargetBot')).toBe(true);

      // Verify Tiny v1 mappings can be dumped directly
      const tiny = registry.dumpMappings();
      expect(tiny).toContain('CLASS\tcom/bot/TargetBot\tbot_obf');
      expect(tiny).toContain('FIELD\tcom/bot/TargetBot\tI\tscore\tf_score');
      expect(tiny).toContain(
        'METHOD\tcom/bot/TargetBot\t()V\tattack\tm_attack',
      );

      // Verify compileAndRemap using the registry
      const userCode = `
        package user.script;
        import com.bot.TargetBot;

        public class UserScript {
            public static void run() {
                TargetBot bot = new TargetBot();
                bot.score = 42;
                bot.attack();
            }
        }
      `;

      const result = registry.compileAndRemapSync(userCode);
      expect(result.compileResult.success).toBe(true);
      expect(result.remapResult.success).toBe(true);
      expect(result.classes.has('user.script.UserScript')).toBe(true);

      const bytecode = result.classes.get('user.script.UserScript');
      expect(bytecode).toBeDefined();
      expect(bytecode!.length).toBeGreaterThan(100);
      expect(result.bytecode).toBeDefined();
    } finally {
      registry.getStubProject().cleanup();
    }
  });
});
