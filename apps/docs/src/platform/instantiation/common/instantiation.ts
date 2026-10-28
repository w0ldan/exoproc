/**
 * Analogue of VS Code's `vs/platform/instantiation/common/instantiation.ts`.
 * Real VS Code resolves services via constructor injection
 * (`IInstantiationService.createInstance()`, decorators on constructor
 * parameters) -- there is no equivalent for React function components, so
 * the shape here is: a `ServiceIdentifier<T>` is a branded string key
 * (`createDecorator`), `ServiceCollection` holds the resolved instances,
 * and `useService(id)` (in `../browser/instantiationService.tsx`) is the
 * function-component analogue of a constructor-injected parameter.
 */
export interface ServiceIdentifier<T> {
  readonly serviceId: string;
  /** Phantom field only -- never assigned, purely for `T` inference at call sites. */
  readonly _serviceBrand: T;
}

const registry = new Map<string, ServiceIdentifier<unknown>>();

/**
 * Returns the identifier for `id`, creating it on first use.
 *
 * Memoized by `id` rather than throwing on a repeat call -- real VS
 * Code's own `createDecorator` does the same. It matters here for a
 * reason VS Code doesn't have to deal with: under Turbopack's Fast
 * Refresh, hot-reloading a module that calls `createDecorator(...)` at
 * top level (every `I*Service.ts` does) re-runs that call against this
 * same still-alive `registry`. Throwing on the second call turned every
 * such reload into `Error: Service identifier "..." is already
 * registered.` -- returning the cached identifier makes a reload a
 * no-op here instead, which is what it should be.
 */
export function createDecorator<T>(id: string): ServiceIdentifier<T> {
  const existing = registry.get(id);
  if (existing) return existing as ServiceIdentifier<T>;
  const identifier: ServiceIdentifier<T> = {
    serviceId: id,
  } as ServiceIdentifier<T>;
  registry.set(id, identifier);
  return identifier;
}

/** Thin typed wrapper over the resolved service instances, keyed by identifier. */
export class ServiceCollection {
  private readonly instances = new Map<string, unknown>();

  public set<T>(id: ServiceIdentifier<T>, instance: T): void {
    this.instances.set(id.serviceId, instance);
  }

  public has(id: ServiceIdentifier<unknown>): boolean {
    return this.instances.has(id.serviceId);
  }

  public get<T>(id: ServiceIdentifier<T>): T | undefined {
    return this.instances.get(id.serviceId) as T | undefined;
  }
}
