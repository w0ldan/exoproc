import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  openSync,
  closeSync,
  statSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { type AddressLike, NativeMemory } from './pointer.js';
import { AbstractSyncMemoryAccessor } from './accessor.js';
import * as debug from './debug-helper.js';
import { type ISyncCallableMemoryAccessor } from './iaccessor.js';
import { type CFunction } from './cfunction.js';
import { type CMachineCode } from './cmachinecode.js';
import { type CCallResult } from './types.js';
import { type Pattern } from './win/scanner.js';
import { getActiveContext, executeInCall } from './runner-context.js';

function runInCall<T>(fn: () => T): T {
  const ctx = getActiveContext();
  if (ctx && !ctx.inCall) {
    return executeInCall(ctx, fn);
  }
  return fn();
}

/**
 * Minimal surface `MiddlewareAccessor`/`InittableMiddlewareAccessor` (and
 * `DebugMemoryAccessor`) need from a `root` accessor. `HostAccessor` itself
 * lives here too (below); the rest of its family that's specific to the
 * default indirect-call chain (`RedirectorHostAccessor`,
 * `BootstrapHostAccessor`, `RaceHostAccessor`, etc.) lives in
 * `exoproc-accessors` instead, extending `HostAccessor` across the package
 * boundary. This interface still exists as the structural contract `root`
 * is typed against everywhere in this file, independent of which concrete
 * subclass is actually passed in.
 */
export interface IHostAccessor extends ISyncCallableMemoryAccessor {
  close(): void;
  /**
   * Called by every `MiddlewareAccessor`'s constructor with itself as `this`
   * host is its `root` -- a no-op for ordinary hosts, but lets a host that
   * cares (e.g. a class that races several candidates for whichever
   * initializes first) discover its whole subtree automatically, just by
   * being passed as `root` when those candidates are built, instead of every
   * caller having to separately register each one by hand.
   */
  registerChild(child: IMiddlewareAccessor): void;
}

/**
 * Structural counterpart to `MiddlewareAccessor`, used instead of
 * `instanceof MiddlewareAccessor` for chain-walking (`initNext`, the
 * `backend`-chain pid lookup, etc.). `instanceof` compares against a
 * *specific loaded copy* of the `MiddlewareAccessor` class -- when a chain
 * crosses a package boundary (e.g. `nthread`'s `NThread` and `accessors`'s
 * `MemsetWriteAccessor` each resolve their own `bun-xffi` via their own
 * `node_modules` symlink), Bun-under-Wine has been observed to load two
 * separate copies of `bun-xffi` even though both symlinks resolve to the
 * same canonical directory -- so an instance built from one copy silently
 * fails `instanceof` against the other copy's class, despite being
 * structurally identical. Checking for the shape instead of the class
 * reference sidesteps the whole problem.
 */
export interface IMiddlewareAccessor extends ISyncCallableMemoryAccessor {
  backend: ISyncCallableMemoryAccessor;
  readonly root: IHostAccessor;
}

export function isMiddlewareAccessor(obj: unknown): obj is IMiddlewareAccessor {
  return (
    !!obj &&
    typeof obj === 'object' &&
    'backend' in obj &&
    'root' in obj &&
    typeof (obj as { call?: unknown }).call === 'function' &&
    typeof (obj as { read?: unknown }).read === 'function'
  );
}

/** Structural counterpart to `InittableMiddlewareAccessor` -- see {@link IMiddlewareAccessor} for why this exists instead of `instanceof`. */
export interface IInittableAccessor extends IMiddlewareAccessor {
  readonly isInitializing: boolean;
  readonly isInitializingSync: boolean;
  init(): Promise<void>;
  initSync(): void;
  deinit(): Promise<void>;
  deinitSync(): void;
}

export function isInittableAccessor(obj: unknown): obj is IInittableAccessor {
  return (
    isMiddlewareAccessor(obj) &&
    typeof (obj as { init?: unknown }).init === 'function' &&
    typeof (obj as { initSync?: unknown }).initSync === 'function' &&
    typeof (obj as { deinit?: unknown }).deinit === 'function' &&
    typeof (obj as { deinitSync?: unknown }).deinitSync === 'function'
  );
}

/**
 * Thrown when `init()` and `initSync()` are attempted concurrently on the same
 * accessor. A sync caller cannot `await` an in-flight async init -- there is
 * no way to block the JS thread on a Promise without an event-loop tick -- so
 * rather than silently letting both paths race (each running `initNext()`/
 * `onInit()` independently, double-executing side effects like suspending a
 * hijacked thread twice), whichever call notices the other is in progress
 * throws immediately instead.
 */
export class ConcurrentInitError extends Error {
  constructor(kind: 'sync-during-async' | 'async-during-sync') {
    super(
      kind === 'sync-during-async'
        ? 'initSync() called while an async init() is already in progress on this accessor -- await the async init first, or use only the sync API on this accessor.'
        : 'init() called while a sync initSync() is already in progress on this accessor -- this should be structurally unreachable (initSync() never yields), so seeing it means onInitSync() (or something it calls) itself triggered an async init().',
    );
    this.name = 'ConcurrentInitError';
  }
}

export class MiddlewareAccessor extends AbstractSyncMemoryAccessor {
  public backend: ISyncCallableMemoryAccessor;
  public readonly root: IHostAccessor;

