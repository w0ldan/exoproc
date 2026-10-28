import type {
  ReflectionBridge,
  ReflectedClass,
  ReflectedMethod,
  ReflectedField,
} from 'bun-njava';
import {
  MINECRAFT_CANONICAL_SCHEMA,
  isPrimitiveType,
  isObfuscatedClassName,
  isObfuscatedMethodName,
  isObfuscatedFieldName,
  STANDARD_UNOBFUSCATED_METHODS,
} from './database.js';
import type {
  MinecraftClassKey,
  MinecraftMappings,
  MatchOptions,
  TypeDescriptorInfo,
  DetectedFieldInfo,
  DetectedMethodInfo,
  DetectedClassInfo,
  DetectOptions,
} from './types.js';
import { MinecraftAnchorResolver } from './anchors.js';
import { StructuralFingerprintEngine } from './fingerprints.js';
import { NbtDifferentialProbe } from './nbt-probe.js';

/**
 * Universal, Graph-Driven Minecraft Dynamic Matcher.
 * Operates under the zero-name-assumption principle: treats every class, field, and method
 * as 100% obfuscated and deduces the complete game graph bidirectionally from any provided
 * seed(s) (or automatically resolved anchors such as RealmsBridge).
 */
export class MinecraftMatcher {
  private readonly anchorResolver: MinecraftAnchorResolver;
  private readonly fingerprintEngine: StructuralFingerprintEngine;
  public readonly nbtProbe: NbtDifferentialProbe;

  /** Active pool of detected classes and their metadata */
  public readonly classPool = new Map<string, DetectedClassInfo>();
  /** Reverse lookup: runtime obfuscated class name -> canonical key */
  public readonly obfToCanonical = new Map<string, string>();
  /** Forward lookup: canonical key -> runtime obfuscated class name */
  public readonly canonicalToObf = new Map<string, string>();
  /** Dynamic mappings dictionary */
  public readonly mappings: Partial<MinecraftMappings> = {};
  /** Associated JavaContext target for automatic live mapping updates */
  public targetJava?: any;

  private readonly classCache = new Map<string, ReflectedClass>();
  private readonly chainCache = new Map<string, string[]>();

  public async getCachedClass(name: string): Promise<ReflectedClass> {
    let c = this.classCache.get(name);
    if (!c) {
      c = await this.bridge.getClass(name);
      this.classCache.set(name, c);
    }
    return c;
  }

  public getCachedClassSync(name: string): ReflectedClass {
    let c = this.classCache.get(name);
    if (!c) {
      if (typeof this.bridge.getClassSync !== 'function') {
        throw new Error(
          'ReflectionBridge does not support synchronous getClassSync',
        );
      }
      c = this.bridge.getClassSync(name);
      this.classCache.set(name, c);
    }
    return c;
  }

  public getCachedChainSync(cls: ReflectedClass): string[] {
    let ch = this.chainCache.get(cls.name);
    if (!ch) {
      ch =
        (cls.getSuperclassChainSync
          ? cls.getSuperclassChainSync()
          : undefined) ?? [];
      this.chainCache.set(cls.name, ch);
    }
    return ch;
  }

  public async getCachedChain(cls: ReflectedClass): Promise<string[]> {
    let ch = this.chainCache.get(cls.name);
    if (!ch) {
      ch = (await cls.getSuperclassChain()) ?? [];
      this.chainCache.set(cls.name, ch);
    }
    return ch;
  }

  private syncMappings(mappings: Partial<MinecraftMappings>): void {
    for (const [k, m] of Object.entries(mappings)) {
      if (
        m &&
        m.realClassName &&
        m.realClassName !==
          MINECRAFT_CANONICAL_SCHEMA[k as MinecraftClassKey]?.canonicalClassName
      ) {
        this.mappings[k as MinecraftClassKey] = m;
        this.obfToCanonical.set(m.realClassName, k);
        this.canonicalToObf.set(k, m.realClassName);
        const schema = MINECRAFT_CANONICAL_SCHEMA[k as MinecraftClassKey];
        if (schema?.canonicalClassName) {
          this.canonicalToObf.set(schema.canonicalClassName, m.realClassName);
        }
      }
    }
  }

  /**
   * Checks whether a given Minecraft canonical class key has been resolved to a real obfuscated JVM class.
   */
  public isResolved(key: MinecraftClassKey | string): boolean {
    const m = (this.mappings as any)[key];
    return Boolean(
      m &&
      m.realClassName &&
      m.realClassName !== '' &&
      m.realClassName !==
        MINECRAFT_CANONICAL_SCHEMA[key as MinecraftClassKey]
          ?.canonicalClassName,
    );
  }

  private ensureAllKeys(
    mappings: Partial<MinecraftMappings>,
  ): MinecraftMappings {
    return mappings as MinecraftMappings;
  }

  constructor(private readonly bridge: ReflectionBridge) {
    this.anchorResolver = new MinecraftAnchorResolver(bridge);
    this.fingerprintEngine = new StructuralFingerprintEngine();
    this.nbtProbe = new NbtDifferentialProbe(bridge);
  }

  private isPrimitive(type: string): boolean {
    return isPrimitiveType(type);
  }

  private cleanTypeName(raw: string | null | undefined): string {
    if (!raw) return '';
    return raw.replace(/^(class|interface)\s+/, '').trim();
  }

  /**
   * Analyzes any JVM type descriptor and returns structured type information
   * including obfuscation status and canonical name resolution.
   */
  public detectType(rawType: string | null | undefined): TypeDescriptorInfo {
    if (!rawType) {
      return {
        typeName: 'void',
        realTypeName: 'void',
        isObfuscated: false,
      };
    }

    let clean = rawType.replace(/^(class|interface)\s+/, '').trim();
    let isArray = false;
    if (clean.endsWith('[]')) {
      isArray = true;
      clean = clean.slice(0, -2);
    }

    // JVM Primitives
    if (isPrimitiveType(clean)) {
      return {
        typeName: isArray ? `${clean}[]` : clean,
        realTypeName: rawType,
        isObfuscated: false,
        isArray,
      };
    }

    // Standard JVM / Library packages (never obfuscated)
    if (
      clean.startsWith('java.') ||
      clean.startsWith('javax.') ||
      clean.startsWith('sun.') ||
      clean.startsWith('jdk.') ||
      clean.startsWith('org.lwjgl.') ||
      clean.startsWith('com.google.') ||
      clean.startsWith('org.apache.') ||
      clean.startsWith('io.netty.')
    ) {
      return {
        typeName: isArray ? `${clean}[]` : clean,
        realTypeName: rawType,
        isObfuscated: false,
        isArray,
      };
    }

    // Check mapping pool
    const canonicalKey = this.obfToCanonical.get(clean);
    if (canonicalKey) {
      const canonicalSchema = (MINECRAFT_CANONICAL_SCHEMA as any)[canonicalKey];
      const typeName = canonicalSchema?.canonicalClassName ?? canonicalKey;
      return {
        typeName: isArray ? `${typeName}[]` : typeName,
        realTypeName: rawType,
        isObfuscated: true,
        canonicalKey,
        isArray,
      };
    }

    // Deobfuscated / MCP names
    if (clean.startsWith('net.minecraft.')) {
      return {
        typeName: isArray ? `${clean}[]` : clean,
        realTypeName: rawType,
        isObfuscated: false,
        isArray,
      };
    }

    // Check obfuscation heuristic
    const isObf = isObfuscatedClassName(clean);
    return {
      typeName: isArray ? `${clean}[]` : clean,
      realTypeName: rawType,
      isObfuscated: isObf,
      isArray,
    };
  }

  /**
   * Analyzes a field handle and returns a structured DetectedFieldInfo.
   */
  public detectField(
    field: ReflectedField | any,
    ownerClass?: ReflectedClass | string,
  ): DetectedFieldInfo {
    const realName: string = field.name ?? field.parsed?.name ?? '';
    const rawType: string = field.type ?? field.parsed?.type ?? '';
    const typeInfo = this.detectType(rawType);
    const isObf = isObfuscatedFieldName(realName);
    const isStatic = Boolean(
      field.isStatic ?? field.parsed?.modifiers?.has('static'),
    );
    const declaringClass: string =
      field.declaringClass ??
      field.parsed?.declaringClass ??
      (typeof ownerClass === 'string' ? ownerClass : ownerClass?.name) ??
      '';

    let originalName = realName;

    // Resolve owner class in database schema
    const ownerName =
      typeof ownerClass === 'string'
        ? ownerClass
        : (ownerClass?.name ?? declaringClass);
    const ownerCanonicalKey = this.obfToCanonical.get(ownerName) as
      MinecraftClassKey | undefined;
    if (ownerCanonicalKey) {
      // 1. Check active resolved mappings first
      const activeMapping = this.mappings[ownerCanonicalKey];
      if (activeMapping?.fields) {
        for (const [canonName, realMappedName] of Object.entries(
          activeMapping.fields,
        )) {
          if (realMappedName === realName) {
            originalName = canonName;
            break;
          }
        }
      }

      // 2. Second priority: If still unmapped, check if schema has this field directly
      if (originalName === realName) {
        const schema = (MINECRAFT_CANONICAL_SCHEMA as any)[ownerCanonicalKey];
        if (schema?.fields) {
          if (schema.fields[realName]) {
            originalName = realName;
          } else {
            const matchingEntries = Object.entries(schema.fields).filter(
              ([, fType]) => {
                if (typeInfo.canonicalKey && typeInfo.canonicalKey === fType)
                  return true;
                if (
                  typeInfo.typeName === fType ||
                  typeInfo.realTypeName === fType
                )
                  return true;
                if (
                  (fType === 'String' || fType === 'java.lang.String') &&
                  (typeInfo.typeName === 'java.lang.String' ||
                    typeInfo.realTypeName === 'java.lang.String')
                ) {
                  return true;
                }
                return false;
              },
            );
            if (matchingEntries.length === 1 && matchingEntries[0]) {
              originalName = matchingEntries[0][0];
            }
          }
        }
      }
    }

    return {
      kind: 'field',
      originalName,
      realName,
      isObfuscated: isObf,
      type: typeInfo,
      isStatic,
      declaringClass,
    };
  }

