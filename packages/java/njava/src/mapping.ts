import { existsSync, readFileSync } from 'node:fs';
import { JavaStubProject } from './stubs/project.js';
import type { JavaStubProjectOptions } from './stubs/types.js';
import { exportToTinyV1 } from './remapper.js';
import {
  compileJava,
  compileJavaSync,
  type JavaCompileOptions,
  type JavaCompileResult,
} from './compiler.js';
import {
  remapJava,
  remapJavaSync,
  type JavaRemapOptions,
  type JavaRemapResult,
} from './remapper.js';

export interface JavaClassSchema {
  canonicalClassName?: string;
  superclass?: string;
  fields?: Record<string, string>;
  methods?: Record<string, any>;
}

export interface JavaDatabaseProvider {
  getDatabase?(): Record<string, any>;
}

export const JAVA_PRIMITIVES = new Set<string>([
  'int',
  'float',
  'double',
  'long',
  'boolean',
  'byte',
  'short',
  'char',
  'void',
]);

export function isPrimitiveType(type: string): boolean {
  return JAVA_PRIMITIVES.has(type);
}

export const STANDARD_PACKAGES = [
  'java.',
  'javax.',
  'sun.',
  'jdk.',
  'org.lwjgl.',
  'com.google.',
  'org.apache.',
  'io.netty.',
  'scala.',
  'kotlin.',
];

export const STANDARD_UNOBFUSCATED_METHODS = new Set<string>([
  'toString',
  'equals',
  'hashCode',
  'clone',
  'compareTo',
  'run',
  'close',
  'call',
  'iterator',
  'hasNext',
  'next',
  'init',
  '<init>',
  '<clinit>',
  'finalize',
  'values',
  'valueOf',
]);

export function isObfuscatedClassName(className: string): boolean {
  if (!className) return false;
  const clean = className.replace(/^(class|interface)\s+/, '').trim();
  if (isPrimitiveType(clean)) return false;
  for (const pkg of STANDARD_PACKAGES) {
    if (clean.startsWith(pkg)) return false;
  }
  const parts = clean.split('.');
  const simpleName = parts[parts.length - 1] ?? '';
  if (parts.length === 1 && simpleName.length <= 4) {
    return true;
  }
  if (parts.length <= 2 && simpleName.length <= 3) {
    return true;
  }
  return false;
}

export function isObfuscatedMethodName(methodName: string): boolean {
  if (!methodName) return false;
  if (STANDARD_UNOBFUSCATED_METHODS.has(methodName)) return false;
  if (methodName.startsWith('func_')) return true;
  if (methodName.length <= 3) return true;
  return false;
}

export function isObfuscatedFieldName(fieldName: string): boolean {
  if (!fieldName) return false;
  if (fieldName.startsWith('field_')) return true;
  if (fieldName.length <= 3) return true;
  return false;
}

export interface JavaClassMappingOptions {
  fields?: Record<string, string>; // obfField -> deobfField
  methods?: Record<string, string>; // obfMethod -> deobfMethod
}

export interface JavaClassMapping {
  obfName: string;
  deobfName: string;
  obfToDeobfFields: Map<string, string>;
  deobfToObfFields: Map<string, string>;
  obfToDeobfMethods: Map<string, string>;
  deobfToObfMethods: Map<string, string>;
}

/**
 * Bidirectional Deobfuscation & Mapping Registry for Java classes, fields, and methods.
 *
 * Allows transparent interaction with obfuscated JVM classes (e.g. MCP / Minecraft / ProGuard)
 * using clean deobfuscated names on the TypeScript/JavaScript side.
 */
export class JavaMappingRegistry {
  private readonly obfToDeobfClasses = new Map<string, string>();
  private readonly deobfToObfClasses = new Map<string, string>();
  private readonly classMappings = new Map<string, JavaClassMapping>();
  private database?: Record<string, any>;
  private readonly canonicalToShortName = new Map<string, string>();
  private readonly shortNameToCanonical = new Map<string, string>();
  private stubProject?: JavaStubProject;
  private readonly emittedClassSignatures = new Map<string, string>();
  private autoCompileStubs = false;
  private stubsDirty = false;

  constructor(
    options?: JavaStubProjectOptions & { autoCompileStubs?: boolean },
  ) {
    if (options?.autoCompileStubs !== undefined) {
      this.autoCompileStubs = options.autoCompileStubs;
    }
    if (options) {
      this.stubProject = new JavaStubProject(options);
    }
  }

