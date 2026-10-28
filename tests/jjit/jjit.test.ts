import { describe, it, expect } from 'bun:test';
import { createPool } from 'exoproc-mappings';
import {
  jjit,
  JavaClassBuilder,
  JavaTypeResolver,
  normalizeModifiers,
  modifiersToFlags,
  flagsToModifiers,
  JavaModifierFlags,
  compileJava,
  remapJava,
  resolveDefaultJavaPath,
} from '../../packages/java/jjit/src/index.js';

describe('jjit - Java Modifiers', () => {
  it('normalizes string modifiers into canonical order', () => {
    expect(normalizeModifiers('final static public')).toBe(
      'public static final',
    );
    expect(normalizeModifiers('synchronized public')).toBe(
      'public synchronized',
    );
  });

  it('normalizes array and boolean object modifiers', () => {
    expect(normalizeModifiers(['final', 'public'])).toBe('public final');
    expect(
      normalizeModifiers({ public: true, static: true, final: true }),
    ).toBe('public static final');
  });

  it('converts between bitmasks and modifier names', () => {
    const flags =
      JavaModifierFlags.PUBLIC |
      JavaModifierFlags.STATIC |
      JavaModifierFlags.FINAL;
    expect(normalizeModifiers(flags)).toBe('public static final');
    expect(modifiersToFlags('public static final')).toBe(flags);
    expect(flagsToModifiers(flags)).toEqual(['public', 'static', 'final']);
  });
});

describe('jjit - TypeResolver & MappingPool', () => {
  it('resolves primitives and java.lang types without imports', () => {
    const resolver = new JavaTypeResolver();
    const intType = resolver.resolve('int');
    expect(intType.isPrimitive).toBe(true);
    expect(intType.codeType).toBe('int');

    const objType = resolver.resolve('Object');
    expect(objType.isPrimitive).toBe(false);
    expect(objType.codeType).toBe('Object');
    expect(resolver.getImports().length).toBe(0); // java.lang does not need explicit import
  });

  it('resolves java.util collections and adds imports', () => {
    const resolver = new JavaTypeResolver();
    const listType = resolver.resolve('List<String>');
    expect(listType.codeType).toBe('List<String>');
    expect(resolver.getImports()).toContain('java.util.List');
  });

  it('resolves canonical Minecraft classes from MappingPool and automatically adds imports', () => {
    const pool = createPool({ name: 'test-pool' });
    pool.registerMatch('net.minecraft.client.gui.GuiScreen', 'scr');
    pool.registerMatch('net.minecraft.client.gui.GuiButton', 'avs');

    const resolver = new JavaTypeResolver(pool);
    const screenType = resolver.resolve('GuiScreen');
    const buttonType = resolver.resolve('GuiButton');

    expect(screenType.codeType).toBe('GuiScreen');
    expect(screenType.fqcn).toBe('net.minecraft.client.gui.GuiScreen');
    expect(buttonType.codeType).toBe('GuiButton');
    expect(buttonType.fqcn).toBe('net.minecraft.client.gui.GuiButton');

    const imports = resolver.getImports();
    expect(imports).toContain('net.minecraft.client.gui.GuiScreen');
    expect(imports).toContain('net.minecraft.client.gui.GuiButton');
  });
});

