import type { Win64Process } from '../runtime/win64-machine.js';

export interface ProcessShimHandle {
  /** Restores whatever `process.pid`/`process.env` looked like before. */
  restore(): void;
}

/**
 * Overrides the ambient host's `process.pid`, `process.env`, and
 * `process.platform` so code running under simulation observes the simulated
 * Windows process's identity and environment. Without this shim, a non-Windows
 * host could select irrelevant platform branches or capture the host PID
 * instead of exercising the Win32 simulator.
 *
 * Install this before dynamically importing modules that capture
 * `process.pid` or `process.platform` during their first evaluation; a static
 * top-level import would run too early.
 *
 * Each Worker gets its own independent `globalThis`/`process` object (this
 * does not leak into the thread that spawned the Worker), so this is safe to
 * call unconditionally once per worker without needing a matching call to
 * `restore()` at worker shutdown -- `restore()` exists for hosts that reuse
 * one JS realm across multiple simulated processes (e.g. a test harness).
 */
export function installProcessShim(target: Win64Process): ProcessShimHandle {
  const pidDescriptor = Object.getOwnPropertyDescriptor(process, 'pid');
  const envDescriptor = Object.getOwnPropertyDescriptor(process, 'env');
  const platformDescriptor = Object.getOwnPropertyDescriptor(
    process,
    'platform',
  );

  const environmentProxy = new Proxy(
    Object.create(null) as Record<string, string>,
    {
      get(_target, property) {
        if (typeof property !== 'string') return undefined;
        return target.environment.get(property);
      },
      set(_target, property, value) {
        if (typeof property !== 'string') return false;
        target.environment.set(property, String(value));
        return true;
      },
      has(_target, property) {
        return (
          typeof property === 'string' &&
          target.environment.get(property) !== undefined
        );
      },
      deleteProperty(_target, property) {
        return (
          typeof property === 'string' && target.environment.delete(property)
        );
      },
      ownKeys() {
        return target.environment.entries().map(([name]) => name);
      },
      getOwnPropertyDescriptor(_target, property) {
        if (typeof property !== 'string') return undefined;
        const value = target.environment.get(property);
        if (value === undefined) return undefined;
        return { value, writable: true, enumerable: true, configurable: true };
      },
    },
  );

  Object.defineProperty(process, 'pid', {
    value: target.pid,
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(process, 'env', {
    value: environmentProxy,
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(process, 'platform', {
    value: 'win32',
    configurable: true,
    enumerable: true,
  });

  return {
    restore() {
      if (pidDescriptor) Object.defineProperty(process, 'pid', pidDescriptor);
      if (envDescriptor) Object.defineProperty(process, 'env', envDescriptor);
      if (platformDescriptor) {
        Object.defineProperty(process, 'platform', platformDescriptor);
      }
    },
  };
}
