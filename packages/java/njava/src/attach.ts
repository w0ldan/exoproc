import {
  HostAccessor,
  isMiddlewareAccessor,
  type ISyncCallableMemoryAccessor,
} from 'bun-xffi';
import { NJavaAccessor } from './njava-accessor.js';
import { NJavaError } from './errors.js';
import type { ReflectionBridge, ReflectedClass } from './reflection-bridge.js';
import { SyncJavaContext, AsyncJavaContext } from './proxy.js';

/**
 * Splices `NJavaAccessor` into `host`'s middleware chain as its immediate backend,
 * initializes JVM/JNI vtable discovery, and returns the `NJavaAccessor`.
 *
 * `host.backend` is updated in-place to point to `njava`.
 */
export async function attachNJava(host: HostAccessor): Promise<NJavaAccessor> {
  const currentBackend = host.backend;
  const njava = new NJavaAccessor(currentBackend, host.processId, host);
  host.backend = njava;
  try {
    await njava.init();
    return njava;
  } catch (err) {
    host.backend = currentBackend;
    throw err;
  }
}

/**
 * Synchronous variant of {@link attachNJava}.
 */
export function attachNJavaSync(host: HostAccessor): NJavaAccessor {
  const currentBackend = host.backend;
  const njava = new NJavaAccessor(currentBackend, host.processId, host);
  host.backend = njava;
  try {
    njava.initSync();
    return njava;
  } catch (err) {
    host.backend = currentBackend;
    throw err;
  }
}

/**
 * Directly attaches `NJavaAccessor` using a known `JNIEnv*` pointer
 * (e.g. from an NHook intercept), discovering JavaVM via GetJavaVM on the
 * native vtable without calling JNI_GetCreatedJavaVMs.
 */
export async function attachNJavaByEnv(
  host: HostAccessor,
  envPtr: bigint,
): Promise<NJavaAccessor> {
  const currentBackend = host.backend;
  const njava = new NJavaAccessor(currentBackend, host.processId, host);
  host.backend = njava;
  try {
    await njava.initByEnv(envPtr);
    return njava;
  } catch (err) {
    host.backend = currentBackend;
    throw err;
  }
}

/**
 * Synchronous variant of {@link attachNJavaByEnv}.
 */
export function attachNJavaByEnvSync(
  host: HostAccessor,
  envPtr: bigint,
): NJavaAccessor {
  const currentBackend = host.backend;
  const njava = new NJavaAccessor(currentBackend, host.processId, host);
  host.backend = njava;
  try {
    njava.initByEnvSync(envPtr);
    return njava;
  } catch (err) {
    host.backend = currentBackend;
    throw err;
  }
}

/**
 * Traverses an accessor's backend chain to find an attached {@link NJavaAccessor}.
 */
export function findNJava(
  accessor: ISyncCallableMemoryAccessor,
): NJavaAccessor | undefined {
  let curr: unknown = accessor;
  while (curr && typeof curr === 'object') {
    if (
      curr instanceof NJavaAccessor ||
      (curr as { isNJava?: boolean }).isNJava
    ) {
      return curr as NJavaAccessor;
    }
    if (isMiddlewareAccessor(curr)) {
      curr = curr.backend;
    } else {
      break;
    }
  }
  return undefined;
}

/**
 * Returns the attached {@link NJavaAccessor} on `accessor`, throwing if not found.
 */
export function getNJava(accessor: ISyncCallableMemoryAccessor): NJavaAccessor {
  const njava = findNJava(accessor);
  if (!njava) {
    throw new NJavaError(
      'getNJava: no NJavaAccessor found in accessor middleware chain',
    );
  }
  return njava;
}

/**
 * Directly retrieves the {@link ReflectionBridge} on `accessor`, throwing if njava is not found.
 */
export async function getReflection(
  accessor: ISyncCallableMemoryAccessor,
): Promise<ReflectionBridge> {
  return await getNJava(accessor).getReflection();
}

/**
 * Sync twin of {@link getReflection}.
 */
export function getReflectionSync(
  accessor: ISyncCallableMemoryAccessor,
): ReflectionBridge {
  return getNJava(accessor).getReflectionSync();
}

/**
 * Finds the {@link ReflectionBridge} on `accessor` if attached, or returns `undefined`.
 */
export async function findReflection(
  accessor: ISyncCallableMemoryAccessor,
): Promise<ReflectionBridge | undefined> {
  const njava = findNJava(accessor);
  return njava ? await njava.getReflection() : undefined;
}

/**
 * Sync twin of {@link findReflection}.
 */
export function findReflectionSync(
  accessor: ISyncCallableMemoryAccessor,
): ReflectionBridge | undefined {
  const njava = findNJava(accessor);
  return njava ? njava.getReflectionSync() : undefined;
}

/**
 * Directly resolves a {@link ReflectedClass} on `accessor` by name.
 */
export async function getJavaClass(
  accessor: ISyncCallableMemoryAccessor,
  className: string,
): Promise<ReflectedClass> {
  const reflection = await getReflection(accessor);
  return await reflection.getClass(className);
}

/**
 * Sync twin of {@link getJavaClass}.
 */
export function getJavaClassSync(
  accessor: ISyncCallableMemoryAccessor,
  className: string,
): ReflectedClass {
  const reflection = getReflectionSync(accessor);
  return reflection.getClassSync(className);
}

/**
 * Returns an {@link AsyncJavaContext} providing Nashorn-style `Java.type(...)` and dynamic class/object proxies asynchronously.
 */
export async function getJava(
  accessor: ISyncCallableMemoryAccessor,
): Promise<AsyncJavaContext> {
  const reflection = await getReflection(accessor);
  return new AsyncJavaContext(reflection);
}

/**
 * Sync twin of {@link getJava}, providing immediate `Java.type(...)` and dynamic object access without `await`.
 */
export function getJavaSync(
  accessor: ISyncCallableMemoryAccessor,
): SyncJavaContext {
  const reflection = getReflectionSync(accessor);
  return new SyncJavaContext(reflection);
}