  public getStubProject(options?: JavaStubProjectOptions): JavaStubProject {
    if (!this.stubProject) {
      this.stubProject = new JavaStubProject(options);
      if (this.shortNameToCanonical.size > 0) {
        const catalog: Record<string, string> = {};
        for (const [k, v] of this.shortNameToCanonical.entries()) {
          catalog[k] = v;
        }
        this.stubProject.registerClassCatalog(catalog);
      }
    }
    return this.stubProject;
  }

  public setAutoCompileStubs(enable: boolean): this {
    this.autoCompileStubs = enable;
    return this;
  }

  /**
   * Registers a canonical database/schema (e.g. MINECRAFT_CANONICAL_SCHEMA).
   * Mappings connect directly to this database instead of maintaining redundant records.
   */
  public registerDatabase(db: Record<string, any>): this {
    this.database = db;
    for (const [shortName, schema] of Object.entries(db)) {
      const canonical = schema?.canonicalClassName || shortName;
      this.canonicalToShortName.set(canonical, shortName);
      this.shortNameToCanonical.set(shortName, canonical);
    }
    if (this.stubProject && this.shortNameToCanonical.size > 0) {
      const catalog: Record<string, string> = {};
      for (const [k, v] of this.shortNameToCanonical.entries()) {
        catalog[k] = v;
      }
      this.stubProject.registerClassCatalog(catalog);
    }
    return this;
  }

  /**
   * Returns the registered canonical database if available.
   */
  public getDatabase(): Record<string, any> | undefined {
    return this.database;
  }

  /**
   * Returns whether a class name is a known entry in the canonical database.
   */
  public isDatabaseClass(name: string): boolean {
    if (!this.database) return false;
    return (
      this.shortNameToCanonical.has(name) ||
      this.canonicalToShortName.has(name) ||
      Boolean(this.database[name])
    );
  }

  /**
   * Registers a bidirectional class mapping with optional field and method mappings.
   * Automatically registers both short class name (e.g. GuiSelectWorld) and full canonical package name.
   *
   * Example:
   * ```ts
   * mapper.mapClass('ave', 'net.minecraft.client.Minecraft', {
   *   fields: { 'h': 'thePlayer', 'f': 'theWorld' },
   *   methods: { 'a': 'sendChatMessage', 's': 'runTick' },
   * });
   * ```
   */
  public mapClass(
    obfName: string,
    deobfName: string,
    options?: JavaClassMappingOptions,
  ): this {
    const simpleName = deobfName.includes('.')
      ? deobfName.split('.').pop()!
      : deobfName;
    const canonName =
      this.shortNameToCanonical.get(deobfName) ??
      (deobfName.includes('.') ? deobfName : undefined);
    const fullDeobfName = canonName ?? deobfName;

    // Register forward & reverse mappings for all aliases
    this.obfToDeobfClasses.set(obfName, fullDeobfName);
    this.deobfToObfClasses.set(deobfName, obfName);
    this.deobfToObfClasses.set(simpleName, obfName);
    if (canonName) {
      this.deobfToObfClasses.set(canonName, obfName);
    }

    let mapping = this.classMappings.get(obfName);
    if (!mapping) {
      mapping = {
        obfName,
        deobfName: fullDeobfName,
        obfToDeobfFields: new Map(),
        deobfToObfFields: new Map(),
        obfToDeobfMethods: new Map(),
        deobfToObfMethods: new Map(),
      };
    } else {
      mapping.deobfName = fullDeobfName;
    }

    this.classMappings.set(obfName, mapping);
    this.classMappings.set(deobfName, mapping);
    this.classMappings.set(simpleName, mapping);
    if (canonName) {
      this.classMappings.set(canonName, mapping);
    }

    if (options?.fields) {
      for (const [obfF, deobfF] of Object.entries(options.fields)) {
        this.mapField(obfName, obfF, deobfF);
      }
    }

    if (options?.methods) {
      for (const [obfM, deobfM] of Object.entries(options.methods)) {
        this.mapMethod(obfName, obfM, deobfM);
      }
    }

    this.checkAndEmitStub(deobfName);
    return this;
  }

