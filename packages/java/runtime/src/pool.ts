/**
 * @exoproc/njava-runtime - Runtime Class Pool
 * Guarantees singleton identity preservation across canonical, obfuscated, and alias names.
 */

import type { MappingPool } from 'exoproc-mappings';
import type { IJavaBridge, IRuntimeExecutionContext } from './types.js';
import type { ClassRegistry } from './registry.js';
import { RuntimeClass } from './class-model.js';

export class RuntimeClassPool {
  private readonly classes = new Map<string, RuntimeClass>();

  constructor(
    public readonly mappingPool: MappingPool,
    public readonly registry: ClassRegistry,
    public readonly bridge?: IJavaBridge,
  ) {}

  /**
   * Retrieves or creates a singleton `RuntimeClass` instance for the given class name.
   * Resolves canonical names, obfuscated names, and aliases into the exact same instance.
   */
  public getClass(
    name: string,
    context: IRuntimeExecutionContext,
  ): RuntimeClass {
    // 1. Direct hit in cache for this exact requested name
    const directHit = this.classes.get(name);
    if (directHit) return directHit;

    // 2. Resolve canonical name
    const def = this.registry.get(name);
    let canonicalName = def?.name;
    if (!canonicalName) {
      canonicalName = this.mappingPool.getCanonicalClass(name) ?? undefined;
    }
    if (!canonicalName) {
      const obf = this.mappingPool.resolveClass(name);
      if (obf) {
        canonicalName =
          this.mappingPool.getCanonicalClass(obf) ??
          (obf !== name ? obf : undefined);
      }
    }
    if (!canonicalName) {
      canonicalName = name;
    }
    const obfName =
      this.mappingPool.resolveClass(canonicalName) || canonicalName;

    // 3. Find or create the canonical core class
    let core = this.classes.get(canonicalName);
    if (!core) {
      core = new RuntimeClass({
        name: canonicalName,
        canonicalName,
        requestedName: canonicalName,
        obfName,
        mode: def?.mode ?? 'native',
        definition: def,
        bridge: this.bridge,
        context,
      });
      this.classes.set(canonicalName, core);
    }

    // If requested by canonical name, return the core class directly
    if (name === canonicalName) {
      return core;
    }

    // 4. Create a specific view instance for the requested name
    const view = new RuntimeClass({
      name: canonicalName,
      canonicalName: core.canonicalName,
      requestedName: name,
      obfName: core.obfName,
      mode: core.mode,
      definition: core.definition,
      bridge: this.bridge,
      classObj: core.classObj,
      context,
    });

    this.classes.set(name, view);
    return view;
  }

  /**
   * Returns true if the class has already been instantiated in this pool.
   */
  public has(name: string): boolean {
    return (
      this.classes.has(name) ||
      Boolean(
        this.mappingPool.resolveClass(name) &&
        this.classes.has(this.mappingPool.resolveClass(name)!),
      )
    );
  }

  /**
   * Returns all instantiated classes in the pool.
   */
  public getAll(): RuntimeClass[] {
    const unique = new Set<RuntimeClass>();
    for (const c of this.classes.values()) {
      unique.add(c);
    }
    return Array.from(unique);
  }

  /**
   * Clears all cached class instances from the pool.
   */
  public clear(): void {
    this.classes.clear();
  }
}
