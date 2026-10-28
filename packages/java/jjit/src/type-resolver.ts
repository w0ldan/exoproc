import { type MappingPool, isPrimitiveType } from 'exoproc-mappings';

const JAVA_LANG_CLASSES = new Set<string>([
  'Object',
  'String',
  'Runnable',
  'Thread',
  'System',
  'Math',
  'Throwable',
  'Exception',
  'RuntimeException',
  'Error',
  'Class',
  'Integer',
  'Long',
  'Boolean',
  'Double',
  'Float',
  'Byte',
  'Short',
  'Character',
  'CharSequence',
  'StringBuilder',
  'StringBuffer',
  'Iterable',
  'Comparable',
  'AutoCloseable',
  'Cloneable',
  'Number',
  'Void',
  'Enum',
]);

const STANDARD_UTIL_CLASSES: Record<string, string> = {
  List: 'java.util.List',
  ArrayList: 'java.util.ArrayList',
  Map: 'java.util.Map',
  HashMap: 'java.util.HashMap',
  Set: 'java.util.Set',
  HashSet: 'java.util.HashSet',
  Collection: 'java.util.Collection',
  Collections: 'java.util.Collections',
  Arrays: 'java.util.Arrays',
  Iterator: 'java.util.Iterator',
  Callable: 'java.util.concurrent.Callable',
  Future: 'java.util.concurrent.Future',
};

export interface ResolvedType {
  /** The code-safe type representation to be rendered in the method/field signature (e.g. "GuiButton") */
  codeType: string;
  /** Fully qualified class name if applicable (e.g. "net.minecraft.client.gui.GuiButton") */
  fqcn?: string;
  /** Package name if resolved */
  packageName?: string;
  /** Simple class name */
  simpleName: string;
  /** True if this type is primitive (e.g. int, boolean, void) */
  isPrimitive: boolean;
  /** True if this type requires an explicit import statement */
  requiresImport: boolean;
}

/**
 * Intelligent Type Resolver for Java source generation.
 * Connects directly to an optional MappingPool to automatically discover
 * canonical Minecraft classes and generate explicit Java import statements.
 */
export class JavaTypeResolver {
  private readonly imports = new Set<string>();

  constructor(public readonly pool?: MappingPool) {}

  /**
   * Adds an explicit import.
   */
  public addImport(fqcn: string): void {
    const isDirectJavaLang =
      fqcn.startsWith('java.lang.') && fqcn.indexOf('.', 10) === -1;
    if (fqcn && !isDirectJavaLang) {
      this.imports.add(fqcn);
    }
  }

  /**
   * Returns all collected imports sorted alphabetically.
   */
  public getImports(): string[] {
    return Array.from(this.imports).sort();
  }

  /**
   * Clears collected imports.
   */
  public clearImports(): void {
    this.imports.clear();
  }

