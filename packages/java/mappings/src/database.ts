import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type {
  ClassSchema,
  DatabaseJson,
  MappingDatabase,
  MethodSchema,
} from './types.js';

export class MappingDatabaseImpl implements MappingDatabase {
  readonly name: string;
  private canonicalMap = new Map<string, ClassSchema>();
  private simpleMap = new Map<string, ClassSchema>();

  constructor(
    name = 'default',
    initialData?: DatabaseJson | Record<string, ClassSchema>,
  ) {
    this.name = name;
    if (initialData) {
      this.load(initialData);
    }
  }

  get size(): number {
    return this.canonicalMap.size;
  }

  load(source: string | DatabaseJson | Record<string, ClassSchema>): this {
    if (!source) return this;

    let data: any = source;
    if (typeof source === 'string') {
      const trimmed = source.trim();
      if (trimmed.startsWith('{')) {
        try {
          data = JSON.parse(trimmed);
        } catch {
          return this;
        }
      } else if (existsSync(trimmed)) {
        try {
          data = JSON.parse(readFileSync(trimmed, 'utf-8'));
        } catch {
          return this;
        }
      } else {
        return this;
      }
    }

    if (data && typeof data === 'object') {
      const classesObj =
        data.classes && typeof data.classes === 'object' ? data.classes : data;
      for (const [key, rawSchema] of Object.entries(classesObj)) {
        if (rawSchema && typeof rawSchema === 'object') {
          this.addClass(rawSchema as ClassSchema, key);
        }
      }
    }

    return this;
  }

  addClass(schema: ClassSchema, keyName?: string): this {
    const s: ClassSchema = { ...schema };

    // 1. Check if this is an alias / shortcut entry (e.g. "GuiButton": { "obf": "net.minecraft.client.gui.GuiButton" })
    const isAlias = Boolean(
      s.obf &&
      keyName &&
      !keyName.includes('.') &&
      (!s.fields || Object.keys(s.fields).length === 0) &&
      (!s.methods || Object.keys(s.methods).length === 0),
    );

    if (isAlias) {
      s.simpleName = keyName;
      s.canonical = s.canonical || s.obf;
      s.canonicalName = s.canonical;
      s.canonicalClassName = s.canonical;
      this.simpleMap.set(keyName!, s);
      return this;
    }

    // 2. Resolve canonical
    const canonical =
      s.canonical ||
      s.canonicalName ||
      s.canonicalClassName ||
      (keyName && keyName.includes('.') ? keyName : undefined) ||
      (s.obf && s.obf.includes('.') ? s.obf : undefined) ||
      keyName;

    if (!canonical) {
      throw new Error(
        'ClassSchema must provide a canonical name or a valid key',
      );
    }
    s.canonical = canonical;
    s.canonicalName = canonical;
    s.canonicalClassName = canonical;

    // 3. Resolve simpleName (explicit only, no auto-guessing with split('.'))
    if (
      !s.simpleName &&
      keyName &&
      !keyName.includes('.') &&
      keyName !== canonical
    ) {
      s.simpleName = keyName;
    }

    // 4. Normalize methods paramTypes -> params
    if (s.methods && typeof s.methods === 'object') {
      const normalizedMethods: Record<string, any> = {};
      for (const [mName, mVal] of Object.entries(s.methods)) {
        if (mVal && typeof mVal === 'object') {
          const mObj = { ...mVal } as MethodSchema;
          if (mObj.paramTypes && !mObj.params) {
            mObj.params = mObj.paramTypes;
          }
          normalizedMethods[mName] = mObj;
        } else {
          normalizedMethods[mName] = mVal;
        }
      }
      s.methods = normalizedMethods;
    }

    this.canonicalMap.set(s.canonical, s);
    if (s.simpleName) {
      this.simpleMap.set(s.simpleName, s);
    }

    return this;
  }

  removeClass(canonicalOrSimpleName: string): boolean {
    const existing = this.getClass(canonicalOrSimpleName);
    if (!existing) return false;

    this.canonicalMap.delete(existing.canonical!);
    if (existing.canonicalName)
      this.canonicalMap.delete(existing.canonicalName);
    if (existing.simpleName) this.simpleMap.delete(existing.simpleName);
    return true;
  }

  getClass(canonicalOrSimpleName: string): ClassSchema | undefined {
    if (!canonicalOrSimpleName) return undefined;

    // 1. Direct canonical map
    const direct = this.canonicalMap.get(canonicalOrSimpleName);
    if (direct) return direct;

    // 2. Simple / alias map
    const fromSimple = this.simpleMap.get(canonicalOrSimpleName);
    if (fromSimple) {
      const target = fromSimple.canonical || fromSimple.obf;
      if (
        target &&
        target !== canonicalOrSimpleName &&
        this.canonicalMap.has(target)
      ) {
        const targetSchema = this.canonicalMap.get(target)!;
        return {
          ...targetSchema,
          simpleName: canonicalOrSimpleName,
          obf: fromSimple.obf || targetSchema.obf,
        };
      }
      return fromSimple;
    }

    return undefined;
  }

