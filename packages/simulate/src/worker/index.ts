/**
 * Browser-Worker-safe simulator surface: standard runtime shims, process
 * lifecycle helpers, and the compact C/FFI implementation. `./bundler.ts`
 * remains build-time tooling and is intentionally not re-exported here.
 */
export * from './node-fs-shim.js';
export * from './node-os-shim.js';
export * from './node-crypto-shim.js';

export * from './process-shim.js';
export * from './lifecycle.js';
export * from './enter-simulated-process.js';
export * from './resolver-source.js';
// `cc` itself comes from `bun-ffi-module.js` below (the actual `bun:ffi`
// alias target) -- re-exported here by name only to avoid an ambiguous
// duplicate `cc` export between the two modules.
export type {
  WorkerCCFunctionDefinition,
  WorkerCCOptions,
  WorkerCCLibrary,
} from './cc-shim.js';
export * from './bun-ffi-module.js';
