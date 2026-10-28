/**
 * Re-exporting from exoproc-jjit for backwards compatibility.
 * remapper.ts has moved to its dedicated standalone package: packages/jjit
 */
export {
  remapJava,
  remapJavaSync,
  exportToTinyV1,
  resolveTinyRemapperJarPath,
  STANDARD_CANONICAL_CLASSES,
  typeToBytecodeDescriptor,
  generateObfuscationMappings,
  obfuscateBytecode,
  obfuscateBytecodeSync,
  toAlphaIdentifier,
  DEFAULT_KEEP_METHODS,
  DEFAULT_KEEP_FIELDS,
  type JavaRemapOptions,
  type JavaRemapResult,
  type ObfuscationOptions,
} from 'exoproc-jjit/remapper';