  override get processId(): number {
    if ((this.root as any) === this) {
      return this._processId;
    }
    return this.root.processId;
  }

  constructor(backend: ISyncCallableMemoryAccessor, root: IHostAccessor) {
    let b: ISyncCallableMemoryAccessor = backend;
    while (isMiddlewareAccessor(b)) {
      b = b.backend;
    }
    const pid = b ? b.processId : backend.processId;
    super(pid);
    this.backend = backend;
    this.root = root;
    if (root) root.registerChild(this);
  }

  override enableDebug(): void {
    if (!(this.backend instanceof DebugMemoryAccessor)) {
      this.backend = new DebugMemoryAccessor(this.backend, this.root);
    }
  }

  override disableDebug(): void {
    if (this.backend instanceof DebugMemoryAccessor) {
      this.backend = this.backend.backend;
    }
  }

  override async read(
    address: AddressLike,
    size: number,
    offset = 0,
  ): Promise<Buffer> {
    return this.backend.read(address, size, offset);
  }

  override async write(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): Promise<number> {
    return this.backend.write(address, data, offset);
  }

  override async alloc(
    size: number | any,
    address: AddressLike | null = null,
    protection?: any,
    allocationType?: any,
  ): Promise<AddressLike> {
    return this.backend.alloc(size, address, protection, allocationType);
  }

  override async free(
    address: AddressLike,
    size = 0,
    freeType?: any,
  ): Promise<boolean> {
    return this.backend.free(address, size, freeType);
  }

  override async protect(
    address: AddressLike,
    size: number,
    newProtect: any,
  ): Promise<number> {
    return this.backend.protect(address, size, newProtect);
  }

  override async query(address: AddressLike): Promise<any> {
    return this.backend.query(address);
  }

  override async machineCode(machineCode: CMachineCode): Promise<number> {
    return this.backend.machineCode(machineCode);
  }

  override machineCodeSync(machineCode: CMachineCode): number {
    return this.backend.machineCodeSync(machineCode);
  }

  override async *scan(
    address: AddressLike,
    size: number,
    pattern: Pattern | string,
  ): AsyncGenerator<NativeMemory> {
    yield* this.backend.scan(address, size, pattern);
  }

  *scanSync(
    address: AddressLike,
    size: number,
    pattern: Pattern | string,
  ): Generator<NativeMemory> {
    yield* this.backend.scanSync(address, size, pattern);
  }

  readSync(address: AddressLike, size: number, offset = 0): Buffer {
    return this.backend.readSync(address, size, offset);
  }

  writeSync(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): number {
    return this.backend.writeSync(address, data, offset);
  }

  allocSync(
    size: number | any,
    address: AddressLike | null = null,
    protection?: any,
    allocationType?: any,
  ): AddressLike {
    return this.backend.allocSync(size, address, protection, allocationType);
  }

  freeSync(address: AddressLike, size = 0, freeType?: any): boolean {
    return this.backend.freeSync(address, size, freeType);
  }

  protectSync(address: AddressLike, size: number, newProtect: any): any {
    return this.backend.protectSync(address, size, newProtect);
  }

  querySync(address: AddressLike): any {
    return this.backend.querySync(address);
  }

  callSync(func: CFunction, ...args: any[]): CCallResult {
    return this.backend.callSync(func, ...args);
  }

  // Forward close if backend exposes it
  close(): void {
    if (typeof (this.backend as any).close === 'function') {
      (this.backend as any).close();
    }
  }

  // Execution delegation: forward call to backend
  async call(func: CFunction, ...args: any[]): Promise<CCallResult> {
    if (
      typeof (func as any).shouldCloneForAccessor === 'function' &&
      (func as any).shouldCloneForAccessor(this)
    ) {
      const addr = await this.machineCode(func as any);
      func = (func as any).cloneForAddress(addr);
    }
    return this.backend.call(func, ...args);
  }
}

/**
 * `isInitialized`/`isInitializing`(async)/`isInitializingSync` are mutually
 * exclusive by construction (entering one while another is active throws --
 * see `ConcurrentInitError`), so instead of three independently-mutable
 * fields that could in principle drift out of sync with each other, they're
 * all views onto one tagged-union state. `async` carries the in-flight
 * promise itself (needed so concurrent async callers coalesce onto the same
 * promise instead of racing); `idle`/`sync`/`done` carry no per-instance data
 * so they're shared singletons, not allocated per instance.
 */
type InitState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'async'; readonly promise: Promise<void> }
  | { readonly kind: 'sync' }
  | { readonly kind: 'done' };

const INIT_STATE_IDLE: InitState = { kind: 'idle' };
const INIT_STATE_SYNC: InitState = { kind: 'sync' };
const INIT_STATE_DONE: InitState = { kind: 'done' };

export abstract class InittableMiddlewareAccessor extends MiddlewareAccessor {
  private initState: InitState = INIT_STATE_IDLE;

  protected get isInitialized(): boolean {
    return this.initState.kind === 'done';
  }

  /** Marks this instance as already initialized (e.g. when resuming from hibernation). */
  public markInitialized(): void {
    this.initState = INIT_STATE_DONE;
  }

  /** Marks this instance as uninitialized / idle (e.g. after hibernation). */
  public markUninitialized(): void {
    this.initState = INIT_STATE_IDLE;
  }

  protected get isInitializing(): boolean {
    return this.initState.kind === 'async';
  }

