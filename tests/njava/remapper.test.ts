import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import {
  exportToTinyV1,
  remapJava,
  remapJavaSync,
  resolveTinyRemapperJarPath,
  typeToBytecodeDescriptor,
  generateObfuscationMappings,
  obfuscateBytecodeSync,
  obfuscateBytecode,
  toAlphaIdentifier,
} from '../../packages/java/njava/src/remapper.js';
import { parseClassBytecode } from 'exoproc-jjit';
import { JavaStubProject } from '../../packages/java/njava/src/stubs/project.js';
import { compileJavaSync } from '../../packages/java/njava/src/compiler.js';
import { JavaMappingRegistry } from '../../packages/java/njava/src/mapping.js';
import { getTestJavaPath } from './java-test-helpers.js';
import db from '../../packages/minecraft/src/mappings/database.json';

const sampleMap: any = {
  classes: {
    'net.minecraft.client.Minecraft': {
      canonical: 'net.minecraft.client.Minecraft',
      obf: 'ave',
      fields: { thePlayer: 'h' },
      methods: {
        getMinecraft: {
          obf: 'A',
          returnType: 'Minecraft',
          params: [],
          isStatic: true,
        },
      },
    },
    'net.minecraft.client.entity.EntityPlayerSP': {
      canonical: 'net.minecraft.client.entity.EntityPlayerSP',
      obf: 'bew',
      fields: {},
      methods: {
        addChatMessage: {
          obf: 'e',
          returnType: 'void',
          params: ['java.lang.String'],
        },
      },
    },
  },
};

const mappingsPath = join(
  import.meta.dir,
  '../../packages/minecraft/src/mappings/mappings-1.8.9.json',
);
const map = existsSync(mappingsPath)
  ? JSON.parse(readFileSync(mappingsPath, 'utf8'))
  : sampleMap;

