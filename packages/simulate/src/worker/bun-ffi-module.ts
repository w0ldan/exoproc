/**
 * The `bun:ffi` alias target for bundled simulated-process code. Most APIs
 * reuse the process-bound runtime implementation; `cc()` uses the worker C
 * compiler because it can read source files from the simulated filesystem and
 * load generated machine code into the active process.
 */
// Cast through `unknown` rather than intersecting with `typeof globalThis`:
// bun's own ambient `Bun` global type (a complex overloaded `hash`) would
// otherwise merge with this minimal guest shim's shape, and the shim's
// intentionally-simple `hash(value: unknown): number` doesn't -- and
// shouldn't need to -- satisfy that overload set.
const guestGlobal = globalThis as unknown as {
  Bun?: {
    hash(value: unknown): number;
    sleep(milliseconds: number): Promise<void>;
    sleepSync(milliseconds: number): void;
  };
};

if (!guestGlobal.Bun) {
  guestGlobal.Bun = {
    hash(value) {
      const text = typeof value === 'string' ? value : String(value);
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    },
    sleep(milliseconds) {
      return new Promise((resolve) =>
        setTimeout(() => resolve(), milliseconds),
      );
    },
    sleepSync(milliseconds) {
      const signal = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(signal, 0, 0, milliseconds);
    },
  };
}

export {
  FFIType,
  bindWin64Process,
  getBoundWin64Process,
  dlopen,
  CFunction,
  ptr,
  toArrayBuffer,
  read,
  CString,
  JSCallback,
  createBrowserBunFFI,
} from '../runtime/bun-ffi.js';
export type {
  Pointer,
  FFITypeOrString,
  FFIFunction,
  FFIOptions,
  FFILibrary,
} from '../runtime/bun-ffi.js';

export { cc } from './cc-shim.js';
export type { WorkerCCOptions as CCOptions } from './cc-shim.js';