  /** Sync twin of {@link isInitializing} -- there's nothing to await synchronously, so this is a plain reentrancy flag instead of a shared in-flight promise. */
  protected get isInitializingSync(): boolean {
    return this.initState.kind === 'sync';
  }

  protected abstract onInit(): Promise<void>;

  /** Sync twin of {@link onInit}. Every subclass that implements `onInit` must implement this too -- see each's own comment for how its logic maps to *Sync calls. */
  protected abstract onInitSync(): void;

  protected async onDeinit(): Promise<void> {}

  protected onDeinitSync(): void {}

  protected async initNext(): Promise<void> {
    let next: ISyncCallableMemoryAccessor = this.backend;
    while (isMiddlewareAccessor(next) && !isInittableAccessor(next)) {
      next = next.backend;
    }
    if (isInittableAccessor(next) && !next.isInitializing) {
      await next.init();
    }
  }

  protected initNextSync(): void {
    let next: ISyncCallableMemoryAccessor = this.backend;
    while (isMiddlewareAccessor(next) && !isInittableAccessor(next)) {
      next = next.backend;
    }
    if (isInittableAccessor(next) && !next.isInitializingSync) {
      next.initSync();
    }
  }

  protected async deinitNext(): Promise<void> {
    let next: ISyncCallableMemoryAccessor = this.backend;
    while (isMiddlewareAccessor(next) && !isInittableAccessor(next)) {
      next = next.backend;
    }
    if (isInittableAccessor(next)) {
      await next.deinit();
    } else {
      super.close();
    }
  }

  protected deinitNextSync(): void {
    let next: ISyncCallableMemoryAccessor = this.backend;
    while (isMiddlewareAccessor(next) && !isInittableAccessor(next)) {
      next = next.backend;
    }
    if (isInittableAccessor(next)) {
      next.deinitSync();
    } else {
      super.close();
    }
  }

  public async deinit(): Promise<void> {
    return runInCall(async () => {
      if (!this.isInitialized) return;
      try {
        await this.onDeinit();
      } finally {
        this.initState = INIT_STATE_IDLE;
        await this.deinitNext();
      }
    });
  }

  /** Sync twin of {@link deinit}. */
  public deinitSync(): void {
    return runInCall(() => {
      if (!this.isInitialized) return;
      try {
        this.onDeinitSync();
      } finally {
        this.initState = INIT_STATE_IDLE;
        this.deinitNextSync();
      }
    });
  }

  public override close(): void {
    this.deinit().catch(() => {});
  }

  public async init(): Promise<void> {
    return runInCall(async () => {
      if (this.initState.kind === 'done') return;
      if (this.initState.kind === 'async') return this.initState.promise;
      if (this.initState.kind === 'sync') {
        throw new ConcurrentInitError('async-during-sync');
      }

      let resolvePromise!: () => void;
      let rejectPromise!: (err: any) => void;
      const promise = new Promise<void>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
      promise.catch(() => {});
      this.initState = { kind: 'async', promise };

      try {
        await this.initNext();

        await this.onInit();
        this.initState = INIT_STATE_DONE;
        resolvePromise();
      } catch (err) {
        this.initState = INIT_STATE_IDLE;
        rejectPromise(err);
        throw err;
      }
    });
  }

  /**
   * Sync twin of {@link init}. Whichever family (sync or async) a caller
   * happens to use first is the one that actually initializes the chain --
   * `readSync()`/`callSync()`/etc. call this the same way `read()`/`call()`
   * call `init()`, so neither family depends on the other having run first.
   * The `sync` state guards against reentrancy (e.g. `onInitSync()` itself
   * issuing a `this.root.*Sync()` call that would otherwise re-trigger
   * `initSync()` on the same instance). A sync caller can't `await` an
   * in-flight async promise, so if one is already running this throws
   * instead of racing it -- see {@link ConcurrentInitError}.
   */
  public initSync(): void {
    return runInCall(() => {
      if (this.initState.kind === 'done') return;
      if (this.initState.kind === 'sync') return;
      if (this.initState.kind === 'async') {
        throw new ConcurrentInitError('sync-during-async');
      }

      this.initState = INIT_STATE_SYNC;
      try {
        this.initNextSync();
        this.onInitSync();
        this.initState = INIT_STATE_DONE;
      } catch (err) {
        this.initState = INIT_STATE_IDLE;
        throw err;
      }
    });
  }

  override async read(
    address: AddressLike,
    size: number,
    offset = 0,
  ): Promise<Buffer> {
    return runInCall(async () => {
      if (!this.isInitializing) {
        await this.init();
      }
      return this.readAfterInit(address, size, offset);
    });
  }

  override async write(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): Promise<number> {
    return runInCall(async () => {
      if (!this.isInitializing) {
        await this.init();
      }
      return this.writeAfterInit(address, data, offset);
    });
  }

  override async alloc(
    size: number | any,
    address: AddressLike | null = null,
    protection?: any,
    allocationType?: any,
  ): Promise<AddressLike> {
    return runInCall(async () => {
      if (!this.isInitializing) {
        await this.init();
      }
      return this.allocAfterInit(size, address, protection, allocationType);
    });
  }

  override async free(
    address: AddressLike,
    size = 0,
    freeType?: any,
  ): Promise<boolean> {
    return runInCall(async () => {
      if (!this.isInitializing) {
        await this.init();
      }
      return this.freeAfterInit(address, size, freeType);
    });
  }