  /**
   * Maps an obfuscated field to a deobfuscated field name on a class (order-independent).
   */
  public mapField(classNameOrObf: string, name1: string, name2: string): this {
    const mapping = this.getOrCreateMapping(classNameOrObf);
    let obf = name1;
    let deobf = name2;
    const dbSchema = this.database
      ? (this.database[classNameOrObf] ?? this.database[mapping.deobfName])
      : undefined;

    if (dbSchema?.fields?.[name1]) {
      deobf = name1;
      obf = name2;
    } else if (dbSchema?.fields?.[name2]) {
      deobf = name2;
      obf = name1;
    } else if (!isObfuscatedFieldName(name1) && isObfuscatedFieldName(name2)) {
      deobf = name1;
      obf = name2;
    }

    mapping.obfToDeobfFields.set(obf, deobf);
    mapping.deobfToObfFields.set(deobf, obf);
    this.checkAndEmitStub(classNameOrObf);
    return this;
  }

  /**
   * Maps an obfuscated method to a deobfuscated method name on a class (order-independent).
   */
  public mapMethod(classNameOrObf: string, name1: string, name2: string): this {
    const mapping = this.getOrCreateMapping(classNameOrObf);
    let obf = name1;
    let deobf = name2;
    const dbSchema = this.database
      ? (this.database[classNameOrObf] ?? this.database[mapping.deobfName])
      : undefined;

    if (dbSchema?.methods?.[name1]) {
      deobf = name1;
      obf = name2;
    } else if (dbSchema?.methods?.[name2]) {
      deobf = name2;
      obf = name1;
    } else if (
      !isObfuscatedMethodName(name1) &&
      isObfuscatedMethodName(name2)
    ) {
      deobf = name1;
      obf = name2;
    }

    mapping.obfToDeobfMethods.set(obf, deobf);
    mapping.deobfToObfMethods.set(deobf, obf);
    this.checkAndEmitStub(classNameOrObf);
    return this;
  }

  /**
   * Resolves the obfuscated JVM class name from a deobfuscated (or already obfuscated) class name.
   * If the requested class is defined in the canonical database but has not been resolved/matched yet,
   * throws an informative error.
   */
  public resolveObfClass(name: string): string {
    // 1. Direct mapped check (fast path)
    const direct = this.deobfToObfClasses.get(name);
    if (direct) return direct;

    // 2. Canonical database check
    if (this.database) {
      const shortName = this.canonicalToShortName.get(name);
      if (shortName) {
        const obf = this.deobfToObfClasses.get(shortName);
        if (obf) return obf;
      }
      const canon = this.shortNameToCanonical.get(name);
      if (canon) {
        const obf = this.deobfToObfClasses.get(canon);
        if (obf) return obf;
      }

      // If class is known in the database but has NOT been resolved yet in runtime:
      if (this.isDatabaseClass(name)) {
        const canonDisplay =
          canon ?? this.database[name]?.canonicalClassName ?? name;
        throw new Error(
          `Minecraft class "${name}" (${canonDisplay}) is defined in the canonical database but has not been resolved/matched yet in runtime.`,
        );
      }
    }

    return name;
  }

  /**
   * Resolves the human-readable deobfuscated class name from an obfuscated JVM class name.
   */
  public resolveDeobfClass(name: string): string {
    return this.obfToDeobfClasses.get(name) ?? name;
  }

  /**
   * Resolves an obfuscated JVM field name from a deobfuscated name, checking superclasses if provided.
   */
  public resolveObfField(
    className: string,
    fieldName: string,
    superclasses?: readonly string[],
  ): string {
    const directMapping = this.classMappings.get(className);
    if (directMapping) {
      const obf = directMapping.deobfToObfFields.get(fieldName);
      if (obf) return obf;
    }

    if (superclasses && superclasses.length > 0) {
      for (const superCls of superclasses) {
        const superMapping = this.classMappings.get(superCls);
        if (superMapping) {
          const obf = superMapping.deobfToObfFields.get(fieldName);
          if (obf) return obf;
        }
      }
    }

    return fieldName;
  }

  /**
   * Resolves a deobfuscated field name from an obfuscated JVM field name.
   */
  public resolveDeobfField(
    className: string,
    fieldName: string,
    superclasses?: readonly string[],
  ): string {
    const directMapping = this.classMappings.get(className);
    if (directMapping) {
      const deobf = directMapping.obfToDeobfFields.get(fieldName);
      if (deobf) return deobf;
    }

    if (superclasses && superclasses.length > 0) {
      for (const superCls of superclasses) {
        const superMapping = this.classMappings.get(superCls);
        if (superMapping) {
          const deobf = superMapping.obfToDeobfFields.get(fieldName);
          if (deobf) return deobf;
        }
      }
    }

    return fieldName;
  }

