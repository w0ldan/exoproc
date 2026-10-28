/**
 * @exoproc/njava-runtime - Class Definition Registry
 * Manages modular class definitions (virtual, hybrid, native) and maps aliases.
 */

import type { JavaClassDefinition } from './types.js';

export class ClassRegistry {
  private readonly definitions = new Map<string, JavaClassDefinition>();
  private readonly aliasMap = new Map<string, string>();

  /**
   * Registers a modular class definition.
   */
  public register(def: JavaClassDefinition): this {
    this.definitions.set(def.name, def);
    if (def.aliases) {
      for (const alias of def.aliases) {
        this.aliasMap.set(alias, def.name);
        this.definitions.set(alias, def);
      }
    }
    return this;
  }

  /**
   * Unregisters a class definition.
   */
  public unregister(name: string): boolean {
    const def = this.definitions.get(name);
    if (!def) return false;
    this.definitions.delete(name);
    if (def.aliases) {
      for (const alias of def.aliases) {
        this.aliasMap.delete(alias);
        this.definitions.delete(alias);
      }
    }
    return true;
  }

  /**
   * Retrieves a class definition by canonical name or alias.
   */
  public get(name: string): JavaClassDefinition | undefined {
    return this.definitions.get(name);
  }

  /**
   * Checks if a definition exists for the given name.
   */
  public has(name: string): boolean {
    return this.definitions.has(name);
  }

  /**
   * Returns all registered definitions.
   */
  public getAll(): JavaClassDefinition[] {
    const seen = new Set<JavaClassDefinition>();
    for (const def of this.definitions.values()) {
      seen.add(def);
    }
    return Array.from(seen);
  }
}
