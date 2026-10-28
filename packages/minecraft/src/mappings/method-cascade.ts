import type { ReflectionBridge, ReflectedMethod } from 'bun-njava';
import {
  MINECRAFT_CANONICAL_SCHEMA,
  type CanonicalClassSchema,
} from './database.js';
import type { MinecraftClassKey, MinecraftMappings } from './types.js';

const JAVA_STDLIB_TYPES: Record<string, string> = {
  String: 'java.lang.String',
  List: 'java.util.List',
  Set: 'java.util.Set',
  Map: 'java.util.Map',
  Collection: 'java.util.Collection',
  UUID: 'java.util.UUID',
  File: 'java.io.File',
  Object: 'java.lang.Object',
};

export class MethodCascadeEngine {
  constructor(private readonly bridge: ReflectionBridge) {}

  private cleanTypeName(raw: string | null | undefined): string {
    if (!raw) return '';
    return raw.replace(/^(class|interface)\s+/, '').trim();
  }

  private isPrimitive(type: string): boolean {
    const primitives = new Set([
      'void',
      'int',
      'float',
      'double',
      'long',
      'boolean',
      'byte',
      'short',
      'char',
    ]);
    return primitives.has(type);
  }

  private isStdLib(type: string): boolean {
    return type in JAVA_STDLIB_TYPES;
  }

  private matchesType(
    candType: string | null | undefined,
    expType: string,
    mappings: Partial<MinecraftMappings>,
  ): boolean {
    const cand = this.cleanTypeName(candType);

    if (expType === 'void') {
      return cand === 'void';
    }

    if (this.isPrimitive(expType)) {
      return cand === expType || cand.endsWith(`.${expType}`);
    }

    if (this.isStdLib(expType)) {
      const fullJava = JAVA_STDLIB_TYPES[expType]!;
      return (
        cand === expType || cand === fullJava || cand.endsWith(`.${expType}`)
      );
    }

    // Array types
    if (expType.endsWith('[]')) {
      const baseExp = expType.slice(0, -2) as MinecraftClassKey;
      if (mappings[baseExp]?.realClassName) {
        const mappedReal = mappings[baseExp]!.realClassName;
        return cand === `${mappedReal}[]` || cand === `[L${mappedReal};`;
      }
      return cand.endsWith('[]') || cand.startsWith('[');
    }

    // Minecraft Class (Object)
    if (this.isPrimitive(cand) || cand.startsWith('java.')) {
      return false;
    }

    if (mappings[expType as MinecraftClassKey]?.realClassName) {
      return cand === mappings[expType as MinecraftClassKey]!.realClassName;
    }

    return true;
  }

  /**
   * Matches method signatures and cascades newly discovered classes through parameter and return types.
   * Employs candidate consumption tracking to prevent identical signatures from colliding.
   */
  public async matchAndCascade(
    mappings: Partial<MinecraftMappings>,
  ): Promise<void> {
    const methodCache = new Map<string, ReflectedMethod[]>();
    const consumedMethodsByClass = new Map<string, Set<string>>();

    for (;;) {
      let newlyDiscovered = 0;

      for (const [k, s] of Object.entries(MINECRAFT_CANONICAL_SCHEMA)) {
        const key = k as MinecraftClassKey;
        const schema = s as CanonicalClassSchema;
        const mapping = mappings[key];
        if (!mapping || !mapping.realClassName || !schema.methods) continue;

        let consumed = consumedMethodsByClass.get(mapping.realClassName);
        if (!consumed) {
          consumed = new Set<string>();
          consumedMethodsByClass.set(mapping.realClassName, consumed);
        }

        try {
          let allMethods = methodCache.get(mapping.realClassName);
          if (!allMethods) {
            const reflectedCls = await this.bridge.getClass(
              mapping.realClassName,
            );
            const rawMethods =
              typeof reflectedCls?.getDeclaredMethods === 'function'
                ? await reflectedCls.getDeclaredMethods()
                : typeof (reflectedCls as any)?.getAllMethods === 'function'
                  ? await (reflectedCls as any).getAllMethods()
                  : [];
            allMethods = (rawMethods ?? []) as ReflectedMethod[];
            methodCache.set(mapping.realClassName, allMethods);
          }

          const OBJECT_METHODS = new Set([
            'equals',
            'hashCode',
            'toString',
            'wait',
            'notify',
            'notifyAll',
            'getClass',
          ]);

          for (const [methodName, methodSchema] of Object.entries(
            schema.methods,
          )) {
            if (mapping.methods[methodName]) {
              consumed.add(mapping.methods[methodName]!);
              continue;
            }

            const expParams = methodSchema.params ?? [];
            const expReturn = methodSchema.returnType ?? 'void';

            // Filter available candidates matching arity
            const candidates = allMethods.filter(
              (m) =>
                m.paramTypes.length === expParams.length &&
                !OBJECT_METHODS.has(m.name) &&
                !consumed!.has(m.name),
            );

            for (const cand of candidates) {
              let isMatch = true;

              // Validate return type
              if (!this.matchesType(cand.returnType, expReturn, mappings)) {
                isMatch = false;
              }

              if (!isMatch) continue;

              // Validate parameter types
              for (let i = 0; i < expParams.length; i++) {
                if (
                  !this.matchesType(
                    cand.paramTypes[i]!,
                    expParams[i]!,
                    mappings,
                  )
                ) {
                  isMatch = false;
                  break;
                }
              }

              if (isMatch) {
                mapping.methods[methodName] = cand.name;
                consumed.add(cand.name);

                // Cascade parameter types to discover unknown classes
                for (let i = 0; i < expParams.length; i++) {
                  const expP = expParams[i]!;
                  const candP = this.cleanTypeName(cand.paramTypes[i]!);
                  if (
                    !this.isPrimitive(expP) &&
                    !this.isStdLib(expP) &&
                    !candP.startsWith('java.') &&
                    !candP.endsWith('[]') &&
                    !candP.startsWith('[')
                  ) {
                    const targetKey = expP as MinecraftClassKey;
                    if (
                      MINECRAFT_CANONICAL_SCHEMA[targetKey] &&
                      !mappings[targetKey]?.realClassName
                    ) {
                      mappings[targetKey] = {
                        realClassName: candP,
                        fields: {},
                        methods: {},
                      };
                      newlyDiscovered++;
                    }
                  }
                }

                // Cascade return type to discover unknown classes
                if (
                  expReturn !== 'void' &&
                  !this.isPrimitive(expReturn) &&
                  !this.isStdLib(expReturn)
                ) {
                  const candRet = this.cleanTypeName(cand.returnType);
                  if (
                    !candRet.startsWith('java.') &&
                    !candRet.endsWith('[]') &&
                    !candRet.startsWith('[')
                  ) {
                    const targetKey = expReturn as MinecraftClassKey;
                    if (
                      MINECRAFT_CANONICAL_SCHEMA[targetKey] &&
                      !mappings[targetKey]?.realClassName
                    ) {
                      mappings[targetKey] = {
                        realClassName: candRet,
                        fields: {},
                        methods: {},
                      };
                      newlyDiscovered++;
                    }
                  }
                }
                break;
              }
            }
          }
        } catch {}
      }

      if (newlyDiscovered === 0) break;
    }
  }
}