  override async protect(
    address: AddressLike,
    size: number,
    newProtect: any,
  ): Promise<number> {
    return runInCall(async () => {
      if (!this.isInitializing) {
        await this.init();
      }
      return this.protectAfterInit(address, size, newProtect);
    });
  }

  override async query(address: AddressLike): Promise<any> {
    return runInCall(async () => {
      if (!this.isInitializing) {
        await this.init();
      }
      return this.queryAfterInit(address);
    });
  }

  override async call(func: CFunction, ...args: any[]): Promise<CCallResult> {
    return runInCall(async () => {
      if (!this.isInitializing) {
        await this.init();
      }
      return this.callAfterInit(func, args);
    });
  }

  override async machineCode(machineCode: CMachineCode): Promise<number> {
    return runInCall(async () => {
      if (!this.isInitializing) {
        await this.init();
      }
      return this.machineCodeAfterInit(machineCode);
    });
  }

  override readSync(address: AddressLike, size: number, offset = 0): Buffer {
    return runInCall(() => {
      if (!this.isInitializingSync) {
        this.initSync();
      }
      return this.readAfterInitSync(address, size, offset);
    });
  }

  override writeSync(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): number {
    return runInCall(() => {
      if (!this.isInitializingSync) {
        this.initSync();
      }
      return this.writeAfterInitSync(address, data, offset);
    });
  }

  override allocSync(
    size: number | any,
    address: AddressLike | null = null,
    protection?: any,
    allocationType?: any,
  ): AddressLike {
    return runInCall(() => {
      if (!this.isInitializingSync) {
        this.initSync();
      }
      return this.allocAfterInitSync(size, address, protection, allocationType);
    });
  }

  override freeSync(address: AddressLike, size = 0, freeType?: any): boolean {
    return runInCall(() => {
      if (!this.isInitializingSync) {
        this.initSync();
      }
      return this.freeAfterInitSync(address, size, freeType);
    });
  }

  override protectSync(
    address: AddressLike,
    size: number,
    newProtect: any,
  ): number {
    return runInCall(() => {
      if (!this.isInitializingSync) {
        this.initSync();
      }
      return this.protectAfterInitSync(address, size, newProtect);
    });
  }

  override querySync(address: AddressLike): any {
    return runInCall(() => {
      if (!this.isInitializingSync) {
        this.initSync();
      }
      return this.queryAfterInitSync(address);
    });
  }

  override callSync(func: CFunction, ...args: any[]): CCallResult {
    return runInCall(() => {
      if (!this.isInitializingSync) {
        this.initSync();
      }
      return this.callAfterInitSync(func, args);
    });
  }

  override machineCodeSync(machineCode: CMachineCode): number {
    return runInCall(() => {
      if (!this.isInitializingSync) {
        this.initSync();
      }
      return this.machineCodeAfterInitSync(machineCode);
    });
  }

  protected async readAfterInit(
    address: AddressLike,
    size: number,
    offset = 0,
  ): Promise<Buffer> {
    return super.read(address, size, offset);
  }

  protected readAfterInitSync(
    address: AddressLike,
    size: number,
    offset = 0,
  ): Buffer {
    return super.readSync(address, size, offset);
  }

  protected async writeAfterInit(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): Promise<number> {
    return super.write(address, data, offset);
  }

  protected writeAfterInitSync(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): number {
    return super.writeSync(address, data, offset);
  }

  protected async allocAfterInit(
    size: number | any,
    address: AddressLike | null = null,
    protection?: any,
    allocationType?: any,
  ): Promise<AddressLike> {
    return super.alloc(size, address, protection, allocationType);
  }

  protected allocAfterInitSync(
    size: number | any,
    address: AddressLike | null = null,
    protection?: any,
    allocationType?: any,
  ): AddressLike {
    return super.allocSync(size, address, protection, allocationType);
  }

  protected async freeAfterInit(
    address: AddressLike,
    size = 0,
    freeType?: any,
  ): Promise<boolean> {
    return super.free(address, size, freeType);
  }

  protected freeAfterInitSync(
    address: AddressLike,
    size = 0,
    freeType?: any,
  ): boolean {
    return super.freeSync(address, size, freeType);
  }

  protected async protectAfterInit(
    address: AddressLike,
    size: number,
    newProtect: any,
  ): Promise<number> {
    return super.protect(address, size, newProtect);
  }

  protected protectAfterInitSync(
    address: AddressLike,
    size: number,
    newProtect: any,
  ): number {
    return super.protectSync(address, size, newProtect);
  }

  protected async queryAfterInit(address: AddressLike): Promise<any> {
    return super.query(address);
  }

  protected queryAfterInitSync(address: AddressLike): any {
    return super.querySync(address);
  }

  protected async callAfterInit(
    func: CFunction,
    args: any[],
  ): Promise<CCallResult> {
    return super.call(func, ...args);
  }

  protected callAfterInitSync(func: CFunction, args: any[]): CCallResult {
    return super.callSync(func, ...args);
  }

  protected async machineCodeAfterInit(
    machineCode: CMachineCode,
  ): Promise<number> {
    return super.machineCode(machineCode);
  }

  protected machineCodeAfterInitSync(machineCode: CMachineCode): number {
    return super.machineCodeSync(machineCode);
  }
}