  /**
   * Analyzes a method handle and returns a structured DetectedMethodInfo.
   * Standard methods such as toString, equals, run are marked as un-obfuscated.
   */
  public detectMethod(
    method: ReflectedMethod | any,
    ownerClass?: ReflectedClass | string,
  ): DetectedMethodInfo {
    const realName: string = method.name ?? method.parsed?.name ?? '';
    const rawReturnType: string =
      method.returnType ?? method.type ?? method.parsed?.type ?? 'void';
    const returnTypeInfo = this.detectType(rawReturnType);
    const rawParamTypes: readonly string[] =
      method.paramTypes ?? method.parsed?.paramTypes ?? [];
    const paramTypeInfos = rawParamTypes.map((p: string) => this.detectType(p));

    const isObf = isObfuscatedMethodName(realName);
    const isStatic = Boolean(
      method.isStatic ?? method.parsed?.modifiers?.has('static'),
    );
    const declaringClass: string =
      method.declaringClass ??
      method.parsed?.declaringClass ??
      (typeof ownerClass === 'string' ? ownerClass : ownerClass?.name) ??
      '';

    let originalName = realName;

    // Standard un-obfuscated methods retain their original name
    if (STANDARD_UNOBFUSCATED_METHODS.has(realName)) {
      originalName = realName;
    } else {
      const ownerName =
        typeof ownerClass === 'string'
          ? ownerClass
          : (ownerClass?.name ?? declaringClass);
      const ownerCanonicalKey = this.obfToCanonical.get(ownerName) as
        MinecraftClassKey | undefined;
      if (ownerCanonicalKey) {
        // 1. Check active resolved mappings first
        const activeMapping = this.mappings[ownerCanonicalKey];
        if (activeMapping?.methods) {
          for (const [canonName, realMappedName] of Object.entries(
            activeMapping.methods,
          )) {
            if (realMappedName === realName) {
              originalName = canonName;
              break;
            }
          }
        }

        if (originalName === realName) {
          const schema = (MINECRAFT_CANONICAL_SCHEMA as any)[ownerCanonicalKey];
          if (schema?.methods) {
            for (const [canonMethodName, methodSchema] of Object.entries(
              schema.methods,
            ) as [string, any][]) {
              if (canonMethodName === realName) {
                originalName = canonMethodName;
                break;
              }
              const params = methodSchema.params ?? [];
              if (params.length === paramTypeInfos.length) {
                let match = true;
                for (let i = 0; i < params.length; i++) {
                  const pSchema = params[i];
                  const pInfo = paramTypeInfos[i];
                  if (!pInfo) {
                    match = false;
                    break;
                  }
                  if (pInfo.canonicalKey && pInfo.canonicalKey === pSchema)
                    continue;
                  if (
                    pInfo.typeName === pSchema ||
                    pInfo.realTypeName === pSchema
                  )
                    continue;
                  match = false;
                  break;
                }
                if (match) {
                  originalName = canonMethodName;
                  break;
                }
              }
            }
          }
        }
      }
    }

    return {
      kind: 'method',
      originalName,
      realName,
      isObfuscated: isObf,
      returnType: returnTypeInfo,
      paramTypes: paramTypeInfos,
      isStatic,
      declaringClass,
    };
  }

  /**
   * Analyzes a class (by name, handle, or instance) and returns a structured DetectedClassInfo.
   * Discovered obfuscated classes are automatically registered into the mapping pool.
   */
  public async detectClass(
    target: ReflectedClass | string | any,
    options: DetectOptions = {},
  ): Promise<DetectedClassInfo> {
    let cls: ReflectedClass;

    if (
      !target ||
      target === 0n ||
      (typeof target === 'object' && target.$ptr === 0n)
    ) {
      throw new Error(
        '[detectClass] Cannot detect class on null or empty object handle',
      );
    }

    if (typeof target === 'string') {
      const clean = target.replace(/^(class|interface)\s+/, '').trim();
      cls = await this.bridge.getClass(clean);
    } else if (
      target &&
      typeof target === 'object' &&
      typeof target.classObj === 'bigint'
    ) {
      cls = target;
    } else if (
      target &&
      typeof target === 'object' &&
      typeof target.$classObj === 'bigint'
    ) {
      const className = target.name || target.$className;
      cls = await this.bridge.getClass(className);
    } else if (
      target &&
      (typeof target.$ptr === 'bigint' || typeof target === 'bigint')
    ) {
      const rawHandle =
        typeof target.$ptr === 'bigint' ? target.$ptr : BigInt(target);
      const className = await this.bridge.getObjectClassName(rawHandle);
      cls = await this.bridge.getClass(className);
    } else {
      throw new Error(`[detectClass] Unsupported class target: ${target}`);
    }

    // Check mapping pool cache
    if (options.useCache !== false) {
      if (this.classPool.has(cls.name)) {
        return this.classPool.get(cls.name)!;
      }
      const existingCanon = this.obfToCanonical.get(cls.name);
      if (existingCanon && this.classPool.has(existingCanon)) {
        return this.classPool.get(existingCanon)!;
      }
    }

    const isObf = isObfuscatedClassName(cls.name);

    // If not obfuscated (e.g. java.lang.Runnable, java.lang.String, net.minecraft...)
    if (!isObf) {
      const fields = await cls
        .getDeclaredFields()
        .catch(() => new Map<string, ReflectedField>());
      const methods = await cls
        .getDeclaredMethods()
        .catch(() => [] as ReflectedMethod[]);

      const detectedFields: Record<string, DetectedFieldInfo> = {};
      for (const f of fields.values()) {
        const d = this.detectField(f, cls);
        detectedFields[d.originalName || d.realName] = d;
      }

      const detectedMethods: Record<string, DetectedMethodInfo> = {};
      for (const m of methods) {
        const d = this.detectMethod(m, cls);
        detectedMethods[d.originalName || d.realName] = d;
      }

      const simpleName = cls.name.includes('.')
        ? cls.name.split('.').pop()!
        : cls.name;
      const info: DetectedClassInfo = {
        kind: 'class',
        originalName: cls.name,
        canonicalKey: simpleName,
        simpleName,
        canonicalClassName: cls.name,
        realClassName: cls.name,
        isObfuscated: false,
        fields: detectedFields,
        methods: detectedMethods,
      };

      this.classPool.set(cls.name, info);
      this.classPool.set(simpleName, info);
      return info;
    }

    // Obfuscated class: structural matching against knowledge base
    const fieldsMap = await cls
      .getDeclaredFields()
      .catch(() => new Map<string, ReflectedField>());
    const fields = Array.from(fieldsMap.values());
    const methods = await cls
      .getDeclaredMethods()
      .catch(() => [] as ReflectedMethod[]);
    const superchain = (await cls.getSuperclassChain().catch(() => [])) ?? [];

    let canonicalKey: MinecraftClassKey | undefined;
    let originalName = cls.name;

    const isGuiScreen = superchain.some(
      (c) =>
        c === this.canonicalToObf.get('GuiScreen') || c.endsWith('GuiScreen'),
    );

    if (isGuiScreen || options.ownerClass === 'GuiScreen') {
      const hasAtomicInt = fields.some(
        (f) => f.type && f.type.includes('AtomicInteger'),
      );
      const hasDateFormat = fields.some(
        (f) => f.type && f.type.includes('DateFormat'),
      );
      const boolFields = fields.filter((f) => f.type === 'boolean');
      const hasServerData = fields.some(
        (f) =>
          f.type &&
          (f.type.includes('ServerData') || f.type.includes('ServerList')),
      );

      if (hasAtomicInt) {
        canonicalKey = 'GuiMainMenu';
      } else if (hasDateFormat) {
        canonicalKey = 'GuiSelectWorld';
      } else if (boolFields.length >= 5) {
        canonicalKey = 'GuiCreateWorld';
      } else if (hasServerData) {
        const textFieldCount = fields.filter(
          (f) => f.type && f.type.includes('TextField'),
        ).length;
        if (textFieldCount === 1) {
          canonicalKey = 'GuiScreenServerList';
        } else if (textFieldCount >= 2) {
          canonicalKey = 'GuiScreenAddServer';
        } else {
          canonicalKey = 'GuiMultiplayer';
        }
      } else if (fields.length === 2 && fields.every((f) => f.type === 'int')) {
        canonicalKey = 'GuiIngameMenu';
      }
    }

    // PlayerCapabilities structural signature
    if (!canonicalKey) {
      const boolCount = fields.filter(
        (f) => !f.isStatic && f.type === 'boolean',
      ).length;
      const floatCount = fields.filter(
        (f) => !f.isStatic && f.type === 'float',
      ).length;
      if (boolCount >= 4 && floatCount >= 2 && superchain.length <= 1) {
        canonicalKey = 'PlayerCapabilities';
      }
    }

    // Minecraft singleton signature
    if (!canonicalKey) {
      const hasSelfSingleton = fields.some(
        (f) => f.isStatic && f.type && f.type.includes(cls.name),
      );
      if (hasSelfSingleton) {
        canonicalKey = 'Minecraft';
      }
    }

    // Check pre-resolved obfToCanonical mapping (e.g. from matchCore)
    if (!canonicalKey) {
      canonicalKey = this.obfToCanonical.get(cls.name) as
        MinecraftClassKey | undefined;
    }

    // GuiButton structural signature
    if (!canonicalKey) {
      const intCount = fields.filter(
        (f) => !f.isStatic && f.type === 'int',
      ).length;
      const strCount = fields.filter(
        (f) => !f.isStatic && f.type && f.type.includes('String'),
      ).length;
      const boolCount = fields.filter(
        (f) => !f.isStatic && f.type === 'boolean',
      ).length;
      if (intCount >= 5 && strCount >= 1 && boolCount >= 2) {
        canonicalKey = 'GuiButton';
      }
    }

    if (canonicalKey) {
      const schema = (MINECRAFT_CANONICAL_SCHEMA as any)[canonicalKey];
      if (schema) {
        originalName = schema.canonicalClassName ?? canonicalKey;
      }
      this.obfToCanonical.set(cls.name, canonicalKey);
      this.canonicalToObf.set(canonicalKey, cls.name);
    }

    const detectedFields: Record<string, DetectedFieldInfo> = {};
    for (const f of fields) {
      const d = this.detectField(f, cls);
      detectedFields[d.originalName || d.realName] = d;
      detectedFields[d.realName] = d;
    }

    const detectedMethods: Record<string, DetectedMethodInfo> = {};
    for (const m of methods) {
      const d = this.detectMethod(m, cls);
      detectedMethods[d.originalName || d.realName] = d;
      detectedMethods[d.realName] = d;
    }

    const schema = canonicalKey
      ? MINECRAFT_CANONICAL_SCHEMA[canonicalKey]
      : undefined;
    const simpleName =
      canonicalKey ??
      (originalName.includes('.')
        ? originalName.split('.').pop()!
        : originalName);
    const canonicalClassName =
      schema?.canonicalClassName ??
      (canonicalKey ? `net.minecraft.${canonicalKey}` : undefined);

    const superSimple = superchain[0]
      ? (this.obfToCanonical.get(superchain[0]) ??
        (superchain[0].includes('.')
          ? superchain[0].split('.').pop()
          : superchain[0]))
      : undefined;

    const info: DetectedClassInfo = {
      kind: 'class',
      originalName,
      canonicalKey,
      simpleName,
      canonicalClassName,
      schema,
      realClassName: cls.name,
      isObfuscated: true,
      superclass: superchain[0]
        ? {
            originalName:
              this.obfToCanonical.get(superchain[0]) ?? superchain[0],
            realClassName: superchain[0],
            simpleName: superSimple,
            isObfuscated: isObfuscatedClassName(superchain[0]),
            canonicalKey: this.obfToCanonical.get(superchain[0]),
          }
        : undefined,
      fields: detectedFields,
      methods: detectedMethods,
    };

    // Save to pool (accessible by realClassName, canonicalKey, simpleName, and canonicalClassName)
    this.classPool.set(cls.name, info);
    if (canonicalKey) {
      this.classPool.set(canonicalKey, info);
      this.classPool.set(simpleName, info);
      if (canonicalClassName) {
        this.classPool.set(canonicalClassName, info);
      }

      // Auto-register to mapping pool
      const fieldMap: Record<string, string> = {};
      for (const f of Object.values(detectedFields)) {
        if (f.originalName && f.realName) fieldMap[f.originalName] = f.realName;
      }
      const methodMap: Record<string, string> = {};
      for (const m of Object.values(detectedMethods)) {
        if (m.originalName && m.realName)
          methodMap[m.originalName] = m.realName;
      }
      this.mappings[canonicalKey] = {
        realClassName: cls.name,
        fields: fieldMap,
        methods: methodMap,
      };
      this.obfToCanonical.set(cls.name, canonicalKey);
      this.canonicalToObf.set(canonicalKey, cls.name);
      if (canonicalClassName) {
        this.canonicalToObf.set(canonicalClassName, cls.name);
      }

      if (this.targetJava && typeof this.targetJava.mapClass === 'function') {
        const cName = canonicalClassName ?? canonicalKey;
        this.targetJava.mapClass(cls.name, cName, {
          fields: fieldMap,
          methods: methodMap,
        });
        if (cName !== canonicalKey) {
          this.targetJava.mapClass(cls.name, canonicalKey, {
            fields: fieldMap,
            methods: methodMap,
          });
        }
      }
    }

    return info;
  }