describe('jjit - JavaClassBuilder AST Synthesis', () => {
  it('synthesizes clean Java source code with auto imports', () => {
    const pool = createPool({ name: 'test-pool' });
    pool.registerMatch('net.minecraft.client.gui.GuiScreen', 'scr');
    pool.registerMatch('net.minecraft.client.gui.GuiButton', 'avs');

    const builder = new JavaClassBuilder('ClickTask', pool)
      .package('org.exoproc.dynamic')
      .public()
      .final()
      .implements('Runnable')
      .field('screen', 'GuiScreen')
      .private()
      .final()
      .field('button', 'GuiButton')
      .private()
      .final()
      .constructorDef({ screen: 'GuiScreen', button: 'GuiButton' })
      .body('this.screen = screen;\nthis.button = button;')
      .method('run')
      .annotation('@Override')
      .public()
      .void()
      .body('screen.actionPerformed(button);');

    const source = builder.toSource();

    expect(source).toContain('package org.exoproc.dynamic;');
    expect(source).toContain('import net.minecraft.client.gui.GuiScreen;');
    expect(source).toContain('import net.minecraft.client.gui.GuiButton;');
    expect(source).toContain(
      'public final class ClickTask implements Runnable {',
    );
    expect(source).toContain('private final GuiScreen screen;');
    expect(source).toContain('private final GuiButton button;');
    expect(source).toContain(
      'public ClickTask(GuiScreen screen, GuiButton button) {',
    );
    expect(source).toContain('@Override');
    expect(source).toContain('public void run() {');
  });
});