  has(canonicalOrSimpleName: string): boolean {
    return Boolean(this.getClass(canonicalOrSimpleName));
  }

  getAllClasses(): ClassSchema[] {
    const unique = new Set<ClassSchema>(this.canonicalMap.values());
    return Array.from(unique);
  }

  findClasses(predicate: (schema: ClassSchema) => boolean): ClassSchema[] {
    return this.getAllClasses().filter(predicate);
  }

  clone(newName?: string): MappingDatabase {
    const copy = new MappingDatabaseImpl(newName || `${this.name}_copy`);
    for (const schema of this.getAllClasses()) {
      copy.addClass(JSON.parse(JSON.stringify(schema)));
    }
    for (const [k, alias] of this.simpleMap.entries()) {
      copy.addClass(JSON.parse(JSON.stringify(alias)), k);
    }
    return copy;
  }

  merge(otherDb: MappingDatabase): this {
    for (const schema of otherDb.getAllClasses()) {
      this.addClass(schema);
    }
    return this;
  }

  toJSON(): DatabaseJson {
    const classes: Record<string, any> = {};

    // 1. Canonical classes
    for (const schema of this.getAllClasses()) {
      const obj: any = {};
      if (schema.superclass && schema.superclass !== 'Object') {
        obj.superclass = schema.superclass;
      }
      if (schema.obf && schema.obf !== schema.canonical) {
        obj.obf = schema.obf;
      }
      if (schema.fields && Object.keys(schema.fields).length > 0) {
        obj.fields = schema.fields;
      }
      if (schema.methods && Object.keys(schema.methods).length > 0) {
        obj.methods = schema.methods;
      }
      classes[schema.canonical!] = obj;
    }

    // 2. SimpleName shortcuts / aliases
    for (const [simpleName, alias] of this.simpleMap.entries()) {
      if (!classes[simpleName]) {
        classes[simpleName] = {
          obf: alias.canonical || alias.obf || simpleName,
        };
      }
    }

    return { classes };
  }
}

export function createDatabase(
  nameOrData?: string | DatabaseJson | Record<string, ClassSchema>,
  initialData?: DatabaseJson | Record<string, ClassSchema>,
): MappingDatabase {
  if (typeof nameOrData === 'object' && nameOrData !== null) {
    const db = new MappingDatabaseImpl('default');
    return db.load(nameOrData);
  }

  const name = typeof nameOrData === 'string' ? nameOrData : 'default';
  const db = new MappingDatabaseImpl(name);
  if (initialData) {
    db.load(initialData);
  }
  return db;
}

export function loadDatabase(
  source?: string | DatabaseJson | Record<string, ClassSchema>,
  targetDb?: MappingDatabase,
): MappingDatabase {
  const db = targetDb || new MappingDatabaseImpl('default');

  if (!source) {
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.DATABASE_JSON) {
        try {
          return db.load(JSON.parse(process.env.DATABASE_JSON));
        } catch {}
      }
      if (process.env.DATABASE_FILE && existsSync(process.env.DATABASE_FILE)) {
        try {
          return db.load(readFileSync(process.env.DATABASE_FILE, 'utf-8'));
        } catch {}
      }
    }

    let repoRoot = process.cwd();
    try {
      let curr = repoRoot;
      for (let i = 0; i < 6; i++) {
        if (
          existsSync(`${curr}/bunfig.toml`) &&
          (existsSync(`${curr}/bun-wine`) ||
            existsSync(`${curr}/packages`) ||
            existsSync(`${curr}/package.json`))
        ) {
          repoRoot = curr;
          break;
        }
        const lastSlash = curr.lastIndexOf('/');
        if (lastSlash <= 0) break;
        curr = curr.substring(0, lastSlash);
      }
    } catch {}

    const defaultCandidates = [
      'packages/minecraft/src/mappings/database.json',
      'packages/minecraft/dist/mappings/database.json',
      'database.json',
    ];

    for (const rel of defaultCandidates) {
      const candidatesToCheck = [rel, `${repoRoot}/${rel}`];
      for (const candidate of candidatesToCheck) {
        if (existsSync(candidate)) {
          try {
            return db.load(readFileSync(candidate, 'utf-8'));
          } catch {}
        }
      }
    }

    return db;
  }

  return db.load(source);
}

export function saveDatabaseToFile(
  filePath: string,
  db: MappingDatabase,
): void {
  writeFileSync(filePath, JSON.stringify(db.toJSON(), null, 2), 'utf-8');
}