  /**
   * Synchronous twin of `detectClass`. Analyzes a class synchronously and registers it into the pool and mappings.
   */
  public detectClassSync(
    target: ReflectedClass | string | any,
    options: DetectOptions = {},
  ): DetectedClassInfo {
    let cls: ReflectedClass;

    if (
      !target ||
      target === 0n ||
      (typeof target === 'object' && target.$ptr === 0n)
    ) {
      throw new Error(
        '[detectClassSync] Cannot detect class on null or empty object handle',
      );
    }

    if (typeof target === 'string') {
      const clean = target.replace(/^(class|interface)\s+/, '').trim();
      cls = this.getCachedClassSync(clean);
    } else if (
      target &&
      typeof target === 'object' &&
      typeof target.classObj === 'bigint'
    ) {
      cls = target;
    } else if (
      target &&
      typeof target === 'object' &&
      typeof target.$classObj === 'bigint'
    ) {
      const className = target.name || target.$className;
      cls = this.getCachedClassSync(className);
    } else if (
      target &&
      (typeof target.$ptr === 'bigint' || typeof target === 'bigint')
    ) {
      const rawHandle =
        typeof target.$ptr === 'bigint' ? target.$ptr : BigInt(target);
      if (typeof this.bridge.getObjectClassNameSync !== 'function') {
        throw new Error(
          '[detectClassSync] ReflectionBridge does not support getObjectClassNameSync',
        );
      }
      const className = this.bridge.getObjectClassNameSync(rawHandle);
      cls = this.getCachedClassSync(className);
    } else {
      throw new Error(`[detectClassSync] Unsupported class target: ${target}`);
    }

    // Check mapping pool cache
    if (options.useCache !== false) {
      if (this.classPool.has(cls.name)) {
        return this.classPool.get(cls.name)!;
      }
      const existingCanon = this.obfToCanonical.get(cls.name);
      if (existingCanon && this.classPool.has(existingCanon)) {
        return this.classPool.get(existingCanon)!;
      }
    }

    const isObf = isObfuscatedClassName(cls.name);

    if (!isObf) {
      const fields = cls.getDeclaredFieldsSync
        ? cls.getDeclaredFieldsSync()
        : [];
      const methods = cls.getDeclaredMethodsSync
        ? cls.getDeclaredMethodsSync()
        : [];

      const detectedFields: Record<string, DetectedFieldInfo> = {};
      for (const f of fields) {
        const d = this.detectField(f, cls);
        detectedFields[d.originalName || d.realName] = d;
      }

      const detectedMethods: Record<string, DetectedMethodInfo> = {};
      for (const m of methods) {
        const d = this.detectMethod(m, cls);
        detectedMethods[d.originalName || d.realName] = d;
      }

      const simpleName = cls.name.includes('.')
        ? cls.name.split('.').pop()!
        : cls.name;
      const info: DetectedClassInfo = {
        kind: 'class',
        originalName: cls.name,
        canonicalKey: simpleName,
        simpleName,
        canonicalClassName: cls.name,
        realClassName: cls.name,
        isObfuscated: false,
        fields: detectedFields,
        methods: detectedMethods,
      };

      this.classPool.set(cls.name, info);
      this.classPool.set(simpleName, info);
      return info;
    }

    // Obfuscated class
    const fields = cls.getDeclaredFieldsSync ? cls.getDeclaredFieldsSync() : [];
    const methods = cls.getDeclaredMethodsSync
      ? cls.getDeclaredMethodsSync()
      : [];
    const superchain = this.getCachedChainSync(cls);

    let canonicalKey: MinecraftClassKey | undefined;
    let originalName = cls.name;

    const isGuiScreen = superchain.some(
      (c) =>
        c === this.canonicalToObf.get('GuiScreen') || c.endsWith('GuiScreen'),
    );

    if (isGuiScreen || options.ownerClass === 'GuiScreen') {
      const hasAtomicInt = fields.some(
        (f) => f.type && f.type.includes('AtomicInteger'),
      );
      const hasDateFormat = fields.some(
        (f) => f.type && f.type.includes('DateFormat'),
      );
      const boolFields = fields.filter((f) => f.type === 'boolean');
      const hasServerData = fields.some(
        (f) =>
          f.type &&
          (f.type.includes('ServerData') || f.type.includes('ServerList')),
      );

      if (hasAtomicInt) {
        canonicalKey = 'GuiMainMenu';
      } else if (hasDateFormat) {
        canonicalKey = 'GuiSelectWorld';
      } else if (boolFields.length >= 5) {
        canonicalKey = 'GuiCreateWorld';
      } else if (hasServerData) {
        const textFieldCount = fields.filter(
          (f) => f.type && f.type.includes('TextField'),
        ).length;
        if (textFieldCount === 1) {
          canonicalKey = 'GuiScreenServerList';
        } else if (textFieldCount >= 2) {
          canonicalKey = 'GuiScreenAddServer';
        } else {
          canonicalKey = 'GuiMultiplayer';
        }
      } else if (fields.length === 2 && fields.every((f) => f.type === 'int')) {
        canonicalKey = 'GuiIngameMenu';
      }
    }

    if (!canonicalKey) {
      const boolCount = fields.filter(
        (f) => !f.isStatic && f.type === 'boolean',
      ).length;
      const floatCount = fields.filter(
        (f) => !f.isStatic && f.type === 'float',
      ).length;
      if (boolCount >= 4 && floatCount >= 2) {
        canonicalKey = 'PlayerCapabilities';
      }
    }

    if (!canonicalKey) {
      const floatCount = fields.filter(
        (f) => !f.isStatic && f.type === 'float',
      ).length;
      const boolCount = fields.filter(
        (f) => !f.isStatic && f.type === 'boolean',
      ).length;
      if (floatCount >= 2 && boolCount >= 4 && superchain.length <= 2) {
        canonicalKey = 'MovementInput';
      }
    }

    // Check pre-resolved obfToCanonical mapping
    if (!canonicalKey) {
      canonicalKey = this.obfToCanonical.get(cls.name) as
        MinecraftClassKey | undefined;
    }

    // GuiButton structural signature
    if (!canonicalKey) {
      const intCount = fields.filter(
        (f) => !f.isStatic && f.type === 'int',
      ).length;
      const strCount = fields.filter(
        (f) => !f.isStatic && f.type && f.type.includes('String'),
      ).length;
      const boolCount = fields.filter(
        (f) => !f.isStatic && f.type === 'boolean',
      ).length;
      if (intCount >= 5 && strCount >= 1 && boolCount >= 2) {
        canonicalKey = 'GuiButton';
      }
    }

    if (canonicalKey) {
      originalName =
        MINECRAFT_CANONICAL_SCHEMA[canonicalKey]?.canonicalClassName ??
        canonicalKey;
      this.obfToCanonical.set(cls.name, canonicalKey);
      this.canonicalToObf.set(canonicalKey, cls.name);
    }

    const detectedFields: Record<string, DetectedFieldInfo> = {};
    for (const f of fields) {
      const d = this.detectField(f, cls);
      detectedFields[d.originalName || d.realName] = d;
      detectedFields[d.realName] = d;
    }

    const detectedMethods: Record<string, DetectedMethodInfo> = {};
    for (const m of methods) {
      const d = this.detectMethod(m, cls);
      detectedMethods[d.originalName || d.realName] = d;
      detectedMethods[d.realName] = d;
    }

    const schema = canonicalKey
      ? MINECRAFT_CANONICAL_SCHEMA[canonicalKey]
      : undefined;
    const simpleName =
      canonicalKey ??
      (originalName.includes('.')
        ? originalName.split('.').pop()!
        : originalName);
    const canonicalClassName =
      schema?.canonicalClassName ??
      (canonicalKey ? `net.minecraft.${canonicalKey}` : undefined);

    const superSimple = superchain[0]
      ? (this.obfToCanonical.get(superchain[0]) ??
        (superchain[0].includes('.')
          ? superchain[0].split('.').pop()
          : superchain[0]))
      : undefined;

    const info: DetectedClassInfo = {
      kind: 'class',
      originalName,
      canonicalKey,
      simpleName,
      canonicalClassName,
      schema,
      realClassName: cls.name,
      isObfuscated: true,
      superclass: superchain[0]
        ? {
            originalName:
              this.obfToCanonical.get(superchain[0]) ?? superchain[0],
            realClassName: superchain[0],
            simpleName: superSimple,
            isObfuscated: isObfuscatedClassName(superchain[0]),
            canonicalKey: this.obfToCanonical.get(superchain[0]),
          }
        : undefined,
      fields: detectedFields,
      methods: detectedMethods,
    };

    // Save to pool
    this.classPool.set(cls.name, info);
    if (canonicalKey) {
      this.classPool.set(canonicalKey, info);
      this.classPool.set(simpleName, info);
      if (canonicalClassName) {
        this.classPool.set(canonicalClassName, info);
      }

      const fieldMap: Record<string, string> = {};
      for (const f of Object.values(detectedFields)) {
        if (f.originalName && f.realName) fieldMap[f.originalName] = f.realName;
      }
      const methodMap: Record<string, string> = {};
      for (const m of Object.values(detectedMethods)) {
        if (m.originalName && m.realName)
          methodMap[m.originalName] = m.realName;
      }
      this.mappings[canonicalKey] = {
        realClassName: cls.name,
        fields: fieldMap,
        methods: methodMap,
      };
      this.obfToCanonical.set(cls.name, canonicalKey);
      this.canonicalToObf.set(canonicalKey, cls.name);
      if (canonicalClassName) {
        this.canonicalToObf.set(canonicalClassName, cls.name);
      }

      if (this.targetJava && typeof this.targetJava.mapClass === 'function') {
        const cName = canonicalClassName ?? canonicalKey;
        this.targetJava.mapClass(cls.name, cName, {
          fields: fieldMap,
          methods: methodMap,
        });
        if (cName !== canonicalKey) {
          this.targetJava.mapClass(cls.name, canonicalKey, {
            fields: fieldMap,
            methods: methodMap,
          });
        }
      }
    }

    return info;
  }

