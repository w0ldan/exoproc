import { Buffer } from 'node:buffer';

/**
 * Minimal `node:crypto` replacement for code running in a simulated worker.
 *
 * The compiler and FFI pipeline use `randomBytes(n).toString('hex')` only to
 * create unique scratch filenames. Randomness has no simulated process state,
 * so this uses the host Web Crypto RNG and wraps the result in a `Buffer` to
 * preserve `node:crypto`'s hexadecimal string behavior.
 *
 * `node:buffer` remains host-provided because it has no process-specific
 * behavior for the simulator to replace.
 */
export function randomBytes(size: number): Buffer {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes);
}

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

const cryptoModule = { randomBytes, randomUUID };

export default cryptoModule;
