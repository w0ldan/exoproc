/**
 * @exoproc/njava-runtime - Built-in Definitions Registry
 */

import type { ClassRegistry } from '../registry.js';
import { JavaLangClassDef } from './class.def.js';
import { JavaLangSystemDef } from './system.def.js';

export * from './class.def.js';
export * from './system.def.js';

export function registerDefaultBuiltins(registry: ClassRegistry): void {
  registry.register(JavaLangClassDef);
  registry.register(JavaLangSystemDef);
}
