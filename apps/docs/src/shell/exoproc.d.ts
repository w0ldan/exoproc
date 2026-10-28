import type { ExoprocApi } from './preload/api';

/**
 * Makes `window.exoproc` the typed, ambient way renderer code reaches the
 * process below it -- the same way an application shell's preload
 * contract is declared for its renderer.
 */
declare global {
  interface Window {
    readonly exoproc: ExoprocApi;
  }
}

export {};
