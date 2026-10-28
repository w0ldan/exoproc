import type { MappingPool } from 'exoproc-mappings';
import {
  JavaClassBuilder,
  JavaConstructorBuilder,
  JavaFieldBuilder,
  JavaMethodBuilder,
} from './builder.js';
import {
  compileJava,
  compileJavaSync,
  detectJavaVersion,
  detectJavaVersionSync,
  parseJavaVersion,
  extractClassInfo,
  resolveEcjJarPath,
  resolveDefaultJavaPath,
  collectClassFilesSync,
  type JavaCompileOptions,
  type JavaCompileResult,
} from './compiler.js';
import {
  remapJava,
  remapJavaSync,
  exportToTinyV1,
  resolveTinyRemapperJarPath,
  generateObfuscationMappings,
  formatMappingsHumanReadable,
  obfuscateBytecode,
  obfuscateBytecodeSync,
  toAlphaIdentifier,
  DEFAULT_KEEP_METHODS,
  DEFAULT_KEEP_FIELDS,
  type JavaRemapOptions,
  type JavaRemapResult,
  type ObfuscationOptions,
} from './remapper.js';
import {
  parseClassBytecode,
  type ParsedJavaClass,
  type ParsedField,
  type ParsedMethod,
} from './class-parser.js';
import { JavaTypeResolver } from './type-resolver.js';
import { parseJavaSource } from './parser.js';
import {
  JavaModifierFlags,
  normalizeModifiers,
  parseModifiers,
  modifiersToFlags,
  flagsToModifiers,
  type JavaModifier,
  type ModifierInput,
} from './modifiers.js';
import {
  buildJarBuffer,
  writeJarSync,
  buildJarFromClasses,
  writeJarFromClassesSync,
  buildManifestContent,
  type JarEntry,
  type JarManifestOptions,
} from './jar.js';
import type {
  JavaClassDef,
  JavaConstructorDef,
  JavaFieldDef,
  JavaMethodDef,
  JavaParamDef,
} from './types.js';

export {
  // Builder
  JavaClassBuilder,
  JavaMethodBuilder,
  JavaConstructorBuilder,
  JavaFieldBuilder,
  JavaTypeResolver,
  parseJavaSource,
  // Class Parser
  parseClassBytecode,
  // Compiler
  compileJava,
  compileJavaSync,
  detectJavaVersion,
  detectJavaVersionSync,
  parseJavaVersion,
  extractClassInfo,
  resolveEcjJarPath,
  resolveDefaultJavaPath,
  collectClassFilesSync,
  // Remapper & Obfuscation
  remapJava,
  remapJavaSync,
  exportToTinyV1,
  resolveTinyRemapperJarPath,
  generateObfuscationMappings,
  formatMappingsHumanReadable,
  obfuscateBytecode,
  obfuscateBytecodeSync,
  toAlphaIdentifier,
  DEFAULT_KEEP_METHODS,
  DEFAULT_KEEP_FIELDS,
  // Modifiers
  JavaModifierFlags,
  normalizeModifiers,
  parseModifiers,
  modifiersToFlags,
  flagsToModifiers,
  // JAR Packaging
  buildJarBuffer,
  writeJarSync,
  buildJarFromClasses,
  writeJarFromClassesSync,
  buildManifestContent,
};

export type {
  JavaCompileOptions,
  JavaCompileResult,
  JavaRemapOptions,
  JavaRemapResult,
  ObfuscationOptions,
  ParsedJavaClass,
  ParsedField,
  ParsedMethod,
  JavaModifier,
  ModifierInput,
  JavaClassDef,
  JavaConstructorDef,
  JavaFieldDef,
  JavaMethodDef,
  JavaParamDef,
  JarEntry,
  JarManifestOptions,
};

export interface JJitBuildOptions {
  pool?: MappingPool;
  mappings?: any;
  classPath?: string | string[];
  javaPath?: string;
  javaVersion?: number;
  outputDir?: string;
}

export interface JJitBuildResult {
  /** Complete generated or input Java source code string */
  source: string;
  /** Compilation result from ECJ */
  compileResult: JavaCompileResult;
  /** Remapping result from Tiny-Remapper if remapping occurred */
  remapResult?: JavaRemapResult;
  /** Bytecode to be defined into the JVM */
  bytecode: Uint8Array;
  /** Primary FQCN of the built class */
  className: string;
}

/**
 * JJit - Java JIT and Dynamic Class Synthesizer for the Exoproc ecosystem.
 */
