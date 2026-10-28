import type { ExoprocApi } from './api';

/**
 * Publishes the API onto `window` and nothing else. Keeping this a
 * separate step from building the API is what makes the boundary
 * inspectable: exactly one assignment, in one file, is how renderer code
 * gains access to the process below it.
 */
export function exposeBridge(api: ExoprocApi): void {
  Object.defineProperty(window, 'exoproc', {
    value: Object.freeze(api),
    configurable: true,
    enumerable: false,
    writable: false,
  });
}

export function isBridgeExposed(): boolean {
  return typeof window !== 'undefined' && 'exoproc' in window;
}
