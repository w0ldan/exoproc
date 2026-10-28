import { existsSync, readFileSync } from 'node:fs';
import type {
  ClassSchema,
  DetectedClassInfo,
  MappingDatabase,
  MappingPool,
  MappingsJson,
  PoolOptions,
  TypeAccessCallback,
  TypeAccessContext,
  ExportMappingsOptions,
} from './types.js';
import { exportMappings } from './io.js';

class MappingPoolImpl implements MappingPool {
  readonly name: string;
  readonly classPool = new Map<string, DetectedClassInfo>();
  readonly canonicalToObf = new Map<string, string>();
  readonly obfToCanonical = new Map<string, string>();
  private databases: MappingDatabase[] = [];

  constructor(options?: PoolOptions) {
    this.name = options?.name || 'default';
    if (options?.databases) {
      for (const db of options.databases) {
        this.useDatabase(db);
      }
    }
  }

  useDatabase(db: MappingDatabase): this {
    if (!this.databases.includes(db)) {
      this.databases.push(db);

      // Register any direct obf mappings present in database
      for (const cls of db.getAllClasses()) {
        if (
          cls.canonical &&
          cls.obf &&
          cls.canonical !== cls.obf &&
          !cls.obf.includes('.')
        ) {
          this.canonicalToObf.set(cls.canonical, cls.obf);
          this.obfToCanonical.set(cls.obf, cls.canonical);
        }
      }
    }
    return this;
  }

  getDatabases(): MappingDatabase[] {
    return [...this.databases];
  }

  registerMatch(
    canonicalOrDetected: string | DetectedClassInfo,
    realClassName?: string,
    fields?: Record<string, string>,
    methods?: Record<string, string>,
    confidence = 1.0,
  ): this {
    let detected: DetectedClassInfo;

    if (
      typeof canonicalOrDetected === 'object' &&
      canonicalOrDetected !== null
    ) {
      detected = {
        ...canonicalOrDetected,
        fields: { ...(canonicalOrDetected.fields || {}) },
        methods: { ...(canonicalOrDetected.methods || {}) },
      };
    } else {
      if (!realClassName) {
        throw new Error(
          'registerMatch requires realClassName when passing canonicalName string',
        );
      }
      const canonical = String(canonicalOrDetected);
      const simple = canonical.includes('.')
        ? canonical.split('.').pop()!
        : canonical;

      detected = {
        canonicalName: canonical,
        simpleName: simple,
        realClassName,
        fields: { ...(fields || {}) },
        methods: { ...(methods || {}) },
        confidence,
      };
    }

    if (!detected.simpleName) {
      detected.simpleName = detected.canonicalName.includes('.')
        ? detected.canonicalName.split('.').pop()!
        : detected.canonicalName;
    }

    // Attach canonical schema if available from attached databases
    if (!detected.schema) {
      for (const db of this.databases) {
        const s =
          db.getClass(detected.canonicalName) ||
          (detected.simpleName ? db.getClass(detected.simpleName) : undefined);
        if (s) {
          detected.schema = s;
          if (!detected.superclass && s.superclass) {
            detected.superclass = s.superclass;
          }
          break;
        }
      }
    }

    const trueCanonical =
      (detected.schema && detected.schema.canonical) || detected.canonicalName;
    const realObf =
      this.canonicalToObf.get(detected.realClassName) || detected.realClassName;

    // Check existing entry to preserve rich info if incoming is a partial/alias entry
    const existing =
      this.classPool.get(trueCanonical) ||
      this.classPool.get(detected.canonicalName) ||
      (detected.simpleName
        ? this.classPool.get(detected.simpleName)
        : undefined);

    if (existing) {
      if (
        existing.realClassName &&
        !existing.realClassName.includes('.') &&
        detected.realClassName.includes('.')
      ) {
        detected.realClassName = existing.realClassName;
      }
      detected.fields = { ...existing.fields, ...detected.fields };
      detected.methods = { ...existing.methods, ...detected.methods };
      if (!detected.superclass && existing.superclass) {
        detected.superclass = existing.superclass;
      }
    }

    if (
      detected.canonicalName !== realObf ||
      !this.canonicalToObf.has(detected.canonicalName)
    ) {
      this.canonicalToObf.set(detected.canonicalName, realObf);
    }
    if (detected.simpleName) {
      if (
        detected.simpleName !== realObf ||
        !this.canonicalToObf.has(detected.simpleName)
      ) {
        this.canonicalToObf.set(detected.simpleName, realObf);
      }
    }
    if (detected.schema && detected.schema.canonical) {
      if (detected.schema.canonical !== detected.realClassName) {
        this.canonicalToObf.set(
          detected.schema.canonical,
          detected.realClassName,
        );
      }
      this.classPool.set(detected.schema.canonical, detected);
    }
    if (detected.realClassName !== trueCanonical) {
      this.obfToCanonical.set(detected.realClassName, trueCanonical);
    }

    if (
      detected.realClassName !== trueCanonical &&
      detected.realClassName !== detected.canonicalName
    ) {
      this.classPool.set(detected.realClassName, detected);
    }
    this.classPool.set(detected.canonicalName, detected);
    if (detected.simpleName) {
      this.classPool.set(detected.simpleName, detected);
    }

    return this;
  }