  /**
   * Resolves a raw type string (e.g. "GuiScreen", "Object", "int", "List<GuiButton>")
   * registering any necessary import and returning the resolved type details.
   */
  public resolve(rawType: string): ResolvedType {
    const trimmed = rawType.trim();

    // 1. Array check: e.g. "GuiButton[]", "int[]"
    if (trimmed.endsWith('[]')) {
      const baseType = trimmed.slice(0, -2);
      const resolvedBase = this.resolve(baseType);
      return {
        codeType: `${resolvedBase.codeType}[]`,
        fqcn: resolvedBase.fqcn ? `${resolvedBase.fqcn}[]` : undefined,
        packageName: resolvedBase.packageName,
        simpleName: `${resolvedBase.simpleName}[]`,
        isPrimitive: false,
        requiresImport: false, // Base type resolution already handled import
      };
    }

    // 2. Generic check: e.g. "List<GuiButton>"
    const genericMatch = trimmed.match(/^([a-zA-Z0-9_.$]+)<(.+)>$/);
    if (genericMatch && genericMatch[1] && genericMatch[2]) {
      const containerType = this.resolve(genericMatch[1]);
      const rawArgs = splitGenericArgs(genericMatch[2]);
      const typeArgs = rawArgs.map((s) => this.resolve(s.trim()));
      const innerCode = typeArgs.map((t) => t.codeType).join(', ');
      return {
        codeType: `${containerType.codeType}<${innerCode}>`,
        fqcn: containerType.fqcn,
        packageName: containerType.packageName,
        simpleName: `${containerType.simpleName}<${innerCode}>`,
        isPrimitive: false,
        requiresImport: false,
      };
    }

    // 3. Primitive types (int, long, void, etc.)
    if (isPrimitiveType(trimmed)) {
      return {
        codeType: trimmed,
        simpleName: trimmed,
        isPrimitive: true,
        requiresImport: false,
      };
    }

    // 4. java.lang.* standard types (Object, String, Runnable, etc.)
    if (JAVA_LANG_CLASSES.has(trimmed)) {
      return {
        codeType: trimmed,
        fqcn: `java.lang.${trimmed}`,
        packageName: 'java.lang',
        simpleName: trimmed,
        isPrimitive: false,
        requiresImport: false, // Implicitly imported in Java
      };
    }

    // 5. java.util.* standard types (List, Map, ArrayList, etc.)
    if (STANDARD_UTIL_CLASSES[trimmed]) {
      const fqcn = STANDARD_UTIL_CLASSES[trimmed]!;
      this.imports.add(fqcn);
      return {
        codeType: trimmed,
        fqcn,
        packageName: 'java.util',
        simpleName: trimmed,
        isPrimitive: false,
        requiresImport: true,
      };
    }

    // 6. Fully Qualified Class Name provided (contains dot)
    if (trimmed.includes('.')) {
      const lastDot = trimmed.lastIndexOf('.');
      const pkg = trimmed.slice(0, lastDot);
      const simpleName = trimmed.slice(lastDot + 1);

      if (!pkg.startsWith('java.lang')) {
        this.imports.add(trimmed);
      }

      return {
        codeType: simpleName,
        fqcn: trimmed,
        packageName: pkg,
        simpleName,
        isPrimitive: false,
        requiresImport: !pkg.startsWith('java.lang'),
      };
    }

    // 7. Check MappingPool for canonical Minecraft class matching simpleName
    if (this.pool) {
      // 7a. Check detected runtime classes in pool
      const detected = this.pool.getDetected(trimmed);
      if (detected && detected.canonicalName) {
        const fqcn = detected.canonicalName;
        const lastDot = fqcn.lastIndexOf('.');
        const pkg = lastDot !== -1 ? fqcn.slice(0, lastDot) : undefined;
        const simple = lastDot !== -1 ? fqcn.slice(lastDot + 1) : fqcn;

        this.imports.add(fqcn);
        return {
          codeType: simple,
          fqcn,
          packageName: pkg,
          simpleName: simple,
          isPrimitive: false,
          requiresImport: true,
        };
      }

      // 7b. Check database schemas in pool
      const poolAny = this.pool as any;
      if (typeof poolAny.findClassSchema === 'function') {
        const schema = poolAny.findClassSchema(trimmed);
        if (schema) {
          const fqcn =
            schema.canonical ??
            schema.canonicalName ??
            schema.canonicalClassName;
          if (fqcn) {
            const lastDot = fqcn.lastIndexOf('.');
            const pkg = lastDot !== -1 ? fqcn.slice(0, lastDot) : undefined;
            const simple =
              schema.simpleName ??
              (lastDot !== -1 ? fqcn.slice(lastDot + 1) : fqcn);

            this.imports.add(fqcn);
            return {
              codeType: simple,
              fqcn,
              packageName: pkg,
              simpleName: simple,
              isPrimitive: false,
              requiresImport: true,
            };
          }
        }
      }

      // 7c. Check canonicalToObf map in pool
      if (typeof poolAny.resolveCanonicalName === 'function') {
        const canonical = poolAny.resolveCanonicalName(trimmed);
        if (canonical && canonical !== trimmed && canonical.includes('.')) {
          const lastDot = canonical.lastIndexOf('.');
          const pkg = canonical.slice(0, lastDot);
          const simple = canonical.slice(lastDot + 1);

          this.imports.add(canonical);
          return {
            codeType: simple,
            fqcn: canonical,
            packageName: pkg,
            simpleName: simple,
            isPrimitive: false,
            requiresImport: true,
          };
        }
      }
    }

    // 8. Fallback: Unknown simple class name
    // Render as-is (e.g. defined in same package or default namespace)
    return {
      codeType: trimmed,
      simpleName: trimmed,
      isPrimitive: false,
      requiresImport: false,
    };
  }
}

function splitGenericArgs(raw: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '<') depth++;
    else if (ch === '>') depth--;
    else if (ch === ',' && depth === 0) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}