  /**
   * Resolves an obfuscated JVM method name from a deobfuscated name, checking superclasses if provided.
   */
  public resolveObfMethod(
    className: string,
    methodName: string,
    superclasses?: readonly string[],
  ): string {
    const directMapping = this.classMappings.get(className);
    if (directMapping) {
      const obf = directMapping.deobfToObfMethods.get(methodName);
      if (obf) return obf;
    }

    if (superclasses && superclasses.length > 0) {
      for (const superCls of superclasses) {
        const superMapping = this.classMappings.get(superCls);
        if (superMapping) {
          const obf = superMapping.deobfToObfMethods.get(methodName);
          if (obf) return obf;
        }
      }
    }

    return methodName;
  }

  /**
   * Resolves a deobfuscated method name from an obfuscated JVM method name.
   */
  public resolveDeobfMethod(
    className: string,
    methodName: string,
    superclasses?: readonly string[],
  ): string {
    const directMapping = this.classMappings.get(className);
    if (directMapping) {
      const deobf = directMapping.obfToDeobfMethods.get(methodName);
      if (deobf) return deobf;
    }

    if (superclasses && superclasses.length > 0) {
      for (const superCls of superclasses) {
        const superMapping = this.classMappings.get(superCls);
        if (superMapping) {
          const deobf = superMapping.obfToDeobfMethods.get(methodName);
          if (deobf) return deobf;
        }
      }
    }

    return methodName;
  }

  /**
   * Checks whether any mapping exists for the given class name (either obf or deobf).
   */
  public hasClassMapping(name: string): boolean {
    return (
      this.classMappings.has(name) ||
      this.obfToDeobfClasses.has(name) ||
      this.deobfToObfClasses.has(name)
    );
  }

  public resolveClassKeys(classNameOrKey: string):
    | {
        shortName: string;
        canon?: string;
        obf: string;
        mapping?: JavaClassMapping;
      }
    | undefined {
    let obf: string | undefined;
    let deobf: string | undefined;

    if (this.obfToDeobfClasses.has(classNameOrKey)) {
      obf = classNameOrKey;
      deobf = this.obfToDeobfClasses.get(classNameOrKey);
    } else if (this.deobfToObfClasses.has(classNameOrKey)) {
      obf = this.deobfToObfClasses.get(classNameOrKey);
      deobf = classNameOrKey;
    } else {
      const short = this.canonicalToShortName.get(classNameOrKey);
      if (short && this.deobfToObfClasses.has(short)) {
        obf = this.deobfToObfClasses.get(short);
        deobf = classNameOrKey;
      }
    }

    if (!obf && this.database) {
      const short =
        this.canonicalToShortName.get(classNameOrKey) ?? classNameOrKey;
      const canon2 = this.shortNameToCanonical.get(short);
      obf =
        this.deobfToObfClasses.get(short) ??
        (canon2 ? this.deobfToObfClasses.get(canon2) : undefined);
      if (obf) deobf = canon2 ?? short;
    }

    if (!obf) return undefined;

    const baseName = deobf ?? classNameOrKey;
    const shortName =
      this.canonicalToShortName.get(baseName) ??
      (baseName.includes('.') ? baseName.split('.').pop()! : baseName);
    const canon =
      this.shortNameToCanonical.get(shortName) ??
      (baseName.includes('.') ? baseName : undefined);
    const mapping =
      this.classMappings.get(shortName) ??
      (canon ? this.classMappings.get(canon) : undefined) ??
      this.classMappings.get(obf);

    return { shortName, canon, obf, mapping };
  }

  public isClassComplete(
    classNameOrKey: string,
    options?: { strict?: boolean },
  ): boolean {
    const keys = this.resolveClassKeys(classNameOrKey);
    if (!keys || !keys.obf || !keys.mapping) return false;

    if (options?.strict && this.database) {
      const schema =
        this.database[keys.shortName] ??
        (keys.canon ? this.database[keys.canon] : undefined);
      if (schema?.fields) {
        for (const fName of Object.keys(schema.fields)) {
          if (!keys.mapping.deobfToObfFields.has(fName)) {
            return false;
          }
        }
      }
      if (schema?.methods) {
        for (const mName of Object.keys(schema.methods)) {
          if (!keys.mapping.deobfToObfMethods.has(mName)) {
            return false;
          }
        }
      }
    }
    return true;
  }