export class AccessorSealedError extends Error {
  constructor(
    message: string = 'HostAccessor is sealed/hibernated after save(). Restore from file to resume operations.',
  ) {
    super(message);
    this.name = 'AccessorSealedError';
  }
}

/**
 * Descriptor for a layer in the accessor decorator chain.
 */
export interface LayerDescriptor {
  type: string;
  state?: Record<string, any>;
}

/**
 * Serializable snapshot of a HostAccessor session configuration, pipeline, and state.
 */
export interface HostAccessorSession {
  version: number;
  savedAt: string;
  processId: number;
  threadId?: number;
  accessorType: string;
  pipeline?: LayerDescriptor[];
  metadata?: Record<string, any>;
  options?: Record<string, any>;
  stubs?: Record<string, string>;
}

/**
 * Executes a function under an exclusive file lock (`${filePath}.lock`).
 * Handles stale locks (>10s) and retries until timeout.
 */
export function withFileLockSync<T>(
  filePath: string,
  fn: () => T,
  timeoutMs = 5000,
): T {
  const absTarget = resolve(filePath);
  const dir = dirname(absTarget);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const lockPath = `${absTarget}.lock`;
  const startTime = Date.now();
  let fd: number | null = null;

  while (fd === null) {
    try {
      fd = openSync(lockPath, 'wx');
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        try {
          const stats = statSync(lockPath);
          if (Date.now() - stats.mtimeMs > 10000) {
            try {
              unlinkSync(lockPath);
            } catch {}
            continue;
          }
        } catch {
          continue;
        }

        if (Date.now() - startTime > timeoutMs) {
          throw new Error(
            `Timeout waiting for file lock on "${lockPath}" after ${timeoutMs}ms`,
          );
        }

        const waitUntil = Date.now() + 25;
        while (Date.now() < waitUntil) {
          /* spin */
        }
      } else {
        throw err;
      }
    }
  }

  try {
    return fn();
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
    try {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    } catch {}
  }
}

/**
 * Executes an async function under an exclusive file lock (`${filePath}.lock`).
 * Handles stale locks (>10s) and retries until timeout.
 */
export async function withFileLock<T>(
  filePath: string,
  fn: () => T | Promise<T>,
  timeoutMs = 5000,
): Promise<T> {
  const absTarget = resolve(filePath);
  const dir = dirname(absTarget);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const lockPath = `${absTarget}.lock`;
  const startTime = Date.now();
  let fd: number | null = null;

  while (fd === null) {
    try {
      fd = openSync(lockPath, 'wx');
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        try {
          const stats = statSync(lockPath);
          if (Date.now() - stats.mtimeMs > 10000) {
            try {
              unlinkSync(lockPath);
            } catch {}
            continue;
          }
        } catch {
          continue;
        }

        if (Date.now() - startTime > timeoutMs) {
          throw new Error(
            `Timeout waiting for file lock on "${lockPath}" after ${timeoutMs}ms`,
          );
        }

        await new Promise((r) => setTimeout(r, 25));
      } else {
        throw err;
      }
    }
  }

  try {
    return await fn();
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
    try {
      if (existsSync(lockPath)) {
        unlinkSync(lockPath);
      }
    } catch {}
  }
}

/**
 * HostAccessor is a base class that automatically initializes all nested InittableMiddlewareAccessors
 * in the backend decorator chain.
 */
export class HostAccessor extends InittableMiddlewareAccessor {
  override get processId(): number {
    return this._processId;
  }

  protected _sessionMetadata: Record<string, any> = {};
  public _options?: Record<string, any>;
  protected _isSealed: boolean = false;

  get isSealed(): boolean {
    return this._isSealed;
  }

  seal(): void {
    this._isSealed = true;
  }

  protected checkSealed(): void {
    if (this._isSealed) {
      throw new AccessorSealedError();
    }
  }

  constructor(backend: ISyncCallableMemoryAccessor, root?: IHostAccessor) {
    super(backend, root ?? (null as any));
    if (!root) {
      (this as any).root = this;
    }
    let b: ISyncCallableMemoryAccessor = backend;
    while (isMiddlewareAccessor(b)) {
      b = b.backend;
    }
    if (b) {
      this._processId = b.processId;
    }
  }

  protected override async readAfterInit(
    address: AddressLike,
    size: number,
    offset = 0,
  ): Promise<Buffer> {
    this.checkSealed();
    return super.readAfterInit(address, size, offset);
  }

  protected override readAfterInitSync(
    address: AddressLike,
    size: number,
    offset = 0,
  ): Buffer {
    this.checkSealed();
    return super.readAfterInitSync(address, size, offset);
  }

  protected override async writeAfterInit(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): Promise<number> {
    this.checkSealed();
    return super.writeAfterInit(address, data, offset);
  }

  protected override writeAfterInitSync(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): number {
    this.checkSealed();
    return super.writeAfterInitSync(address, data, offset);
  }

  protected override async allocAfterInit(
    size: number | any,
    address: AddressLike | null = null,
    protection?: any,
    allocationType?: any,
  ): Promise<AddressLike> {
    this.checkSealed();
    return super.allocAfterInit(size, address, protection, allocationType);
  }

  protected override allocAfterInitSync(
    size: number | any,
    address: AddressLike | null = null,
    protection?: any,
    allocationType?: any,
  ): AddressLike {
    this.checkSealed();
    return super.allocAfterInitSync(size, address, protection, allocationType);
  }

