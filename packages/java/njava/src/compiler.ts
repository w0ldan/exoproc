/**
 * Re-exporting from exoproc-jjit for backwards compatibility.
 * compiler.ts has moved to its dedicated standalone package: packages/jjit
 */
export {
  compileJava,
  compileJavaSync,
  detectJavaVersion,
  detectJavaVersionSync,
  parseJavaVersion,
  extractClassInfo,
  resolveEcjJarPath,
  resolveDefaultJavaPath,
  collectClassFilesSync,
  type JavaCompileOptions,
  type JavaCompileResult,
} from 'exoproc-jjit';