  unregisterMatch(name: string): boolean {
    const detected = this.getDetected(name);
    if (!detected) return false;

    this.canonicalToObf.delete(detected.canonicalName);
    if (detected.simpleName) this.canonicalToObf.delete(detected.simpleName);
    this.obfToCanonical.delete(detected.realClassName);

    this.classPool.delete(detected.realClassName);
    this.classPool.delete(detected.canonicalName);
    if (detected.simpleName) this.classPool.delete(detected.simpleName);
    return true;
  }

  getDetected(name: string): DetectedClassInfo | undefined {
    if (!name) return undefined;
    return this.classPool.get(name);
  }

  getAllDetected(): DetectedClassInfo[] {
    const unique = new Set<DetectedClassInfo>(this.classPool.values());
    return Array.from(unique);
  }

  resolveClass(name: string): string | null {
    if (!name) return null;
    if (this.canonicalToObf.has(name)) {
      const target = this.canonicalToObf.get(name)!;
      if (target !== name && this.canonicalToObf.has(target)) {
        return this.resolveClass(target);
      }
      return target;
    }
    if (this.obfToCanonical.has(name)) {
      return name;
    }

    // Chained resolution: check attached databases for simpleName -> canonical -> obf
    for (const db of this.databases) {
      const schema = db.getClass(name);
      if (schema) {
        const target = schema.obf || schema.canonical;
        if (target && target !== name) {
          const resolved = this.resolveClass(target);
          if (resolved) return resolved;
          return target;
        }
        if (schema.obf) return schema.obf;
        if (schema.canonical) return schema.canonical;
      }
    }

    return null;
  }

  getCanonicalClass(obfName: string): string | null {
    if (!obfName) return null;
    if (this.obfToCanonical.has(obfName)) {
      return this.obfToCanonical.get(obfName)!;
    }
    for (const db of this.databases) {
      const schema = db.getClass(obfName);
      if (schema?.canonical) {
        return schema.canonical;
      }
    }
    return null;
  }

  getObfClass(canonicalName: string): string | null {
    if (!canonicalName) return null;
    return this.resolveClass(canonicalName);
  }

  resolveField(classKey: string, fieldName: string): string | null {
    const detected = this.getDetected(classKey);
    if (detected?.fields && fieldName in detected.fields) {
      return detected.fields[fieldName] ?? null;
    }
    const resolved = this.resolveClass(classKey);
    if (resolved && resolved !== classKey) {
      const resDetected = this.getDetected(resolved);
      if (resDetected?.fields && fieldName in resDetected.fields) {
        return resDetected.fields[fieldName] ?? null;
      }
    }
    return null;
  }

  resolveMethod(classKey: string, methodName: string): string | null {
    const detected = this.getDetected(classKey);
    if (detected?.methods && methodName in detected.methods) {
      return detected.methods[methodName] ?? null;
    }
    const resolved = this.resolveClass(classKey);
    if (resolved && resolved !== classKey) {
      const resDetected = this.getDetected(resolved);
      if (resDetected?.methods && methodName in resDetected.methods) {
        return resDetected.methods[methodName] ?? null;
      }
    }
    return null;
  }

  getCanonicalField(classKey: string, obfField: string): string | null {
    const detected = this.getDetected(classKey);
    if (detected?.fields) {
      for (const [canon, obf] of Object.entries(detected.fields)) {
        if (obf === obfField) return canon;
      }
    }
    const resolved = this.resolveClass(classKey);
    if (resolved && resolved !== classKey) {
      const resDetected = this.getDetected(resolved);
      if (resDetected?.fields) {
        for (const [canon, obf] of Object.entries(resDetected.fields)) {
          if (obf === obfField) return canon;
        }
      }
    }
    return null;
  }

  getCanonicalMethod(classKey: string, obfMethod: string): string | null {
    const detected = this.getDetected(classKey);
    if (detected?.methods) {
      for (const [canon, obf] of Object.entries(detected.methods)) {
        if (obf === obfMethod) return canon;
      }
    }
    const resolved = this.resolveClass(classKey);
    if (resolved && resolved !== classKey) {
      const resDetected = this.getDetected(resolved);
      if (resDetected?.methods) {
        for (const [canon, obf] of Object.entries(resDetected.methods)) {
          if (obf === obfMethod) return canon;
        }
      }
    }
    return null;
  }

  createTypeFunction<T = any>(
    callback: TypeAccessCallback<T>,
  ): (name: string) => T {
    return (name: string): T => {
      const resolved = this.resolveClass(name);
      let detected = this.getDetected(name);
      if (!detected && resolved) {
        detected = this.getDetected(resolved);
      }

      let schema: ClassSchema | undefined = detected?.schema;
      if (!schema) {
        for (const db of this.databases) {
          schema = db.getClass(name);
          if (schema) break;
        }
      }
      if (!schema && resolved) {
        for (const db of this.databases) {
          schema = db.getClass(resolved);
          if (schema) break;
        }
      }

      const isMapped = Boolean(resolved && resolved !== name);
      const ctx: TypeAccessContext = {
        requestedName: name,
        resolvedName: resolved || name,
        isMapped,
        schema,
        detected,
        pool: this,
      };

      return callback(ctx);
    };
  }