  public checkAndEmitStub(classNameOrKey: string): boolean {
    const keys = this.resolveClassKeys(classNameOrKey);
    if (!keys || !keys.obf || !keys.mapping) return false;

    const { shortName, canon, obf, mapping } = keys;
    const dbSchema = this.database
      ? (this.database[shortName] ?? (canon ? this.database[canon] : undefined))
      : undefined;
    const fqcn =
      canon ?? dbSchema?.canonicalClassName ?? dbSchema?.canonical ?? shortName;

    const stubFields: Record<string, string> = {};
    if (dbSchema?.fields) {
      Object.assign(stubFields, dbSchema.fields);
    }
    for (const deobfF of mapping.deobfToObfFields.keys()) {
      if (!stubFields[deobfF]) {
        stubFields[deobfF] =
          (mapping as any).fieldTypes?.get(deobfF) ?? 'Object';
      }
    }

    const stubMethods: Record<string, any> = {};
    if (dbSchema?.methods) {
      Object.assign(stubMethods, dbSchema.methods);
    }
    for (const deobfM of mapping.deobfToObfMethods.keys()) {
      if (!stubMethods[deobfM]) {
        stubMethods[deobfM] = (mapping as any).methodSignatures?.get(
          deobfM,
        ) ?? {
          params: [],
          returnType: 'void',
        };
      }
    }

    const classSchema: any = {
      canonicalClassName: fqcn,
      superclass: dbSchema?.superclass,
      fields: stubFields,
      methods: stubMethods,
    };

    const sig = `${obf}:${Object.keys(stubFields)
      .sort()
      .map(
        (k) =>
          `${k}:${typeof stubFields[k] === 'object' ? JSON.stringify(stubFields[k]) : stubFields[k]}`,
      )
      .join(',')}:${Object.keys(stubMethods)
      .sort()
      .map((k) => `${k}:${JSON.stringify(stubMethods[k])}`)
      .join(',')}`;
    const alreadyEmitted = this.emittedClassSignatures.get(shortName) === sig;

    if (!alreadyEmitted) {
      const project = this.getStubProject();
      project.addClass(shortName, classSchema);
      this.emittedClassSignatures.set(shortName, sig);
      this.stubsDirty = true;
    }

    if (
      this.autoCompileStubs &&
      this.isClassComplete(shortName, { strict: true })
    ) {
      this.compileStubsSync();
    }
    return !alreadyEmitted;
  }

  public compileStubsSync(): JavaCompileResult | undefined {
    if (!this.stubProject || !this.stubsDirty) return;
    const res = this.stubProject.compileSync();
    if (res.success) {
      this.stubsDirty = false;
    }
    return res;
  }

  public async compileStubs(): Promise<JavaCompileResult | undefined> {
    if (!this.stubProject || !this.stubsDirty) return;
    const res = await this.stubProject.compile();
    if (res.success) {
      this.stubsDirty = false;
    }
    return res;
  }

  public syncPool(pool: any): this {
    if (!pool) return this;
    const prevAuto = this.autoCompileStubs;
    this.autoCompileStubs = false;
    try {
      const items: any[] = [];
      if (pool instanceof Map) {
        items.push(...pool.values());
      } else if (Array.isArray(pool)) {
        items.push(...pool);
      } else if (typeof pool[Symbol.iterator] === 'function') {
        items.push(...pool);
      } else if (typeof pool === 'object') {
        items.push(...Object.values(pool));
      }

      const seen = new Set<any>();
      for (const item of items) {
        if (!item || typeof item !== 'object' || seen.has(item)) continue;
        seen.add(item);

        const realClassName =
          item.realClassName ?? item.obfName ?? item.obfClassName ?? item.obf;
        const deobfName =
          item.canonicalClassName ??
          item.schema?.canonicalClassName ??
          item.canonical ??
          item.schema?.canonical ??
          item.canonicalKey ??
          item.canonicalName ??
          item.simpleName ??
          item.originalName ??
          item.deobfName ??
          item.deobf;
        if (!realClassName || !deobfName) continue;

        this.mapClass(realClassName, deobfName);

        if (item.fields) {
          const fieldEntries: Array<[string, any]> =
            item.fields instanceof Map
              ? Array.from(item.fields.entries())
              : Object.entries(item.fields);
          for (const [k, v] of fieldEntries) {
            if (typeof v === 'string') {
              this.mapField(realClassName, v, k);
            } else if (v && typeof v === 'object') {
              const orig =
                (v as any).originalName ??
                (v as any).deobf ??
                (v as any).name ??
                k;
              const real =
                (v as any).realName ??
                (v as any).obf ??
                (v as any).realFieldName;
              if (orig && real) {
                this.mapField(realClassName, real, orig);
              }
            }
          }
        }

        if (item.methods) {
          const methodEntries: Array<[string, any]> =
            item.methods instanceof Map
              ? Array.from(item.methods.entries())
              : Object.entries(item.methods);
          for (const [k, v] of methodEntries) {
            if (typeof v === 'string') {
              this.mapMethod(realClassName, v, k);
            } else if (v && typeof v === 'object') {
              const orig =
                (v as any).originalName ??
                (v as any).deobf ??
                (v as any).name ??
                k;
              const real =
                (v as any).realName ??
                (v as any).obf ??
                (v as any).realMethodName;
              if (orig && real) {
                this.mapMethod(realClassName, real, orig);
              }
            }
          }
        }
      }

      if (this.database) {
        for (const dbKey of Object.keys(this.database)) {
          this.checkAndEmitStub(dbKey);
        }
      }
    } finally {
      this.autoCompileStubs = prevAuto;
      if (this.autoCompileStubs && this.stubsDirty) {
        this.compileStubsSync();
      }
    }
    return this;
  }