export const jjit = {
  /**
   * Creates a new fluent JavaClassBuilder, or parses raw Java source code into a JavaClassBuilder.
   */
  builder(sourceOrName: string, pool?: MappingPool): JavaClassBuilder {
    if (
      sourceOrName.includes('class ') ||
      sourceOrName.includes('interface ') ||
      sourceOrName.includes('enum ') ||
      sourceOrName.includes(';') ||
      sourceOrName.includes('{') ||
      sourceOrName.includes('package ')
    ) {
      return JavaClassBuilder.fromSource(sourceOrName, pool);
    }
    return new JavaClassBuilder(sourceOrName, pool);
  },

  /**
   * Builds and compiles a Java class from a JavaClassBuilder or raw source code string.
   * If a mapping pool or mapping table is provided, automatically remaps the bytecode!
   */
  async build(
    builderOrSource: JavaClassBuilder | string,
    options: JJitBuildOptions = {},
  ): Promise<JJitBuildResult> {
    const builder =
      typeof builderOrSource === 'string'
        ? JavaClassBuilder.fromSource(builderOrSource, options.pool)
        : builderOrSource;

    const pool = options.pool ?? options.mappings ?? builder.pool;
    const source = builder.toSource();
    const compileResult = await compileJava({
      source: builder,
      pool,
      javaPath: options.javaPath ?? resolveDefaultJavaPath(),
      javaVersion: options.javaVersion,
      classPath: options.classPath,
      outputDir: options.outputDir,
    });

    if (!compileResult.success) {
      throw new Error(
        `Java compilation failed:\n${compileResult.errors.join('\n')}\n${compileResult.output}`,
      );
    }

    const mainClass = compileResult.mainClass ?? builder.fqcn;
    let finalBytecode = compileResult.classes.get(mainClass);
    if (!finalBytecode) {
      finalBytecode = await compileResult.readBytecode(mainClass);
    }
    if (!finalBytecode) {
      throw new Error(`Could not find compiled bytecode for ${mainClass}`);
    }

    let remapResult: JavaRemapResult | undefined;
    const mappings = options.mappings ?? options.pool ?? builder.pool;
    if (mappings) {
      remapResult = await remapJava({
        input: compileResult.classes,
        mappings,
        javaPath: options.javaPath,
        classPath: options.classPath,
      });
      if (remapResult.success) {
        const remappedBytecode =
          remapResult.classes.get(mainClass) ??
          remapResult.classes.values().next().value;
        if (remappedBytecode) {
          finalBytecode = remappedBytecode;
        }
      }
    }

    if (!finalBytecode) {
      throw new Error(`Failed to extract bytecode for ${mainClass}`);
    }

    return {
      source,
      compileResult,
      remapResult,
      bytecode: finalBytecode,
      className: mainClass,
    };
  },

  /**
   * Helper to quickly build and compile a Runnable class with an inline body.
   */
  async buildRunnable(
    body: string,
    options: JJitBuildOptions & {
      name?: string;
      packageName?: string;
      fields?: Record<string, string>;
      constructorParams?: Record<string, string>;
      constructorBody?: string;
    } = {},
  ): Promise<JJitBuildResult> {
    const name = options.name ?? `DynamicRunnable_${Date.now()}`;
    const builder = new JavaClassBuilder(name, options.pool)
      .implements('Runnable')
      .public();

    if (options.packageName) {
      builder.package(options.packageName);
    }

    if (options.fields) {
      for (const [fName, fType] of Object.entries(options.fields)) {
        builder.field(fName, fType).public();
      }
    }

    if (options.constructorParams) {
      builder.constructorDef(
        options.constructorParams,
        options.constructorBody ?? '',
      );
    }

    builder.method('run').annotation('@Override').public().void().body(body);

    return jjit.build(builder, options);
  },

  /**
   * Builds an in-memory valid JAR buffer from an array of JarEntry.
   */
  buildJar: buildJarBuffer,

  /**
   * Writes a JAR file to disk from an array of JarEntry.
   */
  writeJar: writeJarSync,

  /**
   * Builds a JAR Buffer directly from a Map or Record of class bytecode.
   */
  buildJarFromClasses,

  /**
   * Writes a JAR file to disk directly from a Map or Record of class bytecode.
   */
  writeJarFromClasses: writeJarFromClassesSync,

  /**
   * Builds a MANIFEST.MF content string.
   */
  buildManifest: buildManifestContent,

  /**
   * Parses binary Java .class bytecode into a structured class model.
   */
  parseClass: parseClassBytecode,

  /**
   * Obfuscates and shrinks compiled Java bytecode asynchronously using tiny-remapper.
   */
  obfuscate: obfuscateBytecode,

  /**
   * Obfuscates and shrinks compiled Java bytecode synchronously using tiny-remapper.
   */
  obfuscateSync: obfuscateBytecodeSync,

  /**
   * Generates Tiny v1 obfuscation mappings from bytecode.
   */
  generateObfuscationMappings,

  /**
   * Formats Tiny v1 mappings into a human-readable text document.
   */
  formatMappings: formatMappingsHumanReadable,
  formatMappingsHumanReadable,
};

export default jjit;