describe('njava remapper', () => {
  const javaPath = getTestJavaPath(8);

  it('resolves tiny-remapper fat jar path', () => {
    const jarPath = resolveTinyRemapperJarPath();
    expect(existsSync(jarPath)).toBe(true);
    expect(jarPath.endsWith('tiny-remapper-0.14.1-fat.jar')).toBe(true);
  });

  it('converts Java types to JVM bytecode descriptors', () => {
    expect(typeToBytecodeDescriptor('void')).toBe('V');
    expect(typeToBytecodeDescriptor('boolean')).toBe('Z');
    expect(typeToBytecodeDescriptor('int')).toBe('I');
    expect(typeToBytecodeDescriptor('float')).toBe('F');
    expect(typeToBytecodeDescriptor('String')).toBe('Ljava/lang/String;');
    expect(typeToBytecodeDescriptor('List')).toBe('Ljava/util/List;');
    expect(typeToBytecodeDescriptor('int[]')).toBe('[I');
    expect(
      typeToBytecodeDescriptor('Minecraft', {
        Minecraft: 'net.minecraft.client.Minecraft',
      }),
    ).toBe('Lnet/minecraft/client/Minecraft;');
  });

  it('exports mappings-1.8.9.json into Tiny v1 format', () => {
    const tiny = exportToTinyV1(map);
    expect(tiny.startsWith('v1\tnamed\tofficial')).toBe(true);
    expect(tiny).toContain('CLASS\tnet/minecraft/client/Minecraft\tave');
    expect(tiny).toContain('thePlayer\th');
    expect(tiny).toContain('getMinecraft\tA');
    expect(tiny).toContain(
      'CLASS\tnet/minecraft/client/entity/EntityPlayerSP\tbew',
    );
  });

  it('exports JavaMappingRegistry into Tiny v1 format', () => {
    const registry = new JavaMappingRegistry();
    registry.registerDatabase({
      MyTestClass: {
        canonicalClassName: 'com.example.MyTestClass',
        fields: { count: 'int' },
        methods: { run: { params: [], returnType: 'void' } },
      },
    });
    registry.mapClass('abc', 'com.example.MyTestClass', {
      fields: { c: 'count' },
      methods: { r: 'run' },
    });

    const tiny = exportToTinyV1(registry);
    expect(tiny).toContain('CLASS\tcom/example/MyTestClass\tabc');
    expect(tiny).toContain('FIELD\tcom/example/MyTestClass\tI\tcount\tc');
    expect(tiny).toContain('METHOD\tcom/example/MyTestClass\t()V\trun\tr');
  });

  it('remaps compiled Java bytecode synchronously with remapJavaSync', () => {
    const project = new JavaStubProject({ javaPath, javaVersion: 8 });
    try {
      project.loadDatabase(db);
      project.compileSync();

      const userSource = `
        import net.minecraft.client.Minecraft;
        import net.minecraft.client.entity.EntityPlayerSP;

        public class SyncHook {
            public static void execute() {
                Minecraft mc = Minecraft.getMinecraft();
                EntityPlayerSP p = mc.thePlayer;
                p.sendChatMessage("Hello Sync");
            }
        }
      `;

      const compRes = compileJavaSync({
        source: userSource,
        classPath: project.getClassPath(),
        javaPath,
        javaVersion: 8,
      });

      expect(compRes.success).toBe(true);

      const remapRes = remapJavaSync({
        input: compRes,
        mappings: map,
        classPath: project.getClassPath(),
        javaPath,
      });

      expect(remapRes.success).toBe(true);
      expect(remapRes.classes.has('SyncHook')).toBe(true);

      const remappedBytes = remapRes.classes.get('SyncHook')!;
      expect(remappedBytes).toBeDefined();

      // Decompile with javap to verify Minecraft was remapped to ave and getMinecraft to A
      const outClass = join(remapRes.outputDir, 'SyncHook.class');
      const javapBin = join(
        dirname(javaPath),
        process.platform === 'win32' ? 'javap.exe' : 'javap',
      );
      const javapCmd = existsSync(javapBin) ? javapBin : 'javap';
      const javap = Bun.spawnSync([javapCmd, '-c', outClass]);
      const disassembled = javap.stdout.toString();

      // Check remapped symbols if javap is available
      if (disassembled.length > 0) {
        expect(disassembled).toContain('ave.A:()Lave;');
        expect(disassembled).toContain('ave.h:Lbew;');
        expect(disassembled).toContain('bew.e:(Ljava/lang/String;)V');
      }
    } finally {
      project.cleanup();
    }
  });

  it('remaps in-memory bytecode buffer asynchronously with remapJava', async () => {
    const project = new JavaStubProject({ javaPath, javaVersion: 8 });
    try {
      project.loadDatabase(db);
      await project.compile();

      const userSource = `
        import net.minecraft.client.Minecraft;

        public class AsyncHook {
            public static Minecraft get() {
                return Minecraft.getMinecraft();
            }
        }
      `;

      const compRes = compileJavaSync({
        source: userSource,
        classPath: project.getClassPath(),
        javaPath,
        javaVersion: 8,
      });

      expect(compRes.success).toBe(true);
      const hookBytecode = compRes.classes.get('AsyncHook')!;

      const remapRes = await remapJava({
        input: hookBytecode,
        mappings: map,
        classPath: project.getClassPath(),
        javaPath,
      });

      expect(remapRes.success).toBe(true);
      const remappedBytes = remapRes.classes.get('AsyncHook');
      expect(remappedBytes).toBeDefined();
    } finally {
      project.cleanup();
    }
  });

  it('generates alphabetic identifiers correctly', () => {
    expect(toAlphaIdentifier(0)).toBe('a');
    expect(toAlphaIdentifier(1)).toBe('b');
    expect(toAlphaIdentifier(25)).toBe('z');
    expect(toAlphaIdentifier(26)).toBe('aa');
    expect(toAlphaIdentifier(27)).toBe('ab');
  });

  it('parses Java class bytecode and generates Tiny v1 obfuscation mappings', () => {
    const userSource = `
      package com.example;
      public class ObfTest {
          private int secretCounter = 100;
          public String publicName = "Test";

          private int calculateSecret(int multiplier) {
              return secretCounter * multiplier;
          }

          public int getPublicResult() {
              return calculateSecret(2);
          }
      }
    `;
    const compRes = compileJavaSync({
      source: userSource,
      javaPath,
      javaVersion: 8,
    });
    expect(compRes.success).toBe(true);

    const bytecode = compRes.classes.get('com.example.ObfTest')!;
    expect(bytecode).toBeDefined();

    const parsed = parseClassBytecode(bytecode);
    expect(parsed.thisClassName).toBe('com/example/ObfTest');
    expect(
      parsed.fields.find((f) => f.name === 'secretCounter')?.isPrivate,
    ).toBe(true);
    expect(parsed.fields.find((f) => f.name === 'publicName')?.isPublic).toBe(
      true,
    );
    expect(
      parsed.methods.find((m) => m.name === 'calculateSecret')?.isPrivate,
    ).toBe(true);
    expect(
      parsed.methods.find((m) => m.name === 'getPublicResult')?.isPublic,
    ).toBe(true);

    const mappings = generateObfuscationMappings(compRes);
    expect(mappings).toContain('v1\tnamed\tobf');
    expect(mappings).toContain(
      'FIELD\tcom/example/ObfTest\tI\tsecretCounter\ta',
    );
    expect(mappings).toContain(
      'METHOD\tcom/example/ObfTest\t(I)I\tcalculateSecret\ta',
    );
    expect(mappings).not.toContain('publicName');
    expect(mappings).not.toContain('getPublicResult');
  });

  it('obfuscates and shrinks bytecode synchronously with obfuscateBytecodeSync', () => {
    const userSource = `
      package com.example;
      public class ExecutableObf {
          private int offset = 40;
          private int addOffset(int val) {
              return val + offset;
          }
          public int compute(int input) {
              return addOffset(input);
          }
      }
    `;
    const compRes = compileJavaSync({
      source: userSource,
      javaPath,
      javaVersion: 8,
    });
    expect(compRes.success).toBe(true);

    const obfRes = obfuscateBytecodeSync(compRes, { javaPath });
    expect(obfRes.success).toBe(true);
    expect(obfRes.classes.has('com.example.ExecutableObf')).toBe(true);

    const obfBytecode = obfRes.classes.get('com.example.ExecutableObf')!;
    const parsed = parseClassBytecode(obfBytecode);
    expect(parsed.fields.some((f) => f.name === 'a')).toBe(true);
    expect(parsed.methods.some((m) => m.name === 'a')).toBe(true);
    expect(parsed.methods.some((m) => m.name === 'compute')).toBe(true);
  });

  it('compiles and obfuscates transparently with compileJavaSync({ obfuscate: true })', () => {
    const userSource = `
      public class AutoObf {
          private String secret = "hidden";
          private String getSecret() { return secret; }
          public String reveal() { return getSecret(); }
      }
    `;
    const normal = compileJavaSync({
      source: userSource,
      javaPath,
      javaVersion: 8,
    });
    const obfuscated = compileJavaSync({
      source: userSource,
      javaPath,
      javaVersion: 8,
      obfuscate: true,
    });

    expect(normal.success).toBe(true);
    expect(obfuscated.success).toBe(true);

    const normalBytes = normal.classes.get('AutoObf')!;
    const obfBytes = obfuscated.classes.get('AutoObf')!;

    // Debug symbols stripped & identifiers shrunk -> smaller size
    expect(obfBytes.length).toBeLessThan(normalBytes.length);

    const parsed = parseClassBytecode(obfBytes);
    expect(parsed.fields.some((f) => f.name === 'a')).toBe(true);
    expect(parsed.methods.some((m) => m.name === 'reveal')).toBe(true);
  });
});