  export(options?: Partial<ExportMappingsOptions>): MappingsJson {
    return exportMappings({
      pool: this,
      ...options,
    });
  }

  loadTiny(tinyContentOrPath: string): this {
    if (!tinyContentOrPath) return this;
    let content = tinyContentOrPath;
    if (
      typeof content === 'string' &&
      (content.includes('/') ||
        content.includes('\\') ||
        content.endsWith('.tiny') ||
        content.endsWith('.txt'))
    ) {
      if (typeof existsSync === 'function' && existsSync(content)) {
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
        simpleName: string;
        realClassName: string;
        fields: Record<string, string>;
        methods: Record<string, string>;
      }
    >();

    const getOrCreate = (fromSlash: string) => {
      const canonical = fromSlash.replace(/\//g, '.');
      let entry = classesMap.get(canonical);
      if (!entry) {
        const simple = canonical.includes('.')
          ? canonical.split('.').pop()!
          : canonical;
        entry = {
          canonicalName: canonical,
          simpleName: simple,
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
        entry.fields[fromField] = toField;
      } else if (type === 'METHOD' && parts[1] && parts[3] && parts[4]) {
        const entry = getOrCreate(parts[1]);
        const fromMethod = parts[3];
        const toMethod = parts[4];
        entry.methods[fromMethod] = toMethod;
      }
    }

    for (const entry of classesMap.values()) {
      this.registerMatch({
        canonicalName: entry.canonicalName,
        simpleName: entry.simpleName,
        realClassName: entry.realClassName,
        fields: entry.fields,
        methods: entry.methods,
        confidence: 1.0,
      });
    }

    return this;
  }

  load(mappings: MappingsJson | any): this {
    if (!mappings) return this;

    if (typeof mappings === 'string') {
      const trimmed = mappings.trim();
      if (
        trimmed.startsWith('v1\t') ||
        trimmed.includes('\tCLASS\t') ||
        trimmed.includes('\tFIELD\t') ||
        trimmed.includes('\tMETHOD\t') ||
        trimmed.endsWith('.tiny')
      ) {
        return this.loadTiny(trimmed);
      }
      try {
        const parsed = JSON.parse(trimmed);
        return this.load(parsed);
      } catch {
        return this.loadTiny(mappings);
      }
    }

    if (typeof mappings === 'object') {
      if (mappings.mappings && typeof mappings.mappings === 'string') {
        return this.loadTiny(mappings.mappings);
      }
      if (mappings.tiny && typeof mappings.tiny === 'string') {
        return this.loadTiny(mappings.tiny);
      }
    }

    const rawClasses = mappings.classes || mappings.data?.classes;
    if (!rawClasses) return this;

    for (const [canonOrKey, cData] of Object.entries<any>(rawClasses)) {
      if (typeof cData === 'string') {
        this.registerMatch({
          canonicalName: canonOrKey,
          simpleName: canonOrKey.includes('.')
            ? canonOrKey.split('.').pop()!
            : canonOrKey,
          realClassName: cData,
          fields: {},
          methods: {},
          confidence: 1.0,
        });
        continue;
      }

      if (cData?.matched === false) continue;
      const canon = cData?.canonical || canonOrKey;
      const obf = cData?.obf || canonOrKey;

      const rawFields = (cData?.fields || {}) as Record<string, any>;
      const fields: Record<string, string> = {};
      for (const [fName, fVal] of Object.entries(rawFields)) {
        if (typeof fVal === 'string') {
          fields[fName] = fVal;
        } else if (
          fVal &&
          typeof fVal === 'object' &&
          typeof fVal.obf === 'string'
        ) {
          fields[fName] = fVal.obf;
        }
      }

      const rawMethods = (cData?.methods || {}) as Record<string, any>;
      const methods: Record<string, string> = {};
      for (const [mName, mVal] of Object.entries(rawMethods)) {
        if (typeof mVal === 'string') {
          methods[mName] = mVal;
        } else if (
          mVal &&
          typeof mVal === 'object' &&
          typeof mVal.obf === 'string'
        ) {
          methods[mName] = mVal.obf;
        }
      }

      this.registerMatch({
        canonicalName: canon,
        simpleName:
          cData?.simpleName ||
          (canon.includes('.') ? canon.split('.').pop()! : canon),
        realClassName: obf,
        superclass: cData?.superclass,
        fields,
        methods,
        confidence: 1.0,
      });
    }

    return this;
  }

  clear(): void {
    this.classPool.clear();
    this.canonicalToObf.clear();
    this.obfToCanonical.clear();
  }
}

export function createPool(options?: PoolOptions): MappingPool {
  return new MappingPoolImpl(options);
}