  /**
   * Loads mappings from an active MappingPool.
   */
  public usePool(pool: any): this {
    if (!pool) return this;
    if (pool.canonicalToObf instanceof Map) {
      for (const [canon, obf] of pool.canonicalToObf.entries()) {
        this.mapClass(obf, canon);
      }
    }
    if (typeof pool.getAllDetected === 'function') {
      return this.syncPool(pool.getAllDetected());
    }
    if (pool.classPool instanceof Map) {
      return this.syncPool(pool.classPool);
    }
    return this.syncPool(pool);
  }

  /**
   * Parses Tiny v1 mappings and registers classes, fields, and methods into this registry.
   */
  public loadTiny(tinyContentOrPath: string): this {
    if (!tinyContentOrPath) return this;
    let content = tinyContentOrPath;
    if (
      typeof content === 'string' &&
      (content.includes('/') ||
        content.includes('\\') ||
        content.endsWith('.tiny') ||
        content.endsWith('.txt'))
    ) {
      if (existsSync(content)) {
        try {
          content = readFileSync(content, 'utf8');
        } catch {}
      }
    }

    const lines = content.split(/\r?\n/);
    const classesMap = new Map<
      string,
      {
        canonicalName: string;
        realClassName: string;
        fields: Record<string, string>; // obfField -> deobfField
        methods: Record<string, string>; // obfMethod -> deobfMethod
      }
    >();

    const getOrCreate = (fromSlash: string) => {
      const canonical = fromSlash.replace(/\//g, '.');
      let entry = classesMap.get(canonical);
      if (!entry) {
        entry = {
          canonicalName: canonical,
          realClassName: canonical,
          fields: {},
          methods: {},
        };
        classesMap.set(canonical, entry);
      }
      return entry;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('v1')) continue;
      const parts = line.split('\t');
      const type = parts[0];

      if (type === 'CLASS' && parts[1] && parts[2]) {
        const entry = getOrCreate(parts[1]);
        entry.realClassName = parts[2].replace(/\//g, '.');
      } else if (type === 'FIELD' && parts[1] && parts[3] && parts[4]) {
        const entry = getOrCreate(parts[1]);
        const fromField = parts[3];
        const toField = parts[4];
        entry.fields[toField] = fromField;
      } else if (type === 'METHOD' && parts[1] && parts[3] && parts[4]) {
        const entry = getOrCreate(parts[1]);
        const fromMethod = parts[3];
        const toMethod = parts[4];
        entry.methods[toMethod] = fromMethod;
      }
    }

    for (const entry of classesMap.values()) {
      this.mapClass(entry.realClassName, entry.canonicalName, {
        fields: entry.fields,
        methods: entry.methods,
      });
    }

    return this;
  }

  /**
   * Universally loads mappings from a Tiny v1 string, a file path (.tiny/.json),
   * a JavaCompileResult with .mappings, a MappingPool, or a MappingsJson object.
   */
  public load(source: any): this {
    if (!source) return this;

    if (typeof source === 'string') {
      const trimmed = source.trim();
      if (
        trimmed.startsWith('v1\t') ||
        trimmed.includes('\tCLASS\t') ||
        trimmed.includes('\tFIELD\t') ||
        trimmed.includes('\tMETHOD\t') ||
        trimmed.endsWith('.tiny')
      ) {
        return this.loadTiny(trimmed);
      }
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          return this.load(parsed);
        } catch {}
      }
      if (existsSync(trimmed)) {
        if (trimmed.endsWith('.tiny')) {
          return this.loadTiny(trimmed);
        }
        try {
          const content = readFileSync(trimmed, 'utf8');
          const parsed = JSON.parse(content);
          return this.load(parsed);
        } catch {
          return this.loadTiny(trimmed);
        }
      }
      return this.loadTiny(trimmed);
    }