  protected override async freeAfterInit(
    address: AddressLike,
    size = 0,
    freeType?: any,
  ): Promise<boolean> {
    this.checkSealed();
    return super.freeAfterInit(address, size, freeType);
  }

  protected override freeAfterInitSync(
    address: AddressLike,
    size = 0,
    freeType?: any,
  ): boolean {
    this.checkSealed();
    return super.freeAfterInitSync(address, size, freeType);
  }

  protected override async protectAfterInit(
    address: AddressLike,
    size: number,
    newProtect: any,
  ): Promise<number> {
    this.checkSealed();
    return super.protectAfterInit(address, size, newProtect);
  }

  protected override protectAfterInitSync(
    address: AddressLike,
    size: number,
    newProtect: any,
  ): number {
    this.checkSealed();
    return super.protectAfterInitSync(address, size, newProtect);
  }

  protected override async queryAfterInit(address: AddressLike): Promise<any> {
    this.checkSealed();
    return super.queryAfterInit(address);
  }

  protected override queryAfterInitSync(address: AddressLike): any {
    this.checkSealed();
    return super.queryAfterInitSync(address);
  }

  protected override async callAfterInit(
    func: CFunction,
    args: any[],
  ): Promise<CCallResult> {
    this.checkSealed();
    return super.callAfterInit(func, args);
  }

  protected override callAfterInitSync(
    func: CFunction,
    args: any[],
  ): CCallResult {
    this.checkSealed();
    return super.callAfterInitSync(func, args);
  }

  protected override async machineCodeAfterInit(
    machineCode: CMachineCode,
  ): Promise<number> {
    this.checkSealed();
    return super.machineCodeAfterInit(machineCode);
  }

  protected override machineCodeAfterInitSync(
    machineCode: CMachineCode,
  ): number {
    this.checkSealed();
    return super.machineCodeAfterInitSync(machineCode);
  }

  /**
   * Sets custom session metadata (e.g. process name, window title, attached JVM info).
   */
  setSessionMetadata(key: string, value: any): this {
    this._sessionMetadata[key] = value;
    return this;
  }

  /**
   * Gets a copy of the attached session metadata.
   */
  getSessionMetadata(): Record<string, any> {
    return { ...this._sessionMetadata };
  }

  /**
   * Serializes the accessor state and builds a declarative pipeline blueprint.
   * If options.hibernate is true, stateful layers (e.g. NThread) will be hibernated (handles closed, remote thread left parked).
   * By default (options.hibernate = false), state is captured non-destructively via saveState() so the accessor remains fully operational.
   */
  toJSON(options?: { hibernate?: boolean }): HostAccessorSession {
    const chainLayers: any[] = [];
    const visited = new Set<any>();

    const traverse = (start: any) => {
      let curr = start;
      while (curr && !visited.has(curr)) {
        visited.add(curr);
        chainLayers.push(curr);

        if (typeof curr.getTarget === 'function') {
          const t = curr.getTarget();
          if (
            t &&
            t !== curr &&
            t !== curr.root &&
            t !== this &&
            !visited.has(t)
          ) {
            traverse(t);
          }
        } else if (
          curr.target &&
          curr.target !== curr &&
          curr.target !== curr.root &&
          curr.target !== this &&
          !visited.has(curr.target)
        ) {
          traverse(curr.target);
        }

        curr = curr.backend;
      }
    };

    traverse(this.backend);

    const directNt = (this as any).nthread;
    if (directNt && !visited.has(directNt)) {
      traverse(directNt);
    }

    const shouldHibernate = options?.hibernate ?? false;
    const pipeline: LayerDescriptor[] = [];
    // Walk from base (innermost backend) to top (outermost middleware)
    for (let i = chainLayers.length - 1; i >= 0; i--) {
      const layer = chainLayers[i];
      const type = layer.constructor?.name || 'MiddlewareAccessor';
      let state: any = undefined;
      if (shouldHibernate && typeof layer.hibernate === 'function') {
        state = layer.hibernate();
      } else if (typeof layer.saveState === 'function') {
        state = layer.saveState();
      }
      pipeline.push({ type, ...(state !== undefined ? { state } : {}) });
    }

    const threadId =
      (this as any).nthread?.threadId ??
      (this as any).threadId ??
      (this as any)._threadId;

    return {
      version: 2,
      savedAt: new Date().toISOString(),
      processId: this.processId,
      ...(threadId !== undefined ? { threadId } : {}),
      accessorType: this.constructor.name || 'HostAccessor',
      pipeline,
      metadata: { ...this._sessionMetadata },
      options: this._options ? { ...this._options } : undefined,
    };
  }

