/**
 * Core type definitions for @exoproc/njava-mappings
 */

/**
 * Database schema definitions (Canonical ONLY - matching database.json).
 * Defines the known structure of classes, methods, and fields.
 */
export interface MethodSchema {
  params?: string[];
  paramTypes?: string[]; // backwards-compatible alias for params
  returnType?: string;
  isStatic?: boolean;
  signature?: string;
  description?: string;
  metadata?: Record<string, any>;
}

export interface FieldSchema {
  type: string;
  isStatic?: boolean;
  description?: string;
  metadata?: Record<string, any>;
}

export interface ClassSchema {
  canonical?: string; // e.g. "net.minecraft.client.Minecraft" (optional if key is canonical)
  canonicalName?: string; // backwards-compatible alias
  canonicalClassName?: string; // backwards-compatible alias
  simpleName?: string; // e.g. "Minecraft"
  obf?: string; // e.g. "net.minecraft.client.gui.GuiButton" (target class) or direct obf name like "ave"
  superclass?: string; // e.g. "Object" or "GuiScreen" (optional)
  interfaces?: string[];
  fields?: Record<string, string | FieldSchema>; // e.g. "thePlayer": "EntityPlayerSP"
  methods?: Record<string, MethodSchema | string>; // e.g. "getMinecraft": { params: [], returnType: "Minecraft", isStatic: true }
  metadata?: Record<string, any>;
}

export interface DatabaseJson {
  classes: Record<string, ClassSchema>;
  metadata?: Record<string, any>;
}

/**
 * Pool detection & match definitions (Runtime Discovered Obfuscated mappings).
 * Holds the matched runtime classes, fields, and methods.
 */
export interface DetectedFieldInfo {
  canonicalName: string;
  realName: string;
  type?: string;
  isStatic?: boolean;
}

export interface DetectedMethodInfo {
  canonicalName: string;
  realName: string;
  signature?: string;
  isStatic?: boolean;
}

export interface DetectedClassInfo {
  canonicalName: string;
  simpleName?: string;
  realClassName: string;
  superclass?: string;
  fields: Record<string, string>; // canonicalName -> realName
  methods: Record<string, string>; // canonicalName -> realName
  fieldDetails?: Record<string, DetectedFieldInfo>;
  methodDetails?: Record<string, DetectedMethodInfo>;
  confidence?: number;
  schema?: ClassSchema;
}

export interface MappingsJsonClass {
  obf: string;
  canonical?: string;
  simpleName?: string;
  superclass?: string;
  matched?: boolean;
  fields?: Record<string, string>;
  methods?: Record<string, string>;
}

export interface MappingsJson {
  formatVersion: string;
  environment?: {
    classpath?: string[];
    javaVersion?: string;
    os?: string;
    timestamp?: string;
    [key: string]: any;
  };
  classes: Record<string, MappingsJsonClass>;
  metadata?: Record<string, any>;
}

export interface TypeAccessContext {
  requestedName: string;
  resolvedName: string | null;
  isMapped: boolean;
  schema?: ClassSchema;
  detected?: DetectedClassInfo;
  pool: MappingPool;
}

export type TypeAccessCallback<T = any> = (ctx: TypeAccessContext) => T;

export interface PoolOptions {
  name?: string;
  databases?: MappingDatabase[];
}

export interface ExportMappingsOptions {
  pool: MappingPool;
  formatVersion?: string;
  environment?: {
    classpath?: string[];
    javaVersion?: string;
    os?: string;
    [key: string]: any;
  };
  metadata?: Record<string, any>;
}

export interface MappingDatabase {
  readonly name: string;
  load(source: string | DatabaseJson | Record<string, ClassSchema>): this;
  addClass(schema: ClassSchema, keyName?: string): this;
  removeClass(canonicalOrSimpleName: string): boolean;
  getClass(canonicalOrSimpleName: string): ClassSchema | undefined;
  has(canonicalOrSimpleName: string): boolean;
  getAllClasses(): ClassSchema[];
  findClasses(predicate: (schema: ClassSchema) => boolean): ClassSchema[];
  clone(newName?: string): MappingDatabase;
  merge(otherDb: MappingDatabase): this;
  toJSON(): DatabaseJson;
  size: number;
}

export interface MappingPool {
  readonly name: string;
  readonly classPool: Map<string, DetectedClassInfo>;
  readonly canonicalToObf: Map<string, string>;
  readonly obfToCanonical: Map<string, string>;

  useDatabase(db: MappingDatabase): this;
  getDatabases(): MappingDatabase[];

  registerMatch(
    canonicalOrDetected: string | DetectedClassInfo,
    realClassName?: string,
    fields?: Record<string, string>,
    methods?: Record<string, string>,
    confidence?: number,
  ): this;

  unregisterMatch(name: string): boolean;
  resolveClass(name: string): string | null;
  resolveField(classKey: string, fieldName: string): string | null;
  resolveMethod(classKey: string, methodName: string): string | null;

  getCanonicalClass(obfName: string): string | null;
  getObfClass(canonicalName: string): string | null;
  getCanonicalField(classKey: string, obfField: string): string | null;
  getCanonicalMethod(classKey: string, obfMethod: string): string | null;

  getDetected(name: string): DetectedClassInfo | undefined;
  getAllDetected(): DetectedClassInfo[];

  createTypeFunction<T = any>(
    callback: TypeAccessCallback<T>,
  ): (name: string) => T;
  export(options?: Partial<ExportMappingsOptions>): MappingsJson;
  load(mappings: MappingsJson | any): this;
  loadTiny(tinyContentOrPath: string): this;
  clear(): void;
}

export type JavaClassSchema = ClassSchema;
export interface JavaDatabaseProvider {
  getDatabase?(): Record<string, any>;
}
