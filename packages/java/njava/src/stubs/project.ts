import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  compileJava,
  compileJavaSync,
  collectClassFilesSync,
  type JavaCompileResult,
} from '../compiler.js';
import {
  generateAuxiliaryStubs,
  generateClassStub,
  resolveJavaType,
  KNOWN_CANONICAL_CLASSES,
  JAVA_PRIMITIVE_TYPES,
  JAVA_STANDARD_CLASSES,
  type GeneratedStubFile,
} from './stub-generator.js';
import { writeJarSync, type JarEntry } from './jar.js';
import type {
  JavaStubClassSchema,
  JavaDatabaseSchema,
  JavaStubProjectOptions,
} from './types.js';

/**
 * Manages a virtual Gradle-style Java workspace for generating and compiling stubs.
 *
 * Directory Layout:
 * ```
 * <workspaceDir>/
 *   ├── src/main/java/              # Generated .java source files
 *   ├── build/classes/java/main/   # Compiled .class files for classpath use
 *   └── build/libs/stubs.jar       # Packaged stub jar
 * ```
 */
export class JavaStubProject {
  public readonly workspaceDir: string;
  public readonly srcDir: string;
  public readonly classesDir: string;
  public readonly libsDir: string;
  public readonly jarPath: string;
  public readonly javaPath: string;
  public readonly javaVersion: number;

  private readonly classCatalog: Record<string, string> = {
    ...KNOWN_CANONICAL_CLASSES,
  };
  private readonly schemas = new Map<string, JavaStubClassSchema>();
  private readonly generatedFiles = new Map<string, GeneratedStubFile>();
  private isCompiled = false;

