import { JSCallback, type FFITypeOrString, type Pointer } from 'bun:ffi';
import { mapToBunFFIType } from './types.js';
import type { IFunction } from './cfunction.js';

/**
 * Signature descriptor for a C-callable JS callback.
 * Identical shape to IFunction so it composes naturally with cimport/cjitopen.
 */
export type CCallbackSignature = Pick<IFunction, 'args' | 'returns'>;

/**
 * A JS function exposed to native C code as a function pointer.
 *
 * Wraps Bun's JSCallback with the xffi CTypeOrString type system,
 * so you never have to touch raw FFIType strings or import from bun:ffi.
 *
 * @example
 * const cb = ccallback(
 *   (key: number) => { if (key === 27) process.exit(0); },
 *   { args: [CType.u8], returns: CType.void }
 * );
 * glutKeyboardFunc(cb.ptr);
 * // later…
 * cb.close();
 */
export interface CCallback {
  /** Raw C function pointer — pass this to any native function that accepts a callback. */
  readonly ptr: Pointer;
  /** Release the underlying JSCallback and free native resources. */
  close(): void;
}

/**
 * Creates a CCallback — a JS function exposed to native C code as a typed function pointer.
 *
 * @param fn       The JavaScript function to expose. Receives native arguments, returns a native value.
 * @param sig      Signature using CTypeOrString (same as cimport / cjitopen).
 * @returns        A CCallback with a `.ptr` for passing to native code and a `.close()` for cleanup.
 */
export function ccallback(
  fn: (...args: any[]) => any,
  sig: CCallbackSignature,
): CCallback {
  const args = (sig.args || []).map(mapToBunFFIType) as FFITypeOrString[];
  const returns = mapToBunFFIType(sig.returns || 'void') as FFITypeOrString;

  const inner = new JSCallback(fn, { args, returns });

  return {
    get ptr() {
      return inner.ptr as Pointer;
    },
    close() {
      inner.close();
    },
  };
}