    // MappingPool or pool-like
    if (
      typeof source.getAllDetected === 'function' ||
      source.classPool instanceof Map
    ) {
      return this.usePool(source);
    }

    // JavaCompileResult / JavaRemapResult
    if (
      typeof source === 'object' &&
      source.mappings &&
      typeof source.mappings === 'string'
    ) {
      return this.loadTiny(source.mappings);
    }

    // Standard MappingsJson or database object
    const rawClasses = source.classes || source.data?.classes;
    if (rawClasses && typeof rawClasses === 'object') {
      for (const [canonOrKey, cData] of Object.entries<any>(rawClasses)) {
        if (typeof cData === 'string') {
          this.mapClass(cData, canonOrKey);
          continue;
        }
        const canon = cData?.canonical || canonOrKey;
        const obf = cData?.obf || canonOrKey;

        const fMap: Record<string, string> = {};
        for (const [deobfF, obfF] of Object.entries<any>(cData?.fields || {})) {
          if (typeof obfF === 'string') {
            fMap[obfF] = deobfF;
          }
        }

        const mMap: Record<string, string> = {};
        for (const [deobfM, obfM] of Object.entries<any>(
          cData?.methods || {},
        )) {
          if (typeof obfM === 'string') {
            mMap[obfM] = deobfM;
          }
        }

        this.mapClass(obf, canon, { fields: fMap, methods: mMap });
      }
    }