  constructor(options: JavaStubProjectOptions = {}) {
    this.workspaceDir = options.workspaceDir
      ? resolve(options.workspaceDir)
      : join(
          tmpdir(),
          `exoproc-java-workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        );

    this.srcDir = join(this.workspaceDir, 'src', 'main', 'java');
    this.classesDir = join(
      this.workspaceDir,
      'build',
      'classes',
      'java',
      'main',
    );
    this.libsDir = join(this.workspaceDir, 'build', 'libs');
    this.jarPath = join(this.libsDir, 'stubs.jar');

    this.javaPath =
      options.javaPath ??
      process.env.MINECRAFT_JAVA_PATH ??
      process.env.JAVA_PATH ??
      'java';
    this.javaVersion = options.javaVersion ?? 8;

    this.ensureDirectories();
  }

  /**
   * Ensures project directories exist on disk.
   */
  public ensureDirectories(): void {
    mkdirSync(this.srcDir, { recursive: true });
    mkdirSync(this.classesDir, { recursive: true });
    mkdirSync(this.libsDir, { recursive: true });
  }

  /**
   * Returns the classpath directory containing compiled `.class` files.
   */
  public getClassPath(): string {
    return this.classesDir;
  }

  /**
   * Returns the path to `build/libs/stubs.jar`.
   */
  public getJarPath(): string {
    return this.jarPath;
  }

  /**
   * Returns the path to `src/main/java`.
   */
  public getSrcDir(): string {
    return this.srcDir;
  }

  /**
   * Ensures auxiliary stubs (e.g. GameProfile, ListenableFuture) are present in the workspace.
   */
  public ensureAuxiliaryStubs(): void {
    const auxStubs = generateAuxiliaryStubs(new Set(this.schemas.keys()));
    for (const aux of auxStubs) {
      if (!this.generatedFiles.has(aux.relativePath)) {
        const targetFile = join(this.srcDir, aux.relativePath);
        mkdirSync(join(targetFile, '..'), { recursive: true });
        writeFileSync(targetFile, aux.source, 'utf8');
        this.generatedFiles.set(aux.relativePath, aux);
      }
    }
  }

  /**
   * Registers one or more canonical class mappings in the type catalog.
   */
  public registerClassCatalog(
    catalog: Record<string, string> | string,
    fqcn?: string,
  ): this {
    if (typeof catalog === 'string' && fqcn) {
      this.classCatalog[catalog] = fqcn;
    } else if (typeof catalog === 'object') {
      Object.assign(this.classCatalog, catalog);
    }
    return this;
  }

  /**
   * Generates minimal skeleton stubs for any custom types referenced in this schema
   * that haven't been generated yet, so ECJ won't complain about unresolved types.
   */
  public ensureReferencedTypePlaceholders(schema: JavaStubClassSchema): void {
    const referencedTypes = new Set<string>();

    if (schema.superclass && schema.superclass !== 'Object') {
      referencedTypes.add(schema.superclass);
    }

    if (schema.fields) {
      for (const t of Object.values(schema.fields)) {
        const rawType = typeof t === 'string' ? t : (t as any)?.type;
        if (rawType) referencedTypes.add(rawType.replace(/\[\]/g, ''));
      }
    }

    if (schema.methods) {
      for (const m of Object.values(schema.methods)) {
        if (typeof m === 'object') {
          if (m.returnType && m.returnType !== 'void') {
            referencedTypes.add(m.returnType.replace(/\[\]/g, ''));
          }
          if (m.params) {
            for (const p of m.params) {
              referencedTypes.add(p.replace(/\[\]/g, ''));
            }
          }
        }
      }
    }

    for (const t of referencedTypes) {
      const resolved = resolveJavaType(t, this.classCatalog);
      if (
        JAVA_PRIMITIVE_TYPES.has(resolved) ||
        JAVA_STANDARD_CLASSES[resolved] ||
        resolved.startsWith('java.') ||
        resolved.startsWith('javax.')
      ) {
        continue;
      }
      const parts = resolved.split('.');
      const simpleName = parts.pop()!;
      // Skip inner classes / nested enums (e.g. MovingObjectPosition.MovingObjectType)
      if (
        parts.some(
          (p) => p.length > 0 && p.charAt(0) === p.charAt(0).toUpperCase(),
        )
      ) {
        continue;
      }
      let packageName = parts.join('.');
      if (!packageName) {
        const schemaFqcn = schema.canonical ?? schema.canonicalClassName ?? '';
        const schemaParts = schemaFqcn.split('.');
        schemaParts.pop();
        packageName = schemaParts.join('.');
      }
      const relativePath = packageName
        ? `${packageName.replace(/\./g, '/')}/${simpleName}.java`
        : `${simpleName}.java`;

      if (!this.generatedFiles.has(relativePath)) {
        const isInterface =
          simpleName.startsWith('I') &&
          simpleName.length > 1 &&
          Boolean(
            simpleName[1] && simpleName[1] === simpleName[1].toUpperCase(),
          );
        const pkgHeader = packageName ? `package ${packageName};\n\n` : '';
        const placeholderSource = isInterface
          ? [pkgHeader, `public interface ${simpleName} {`, `}`, '']
              .filter(Boolean)
              .join('\n')
          : [
              pkgHeader,
              `public class ${simpleName} {`,
              `    public ${simpleName}() {}`,
              `}`,
              '',
            ]
              .filter(Boolean)
              .join('\n');

        const targetFile = join(this.srcDir, relativePath);
        mkdirSync(join(targetFile, '..'), { recursive: true });
        writeFileSync(targetFile, placeholderSource, 'utf8');

        this.generatedFiles.set(relativePath, {
          relativePath,
          source: placeholderSource,
          fqcn: resolved,
          className: simpleName,
          packageName,
        });
      }
    }
  }

  /**
   * Adds or updates a single class schema in the project and writes its `.java` stub file.
   */
  public addClass(
    shortName: string,
    schema: JavaStubClassSchema,
  ): GeneratedStubFile {
    const fqcn =
      schema.canonical ??
      schema.canonicalClassName ??
      `net.minecraft.${shortName}`;
    this.classCatalog[shortName] = fqcn;
    this.schemas.set(shortName, schema);

    this.ensureAuxiliaryStubs();
    this.ensureReferencedTypePlaceholders(schema);

    const stub = generateClassStub(shortName, schema, this.classCatalog);
    const targetFile = join(this.srcDir, stub.relativePath);
    mkdirSync(join(targetFile, '..'), { recursive: true });
    writeFileSync(targetFile, stub.source, 'utf8');

    this.generatedFiles.set(stub.relativePath, stub);
    this.isCompiled = false;
    return stub;
  }

  /**
   * Loads an entire database (e.g. database.json) into the stub workspace,
   * generates auxiliary stubs, and writes all `.java` files.
   */
  public loadDatabase(
    database: JavaDatabaseSchema | Record<string, JavaStubClassSchema>,
  ): this {
    const classMap: Record<string, JavaStubClassSchema> =
      database &&
      typeof database === 'object' &&
      'classes' in database &&
      database.classes
        ? (database.classes as Record<string, JavaStubClassSchema>)
        : (database as Record<string, JavaStubClassSchema>);

    // 1. Build initial catalog
    for (const [key, schema] of Object.entries(classMap)) {
      if (
        !schema.fields &&
        !schema.methods &&
        schema.obf &&
        schema.obf.includes('.')
      ) {
        this.classCatalog[key] = schema.obf;
        continue;
      }
      const fqcn =
        schema.canonical ??
        schema.canonicalClassName ??
        (key.includes('.') ? key : `net.minecraft.${key}`);
      const simple = fqcn.includes('.') ? fqcn.split('.').pop()! : fqcn;
      this.classCatalog[key] = fqcn;
      this.classCatalog[fqcn] = fqcn;
      this.classCatalog[simple] = fqcn;
      this.schemas.set(fqcn, schema);
    }

    // 2. Generate and write auxiliary stubs
    const existingNames = new Set<string>(this.schemas.keys());
    const auxStubs = generateAuxiliaryStubs(existingNames);
    for (const aux of auxStubs) {
      const targetFile = join(this.srcDir, aux.relativePath);
      mkdirSync(join(targetFile, '..'), { recursive: true });
      writeFileSync(targetFile, aux.source, 'utf8');
      this.generatedFiles.set(aux.relativePath, aux);
    }

    // 3. Generate and write all class stubs
    for (const [key, schema] of Object.entries(classMap)) {
      if (
        !schema.fields &&
        !schema.methods &&
        schema.obf &&
        schema.obf.includes('.')
      ) {
        continue;
      }
      const stub = generateClassStub(key, schema, this.classCatalog);
      const targetFile = join(this.srcDir, stub.relativePath);
      mkdirSync(join(targetFile, '..'), { recursive: true });
      writeFileSync(targetFile, stub.source, 'utf8');
      this.generatedFiles.set(stub.relativePath, stub);
    }

    // 4. Ensure placeholders for any unmapped referenced types
    for (const [_key, schema] of Object.entries(classMap)) {
      if (
        !schema.fields &&
        !schema.methods &&
        schema.obf &&
        schema.obf.includes('.')
      ) {
        continue;
      }
      this.ensureReferencedTypePlaceholders(schema);
    }

    this.isCompiled = false;
    return this;
  }

  /**
   * Packages all compiled .class files into build/libs/stubs.jar.
   */
  public packageJar(): string {
    const classFiles = new Map<string, Uint8Array>();
    collectClassFilesSync(this.classesDir, this.classesDir, classFiles);
    const manifest =
      'Manifest-Version: 1.0\r\nCreated-By: Exoproc NJava Virtual Stubs\r\n\r\n';
    const entries: JarEntry[] = [
      { path: 'META-INF/MANIFEST.MF', data: Buffer.from(manifest, 'utf8') },
    ];
    for (const [className, bytecode] of classFiles.entries()) {
      entries.push({
        path: `${className.replace(/\./g, '/')}.class`,
        data: bytecode,
      });
    }
    writeJarSync(this.jarPath, entries);
    return this.jarPath;
  }

  /**
   * Compiles all generated stubs into `build/classes/java/main/` synchronously.
   */
  public compileSync(): JavaCompileResult {
    const sourceRecord: Record<string, string> = {};
    for (const [relPath, stub] of this.generatedFiles.entries()) {
      sourceRecord[relPath] = stub.source;
    }

    const result = compileJavaSync({
      source: sourceRecord,
      javaPath: this.javaPath,
      javaVersion: this.javaVersion,
      outputDir: this.classesDir,
      targetVersion: '-1.8',
      sourceVersion: '-1.8',
      additionalArgs: ['-nowarn'],
    });

    if (result.success) {
      this.isCompiled = true;
      try {
        this.packageJar();
      } catch {}
    }
    return result;
  }

  /**
   * Compiles all generated stubs into `build/classes/java/main/` asynchronously.
   */
  public async compile(): Promise<JavaCompileResult> {
    const sourceRecord: Record<string, string> = {};
    for (const [relPath, stub] of this.generatedFiles.entries()) {
      sourceRecord[relPath] = stub.source;
    }

    const result = await compileJava({
      source: sourceRecord,
      javaPath: this.javaPath,
      javaVersion: this.javaVersion,
      outputDir: this.classesDir,
      targetVersion: '-1.8',
      sourceVersion: '-1.8',
      additionalArgs: ['-nowarn'],
    });

    if (result.success) {
      this.isCompiled = true;
      try {
        this.packageJar();
      } catch {}
    }
    return result;
  }

  /**
   * Returns whether stubs have been compiled since the last modification.
   */
  public hasCompiled(): boolean {
    return this.isCompiled;
  }

  /**
   * Gets all generated stub files.
   */
  public getGeneratedFiles(): Map<string, GeneratedStubFile> {
    return new Map(this.generatedFiles);
  }

  /**
   * Removes workspace files and directory.
   */
  public cleanup(): void {
    if (existsSync(this.workspaceDir)) {
      try {
        rmSync(this.workspaceDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