  /**
   * Universal detection entry point.
   * Accepts a class, method, field, or instance, determines whether it is obfuscated,
   * matches it against the Minecraft database, and returns a rich detection struct.
   */
  public async detect(
    target: any,
    options?: DetectOptions,
  ): Promise<
    | DetectedClassInfo
    | DetectedMethodInfo
    | DetectedFieldInfo
    | TypeDescriptorInfo
  > {
    if (!target) {
      return this.detectType(null);
    }
    if (typeof target === 'string') {
      if (isPrimitiveType(target)) {
        return this.detectType(target);
      }
      return await this.detectClass(target, options);
    }
    if (typeof target === 'object') {
      if (
        'fieldObj' in target ||
        (target.parsed && target.parsed.kind === 'field')
      ) {
        return this.detectField(target, options?.ownerClass);
      }
      if (
        'methodObj' in target ||
        (target.parsed && target.parsed.kind === 'method')
      ) {
        return this.detectMethod(target, options?.ownerClass);
      }
      return await this.detectClass(target, options);
    }
    return this.detectType(String(target));
  }

  /**
   * Synchronous twin of `detect`.
   * Accepts a class, method, field, or instance, determines whether it is obfuscated,
   * matches it against the Minecraft database, and returns a rich detection struct synchronously.
   */
  public detectSync(
    target: any,
    options?: DetectOptions,
  ):
    | DetectedClassInfo
    | DetectedMethodInfo
    | DetectedFieldInfo
    | TypeDescriptorInfo {
    if (!target) {
      return this.detectType(null);
    }
    if (typeof target === 'string') {
      if (isPrimitiveType(target)) {
        return this.detectType(target);
      }
      return this.detectClassSync(target, options);
    }
    if (typeof target === 'object') {
      if (
        'fieldObj' in target ||
        (target.parsed && target.parsed.kind === 'field')
      ) {
        return this.detectField(target, options?.ownerClass);
      }
      if (
        'methodObj' in target ||
        (target.parsed && target.parsed.kind === 'method')
      ) {
        return this.detectMethod(target, options?.ownerClass);
      }
      return this.detectClassSync(target, options);
    }
    return this.detectType(String(target));
  }

  /**
   * Phase 1 (Core Match): Ultra-fast scan of Minecraft singleton, GuiScreen, and GuiButton (~50ms).
   * Resolves:
   * - Minecraft (theMinecraft, getMinecraft, currentScreen, displayGuiScreen)
   * - GuiScreen (buttonList, actionPerformed)
   * - GuiButton (id, displayString, enabled, visible)
   *
   * Designed for launcher / pre-world / menu states so tests or clients can inspect
   * and navigate client GUI screens before player/world instances exist.
   */
  public async matchCore(
    options: MatchOptions = {},
  ): Promise<MinecraftMappings> {
    const mappings: Partial<MinecraftMappings> = { ...this.mappings };

    // 1. Seed any known classes provided by the user
    if (options.seeds) {
      for (const [key, realName] of Object.entries(options.seeds)) {
        if (realName && typeof realName === 'string') {
          mappings[key as MinecraftClassKey] = {
            realClassName: realName,
            fields: {},
            methods: {},
          };
        }
      }
    }

    if (options.minecraftClassName && !mappings.Minecraft) {
      mappings.Minecraft = {
        realClassName: options.minecraftClassName,
        fields: {},
        methods: {},
      };
    }

    // 2. Anchor-based Root Resolution
    const anchors = await this.anchorResolver.findRoots(options);
    if (anchors.Minecraft && !mappings.Minecraft) {
      mappings.Minecraft = {
        realClassName: anchors.Minecraft,
        fields: {},
        methods: {},
      };
    }

    // Inspect RealmsBridge anchor for GuiScreen
    if (!mappings.GuiScreen) {
      try {
        const rbCls = await this.getCachedClass(
          'net.minecraft.realms.RealmsBridge',
        );
        const rbFields = await rbCls.getDeclaredFields();
        for (const f of rbFields) {
          if (!f.isStatic && f.type) {
            const cleanT = this.cleanTypeName(f.type);
            if (!cleanT.startsWith('java.') && !cleanT.startsWith('[')) {
              mappings.GuiScreen = {
                realClassName: cleanT,
                fields: {},
                methods: {},
              };
              break;
            }
          }
        }
      } catch {}
    }

    // Fallback: Check common root Minecraft class names if not seeded or anchored
    if (!mappings.Minecraft?.realClassName) {
      for (const name of ['ave', 'net.minecraft.client.Minecraft']) {
        try {
          const cls = await this.getCachedClass(name);
          if (cls) {
            mappings.Minecraft = {
              realClassName: name,
              fields: {},
              methods: {},
            };
            break;
          }
        } catch {}
      }
    }

    if (!mappings.Minecraft?.realClassName) {
      try {
        const mcCls = await this.anchorResolver.resolveMinecraftClass(options);
        mappings.Minecraft = {
          realClassName: mcCls.name,
          fields: {},
          methods: {},
        };
      } catch {}
    }

    // 3. Inspect Minecraft Class for singleton, currentScreen, displayGuiScreen
    if (mappings.Minecraft?.realClassName) {
      try {
        const mcCls = await this.getCachedClass(
          mappings.Minecraft.realClassName,
        );
        const mcName = mcCls.name;
        const mcFields = await mcCls.getDeclaredFields();

        // Static theMinecraft field
        if (!mappings.Minecraft.fields.theMinecraft) {
          const theMcField = mcFields.find(
            (f: ReflectedField) =>
              f.isStatic && (f.type === mcName || f.type === `class ${mcName}`),
          );
          if (theMcField) {
            mappings.Minecraft.fields.theMinecraft = theMcField.name;
          }
        }

        // Static getMinecraft method
        if (!mappings.Minecraft.methods.getMinecraft) {
          try {
            const mcMethods = await mcCls.getDeclaredMethods();
            const getMcMethod = mcMethods.find(
              (m: ReflectedMethod) =>
                m.isStatic &&
                m.paramTypes.length === 0 &&
                (m.returnType === mcName || m.returnType === `class ${mcName}`),
            );
            if (getMcMethod) {
              mappings.Minecraft.methods.getMinecraft = getMcMethod.name;
            }
          } catch {}
        }

        // currentScreen field & displayGuiScreen method
        if (mappings.GuiScreen?.realClassName) {
          const gsName = mappings.GuiScreen.realClassName;
          if (!mappings.Minecraft.fields.currentScreen) {
            const csField = mcFields.find(
              (f: ReflectedField) =>
                !f.isStatic &&
                (f.type === gsName || f.type === `class ${gsName}`),
            );
            if (csField) {
              mappings.Minecraft.fields.currentScreen = csField.name;
            }
          }
          if (!mappings.Minecraft.methods.displayGuiScreen) {
            try {
              const mcMethods = await mcCls.getDeclaredMethods();
              const dispMethod = mcMethods.find(
                (m: ReflectedMethod) =>
                  !m.isStatic &&
                  m.paramTypes.length === 1 &&
                  (m.paramTypes[0] === gsName ||
                    m.paramTypes[0] === `class ${gsName}`),
              );
              if (dispMethod) {
                mappings.Minecraft.methods.displayGuiScreen = dispMethod.name;
              }
            } catch {}
          }
        }

        // Instance thePlayer (EntityPlayerSP) and theWorld (WorldClient) fields
        if (
          !mappings.Minecraft.fields.thePlayer ||
          !mappings.Minecraft.fields.theWorld
        ) {
          for (const field of mcFields) {
            if (field.isStatic || !field.type) continue;
            const typeName = this.cleanTypeName(field.type);
            if (
              this.isPrimitive(typeName) ||
              typeName.startsWith('java.') ||
              typeName.startsWith('[')
            )
              continue;

            try {
              const fieldCls = await this.getCachedClass(typeName);
              const chain = await this.getCachedChain(fieldCls);

              // EntityPlayerSP: class hierarchy depth >= 5
              if (chain.length >= 5 && !mappings.Minecraft.fields.thePlayer) {
                mappings.Minecraft.fields.thePlayer = field.name;
                if (!mappings.EntityPlayerSP?.realClassName) {
                  mappings.EntityPlayerSP = {
                    realClassName: typeName,
                    fields: {},
                    methods: {},
                  };
                }
              }

              // WorldClient: class hierarchy depth === 3 + entity collections
              if (chain.length === 3 && !mappings.Minecraft.fields.theWorld) {
                const superCls = await fieldCls.getSuperclass();
                const superFields = superCls
                  ? await superCls.getDeclaredFields()
                  : [];
                const listFields = superFields.filter(
                  (f: ReflectedField) =>
                    f.type &&
                    (f.type.includes('List') || f.type.includes('Set')),
                );
                if (listFields.length >= 2) {
                  mappings.Minecraft.fields.theWorld = field.name;
                  if (!mappings.WorldClient?.realClassName) {
                    mappings.WorldClient = {
                      realClassName: typeName,
                      fields: {},
                      methods: {},
                    };
                  }
                }
              }
            } catch {}
          }
        }
      } catch {}
    }

    // 4. Inspect GuiScreen for buttonList, actionPerformed, and GuiButton
    if (mappings.GuiScreen?.realClassName) {
      try {
        const gsCls = await this.getCachedClass(
          mappings.GuiScreen.realClassName,
        );
        const gsFields = await gsCls.getDeclaredFields();

        // buttonList field (type java.util.List)
        if (!mappings.GuiScreen.fields.buttonList) {
          const listField = gsFields.find(
            (f: ReflectedField) =>
              !f.isStatic && f.type && f.type.includes('List'),
          );
          if (listField) {
            mappings.GuiScreen.fields.buttonList = listField.name;
          }
        }

        // actionPerformed method & GuiButton class
        if (
          !mappings.GuiScreen.methods.actionPerformed ||
          !mappings.GuiButton?.realClassName
        ) {
          try {
            const gsMethods = [
              ...(await gsCls.getDeclaredMethods().catch(() => [])),
              ...(await gsCls.getAllMethods().catch(() => [])),
            ];
            for (const m of gsMethods) {
              if (
                m.paramTypes.length === 1 &&
                (m.returnType === 'void' || m.returnType === 'V')
              ) {
                const pType = this.cleanTypeName(m.paramTypes[0]!);
                if (
                  !pType.startsWith('java.') &&
                  !this.isPrimitive(pType) &&
                  pType !== gsCls.name
                ) {
                  try {
                    const candidateCls = await this.getCachedClass(pType);
                    const flds = await candidateCls.getDeclaredFields();
                    const hasBool = flds.some(
                      (f: ReflectedField) => f.type === 'boolean',
                    );
                    const hasStr = flds.some(
                      (f: ReflectedField) =>
                        f.type && f.type.includes('String'),
                    );
                    if (hasBool && hasStr) {
                      mappings.GuiScreen.methods.actionPerformed = m.name;
                      if (!mappings.GuiButton?.realClassName) {
                        mappings.GuiButton = {
                          realClassName: pType,
                          fields: {},
                          methods: {},
                        };
                      }
                      break;
                    }
                  } catch {}
                }
              }
            }
          } catch {}
        }
      } catch {}
    }

    // 5. Inspect GuiButton fields: id, displayString, enabled, visible
    if (mappings.GuiButton?.realClassName && !mappings.GuiButton.fields.id) {
      try {
        const btnCls = await this.getCachedClass(
          mappings.GuiButton.realClassName,
        );
        const btnFields = await btnCls.getDeclaredFields();
        const intFields = btnFields.filter(
          (f: ReflectedField) => f.type === 'int',
        );
        const strFields = btnFields.filter(
          (f: ReflectedField) => f.type && f.type.includes('String'),
        );
        const boolFields = btnFields.filter(
          (f: ReflectedField) => f.type === 'boolean',
        );
        const idField =
          intFields.length >= 5
            ? (intFields[4]?.name ?? 'id')
            : (intFields[0]?.name ?? 'id');
        mappings.GuiButton.fields = {
          id: idField,
          width: intFields[0]?.name ?? 'width',
          height: intFields[1]?.name ?? 'height',
          xPosition: intFields[2]?.name ?? 'xPosition',
          yPosition: intFields[3]?.name ?? 'yPosition',
          displayString: strFields[0]?.name ?? 'displayString',
          enabled: boolFields[0]?.name ?? 'enabled',
          visible: boolFields[1]?.name ?? 'visible',
        };
      } catch {}
    }

    // 6. User overrides
    if (options.overrides) {
      for (const [k, override] of Object.entries(options.overrides)) {
        const key = k as MinecraftClassKey;
        if (!mappings[key]) {
          mappings[key] = {
            realClassName:
              override.realClassName ??
              MINECRAFT_CANONICAL_SCHEMA[key]?.canonicalClassName ??
              key,
            fields: override.fields ?? {},
            methods: override.methods ?? {},
          };
        } else {
          if (override.realClassName)
            mappings[key]!.realClassName = override.realClassName;
          if (override.fields)
            Object.assign(mappings[key]!.fields, override.fields);
          if (override.methods)
            Object.assign(mappings[key]!.methods, override.methods);
        }
      }
    }

    // 7. Synchronize into pools
    this.syncMappings(mappings);

    return this.ensureAllKeys(mappings);
  }