    return this;
  }

  public dumpMappings(options?: any): string {
    return exportToTinyV1(this, options);
  }

  public async compileJava(
    source: string,
    options: Partial<JavaCompileOptions> = {},
  ): Promise<JavaCompileResult> {
    const javaPath =
      options.javaPath ??
      (this.stubProject ? this.stubProject.javaPath : undefined) ??
      process.env.MINECRAFT_JAVA_PATH ??
      process.env.JAVA_PATH ??
      'java';
    if (this.stubProject && this.stubsDirty) {
      await this.compileStubs();
    }
    const stubCp = this.stubProject
      ? this.stubProject.getClassPath()
      : undefined;
    const isWinTarget =
      process.platform === 'win32' ||
      javaPath.toLowerCase().endsWith('.exe') ||
      javaPath.includes('\\');
    const sep = isWinTarget ? ';' : ':';
    let classPath: string | undefined;
    if (options.classPath) {
      const extraCp = Array.isArray(options.classPath)
        ? options.classPath.join(sep)
        : options.classPath;
      classPath = stubCp ? `${stubCp}${sep}${extraCp}` : extraCp;
    } else {
      classPath = stubCp;
    }
    return await compileJava({
      ...options,
      source,
      javaPath,
      classPath,
    });
  }

  public compileJavaSync(
    source: string,
    options: Partial<JavaCompileOptions> = {},
  ): JavaCompileResult {
    const javaPath =
      options.javaPath ??
      (this.stubProject ? this.stubProject.javaPath : undefined) ??
      process.env.MINECRAFT_JAVA_PATH ??
      process.env.JAVA_PATH ??
      'java';
    if (this.stubProject && this.stubsDirty) {
      this.compileStubsSync();
    }
    const stubCp = this.stubProject
      ? this.stubProject.getClassPath()
      : undefined;
    const isWinTarget =
      process.platform === 'win32' ||
      javaPath.toLowerCase().endsWith('.exe') ||
      javaPath.includes('\\');
    const sep = isWinTarget ? ';' : ':';
    let classPath: string | undefined;
    if (options.classPath) {
      const extraCp = Array.isArray(options.classPath)
        ? options.classPath.join(sep)
        : options.classPath;
      classPath = stubCp ? `${stubCp}${sep}${extraCp}` : extraCp;
    } else {
      classPath = stubCp;
    }
    return compileJavaSync({
      ...options,
      source,
      javaPath,
      classPath,
    });
  }

  public async remapJava(
    input: any,
    options: Partial<JavaRemapOptions> = {},
  ): Promise<JavaRemapResult> {
    const stubCp = this.stubProject
      ? this.stubProject.getClassPath()
      : undefined;
    const isWinTarget =
      process.platform === 'win32' ||
      (options.javaPath &&
        (options.javaPath.toLowerCase().endsWith('.exe') ||
          options.javaPath.includes('\\')));
    const sep = isWinTarget ? ';' : ':';
    let classPath: string | undefined;
    if (options.classPath) {
      const extraCp = Array.isArray(options.classPath)
        ? options.classPath.join(sep)
        : options.classPath;
      classPath = stubCp ? `${stubCp}${sep}${extraCp}` : extraCp;
    } else {
      classPath = stubCp;
    }
    return await remapJava({
      ...options,
      input,
      mappings: options.mappings ?? this,
      classPath,
    });
  }

  public remapJavaSync(
    input: any,
    options: Partial<JavaRemapOptions> = {},
  ): JavaRemapResult {
    const stubCp = this.stubProject
      ? this.stubProject.getClassPath()
      : undefined;
    const isWinTarget =
      process.platform === 'win32' ||
      (options.javaPath &&
        (options.javaPath.toLowerCase().endsWith('.exe') ||
          options.javaPath.includes('\\')));
    const sep = isWinTarget ? ';' : ':';
    let classPath: string | undefined;
    if (options.classPath) {
      const extraCp = Array.isArray(options.classPath)
        ? options.classPath.join(sep)
        : options.classPath;
      classPath = stubCp ? `${stubCp}${sep}${extraCp}` : extraCp;
    } else {
      classPath = stubCp;
    }
    return remapJavaSync({
      ...options,
      input,
      mappings: options.mappings ?? this,
      classPath,
    });
  }

  public async compileAndRemap(
    source: string,
    compileOptions: Partial<JavaCompileOptions> = {},
    remapOptions: Partial<JavaRemapOptions> = {},
  ): Promise<{
    compileResult: JavaCompileResult;
    remapResult: JavaRemapResult;
    classes: Map<string, Uint8Array>;
    bytecode: Uint8Array;
  }> {
    const compileResult = await this.compileJava(source, compileOptions);
    if (!compileResult.success) {
      throw new Error(
        `Java compilation failed:\n${compileResult.errors.join('\n')}`,
      );
    }
    const remapResult = await this.remapJava(compileResult, remapOptions);
    if (!remapResult.success) {
      throw new Error(
        `Java remapping failed:\n${remapResult.errors.join('\n')}`,
      );
    }
    const classes = remapResult.classes;
    const bytecode = compileResult.mainClass
      ? (classes.get(compileResult.mainClass) ?? classes.values().next().value!)
      : classes.values().next().value!;
    return {
      compileResult,
      remapResult,
      classes,
      bytecode,
    };
  }

  public compileAndRemapSync(
    source: string,
    compileOptions: Partial<JavaCompileOptions> = {},
    remapOptions: Partial<JavaRemapOptions> = {},
  ): {
    compileResult: JavaCompileResult;
    remapResult: JavaRemapResult;
    classes: Map<string, Uint8Array>;
    bytecode: Uint8Array;
  } {
    const compileResult = this.compileJavaSync(source, compileOptions);
    if (!compileResult.success) {
      throw new Error(
        `Java compilation failed:\n${compileResult.errors.join('\n')}`,
      );
    }
    const remapResult = this.remapJavaSync(compileResult, remapOptions);
    if (!remapResult.success) {
      throw new Error(
        `Java remapping failed:\n${remapResult.errors.join('\n')}\nOutput: ${remapResult.output}`,
      );
    }
    const classes = remapResult.classes;
    const bytecode = compileResult.mainClass
      ? (classes.get(compileResult.mainClass) ?? classes.values().next().value!)
      : classes.values().next().value!;
    return {
      compileResult,
      remapResult,
      classes,
      bytecode,
    };
  }

  /**
   * Clears all registered mappings.
   */
  public clear(): void {
    this.obfToDeobfClasses.clear();
    this.deobfToObfClasses.clear();
    this.classMappings.clear();
    this.canonicalToShortName.clear();
    this.shortNameToCanonical.clear();
    this.database = undefined;
  }

  private getOrCreateMapping(className: string): JavaClassMapping {
    let mapping = this.classMappings.get(className);
    if (!mapping) {
      const obf = this.deobfToObfClasses.get(className) ?? className;
      const deobf = this.obfToDeobfClasses.get(className) ?? className;
      mapping = {
        obfName: obf,
        deobfName: deobf,
        obfToDeobfFields: new Map(),
        deobfToObfFields: new Map(),
        obfToDeobfMethods: new Map(),
        deobfToObfMethods: new Map(),
      };
      this.classMappings.set(obf, mapping);
      this.classMappings.set(deobf, mapping);
    }
    return mapping;
  }
}