describe('jjit - ECJ In-Memory Compilation', () => {
  it('compiles Java source code to valid bytecode (0xCAFEBABE)', async () => {
    const source = `
      package org.exoproc.test;

      public class Calculator {
          public static int add(int a, int b) {
              return a + b;
          }
      }
    `;

    const res = await compileJava({
      source,
      javaPath: resolveDefaultJavaPath(),
    });
    expect(res.success).toBe(true);
    expect(res.mainClass).toBe('org.exoproc.test.Calculator');

    const bytecode = await res.readBytecode('org.exoproc.test.Calculator');
    expect(bytecode).toBeDefined();
    // Validate Java Class File Magic Header: 0xCA, 0xFE, 0xBA, 0xBE
    expect(bytecode![0]).toBe(0xca);
    expect(bytecode![1]).toBe(0xfe);
    expect(bytecode![2]).toBe(0xba);
    expect(bytecode![3]).toBe(0xbe);
  });

  it('builds a dynamic Runnable using jjit.buildRunnable', async () => {
    const res = await jjit.buildRunnable(
      `
      System.out.println("Hello from dynamic Runnable!");
    `,
      {
        name: 'TestTask',
        packageName: 'org.exoproc.tasks',
      },
    );

    expect(res.compileResult.success).toBe(true);
    expect(res.className).toBe('org.exoproc.tasks.TestTask');
    expect(res.bytecode).toBeDefined();
    expect(res.bytecode[0]).toBe(0xca);
    expect(res.bytecode[1]).toBe(0xfe);
    expect(res.bytecode[2]).toBe(0xba);
    expect(res.bytecode[3]).toBe(0xbe);
  });

  it('remaps compiled bytecode via Tiny-Remapper', async () => {
    const source = `
      package org.exoproc.test;

      public class UserHook implements Runnable {
          public void run() {
              System.out.println("hook executed");
          }
      }
    `;

    const compiled = await compileJava({
      source,
      javaPath: resolveDefaultJavaPath(),
    });
    expect(compiled.success).toBe(true);

    const tinyMapping = [
      'v1\tnamed\tofficial',
      'CLASS\torg/exoproc/test/UserHook\tnet/minecraft/custom/ObfHook',
    ].join('\n');

    const remapped = await remapJava({
      input: compiled.classes,
      mappings: tinyMapping,
    });

    expect(remapped.success).toBe(true);
    const remappedBytecode = remapped.classes.get(
      'net.minecraft.custom.ObfHook',
    );
    expect(remappedBytecode).toBeDefined();
    expect(remappedBytecode![0]).toBe(0xca);
    expect(remappedBytecode![1]).toBe(0xfe);
    expect(remappedBytecode![2]).toBe(0xba);
    expect(remappedBytecode![3]).toBe(0xbe);
  });

  it('reverse-parses source code back into a JavaClassBuilder object', () => {
    const source = `
      package org.exoproc.test;

      import java.util.List;

      public class ComplexCalc extends BaseCalc implements Runnable {
          public static final int CONSTANT = 42;
          private String name;

          public ComplexCalc(String name) {
              this.name = name;
          }

          public static int add(int a, int b) {
              return a + b;
          }

          @Override
          public void run() {
              System.out.println(name);
          }
      }
    `;

    const builder = JavaClassBuilder.fromSource(source);
    expect(builder.name).toBe('ComplexCalc');
    expect(builder.packageName).toBe('org.exoproc.test');
    expect(builder.fqcn).toBe('org.exoproc.test.ComplexCalc');
    expect(builder.fileName).toBe('ComplexCalc.java');
    expect(builder.relativePath).toBe('org/exoproc/test/ComplexCalc.java');

    const generated = builder.toSource();
    expect(generated).toContain('package org.exoproc.test;');
    expect(generated).toContain(
      'class ComplexCalc extends BaseCalc implements Runnable',
    );
    expect(generated).toContain('public static final int CONSTANT = 42;');
    expect(generated).toContain('public ComplexCalc(String name) {');
    expect(generated).toContain('public static int add(int a, int b) {');
    expect(generated).toContain('@Override');
    expect(generated).toContain('public void run() {');
  });

  it('compiles directly via builder.compile() without calling compileJava explicitly', async () => {
    const builder = jjit
      .builder('Adder')
      .package('org.exoproc.test')
      .method('add', 'int')
      .public()
      .static()
      .param('a', 'int')
      .param('b', 'int')
      .body('return a + b;')
      .endMethod();

    expect(builder.fqcn).toBe('org.exoproc.test.Adder');

    const res = await builder.compile({ javaPath: resolveDefaultJavaPath() });
    expect(res.success).toBe(true);
    expect(res.mainClass).toBe('org.exoproc.test.Adder');
    const bytecode = await res.readBytecode('org.exoproc.test.Adder');
    expect(bytecode).toBeDefined();
    expect(bytecode![0]).toBe(0xca);
    expect(bytecode![1]).toBe(0xfe);
    expect(bytecode![2]).toBe(0xba);
    expect(bytecode![3]).toBe(0xbe);
  });

  it('builds directly via builder.build() and automatically inherits builder.pool', async () => {
    const pool = createPool();
    const builder = jjit
      .builder('MultiCalc', pool)
      .package('org.exoproc.test')
      .method('multiply', 'int')
      .public()
      .static()
      .param('x', 'int')
      .param('y', 'int')
      .body('return x * y;')
      .endMethod();

    expect(builder.pool).toBe(pool);

    // Call build directly without passing pool again
    const res = await builder.build({ javaPath: resolveDefaultJavaPath() });
    expect(res.compileResult.success).toBe(true);
    expect(res.className).toBe('org.exoproc.test.MultiCalc');
    expect(res.bytecode).toBeDefined();
    expect(res.bytecode[0]).toBe(0xca);
    expect(res.bytecode[1]).toBe(0xfe);
    expect(res.bytecode[2]).toBe(0xba);
    expect(res.bytecode[3]).toBe(0xbe);
  });

  it('jjit.builder parses source string automatically and can compile directly', async () => {
    const source = `
      package org.exoproc.test;
      public class InlineParsed {
          public static String getGreeting() {
              return "hello jjit";
          }
      }
    `;

    const builder = jjit.builder(source);
    expect(builder.name).toBe('InlineParsed');
    expect(builder.packageName).toBe('org.exoproc.test');
    expect(builder.fqcn).toBe('org.exoproc.test.InlineParsed');

    const res = await builder.compile({ javaPath: resolveDefaultJavaPath() });
    expect(res.success).toBe(true);
    expect(res.mainClass).toBe('org.exoproc.test.InlineParsed');
    const bytecode = await res.readBytecode('org.exoproc.test.InlineParsed');
    expect(bytecode).toBeDefined();
    expect(bytecode![0]).toBe(0xca);
    expect(bytecode![1]).toBe(0xfe);
    expect(bytecode![2]).toBe(0xba);
    expect(bytecode![3]).toBe(0xbe);
  });
});