  /**
   * Phase 2 (World Match): Deep graph scan for in-world player capabilities, world, inventory, movement, and combat.
   * Resolves EntityPlayerSP, PlayerCapabilities (allowFlying, isFlying, flySpeed), WorldClient, and game mechanics.
   */
  public async matchWorld(
    options: MatchOptions = {},
  ): Promise<MinecraftMappings> {
    if (
      !this.mappings.Minecraft?.realClassName ||
      !this.mappings.Minecraft.fields?.theMinecraft
    ) {
      await this.matchCore(options);
    }

    const mappings: Partial<MinecraftMappings> = { ...this.mappings };

    const getCachedClass = (name: string) => this.getCachedClass(name);
    const getCachedChain = (cls: ReflectedClass) => this.getCachedChain(cls);

    // 1. Seed any known classes provided by the user
    if (options.seeds) {
      for (const [key, realName] of Object.entries(options.seeds)) {
        if (realName && typeof realName === 'string') {
          mappings[key as MinecraftClassKey] = {
            realClassName: realName,
            fields: {},
            methods: {},
          };
        }
      }
    }

    if (options.playerClassName && !mappings.EntityPlayerSP) {
      mappings.EntityPlayerSP = {
        realClassName: options.playerClassName,
        fields: {},
        methods: {},
      };
    }

    if (options.minecraftClassName && !mappings.Minecraft) {
      mappings.Minecraft = {
        realClassName: options.minecraftClassName,
        fields: {},
        methods: {},
      };
    }

    // 2. Anchor-based Root Resolution
    const anchors = await this.anchorResolver.findRoots(options);
    if (anchors.Minecraft) {
      mappings.Minecraft = {
        realClassName: anchors.Minecraft,
        fields: {},
        methods: {},
      };
    }

    // Inspect RealmsBridge anchor for GuiScreen
    try {
      const rbCls = await getCachedClass('net.minecraft.realms.RealmsBridge');
      const rbFields = await rbCls.getDeclaredFields();
      for (const f of rbFields) {
        if (!f.isStatic && f.type) {
          const cleanT = this.cleanTypeName(f.type);
          if (!cleanT.startsWith('java.') && !cleanT.startsWith('[')) {
            mappings.GuiScreen = {
              realClassName: cleanT,
              fields: {},
              methods: {},
            };
            break;
          }
        }
      }
    } catch {}

    // Fallback: Check common root Minecraft class names if not seeded or anchored
    if (!mappings.Minecraft?.realClassName) {
      for (const name of ['ave', 'net.minecraft.client.Minecraft']) {
        try {
          const cls = await getCachedClass(name);
          if (cls) {
            mappings.Minecraft = {
              realClassName: name,
              fields: {},
              methods: {},
            };
            break;
          }
        } catch {}
      }
    }

    if (
      !mappings.Minecraft?.realClassName &&
      !mappings.EntityPlayerSP?.realClassName
    ) {
      try {
        const mcCls = await this.anchorResolver.resolveMinecraftClass(options);
        mappings.Minecraft = {
          realClassName: mcCls.name,
          fields: {},
          methods: {},
        };
      } catch {}
    }

    // 3. Iterative Bidirectional Graph Expansion Loop
    // Expands outward from whatever seeds are known, classifying connected nodes.
    let netHandlerClassName: string | undefined;

    for (let pass = 0; pass < 5; pass++) {
      let newlyDiscoveredInPass = 0;

      // --- Inspect Minecraft Class ---
      if (mappings.Minecraft?.realClassName) {
        try {
          const mcCls = await getCachedClass(mappings.Minecraft.realClassName);
          const mcName = mcCls.name;
          const mcFields = await mcCls.getDeclaredFields();

          // Static theMinecraft field
          if (!mappings.Minecraft.fields.theMinecraft) {
            const theMcField = mcFields.find(
              (f: ReflectedField) =>
                f.isStatic &&
                (f.type === mcName || f.type === `class ${mcName}`),
            );
            if (theMcField) {
              mappings.Minecraft.fields.theMinecraft = theMcField.name;
            }
          }

          // Static getMinecraft method
          if (!mappings.Minecraft.methods.getMinecraft) {
            try {
              const mcMethods = await mcCls.getDeclaredMethods();
              const getMcMethod = mcMethods.find(
                (m: ReflectedMethod) =>
                  m.isStatic &&
                  m.paramTypes.length === 0 &&
                  (m.returnType === mcName ||
                    m.returnType === `class ${mcName}`),
              );
              if (getMcMethod) {
                mappings.Minecraft.methods.getMinecraft = getMcMethod.name;
              }
            } catch {}
          }

          // currentScreen field and displayGuiScreen method
          if (mappings.GuiScreen?.realClassName) {
            const gsName = mappings.GuiScreen.realClassName;
            if (!mappings.Minecraft.fields.currentScreen) {
              const csField = mcFields.find(
                (f: ReflectedField) =>
                  !f.isStatic &&
                  (f.type === gsName || f.type === `class ${gsName}`),
              );
              if (csField) {
                mappings.Minecraft.fields.currentScreen = csField.name;
              }
            }
            if (!mappings.Minecraft.methods.displayGuiScreen) {
              try {
                const mcMethods = await mcCls.getDeclaredMethods();
                const dispMethod = mcMethods.find(
                  (m: ReflectedMethod) =>
                    !m.isStatic &&
                    m.paramTypes.length === 1 &&
                    (m.paramTypes[0] === gsName ||
                      m.paramTypes[0] === `class ${gsName}`),
                );
                if (dispMethod) {
                  mappings.Minecraft.methods.displayGuiScreen = dispMethod.name;
                }
              } catch {}
            }
          }

          // Inspect instance fields of Minecraft
          for (const field of mcFields) {
            if (field.isStatic || !field.type) continue;
            const typeName = this.cleanTypeName(field.type);
            if (
              this.isPrimitive(typeName) ||
              typeName.startsWith('java.') ||
              typeName.startsWith('[')
            )
              continue;

            // Fast path: if class was already seeded/discovered, match field directly without slow superclass crawls
            if (
              mappings.EntityPlayerSP?.realClassName === typeName &&
              !mappings.Minecraft.fields.thePlayer
            ) {
              mappings.Minecraft.fields.thePlayer = field.name;
              newlyDiscoveredInPass++;
              continue;
            }
            if (
              mappings.WorldClient?.realClassName === typeName &&
              !mappings.Minecraft.fields.theWorld
            ) {
              mappings.Minecraft.fields.theWorld = field.name;
              newlyDiscoveredInPass++;
              continue;
            }
            if (
              mappings.Timer?.realClassName === typeName &&
              !mappings.Minecraft.fields.timer
            ) {
              mappings.Minecraft.fields.timer = field.name;
              newlyDiscoveredInPass++;
              continue;
            }
            if (
              mappings.GameSettings?.realClassName === typeName &&
              !mappings.Minecraft.fields.gameSettings
            ) {
              mappings.Minecraft.fields.gameSettings = field.name;
              newlyDiscoveredInPass++;
              continue;
            }

            // Early exit if all core Minecraft fields have already been discovered
            if (
              mappings.Minecraft.fields.thePlayer &&
              mappings.Minecraft.fields.theWorld &&
              mappings.Minecraft.fields.timer &&
              mappings.Minecraft.fields.gameSettings
            ) {
              break;
            }

            try {
              const fieldCls = await getCachedClass(typeName);
              const chain = await getCachedChain(fieldCls);

              // EntityPlayerSP (depth >= 5)
              if (
                chain.length >= 5 &&
                !mappings.EntityPlayerSP?.realClassName
              ) {
                mappings.EntityPlayerSP = {
                  realClassName: typeName,
                  fields: {},
                  methods: {},
                };
                mappings.Minecraft.fields.thePlayer = field.name;
                const epName =
                  chain.length >= 4 ? chain[chain.length - 4] : chain[2];
                if (epName && !mappings.EntityPlayer?.realClassName) {
                  mappings.EntityPlayer = {
                    realClassName: epName,
                    fields: {},
                    methods: {},
                  };
                }
                newlyDiscoveredInPass++;
                continue;
              } else if (
                mappings.EntityPlayerSP?.realClassName === typeName &&
                !mappings.Minecraft.fields.thePlayer
              ) {
                mappings.Minecraft.fields.thePlayer = field.name;
              }

              // WorldClient (depth === 3 + entity collections)
              if (chain.length === 3 && !mappings.WorldClient?.realClassName) {
                const superCls = await fieldCls.getSuperclass();
                const superFields = superCls
                  ? await superCls.getDeclaredFields()
                  : [];
                const listFields = superFields.filter(
                  (f: ReflectedField) =>
                    f.type &&
                    (f.type.includes('List') || f.type.includes('Set')),
                );
                if (listFields.length >= 2) {
                  mappings.WorldClient = {
                    realClassName: typeName,
                    fields: {},
                    methods: {},
                  };
                  mappings.Minecraft.fields.theWorld = field.name;
                  newlyDiscoveredInPass++;
                  continue;
                }
              } else if (
                mappings.WorldClient?.realClassName === typeName &&
                !mappings.Minecraft.fields.theWorld
              ) {
                mappings.Minecraft.fields.theWorld = field.name;
              }

              // Timer (ctor: float) or GameSettings (ctor: Minecraft, File)
              if (
                !mappings.Timer?.realClassName ||
                !mappings.GameSettings?.realClassName
              ) {
                const ctors = await fieldCls.getDeclaredConstructors();
                if (
                  !mappings.Timer?.realClassName &&
                  (await this.fingerprintEngine.isTimer(fieldCls, ctors))
                ) {
                  mappings.Timer = {
                    realClassName: typeName,
                    fields: {},
                    methods: {},
                  };
                  mappings.Minecraft.fields.timer = field.name;
                  newlyDiscoveredInPass++;
                  continue;
                }
                if (
                  !mappings.GameSettings?.realClassName &&
                  (await this.fingerprintEngine.isGameSettings(
                    fieldCls,
                    mcName,
                    ctors,
                  ))
                ) {
                  mappings.GameSettings = {
                    realClassName: typeName,
                    fields: {},
                    methods: {},
                  };
                  mappings.Minecraft.fields.gameSettings = field.name;
                  newlyDiscoveredInPass++;
                  continue;
                }
              }
            } catch {}
          }
        } catch {}
      }

      // --- Inspect EntityPlayerSP & Inheritance Chain ---
      if (mappings.EntityPlayerSP?.realClassName) {
        try {
          const spCls = await getCachedClass(
            mappings.EntityPlayerSP.realClassName,
          );
          const chain = await spCls.getSuperclassChain();
          // In standard Minecraft:
          // ... -> EntityPlayer -> EntityLivingBase -> Entity -> java.lang.Object
          // Regardless of intermediate client classes, Object is at the end:
          // chain[chain.length - 1] = java.lang.Object
          // chain[chain.length - 2] = Entity
          // chain[chain.length - 3] = EntityLivingBase
          // chain[chain.length - 4] = EntityPlayer
          const entityName =
            chain.length >= 2 ? chain[chain.length - 2] : chain[4];
          const livingName =
            chain.length >= 3 ? chain[chain.length - 3] : chain[3];
          const playerExtName =
            chain.length >= 4 ? chain[chain.length - 4] : chain[2];

          if (playerExtName && !mappings.EntityPlayer?.realClassName) {
            mappings.EntityPlayer = {
              realClassName: playerExtName,
              fields: {},
              methods: {},
            };
            newlyDiscoveredInPass++;
          }
          if (livingName && !mappings.EntityLivingBase?.realClassName) {
            mappings.EntityLivingBase = {
              realClassName: livingName,
              fields: {},
              methods: {},
            };
            newlyDiscoveredInPass++;
          }
          if (entityName && !mappings.Entity?.realClassName) {
            mappings.Entity = {
              realClassName: entityName,
              fields: {},
              methods: {},
            };
            newlyDiscoveredInPass++;
          }

          // EntityPlayerSP constructor: (Minecraft, World, NetHandlerPlayClient, StatFileWriter)
          const spCtors = await spCls.getDeclaredConstructors();
          for (const ctor of spCtors) {
            if (ctor.paramTypes.length >= 4) {
              const [mcParam, worldParam, netHandlerParam] = ctor.paramTypes;
              if (
                mcParam &&
                !mcParam.startsWith('java.') &&
                !mappings.Minecraft?.realClassName
              ) {
                mappings.Minecraft = {
                  realClassName: this.cleanTypeName(mcParam),
                  fields: {},
                  methods: {},
                };
                newlyDiscoveredInPass++;
              }
              if (
                worldParam &&
                !worldParam.startsWith('java.') &&
                !mappings.World?.realClassName
              ) {
                mappings.World = {
                  realClassName: this.cleanTypeName(worldParam),
                  fields: {},
                  methods: {},
                };
                newlyDiscoveredInPass++;
              }
              if (netHandlerParam && !netHandlerParam.startsWith('java.')) {
                netHandlerClassName = this.cleanTypeName(netHandlerParam);
              }
              break;
            }
          }

          // MovementInput
          const spFields = await spCls.getDeclaredFields();
          for (const spField of spFields) {
            if (!spField.type || spField.isStatic) continue;
            const tName = this.cleanTypeName(spField.type);
            if (tName.startsWith('java.') || tName.startsWith('[')) continue;
            try {
              const miCls = await this.bridge.getClass(tName);
              const miFields = await miCls.getDeclaredFields();
              const miMatches =
                this.fingerprintEngine.matchMovementInput(miFields);
              if (miMatches) {
                if (!mappings.MovementInput?.realClassName) {
                  mappings.MovementInput = {
                    realClassName: tName,
                    fields: {
                      moveStrafe: miMatches.moveStrafe ?? 'moveStrafe',
                      moveForward: miMatches.moveForward ?? 'moveForward',
                      jump: miMatches.jump ?? 'jump',
                      sneak: miMatches.sneak ?? 'sneak',
                    },
                    methods: {},
                  };
                  newlyDiscoveredInPass++;
                }
                mappings.EntityPlayerSP.fields.movementInput = spField.name;
                break;
              }
            } catch {}
          }
        } catch {}
      }

      // --- Inspect PlayerControllerMP from Minecraft Fields via NetHandler ---
      if (
        netHandlerClassName &&
        mappings.Minecraft?.realClassName &&
        !mappings.PlayerControllerMP?.realClassName
      ) {
        try {
          const mcCls = await this.bridge.getClass(
            mappings.Minecraft.realClassName,
          );
          const mcFields = await mcCls.getDeclaredFields();
          for (const field of mcFields) {
            if (!field.isStatic && field.type) {
              const fType = this.cleanTypeName(field.type);
              try {
                const fCls = await this.bridge.getClass(fType);
                if (
                  await this.fingerprintEngine.isPlayerControllerMP(
                    fCls,
                    mcCls.name,
                    netHandlerClassName,
                  )
                ) {
                  mappings.PlayerControllerMP = {
                    realClassName: fType,
                    fields: {},
                    methods: {},
                  };
                  mappings.Minecraft.fields.playerController = field.name;
                  newlyDiscoveredInPass++;
                  break;
                }
              } catch {}
            }
          }
        } catch {}
      }

      // --- Inspect EntityPlayer ---
      if (mappings.EntityPlayer?.realClassName) {
        try {
          const epCls = await getCachedClass(
            mappings.EntityPlayer.realClassName,
          );
          const epFields = await epCls.getDeclaredFields();
          for (const f of epFields) {
            if (!f.type) continue;
            const tName = this.cleanTypeName(f.type);
            if (tName.startsWith('java.') || tName.startsWith('[')) continue;
            try {
              const fCls = await getCachedClass(tName);
              const fCtors = await fCls.getDeclaredConstructors();

              // InventoryPlayer (ctor: EntityPlayer)
              const isInvCtor = fCtors.some(
                (c) =>
                  c.paramTypes.length === 1 &&
                  (c.paramTypes[0] === epCls.name ||
                    c.paramTypes[0] === `class ${epCls.name}`),
              );
              if (isInvCtor) {
                if (!mappings.InventoryPlayer?.realClassName) {
                  mappings.InventoryPlayer = {
                    realClassName: tName,
                    fields: {},
                    methods: {},
                  };
                  newlyDiscoveredInPass++;
                }
                mappings.EntityPlayer.fields.inventory = f.name;

                // ItemStack array in InventoryPlayer
                const fFields = await fCls.getDeclaredFields();
                for (const itemField of fFields) {
                  const baseType = this.fingerprintEngine.extractArrayBaseType(
                    itemField.type,
                  );
                  if (baseType && !baseType.startsWith('java.')) {
                    if (!mappings.ItemStack?.realClassName) {
                      mappings.ItemStack = {
                        realClassName: baseType,
                        fields: {},
                        methods: {},
                      };
                      newlyDiscoveredInPass++;
                    }
                    // Item in ItemStack
                    try {
                      const isCls = await this.bridge.getClass(baseType);
                      const isFields = await isCls.getDeclaredFields();
                      const PRIMITIVES = new Set([
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
                      for (const isField of isFields) {
                        if (!isField.type) continue;
                        const itName = this.cleanTypeName(isField.type);
                        if (
                          !PRIMITIVES.has(itName) &&
                          !itName.startsWith('java.') &&
                          !itName.startsWith('[') &&
                          !itName.endsWith('[]')
                        ) {
                          if (!mappings.Item?.realClassName) {
                            mappings.Item = {
                              realClassName: itName,
                              fields: {},
                              methods: {},
                            };
                            newlyDiscoveredInPass++;
                          }
                          mappings.ItemStack.fields.item = isField.name;
                          break;
                        }
                      }
                    } catch {}
                    break;
                  }
                }
                continue;
              }

              // Fast path: PlayerCapabilities known from seeds or earlier discovery
              if (mappings.PlayerCapabilities?.realClassName === tName) {
                if (!mappings.EntityPlayer.fields.capabilities) {
                  mappings.EntityPlayer.fields.capabilities = f.name;
                  if (mappings.EntityPlayerSP) {
                    mappings.EntityPlayerSP.fields.capabilities = f.name;
                  }
                  newlyDiscoveredInPass++;
                }
                continue;
              }

              // PlayerCapabilities (4+ bools, 2+ floats)
              const fFields = await fCls.getDeclaredFields();
              const fBooleans = fFields.filter(
                (item: ReflectedField) => item.type === 'boolean',
              );
              const fFloats = fFields.filter(
                (item: ReflectedField) => item.type === 'float',
              );
              if (
                fBooleans.length >= 4 &&
                fFloats.length >= 2 &&
                !mappings.PlayerCapabilities?.realClassName
              ) {
                const findField = (names: string[], fallback: string) => {
                  const match = fFields.find((item: ReflectedField) =>
                    names.includes(item.name),
                  );
                  return match ? match.name : fallback;
                };

                mappings.PlayerCapabilities = {
                  realClassName: tName,
                  fields: {
                    disableDamage: findField(
                      ['disableDamage', 'field_75102_a', 'a'],
                      fBooleans[0]?.name ?? 'disableDamage',
                    ),
                    isFlying: findField(
                      ['isFlying', 'field_75100_b', 'b'],
                      fBooleans[1]?.name ?? 'isFlying',
                    ),
                    allowFlying: findField(
                      ['allowFlying', 'field_75101_c', 'c'],
                      fBooleans[2]?.name ?? 'allowFlying',
                    ),
                    isCreativeMode: findField(
                      ['isCreativeMode', 'field_75098_d', 'd'],
                      fBooleans[3]?.name ?? 'isCreativeMode',
                    ),
                    allowEdit: findField(
                      ['allowEdit', 'field_75099_e', 'e'],
                      fBooleans[4]?.name ?? 'allowEdit',
                    ),
                    flySpeed: findField(
                      ['flySpeed', 'field_75097_g', 'f'],
                      fFloats[0]?.name ?? 'flySpeed',
                    ),
                    walkSpeed: findField(
                      ['walkSpeed', 'field_75096_f', 'g'],
                      fFloats[1]?.name ?? 'walkSpeed',
                    ),
                  },
                  methods: {},
                };
                mappings.EntityPlayer.fields.capabilities = f.name;
                if (mappings.EntityPlayerSP) {
                  mappings.EntityPlayerSP.fields.capabilities = f.name;
                }
                newlyDiscoveredInPass++;
              }

              // FoodStats (2 floats, 3 ints)
              const fsMatches = this.fingerprintEngine.matchFoodStats(fFields);
              if (fsMatches && !mappings.FoodStats?.realClassName) {
                mappings.FoodStats = {
                  realClassName: tName,
                  fields: {
                    foodLevel: fsMatches.foodLevel ?? 'foodLevel',
                    foodSaturationLevel:
                      fsMatches.foodSaturationLevel ?? 'foodSaturationLevel',
                    foodExhaustionLevel:
                      fsMatches.foodExhaustionLevel ?? 'foodExhaustionLevel',
                    foodTimer: fsMatches.foodTimer ?? 'foodTimer',
                    prevFoodLevel: fsMatches.prevFoodLevel ?? 'prevFoodLevel',
                  },
                  methods: {},
                };
                mappings.EntityPlayer.fields.foodStats = f.name;
                newlyDiscoveredInPass++;
              }
            } catch {}
          }
        } catch {}
      }

      // --- Inspect Entity ---
      if (mappings.Entity?.realClassName) {
        try {
          const entCls = await this.bridge.getClass(
            mappings.Entity.realClassName,
          );
          const entFields = await entCls.getDeclaredFields();
          const entDoubles = entFields.filter(
            (f: ReflectedField) => f.type === 'double',
          );
          const entFloats = entFields.filter(
            (f: ReflectedField) => f.type === 'float',
          );
          const entBools = entFields.filter(
            (f: ReflectedField) => f.type === 'boolean',
          );

          if (entDoubles.length >= 10) {
            mappings.Entity.fields.lastTickPosX = entDoubles[1]!.name;
            mappings.Entity.fields.lastTickPosY = entDoubles[2]!.name;
            mappings.Entity.fields.lastTickPosZ = entDoubles[3]!.name;
            mappings.Entity.fields.posX = entDoubles[4]!.name;
            mappings.Entity.fields.posY = entDoubles[5]!.name;
            mappings.Entity.fields.posZ = entDoubles[6]!.name;
            mappings.Entity.fields.motionX = entDoubles[7]!.name;
            mappings.Entity.fields.motionY = entDoubles[8]!.name;
            mappings.Entity.fields.motionZ = entDoubles[9]!.name;
          } else if (entDoubles.length >= 6) {
            mappings.Entity.fields.posX = entDoubles[0]!.name;
            mappings.Entity.fields.posY = entDoubles[1]!.name;
            mappings.Entity.fields.posZ = entDoubles[2]!.name;
            mappings.Entity.fields.motionX = entDoubles[3]!.name;
            mappings.Entity.fields.motionY = entDoubles[4]!.name;
            mappings.Entity.fields.motionZ = entDoubles[5]!.name;
          }

          if (entFloats.length >= 2) {
            mappings.Entity.fields.rotationYaw = entFloats[0]!.name;
            mappings.Entity.fields.rotationPitch = entFloats[1]!.name;
          }
          if (entFloats.length >= 4) {
            mappings.Entity.fields.prevRotationYaw = entFloats[2]!.name;
            mappings.Entity.fields.prevRotationPitch = entFloats[3]!.name;
          }

          if (entBools.length >= 2) {
            mappings.Entity.fields.onGround = entBools[1]!.name;
          } else if (entBools.length >= 1) {
            mappings.Entity.fields.onGround = entBools[0]!.name;
          }

          // AxisAlignedBB (ctor: 6 doubles)
          for (const f of entFields) {
            if (!f.type) continue;
            const tName = this.cleanTypeName(f.type);
            if (tName.startsWith('java.') || tName.startsWith('[')) continue;
            try {
              const fCls = await this.bridge.getClass(tName);
              const fCtors = await fCls.getDeclaredConstructors();
              const isAabbCtor = fCtors.some(
                (c) =>
                  c.paramTypes.length === 6 &&
                  c.paramTypes.every((p) => p === 'double'),
              );
              if (isAabbCtor && !mappings.AxisAlignedBB?.realClassName) {
                const aabbFields = await fCls.getDeclaredFields();
                const aabbMatches =
                  this.fingerprintEngine.matchAxisAlignedBB(aabbFields);
                if (aabbMatches) {
                  mappings.AxisAlignedBB = {
                    realClassName: tName,
                    fields: {
                      minX: aabbMatches.minX ?? 'minX',
                      minY: aabbMatches.minY ?? 'minY',
                      minZ: aabbMatches.minZ ?? 'minZ',
                      maxX: aabbMatches.maxX ?? 'maxX',
                      maxY: aabbMatches.maxY ?? 'maxY',
                      maxZ: aabbMatches.maxZ ?? 'maxZ',
                    },
                    methods: {},
                  };
                  mappings.Entity.fields.boundingBox = f.name;
                  newlyDiscoveredInPass++;
                  break;
                }
              }
            } catch {}
          }
        } catch {}
      }

      // --- Inspect WorldClient ---
      if (mappings.WorldClient?.realClassName) {
        try {
          const wcCls = await getCachedClass(
            mappings.WorldClient.realClassName,
          );
          const wcSuper = await wcCls.getSuperclass();
          if (wcSuper && !mappings.World?.realClassName) {
            mappings.World = {
              realClassName: wcSuper.name,
              fields: {},
              methods: {},
            };
            newlyDiscoveredInPass++;
          }
        } catch {}
      }

      // --- Inspect GameSettings & KeyBindings ---
      if (
        mappings.GameSettings?.realClassName &&
        !mappings.KeyBinding?.realClassName
      ) {
        try {
          const gsCls = await getCachedClass(
            mappings.GameSettings.realClassName,
          );
          const gsFields = await gsCls.getDeclaredFields();
          for (const f of gsFields) {
            if (!f.type) continue;
            const tName = this.cleanTypeName(f.type);
            if (!tName.startsWith('java.') && !tName.startsWith('[')) {
              try {
                const kbCls = await getCachedClass(tName);
                if (await this.fingerprintEngine.isKeyBinding(kbCls)) {
                  const kbFields = await kbCls.getDeclaredFields();
                  const kbBools = kbFields.filter(
                    (item: ReflectedField) => item.type === 'boolean',
                  );
                  const kbInts = kbFields.filter(
                    (item: ReflectedField) => item.type === 'int',
                  );
                  mappings.KeyBinding = {
                    realClassName: tName,
                    fields: {
                      pressed: kbBools[0]?.name ?? 'pressed',
                      pressTime: kbInts[0]?.name ?? 'pressTime',
                      keyCode: kbInts[1]?.name ?? 'keyCode',
                    },
                    methods: {},
                  };
                  newlyDiscoveredInPass++;
                  break;
                }
              } catch {}
            }
          }
        } catch {}
      }

      // --- Inspect Timer ---
      if (mappings.Timer?.realClassName && !mappings.Timer.fields.timerSpeed) {
        try {
          const timerCls = await getCachedClass(mappings.Timer.realClassName);
          const timerFields = await timerCls.getDeclaredFields();
          const timerFloats = timerFields.filter(
            (f: ReflectedField) => f.type === 'float',
          );
          const timerDoubles = timerFields.filter(
            (f: ReflectedField) => f.type === 'double',
          );
          const timerLongs = timerFields.filter(
            (f: ReflectedField) => f.type === 'long',
          );
          mappings.Timer.fields = {
            ticksPerSecond: timerFloats[0]?.name ?? 'ticksPerSecond',
            lastSyncSysClock: timerLongs[0]?.name ?? 'lastSyncSysClock',
            elapsedPartialTicks: timerFloats[1]?.name ?? 'elapsedPartialTicks',
            timerSpeed: timerFloats[2]?.name ?? 'timerSpeed',
            renderPartialTicks: timerFloats[3]?.name ?? 'renderPartialTicks',
            lastSyncHRClock: timerDoubles[0]?.name ?? 'lastSyncHRClock',
          };
        } catch {}
      }

      // --- Inspect GuiScreen & GuiButton ---
      if (mappings.GuiScreen?.realClassName) {
        try {
          const gsCls = await getCachedClass(mappings.GuiScreen.realClassName);
          const gsFields = await gsCls.getDeclaredFields();

          // buttonList field (type java.util.List)
          if (!mappings.GuiScreen.fields.buttonList) {
            const listField = gsFields.find(
              (f: ReflectedField) =>
                !f.isStatic && f.type && f.type.includes('List'),
            );
            if (listField) {
              mappings.GuiScreen.fields.buttonList = listField.name;
            }
          }

          // actionPerformed method & GuiButton class
          if (
            !mappings.GuiScreen.methods.actionPerformed ||
            !mappings.GuiButton?.realClassName
          ) {
            try {
              const gsMethods = [
                ...(await gsCls.getDeclaredMethods().catch(() => [])),
                ...(await gsCls.getAllMethods().catch(() => [])),
              ];
              for (const m of gsMethods) {
                if (
                  m.paramTypes.length === 1 &&
                  (m.returnType === 'void' || m.returnType === 'V')
                ) {
                  const pType = this.cleanTypeName(m.paramTypes[0]!);
                  if (
                    !pType.startsWith('java.') &&
                    !this.isPrimitive(pType) &&
                    pType !== gsCls.name
                  ) {
                    try {
                      const candidateCls = await getCachedClass(pType);
                      const flds = await candidateCls.getDeclaredFields();
                      const hasBool = flds.some(
                        (f: ReflectedField) => f.type === 'boolean',
                      );
                      const hasStr = flds.some(
                        (f: ReflectedField) =>
                          f.type && f.type.includes('String'),
                      );
                      if (hasBool && hasStr) {
                        mappings.GuiScreen.methods.actionPerformed = m.name;
                        if (!mappings.GuiButton?.realClassName) {
                          mappings.GuiButton = {
                            realClassName: pType,
                            fields: {},
                            methods: {},
                          };
                          newlyDiscoveredInPass++;
                        }
                        break;
                      }
                    } catch {}
                  }
                }
              }
            } catch {}
          }
        } catch {}
      }

      // --- Inspect GuiButton fields ---
      if (mappings.GuiButton?.realClassName && !mappings.GuiButton.fields.id) {
        try {
          const btnCls = await getCachedClass(mappings.GuiButton.realClassName);
          const btnFields = await btnCls.getDeclaredFields();
          const intFields = btnFields.filter(
            (f: ReflectedField) => f.type === 'int',
          );
          const strFields = btnFields.filter(
            (f: ReflectedField) => f.type && f.type.includes('String'),
          );
          const boolFields = btnFields.filter(
            (f: ReflectedField) => f.type === 'boolean',
          );
          const idField =
            intFields.length >= 5
              ? (intFields[4]?.name ?? 'id')
              : (intFields[0]?.name ?? 'id');
          mappings.GuiButton.fields = {
            id: idField,
            width: intFields[0]?.name ?? 'width',
            height: intFields[1]?.name ?? 'height',
            xPosition: intFields[2]?.name ?? 'xPosition',
            yPosition: intFields[3]?.name ?? 'yPosition',
            displayString: strFields[0]?.name ?? 'displayString',
            enabled: boolFields[0]?.name ?? 'enabled',
            visible: boolFields[1]?.name ?? 'visible',
          };
        } catch {}
      }

      // Stop if fixed point reached
      if (newlyDiscoveredInPass === 0 && pass > 0) {
        break;
      }
    }

    // Apply any explicit user overrides on top
    if (options.overrides) {
      for (const [k, override] of Object.entries(options.overrides)) {
        const key = k as MinecraftClassKey;
        if (!mappings[key]) {
          mappings[key] = {
            realClassName:
              override.realClassName ??
              MINECRAFT_CANONICAL_SCHEMA[key]?.canonicalClassName ??
              key,
            fields: override.fields ?? {},
            methods: override.methods ?? {},
          };
        } else {
          if (override.realClassName)
            mappings[key]!.realClassName = override.realClassName;
          if (override.fields)
            Object.assign(mappings[key]!.fields, override.fields);
          if (override.methods)
            Object.assign(mappings[key]!.methods, override.methods);
        }
      }
    }

    // Ensure all canonical keys exist in mappings
    for (const key of Object.keys(
      MINECRAFT_CANONICAL_SCHEMA,
    ) as MinecraftClassKey[]) {
      if (!mappings[key]) {
        mappings[key] = {
          realClassName: MINECRAFT_CANONICAL_SCHEMA[key].canonicalClassName,
          fields: {},
          methods: {},
        };
      }
    }

    // Merge inherited EntityPlayer fields into EntityPlayerSP for direct proxy property access
    if (mappings.EntityPlayerSP && mappings.EntityPlayer) {
      Object.assign(
        mappings.EntityPlayerSP.fields,
        mappings.EntityPlayer.fields,
      );
    }

    // Synchronize resolved mappings with internal pools
    this.syncMappings(mappings);

    return this.ensureAllKeys(mappings);
  }

  /**
   * Universal dynamic Minecraft matcher. Executes phased resolution:
   * - options.phase === 'core' -> executes matchCore() (~50ms, pre-world/menus)
   * - options.phase === 'world' -> executes matchWorld() (deep in-world player scan)
   * - default ('all') -> executes matchCore() followed by matchWorld()
   */
  public async match(options: MatchOptions = {}): Promise<MinecraftMappings> {
    if (options.pool) {
      const poolMappings = MinecraftMatcher.mappingsFromPool(options.pool);
      if (poolMappings && poolMappings.Minecraft?.realClassName) {
        Object.assign(this.mappings, poolMappings);
        return poolMappings;
      }
    }
    if (options.phase === 'core') {
      return this.matchCore(options);
    }
    if (options.phase === 'world') {
      return this.matchWorld(options);
    }
    await this.matchCore(options);
    return this.matchWorld(options);
  }

  /**
   * Registers all discovered Minecraft class, field, and method mappings into a `JavaContext`,
   * and attaches the Minecraft database and dynamic detector to the context.
   */
  public registerTo(
    javaContext: {
      mapClass(obf: string, deobf: string, options?: any): any;
      registerDatabase?(db: any): any;
      setDetector?(detector: any): any;
      mapper?: any;
    },
    mappings?: MinecraftMappings,
  ): void {
    this.targetJava = javaContext;

    // 1. Connect Minecraft database & dynamic detector to njava JavaContext / mapper
    if (typeof javaContext.registerDatabase === 'function') {
      javaContext.registerDatabase(MINECRAFT_CANONICAL_SCHEMA);
    } else if (
      javaContext.mapper &&
      typeof javaContext.mapper.registerDatabase === 'function'
    ) {
      javaContext.mapper.registerDatabase(MINECRAFT_CANONICAL_SCHEMA);
    }

    if (typeof javaContext.setDetector === 'function') {
      javaContext.setDetector(this);
    } else if (
      javaContext.mapper &&
      typeof javaContext.mapper.setDetector === 'function'
    ) {
      javaContext.mapper.setDetector(this);
    }

    // 2. Register all currently resolved class mappings
    const activeMappings = mappings ?? (this.mappings as MinecraftMappings);
    for (const [k, mapping] of Object.entries(activeMappings)) {
      const key = k as MinecraftClassKey;
      if (!mapping || !mapping.realClassName) continue;

      const schema = (MINECRAFT_CANONICAL_SCHEMA as any)[key];
      const canonicalName = schema?.canonicalClassName ?? key;
      // Skip unresolved entries where realClassName is empty or identical to canonicalClassName
      if (
        mapping.realClassName === '' ||
        mapping.realClassName === canonicalName
      ) {
        continue;
      }

      javaContext.mapClass(mapping.realClassName, canonicalName, {
        fields: mapping.fields,
        methods: mapping.methods,
      });
      if (canonicalName !== key) {
        javaContext.mapClass(mapping.realClassName, key, {
          fields: mapping.fields,
          methods: mapping.methods,
        });
      }
    }
  }

  /**
   * Constructs MinecraftMappings directly from a loaded MappingPool without needing live reflection scanning.
   */
  public static mappingsFromPool(pool: any): MinecraftMappings | null {
    if (!pool) return null;
    const mappings: any = {};

    for (const [key, schema] of Object.entries(MINECRAFT_CANONICAL_SCHEMA)) {
      const canonical = (schema as any).canonicalClassName || key;
      const realClass =
        pool.resolveClass?.(canonical) ?? pool.resolveClass?.(key) ?? canonical;

      const fields: Record<string, string> = {};
      if ((schema as any).fields) {
        for (const fKey of Object.keys((schema as any).fields)) {
          const resolvedField =
            pool.resolveField?.(canonical, fKey) ??
            pool.resolveField?.(realClass, fKey) ??
            fKey;
          fields[fKey] = resolvedField;
        }
      }

      const methods: Record<string, string> = {};
      if ((schema as any).methods) {
        for (const mKey of Object.keys((schema as any).methods)) {
          const resolvedMethod =
            pool.resolveMethod?.(canonical, mKey) ??
            pool.resolveMethod?.(realClass, mKey) ??
            mKey;
          methods[mKey] = resolvedMethod;
        }
      }

      mappings[key] = {
        canonicalClassName: canonical,
        realClassName: realClass,
        fields,
        methods,
      };
    }

    return mappings as MinecraftMappings;
  }
}
