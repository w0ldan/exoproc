import { createCFunction, type CFunction } from './cfunction.js';
import { type AddressLike } from './pointer.js';
import { type CTypeOrString } from './types.js';

/**
 * A {@link CFunction} whose callable redirects itself to some accessor it
 * already knows about (baked in via closure at construction time) instead of
 * using a local `BunCFunction` binding -- for a function whose real address
 * lives in a *different* process, invoking it via a local binding would be
 * invalid, so its callable does whatever cross-process dispatch is actually
 * needed instead (e.g. `(...args) => accessor.call(realFn, implicitArg,
 * ...args)`). `.ptr` is a real, already-resolved address, same as any other
 * `CFunction` -- "dummy" describes how the *callable* is wired, not the
 * address: calling the function directly (`await fn(...)`) already routes to
 * the right place, no separate `accessor.call(fn, ...)` needed.
 */
export interface DummyFunction extends CFunction {
  readonly isDummy: true;
}

/**
 * Builds a {@link DummyFunction}: a normal {@link CFunction} (real `.ptr`,
 * the same arg/cstring/pointer marshaling `createCFunction` always applies)
 * except `callable` replaces the default local `BunCFunction` binding.
 */
export function createDummyFunction(
  address: AddressLike,
  sig: [CTypeOrString, CTypeOrString[]],
  callable: CallableFunction,
  name?: string,
): DummyFunction {
  const fn = createCFunction(address, sig, callable, name) as DummyFunction;
  (fn as { isDummy: true }).isDummy = true;
  return fn;
}

export function isDummyFunction(fn: unknown): fn is DummyFunction {
  return !!fn && typeof fn === 'object' && (fn as any).isDummy === true;
}