  /**
   * Hibernates the accessor stack, seals this instance so it cannot be further operated on,
   * and saves the session to a JSON file synchronously under an exclusive file lock.
   *
   * @param filePath Target JSON file path (defaults to previously loaded _sessionFilePath if omitted).
   * @returns Absolute path of the written session file.
   */
  saveToFileSync(filePath?: string): string {
    this.checkSealed();

    const targetPath = filePath ?? (this as any)._sessionFilePath;
    if (!targetPath) {
      throw new Error(
        'No target filePath specified for saveToFileSync() and no _sessionFilePath found',
      );
    }

    const absPath = resolve(targetPath);
    const session = this.toJSON({ hibernate: true });

    withFileLockSync(absPath, () => {
      const dir = dirname(absPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(absPath, JSON.stringify(session, null, 2), 'utf8');
    });

    (this as any)._sessionFilePath = absPath;

    // Seal this instance after saving
    this.seal();

    return absPath;
  }

  /**
   * Saves the accessor session configuration to a file asynchronously under an exclusive file lock.
   *
   * @param filePath Target JSON file path (defaults to previously loaded _sessionFilePath if omitted).
   * @returns Absolute path of the written session file.
   */
  async saveToFile(filePath?: string): Promise<string> {
    this.checkSealed();

    const targetPath = filePath ?? (this as any)._sessionFilePath;
    if (!targetPath) {
      throw new Error(
        'No target filePath specified for saveToFile() and no _sessionFilePath found',
      );
    }

    const absPath = resolve(targetPath);
    const session = this.toJSON({ hibernate: true });

    await withFileLock(absPath, async () => {
      const dir = dirname(absPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(absPath, JSON.stringify(session, null, 2), 'utf8');
    });

    (this as any)._sessionFilePath = absPath;

    // Seal this instance after saving
    this.seal();

    return absPath;
  }

  /** Alias for saveToFile */
  async save(filePath?: string): Promise<string> {
    return this.saveToFile(filePath);
  }

  /** Alias for saveToFileSync */
  saveSync(filePath?: string): string {
    return this.saveToFileSync(filePath);
  }

  /**
   * Reads and parses a HostAccessorSession from a JSON file under file lock without consuming it.
   *
   * @param filePath Target JSON file path.
   * @returns Parsed HostAccessorSession object.
   */
  static loadSession(filePath: string): HostAccessorSession {
    const absPath = resolve(filePath);
    return withFileLockSync(absPath, () => {
      if (!existsSync(absPath)) {
        throw new Error(`HostAccessor session file not found: ${absPath}`);
      }
      const raw = readFileSync(absPath, 'utf8');
      const session = JSON.parse(raw) as HostAccessorSession;
      if (!session || typeof session.processId !== 'number') {
        throw new Error(`Invalid HostAccessor session file: ${absPath}`);
      }
      return session;
    });
  }

  private static restorers = new Map<
    string,
    (
      session: HostAccessorSession,
      overrideOptions?: any,
    ) => Promise<HostAccessor>
  >();

  /**
   * Registers a factory function to restore a specific accessorType from a saved session.
   */
  static registerRestorer(
    accessorType: string,
    restorer: (
      session: HostAccessorSession,
      overrideOptions?: any,
    ) => Promise<HostAccessor>,
  ): void {
    HostAccessor.restorers.set(accessorType, restorer);
  }

  /**
   * Restores an active HostAccessor from a previously saved session file under an exclusive file lock.
   * By default, consumes (deletes) the session file upon load to prevent concurrent execution conflicts.
   *
   * @param filePath Path to session JSON file.
   * @param overrideOptions Options to merge or { consume?: boolean } (default: true).
   */
  static async restoreFromFile(
    filePath: string,
    overrideOptions?: any,
  ): Promise<HostAccessor> {
    const absPath = resolve(filePath);
    const shouldConsume = overrideOptions?.consume !== false;

    let session: HostAccessorSession | undefined;

    await withFileLock(absPath, async () => {
      if (!existsSync(absPath)) {
        throw new Error(`HostAccessor session file not found: ${absPath}`);
      }
      const raw = readFileSync(absPath, 'utf8');
      session = JSON.parse(raw) as HostAccessorSession;
      if (!session || typeof session.processId !== 'number') {
        throw new Error(`Invalid HostAccessor session file: ${absPath}`);
      }
      if (shouldConsume) {
        try {
          unlinkSync(absPath);
        } catch {}
      }
    });

    if (!session) {
      throw new Error(`Failed to load session from ${absPath}`);
    }

    const restorer =
      HostAccessor.restorers.get(session.accessorType) ??
      HostAccessor.restorers.get('default');

    if (!restorer) {
      throw new Error(
        `No restorer registered for accessorType: "${session.accessorType}". ` +
          `Ensure 'exoproc-accessors' is imported or register a custom restorer via HostAccessor.registerRestorer().`,
      );
    }

    const accessor = await restorer(session, overrideOptions);
    (accessor as any)._sessionFilePath = absPath;
    return accessor;
  }

  /**
   * Convenience alias: loads and rehydrates an accessor from a saved session file.
   */
  static async load(
    filePath: string,
    overrideOptions?: any,
  ): Promise<HostAccessor> {
    return await HostAccessor.restoreFromFile(filePath, overrideOptions);
  }

  protected override async onInit(): Promise<void> {
    // No-op. Chain initialization is automatically propagated by init().
  }

  protected override onInitSync(): void {
    // No-op. Chain initialization is automatically propagated by initSync().
  }

  // No-op by default -- see IHostAccessor.registerChild's doc comment.
  // RaceHostAccessor (exoproc-accessors) is the only override that does
  // anything with it.
  registerChild(_child: IMiddlewareAccessor): void {}

  // deinit()/deinitSync() are inherited as-is from InittableMiddlewareAccessor:
  // deinitNext()/deinitNextSync() already walk the whole `backend` chain and
  // deinit every InittableMiddlewareAccessor on it, so there's nothing left
  // for HostAccessor to reconcile separately.
}

/**
 * Base middleware accessor for components that require msvcrt.dll in the target process.
 */
export class DebugMemoryAccessor extends MiddlewareAccessor {
  constructor(backend: ISyncCallableMemoryAccessor, root: IHostAccessor) {
    super(backend, root);
    if (backend) {
      let curr: any = backend;
      while (curr) {
        if (
          typeof curr.enableDebug === 'function' &&
          curr !== this &&
          !(curr instanceof DebugMemoryAccessor)
        ) {
          try {
            if (
              Object.prototype.hasOwnProperty.call(curr, 'enableDebug') ||
              !curr.constructor.prototype.enableDebug
            ) {
              curr.enableDebug();
            }
          } catch {
            /* ignore enableDebug errors */
          }
        }
        if ('debug' in curr) {
          try {
            curr.debug = true;
          } catch {
            /* ignore debug assignment errors */
          }
        }
        curr = curr.backend;
      }
    }
  }

  override async read(address: any, size: number, offset = 0): Promise<Buffer> {
    return debug.debugRead(
      this.backend.constructor.name,
      address,
      size,
      offset,
      () => this.backend.read(address, size, offset),
    );
  }

  override readSync(address: any, size: number, offset = 0): Buffer {
    return debug.debugReadSync(
      this.backend.constructor.name,
      address,
      size,
      offset,
      () => this.backend.readSync(address, size, offset),
    );
  }

  override async write(
    address: any,
    data: Buffer | Uint8Array,
    offset = 0,
  ): Promise<number> {
    return debug.debugWrite(
      this.backend.constructor.name,
      address,
      data,
      offset,
      () => this.backend.write(address, data, offset),
    );
  }

  override writeSync(
    address: any,
    data: Buffer | Uint8Array,
    offset = 0,
  ): number {
    return debug.debugWriteSync(
      this.backend.constructor.name,
      address,
      data,
      offset,
      () => this.backend.writeSync(address, data, offset),
    );
  }

  override async alloc(
    size: number,
    address: any = null,
    protection?: any,
    allocationType?: any,
  ): Promise<any> {
    return debug.debugAlloc(
      this.backend.constructor.name,
      size,
      address,
      protection,
      allocationType,
      () => this.backend.alloc(size, address, protection, allocationType),
    );
  }

  override allocSync(
    size: number,
    address: any = null,
    protection?: any,
    allocationType?: any,
  ): any {
    return debug.debugAllocSync(
      this.backend.constructor.name,
      size,
      address,
      protection,
      allocationType,
      () => this.backend.allocSync(size, address, protection, allocationType),
    );
  }

  override async free(
    address: any,
    size = 0,
    freeType?: any,
  ): Promise<boolean> {
    return debug.debugFree(
      this.backend.constructor.name,
      address,
      size,
      freeType,
      () => this.backend.free(address, size, freeType),
    );
  }

  override freeSync(address: any, size = 0, freeType?: any): boolean {
    return debug.debugFreeSync(
      this.backend.constructor.name,
      address,
      size,
      freeType,
      () => this.backend.freeSync(address, size, freeType),
    );
  }

  override async call(func: any, ...args: any[]): Promise<any> {
    return debug.debugCall(this.backend.constructor.name, func, args, () =>
      this.backend.call(func, ...args),
    );
  }

  override callSync(func: any, ...args: any[]): any {
    return debug.debugCallSync(this.backend.constructor.name, func, args, () =>
      this.backend.callSync(func, ...args),
    );
  }

  override async protect(
    address: any,
    size: number,
    newProtect: any,
  ): Promise<any> {
    return debug.debugProtect(
      this.backend.constructor.name,
      address,
      size,
      newProtect,
      () => this.backend.protect(address, size, newProtect),
    );
  }

  override protectSync(address: any, size: number, newProtect: any): any {
    return debug.debugProtectSync(
      this.backend.constructor.name,
      address,
      size,
      newProtect,
      () => this.backend.protectSync(address, size, newProtect),
    );
  }

  override async query(address: any): Promise<any> {
    return debug.debugQuery(this.backend.constructor.name, address, () =>
      this.backend.query(address),
    );
  }

  override querySync(address: any): any {
    return debug.debugQuerySync(this.backend.constructor.name, address, () =>
      this.backend.querySync(address),
    );
  }

  override async machineCode(machineCode: CMachineCode): Promise<number> {
    return debug.debugMachineCode(
      this.backend.constructor.name,
      machineCode.size,
      () => this.backend.machineCode(machineCode),
    );
  }

  override machineCodeSync(machineCode: CMachineCode): number {
    return debug.debugMachineCodeSync(
      this.backend.constructor.name,
      machineCode.size,
      () => this.backend.machineCodeSync(machineCode),
    );
  }

  override async *scan(
    address: any,
    size: number,
    pattern: any,
  ): AsyncGenerator<NativeMemory> {
    yield* debug.debugScan(
      this.backend.constructor.name,
      address,
      size,
      pattern,
      () => this.backend.scan(address, size, pattern),
    );
  }

  override *scanSync(
    address: any,
    size: number,
    pattern: any,
  ): Generator<NativeMemory> {
    yield* debug.debugScanSync(
      this.backend.constructor.name,
      address,
      size,
      pattern,
      () => this.backend.scanSync(address, size, pattern),
    );
  }
}
