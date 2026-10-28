import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  type AddressLike,
  NativeMemory,
  type ISyncCallableMemoryAccessor,
  type AllocNearOptions,
  type CFunction,
  type CMachineCode,
  type CCallResult,
  type CTypeOrString,
  normalizeType,
  resolveAddress,
  alignUp,
  computeNearAllocRange,
  freeRegionCandidate,
  AllocNearRangeError,
  Kernel32Impl,
  MsvcrtImpl,
  MsvcrtLibrary,
  MemoryBasicInformation,
  PROCESSENTRY32W_SIZE,
  MemoryState,
  MemoryProtection,
  MemoryFreeType,
  ToolhelpSnapshotFlag,
  ProcessAccess,
  DEFAULT_MACHINECODE_ALIGNMENT,
  memmem,
  memmem1,
  memmem2,
  memmem4,
  memmem8,
  memmemWithoutBuffer,
  Pattern,
  Scanner,
  verifyCoreModules,
  verifyCoreModulesSync,
  type CoreModulesStatus,
  isModuleLoadedInProcess,
  isModuleLoadedInProcessSync,
  MiddlewareAccessor,
  InittableMiddlewareAccessor,
  isInittableAccessor,
  HostAccessor,
  type HostAccessorSession,
  type IHostAccessor,
  type IInittableAccessor,
  type IMiddlewareAccessor,
} from 'bun-xffi';

export { HostAccessor, type HostAccessorSession };

export abstract class MsvcrtDependentMiddlewareAccessor extends InittableMiddlewareAccessor {
  protected async onInit(): Promise<void> {
    if (this.isLocal) return;
    const msvcrtBase = MsvcrtLibrary.baseAddress;
    const isMsvcrtLoaded = await isModuleLoadedInProcess(this.root, msvcrtBase);
    if (!isMsvcrtLoaded) {
      throw new Error('Target process does not have msvcrt.dll loaded.');
    }
  }

  protected onInitSync(): void {
    if (this.isLocal) return;
    const msvcrtBase = MsvcrtLibrary.baseAddress;
    const isMsvcrtLoaded = isModuleLoadedInProcessSync(this.root, msvcrtBase);
    if (!isMsvcrtLoaded) {
      throw new Error('Target process does not have msvcrt.dll loaded.');
    }
  }
}

/**
 * A HostAccessor that forwards all operations to a dynamically changeable target HostAccessor.
 * This is useful for resolving circular dependencies in middleware chains where the root
 * reference is readonly and needs to be set after construction.
 *
 * Usage:
 *   const redirector = new RedirectorHostAccessor(pid);
 *   // ... build middleware chain using redirector as root ...
 *   redirector.target = actualHostAccessor; // wire it up later
 */
/**
 * HostAccessor that throws an error for all operations. Used as the default/unconfigured target for redirectors.
 */
export class ThrowingHostAccessor extends HostAccessor {
  constructor(processId: number, root?: IHostAccessor) {
    super(new ThrowingMemoryAccessor(processId), root);
  }
}

/**
 * A HostAccessor that forwards all operations to a dynamically changeable target HostAccessor.
 * If target is set to `this`, it delegates calls directly to its own backend (acting like a normal HostAccessor).
 */
export class RedirectorHostAccessor extends HostAccessor {
  private _target: IHostAccessor;

  constructor(processId: number, root?: IHostAccessor) {
    super(new ThrowingMemoryAccessor(processId), root);
    // Deliberately self-rooted (no `root` arg) rather than `this.root`: this
    // placeholder is never a real candidate, but constructing it with the
    // outer `root` would still run through `MiddlewareAccessor`'s
    // constructor -- which unconditionally calls `root.registerChild(this)`
    // -- and register the placeholder itself as a racer on a
    // `RacingHostAccessor` root. Since it always throws and never does real
    // work, it would "win" the race instantly, before any genuine candidate
    // could land.
    this._target = new ThrowingHostAccessor(processId);
  }

  get target(): IHostAccessor {
    return this._target;
  }

  set target(value: IHostAccessor) {
    this._target = value;
    this._processId = value.processId;
  }

  private getTarget(): IHostAccessor {
    return this._target;
  }

  override async read(
    address: AddressLike,
    size: number,
    offset = 0,
  ): Promise<Buffer> {
    const t = this.getTarget();
    if (t === this) {
      return super.read(address, size, offset);
    }
    return t.read(address, size, offset);
  }

  override async write(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): Promise<number> {
    const t = this.getTarget();
    if (t === this) {
      return super.write(address, data, offset);
    }
    return t.write(address, data, offset);
  }

  override async alloc(
    size: number | any,
    address: AddressLike | null = null,
    protection?: any,
    allocationType?: any,
  ): Promise<AddressLike> {
    const t = this.getTarget();
    if (t === this) {
      return super.alloc(size, address, protection, allocationType);
    }
    return t.alloc(size, address, protection, allocationType);
  }

  override async free(
    address: AddressLike,
    size = 0,
    freeType?: any,
  ): Promise<boolean> {
    const t = this.getTarget();
    if (t === this) {
      return super.free(address, size, freeType);
    }
    return t.free(address, size, freeType);
  }

  override async protect(
    address: AddressLike,
    size: number,
    newProtect: any,
  ): Promise<number> {
    const t = this.getTarget();
    if (t === this) {
      return super.protect(address, size, newProtect);
    }
    return t.protect(address, size, newProtect);
  }

  override async query(address: AddressLike): Promise<any> {
    const t = this.getTarget();
    if (t === this) {
      return super.query(address);
    }
    return t.query(address);
  }

  override async call(func: CFunction, ...args: any[]): Promise<CCallResult> {
    const t = this.getTarget();
    if (t === this) {
      return super.call(func, ...args);
    }
    return t.call(func, ...args);
  }

  override async machineCode(machineCode: CMachineCode): Promise<number> {
    const t = this.getTarget();
    if (t === this) {
      return super.machineCode(machineCode);
    }
    return t.machineCode(machineCode);
  }

  override async *scan(
    address: AddressLike,
    size: number,
    pattern: Pattern | string,
  ): AsyncGenerator<NativeMemory> {
    const t = this.getTarget();
    if (t === this) {
      yield* super.scan(address, size, pattern);
    } else {
      yield* t.scan(address, size, pattern);
    }
  }

  // ── Sync twins of the overrides above -- same getTarget()-redirect, for
  //    callers (e.g. NThread.callSync) that need the *Sync family routed
  //    through `root` all the way to whatever `target` ends up wired to,
  //    instead of silently hitting the placeholder ThrowingMemoryAccessor
  //    this class starts with as its own `backend`. ─────────────────────────

  override readSync(address: AddressLike, size: number, offset = 0): Buffer {
    const t = this.getTarget();
    if (t === this) {
      return super.readSync(address, size, offset);
    }
    return t.readSync(address, size, offset);
  }

  override writeSync(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): number {
    const t = this.getTarget();
    if (t === this) {
      return super.writeSync(address, data, offset);
    }
    return t.writeSync(address, data, offset);
  }

  override allocSync(
    size: number | any,
    address: AddressLike | null = null,
    protection?: any,
    allocationType?: any,
  ): AddressLike {
    const t = this.getTarget();
    if (t === this) {
      return super.allocSync(size, address, protection, allocationType);
    }
    return t.allocSync(size, address, protection, allocationType);
  }

  override freeSync(address: AddressLike, size = 0, freeType?: any): boolean {
    const t = this.getTarget();
    if (t === this) {
      return super.freeSync(address, size, freeType);
    }
    return t.freeSync(address, size, freeType);
  }

  override protectSync(
    address: AddressLike,
    size: number,
    newProtect: any,
  ): any {
    const t = this.getTarget();
    if (t === this) {
      return super.protectSync(address, size, newProtect);
    }
    return t.protectSync(address, size, newProtect);
  }

  override querySync(address: AddressLike): any {
    const t = this.getTarget();
    if (t === this) {
      return super.querySync(address);
    }
    return t.querySync(address);
  }

  override callSync(func: CFunction, ...args: any[]): CCallResult {
    const t = this.getTarget();
    if (t === this) {
      return super.callSync(func, ...args);
    }
    return t.callSync(func, ...args);
  }

  override machineCodeSync(machineCode: CMachineCode): number {
    const t = this.getTarget();
    if (t === this) {
      return super.machineCodeSync(machineCode);
    }
    return t.machineCodeSync(machineCode);
  }

  override *scanSync(
    address: AddressLike,
    size: number,
    pattern: Pattern | string,
  ): Generator<NativeMemory> {
    const t = this.getTarget();
    if (t === this) {
      yield* super.scanSync(address, size, pattern);
    } else {
      yield* t.scanSync(address, size, pattern);
    }
  }

  override close(): void {
    if (this._target && this._target !== this) {
      this._target.close();
    }
  }

  protected override async onInit(): Promise<void> {
    // No-op. The target is initialized separately.
  }

  /**
   * Mirrors the `close()` override above for the async lifecycle: every op
   * (read/write/call/...) routes to `target` once it's no longer `this`, so
   * `deinit()` must too. Without this, the inherited `deinitNext()` (from
   * `InittableMiddlewareAccessor`) walks `this.backend` -- which for a
   * subclass like `NThreadRaceAccessor` stays pointed at its own
   * placeholder `ThrowingMemoryAccessor` forever (only `target` ever gets
   * reassigned to the winner, per `RedirectorHostAccessor`'s whole design;
   * see its class doc comment) -- so the real accessor `target` resolved to
   * would never actually get deinited, leaving its underlying resource
   * (e.g. a hijacked thread) permanently stuck.
   *
   * Deliberately excludes `t === this.root`: `BootstrapHostAccessor.onInit()`
   * itself resolves `target` to `this.root` once its own backend has landed
   * -- that's a hand-off back to whatever *contains* this accessor (e.g. a
   * per-candidate `BootstrapHostAccessor` inside `NThreadRaceAccessor`
   * resolves to the race accessor itself), not a distinct resource this
   * accessor now owns. Cascading `deinit()` there would tear down the
   * container (and everything else riding on it, e.g. the actual race
   * winner) from a single losing candidate's own cleanup.
   */
  protected override async onDeinit(): Promise<void> {
    const t = this.getTarget();
    if (t !== this && t !== this.root && isInittableAccessor(t)) {
      await t.deinit();
    }
  }

  protected override onInitSync(): void {
    // No-op. The target is initialized separately.
  }

  protected override onDeinitSync(): void {
    const t = this.getTarget();
    if (t !== this && t !== this.root && isInittableAccessor(t)) {
      t.deinitSync();
    }
  }
}

/**
 * A minimal `RedirectorHostAccessor` mixin meant to be *extended*, not used
 * directly -- its only job is giving a subclass (e.g. `NThreadRaceAccessor`)
 * two things for free: automatic candidate collection, and a `race()` helper
 * to actually run the race once the subclass's own `onInit()` decides it's
 * time. `target` (inherited) is left for the subclass to set to the winner
 * however makes sense for it -- this class never touches it itself.
 *
 * Candidates are never added explicitly -- every `MiddlewareAccessor`'s
 * constructor calls `root.registerChild(this)` (a no-op on every other
 * `IHostAccessor`; see its doc comment), so simply constructing a candidate
 * with a `RacingHostAccessor` (sub)instance as its `root` is enough to enter
 * it into the race.
 *
 * Deliberately knows nothing about *why* a caller is racing candidates -- no
 * `NThread`, no `AbortController`, no timeout, no `AsyncLocalStorage`; a
 * caller that needs to cancel the losers does so itself, by extending this
 * class and overriding `releaseLoser`, and a caller whose candidates need
 * per-candidate context threaded through their own `init()` (e.g.
 * `NThreadRaceAccessor`, whose candidates all share one root and need
 * `root.call()` to resolve back to *this specific* candidate while racing)
 * does so by overriding `startRacer` -- kept as a single, narrow extension
 * point instead of baking any particular mechanism (like
 * `AsyncLocalStorage`) into this generic base.
 */
export class RacingHostAccessor extends RedirectorHostAccessor {
  protected readonly racers: IInittableAccessor[] = [];

  override registerChild(child: IMiddlewareAccessor): void {
    // Can fire before our own field initializers run: RedirectorHostAccessor's
    // constructor builds a placeholder `new ThrowingHostAccessor(processId,
    // this.root)`, and `this.root` is this very instance (self-rooted, still
    // mid-construction) when nothing else was passed as `root` -- `this.racers`
    // isn't assigned yet at that point. Harmless to skip: real candidates
    // always register later, from a subclass's own constructor body, which
    // only runs after every `super()` call (and therefore every field
    // initializer) has completed.
    if (!this.racers || !isInittableAccessor(child)) return;
    this.racers.push(child);
  }

  /**
   * Launches one racer's `init()`. Overridable so a subclass can wrap the
   * call with its own per-candidate context (see `NThreadRaceAccessor`,
   * which threads an `AsyncLocalStorage` context through this so its shared
   * root's `call()` can resolve back to whichever candidate is currently
   * bootstrapping) without this base class needing to know why.
   */
  protected startRacer(racer: IInittableAccessor): Promise<void> {
    return racer.init();
  }

  /**
   * Races every registered racer's `init()` and returns whichever settles
   * first; every other racer gets {@link releaseLoser}'d. Doesn't touch
   * `target` itself -- callers (a subclass's own `onInit()` override)
   * decide what to do with the winner.
   */
  protected async race(): Promise<IInittableAccessor> {
    if (this.racers.length === 0) {
      throw new Error('RacingHostAccessor: no racers registered to race');
    }
    const attempts = this.racers.map((racer) => ({
      racer,
      settled: this.startRacer(racer),
    }));
    let winner: IInittableAccessor;
    try {
      winner = await Promise.any(
        attempts.map((a) => a.settled.then(() => a.racer)),
      );
    } catch (err) {
      throw new Error(
        `RacingHostAccessor: none of ${attempts.length} racer(s) could be initialized`,
        { cause: err },
      );
    }
    for (const a of attempts) {
      if (a.racer === winner) continue;
      this.releaseLoser(a.racer, a.settled);
    }
    return winner;
  }

  /**
   * Called once per losing racer, right after a winner is picked. Default:
   * deinit it once (if) its own `init()` eventually settles -- `deinit()` is
   * a no-op for one that never finished or that already failed. Subclasses
   * (e.g. `NThreadRaceAccessor`) can override this to *also* cancel an
   * in-flight racer immediately, instead of only cleaning up after the fact.
   */
  protected releaseLoser(
    racer: IInittableAccessor,
    settled: Promise<void>,
  ): void {
    settled.then(() => racer.deinit().catch(() => {})).catch(() => {});
  }
}

/**
 * BootstrapHostAccessor is a specialized RedirectorHostAccessor designed to resolve circular dependencies
 * during the initialization of decorator/middleware chains.
 * It acts as a temporary root, redirecting calls to itself (direct backend execution)
 * during initialization, and then automatically switches to the actual root once its backend is initialized.
 */
export class BootstrapHostAccessor extends RedirectorHostAccessor {
  constructor(processId: number, root: IHostAccessor) {
    super(processId, root);
    this.target = this;
  }

  protected override async onInit(): Promise<void> {
    await this.initNext();
    this.target = this.root;
  }

  protected override onInitSync(): void {
    this.initNextSync();
    this.target = this.root;
  }

  protected override async onDeinit(): Promise<void> {
    this.target = this;
  }

  protected override onDeinitSync(): void {
    this.target = this;
  }
}

/**
 * Advanced Middleware Accessor that redirects virtual memory operations
 * (alloc, free, protect, query) to run inside the target process's context via the call method.
 * This performs memory operations directly in the target process's thread context, optimizing access and avoiding cross-process overhead.
 */
export class CallRedirectorAccessor extends MiddlewareAccessor {
  override async alloc(
    size: number,
    address: AddressLike | null = null,
    protection: number = MemoryProtection.READWRITE,
    allocationType: number = MemoryState.COMMIT | MemoryState.RESERVE,
  ): Promise<AddressLike> {
    const addressVal = address ? resolveAddress(address) : 0;
    const result = await this.root.call(
      Kernel32Impl.VirtualAlloc,
      addressVal,
      size,
      allocationType,
      protection,
    );
    if (!result || Number(result) === 0) {
      throw new Error(`VirtualAlloc failed in remote process for size ${size}`);
    }
    return result;
  }

  override allocSync(
    size: number,
    address: AddressLike | null = null,
    protection: number = MemoryProtection.READWRITE,
    allocationType: number = MemoryState.COMMIT | MemoryState.RESERVE,
  ): AddressLike {
    const addressVal = address ? resolveAddress(address) : 0;
    const result = this.root.callSync(
      Kernel32Impl.VirtualAlloc,
      addressVal,
      size,
      allocationType,
      protection,
    );
    if (!result || Number(result) === 0) {
      throw new Error(`VirtualAlloc failed in remote process for size ${size}`);
    }
    return result;
  }

  override async free(
    address: AddressLike,
    size = 0,
    freeType: number = MemoryFreeType.RELEASE,
  ): Promise<boolean> {
    const success = await this.root.call(
      Kernel32Impl.VirtualFree,
      resolveAddress(address),
      size,
      freeType,
    );
    return success !== 0 && success !== false;
  }

  override freeSync(
    address: AddressLike,
    size = 0,
    freeType: number = MemoryFreeType.RELEASE,
  ): boolean {
    const success = this.root.callSync(
      Kernel32Impl.VirtualFree,
      resolveAddress(address),
      size,
      freeType,
    );
    return success !== 0 && success !== false;
  }

  override async protect(
    address: AddressLike,
    size: number,
    newProtect: number,
  ): Promise<number> {
    // Allocate a temporary 4-byte buffer in the target process using root.alloc
    // to store the old protection value returned by VirtualProtect
    const tempAddr = await this.root.alloc(4);
    try {
      const success = await this.root.call(
        Kernel32Impl.VirtualProtect,
        resolveAddress(address),
        size,
        newProtect,
        tempAddr,
      );
      if (!success || success === 0) {
        throw new Error(
          `VirtualProtect failed in remote process at address ${resolveAddress(address)}`,
        );
      }
      const oldProtect = await this.root.readUInt32(tempAddr);
      return oldProtect;
    } finally {
      await this.root.free(tempAddr);
    }
  }

  override protectSync(
    address: AddressLike,
    size: number,
    newProtect: number,
  ): number {
    // Sync twin of protect() -- see its comment for the temp-buffer rationale.
    const tempAddr = this.root.allocSync(4);
    try {
      const success = this.root.callSync(
        Kernel32Impl.VirtualProtect,
        resolveAddress(address),
        size,
        newProtect,
        tempAddr,
      );
      if (!success || success === 0) {
        throw new Error(
          `VirtualProtect failed in remote process at address ${resolveAddress(address)}`,
        );
      }
      return this.root.readUInt32Sync(tempAddr);
    } finally {
      this.root.freeSync(tempAddr);
    }
  }

  override async query(address: AddressLike): Promise<MemoryBasicInformation> {
    const info = new MemoryBasicInformation();
    // Allocate a temporary 48-byte buffer in the target process using root.alloc
    // to store the MEMORY_BASIC_INFORMATION structure
    const tempAddr = await this.root.alloc(info.size);
    try {
      const bytesReturned = await this.root.call(
        Kernel32Impl.VirtualQuery,
        resolveAddress(address),
        tempAddr,
        info.size,
      );
      if (!bytesReturned || Number(bytesReturned) === 0) {
        throw new Error(
          `VirtualQuery failed in remote process at address ${resolveAddress(address)}`,
        );
      }
      const buffer = await this.root.read(tempAddr, info.size);
      info.writeSync(buffer, 0);
      return info;
    } finally {
      await this.root.free(tempAddr);
    }
  }

  override querySync(address: AddressLike): MemoryBasicInformation {
    // Sync twin of query() -- see its comment for the temp-buffer rationale.
    const info = new MemoryBasicInformation();
    const tempAddr = this.root.allocSync(info.size);
    try {
      const bytesReturned = this.root.callSync(
        Kernel32Impl.VirtualQuery,
        resolveAddress(address),
        tempAddr,
        info.size,
      );
      if (!bytesReturned || Number(bytesReturned) === 0) {
        throw new Error(
          `VirtualQuery failed in remote process at address ${resolveAddress(address)}`,
        );
      }
      const buffer = this.root.readSync(tempAddr, info.size);
      info.writeSync(buffer, 0);
      return info;
    } finally {
      this.root.freeSync(tempAddr);
    }
  }

  /**
   * Same principle as this class's alloc/free/protect/query: the *target*
   * process does the work itself via `call` (in-process VirtualQuery /
   * VirtualAlloc), not VirtualQueryEx/VirtualAllocEx reaching in from ours.
   *
   * `allocNear` is a search loop rather than a single Win32 call, so this
   * override drives it entirely through the sibling `this.query()` /
   * `this.alloc()` (each already a remote `call`, and each still composed with
   * subclasses like {@link IndirectCallRedirectorAccessor}). Because every probe
   * is an expensive round-trip here, it walks one region per `VirtualQuery`
   * using the reported `RegionSize`, instead of the base accessor's naive
   * fixed 64KB grid steps.
   */
  override async allocNear(
    target: AddressLike,
    size: number,
    options: AllocNearOptions = {},
  ): Promise<AddressLike> {
    const range = computeNearAllocRange(target, options);
    const protection = options.protection ?? MemoryProtection.EXECUTE_READWRITE;
    const allocationType = (MemoryState.COMMIT |
      MemoryState.RESERVE) as MemoryState;

    // Try to claim a free region: VirtualAlloc runs in the target (sibling
    // override) at the exact granularity-aligned candidate -- the allocation
    // is made by the process itself.
    const tryRegion = async (
      info: MemoryBasicInformation,
    ): Promise<AddressLike | null> => {
      const candidate = freeRegionCandidate(info, size, range);
      if (candidate === null) return null;
      try {
        return await this.alloc(size, candidate, protection, allocationType);
      } catch {
        // Region got claimed/rejected between query and alloc -- skip it.
        return null;
      }
    };

    // Probe the target's own region once, then walk outward from its edges.
    const first = await this.query(range.target);
    const firstHit = await tryRegion(first);
    if (firstHit !== null) return firstHit;
    const firstBase = BigInt(resolveAddress(first.BaseAddress));
    const firstSize = BigInt(first.RegionSize) || 0x10000n;

    // Downward: each VirtualQuery jumps to the region just below the last.
    let cursor = firstBase - 1n;
    while (cursor >= range.minAddr) {
      const info = await this.query(cursor);
      const hit = await tryRegion(info);
      if (hit !== null) return hit;
      const base = BigInt(resolveAddress(info.BaseAddress));
      const next = base - 1n;
      if (next >= cursor) break; // no downward progress -- stop
      cursor = next;
    }

    // Upward: each VirtualQuery jumps to the first address past the last region.
    cursor = firstBase + firstSize;
    while (cursor <= range.maxAddr) {
      const info = await this.query(cursor);
      const hit = await tryRegion(info);
      if (hit !== null) return hit;
      const base = BigInt(resolveAddress(info.BaseAddress));
      const regionSize = BigInt(info.RegionSize) || 0x10000n;
      const next = base + regionSize;
      if (next <= cursor) break; // no upward progress -- stop
      cursor = next;
    }

    throw new AllocNearRangeError(range.target, range.maxDistance);
  }

  override allocNearSync(
    target: AddressLike,
    size: number,
    options: AllocNearOptions = {},
  ): AddressLike {
    // Sync twin of allocNear() -- same walk, same shared computeNearAllocRange/
    // freeRegionCandidate helpers, driven with querySync/allocSync instead.
    const range = computeNearAllocRange(target, options);
    const protection = options.protection ?? MemoryProtection.EXECUTE_READWRITE;
    const allocationType = (MemoryState.COMMIT |
      MemoryState.RESERVE) as MemoryState;

    const tryRegion = (info: MemoryBasicInformation): AddressLike | null => {
      const candidate = freeRegionCandidate(info, size, range);
      if (candidate === null) return null;
      try {
        return this.allocSync(size, candidate, protection, allocationType);
      } catch {
        return null;
      }
    };

    const first = this.querySync(range.target);
    const firstHit = tryRegion(first);
    if (firstHit !== null) return firstHit;
    const firstBase = BigInt(resolveAddress(first.BaseAddress));
    const firstSize = BigInt(first.RegionSize) || 0x10000n;

    let cursor = firstBase - 1n;
    while (cursor >= range.minAddr) {
      const info = this.querySync(cursor);
      const hit = tryRegion(info);
      if (hit !== null) return hit;
      const base = BigInt(resolveAddress(info.BaseAddress));
      const next = base - 1n;
      if (next >= cursor) break;
      cursor = next;
    }

    cursor = firstBase + firstSize;
    while (cursor <= range.maxAddr) {
      const info = this.querySync(cursor);
      const hit = tryRegion(info);
      if (hit !== null) return hit;
      const base = BigInt(resolveAddress(info.BaseAddress));
      const regionSize = BigInt(info.RegionSize) || 0x10000n;
      const next = base + regionSize;
      if (next <= cursor) break;
      cursor = next;
    }

    throw new AllocNearRangeError(range.target, range.maxDistance);
  }
}

/**
 * Indirect variant of CallRedirectorAccessor that redirects read-write memory allocations
 * to malloc on the process's CRT heap instead of VirtualAlloc.
 * It tracks these heap allocations locally and intercepts free, protect, and query operations
 * on them to optimize compatibility with external diagnostic and memory analysis tools.
 */
export class IndirectCallRedirectorAccessor extends CallRedirectorAccessor {
  private readonly mallocs = new Map<number, number>(); // Map<address, size>

  private findMallocBlock(
    address: number,
  ): { base: number; size: number } | null {
    for (const [base, size] of this.mallocs.entries()) {
      if (address >= base && address < base + size) {
        return { base, size };
      }
    }
    return null;
  }

  /** Shared by query()/querySync() -- pure, no I/O, so no need for two copies. */
  private buildMallocBlockInfo(block: {
    base: number;
    size: number;
  }): MemoryBasicInformation {
    const info = new MemoryBasicInformation();
    info.assign({
      BaseAddress: block.base,
      AllocationBase: block.base,
      AllocationProtect: MemoryProtection.READWRITE,
      PartitionId: 0,
      RegionSize: BigInt(block.size),
      State: MemoryState.COMMIT,
      Protect: MemoryProtection.READWRITE,
      Type: 0x20000, // MEM_PRIVATE
    } as any);
    return info;
  }

  private hasMsvcrt: boolean | null = null;

  private async checkMsvcrt(): Promise<boolean> {
    if (this.hasMsvcrt !== null) return this.hasMsvcrt;
    const msvcrtBase = MsvcrtLibrary.baseAddress;
    if (msvcrtBase.isNull() || Number(msvcrtBase) === 0) {
      this.hasMsvcrt = false;
      return false;
    }
    this.hasMsvcrt = await isModuleLoadedInProcess(this.root, msvcrtBase);
    return this.hasMsvcrt;
  }

  private checkMsvcrtSync(): boolean {
    if (this.hasMsvcrt !== null) return this.hasMsvcrt;
    const msvcrtBase = MsvcrtLibrary.baseAddress;
    if (msvcrtBase.isNull() || Number(msvcrtBase) === 0) {
      this.hasMsvcrt = false;
      return false;
    }
    this.hasMsvcrt = isModuleLoadedInProcessSync(this.root, msvcrtBase);
    return this.hasMsvcrt;
  }

  override async alloc(
    size: number,
    address: AddressLike | null = null,
    protection: number = MemoryProtection.READWRITE,
    allocationType: number = MemoryState.COMMIT | MemoryState.RESERVE,
  ): Promise<AddressLike> {
    // If it's standard READWRITE memory without a specific requested address, use malloc for maximum redirection!
    if (
      protection === MemoryProtection.READWRITE &&
      (address === null || address === undefined)
    ) {
      try {
        if (await this.checkMsvcrt()) {
          const result = await this.root.call(MsvcrtImpl.malloc, size);
          if (result && Number(result) !== 0) {
            const allocatedAddr = Number(result);
            this.mallocs.set(allocatedAddr, size);
            return allocatedAddr;
          }
        }
      } catch {
        // Fallback to VirtualAlloc if msvcrt.dll malloc is not available in target process
      }
    }

    // Otherwise, fall back to VirtualAlloc (e.g. for executable memory blocks or if msvcrt not loaded)
    return super.alloc(size, address, protection, allocationType);
  }

  override allocSync(
    size: number,
    address: AddressLike | null = null,
    protection: number = MemoryProtection.READWRITE,
    allocationType: number = MemoryState.COMMIT | MemoryState.RESERVE,
  ): AddressLike {
    if (
      protection === MemoryProtection.READWRITE &&
      (address === null || address === undefined)
    ) {
      try {
        if (this.checkMsvcrtSync()) {
          const result = this.root.callSync(MsvcrtImpl.malloc, size);
          if (result && Number(result) !== 0) {
            const allocatedAddr = Number(result);
            this.mallocs.set(allocatedAddr, size);
            return allocatedAddr;
          }
        }
      } catch {
        // Fallback to VirtualAlloc if msvcrt.dll malloc is not available in target process
      }
    }

    return super.allocSync(size, address, protection, allocationType);
  }

  override async free(
    address: AddressLike,
    size = 0,
    freeType: number = MemoryFreeType.RELEASE,
  ): Promise<boolean> {
    const addrVal = Number(resolveAddress(address));
    if (this.mallocs.has(addrVal)) {
      await this.root.call(MsvcrtImpl.free, addrVal);
      this.mallocs.delete(addrVal);
      return true;
    }
    return super.free(address, size, freeType);
  }

  override freeSync(
    address: AddressLike,
    size = 0,
    freeType: number = MemoryFreeType.RELEASE,
  ): boolean {
    const addrVal = Number(resolveAddress(address));
    if (this.mallocs.has(addrVal)) {
      this.root.callSync(MsvcrtImpl.free, addrVal);
      this.mallocs.delete(addrVal);
      return true;
    }
    return super.freeSync(address, size, freeType);
  }

  override async protect(
    address: AddressLike,
    size: number,
    newProtect: number,
  ): Promise<number> {
    const addrVal = Number(resolveAddress(address));
    const block = this.findMallocBlock(addrVal);
    if (block) {
      if (newProtect !== MemoryProtection.READWRITE) {
        throw new Error(
          `Cannot change protection of indirect heap block at 0x${addrVal.toString(16)} to ${newProtect}. Only READWRITE is allowed.`,
        );
      }
      return MemoryProtection.READWRITE; // Already READWRITE
    }
    return super.protect(address, size, newProtect);
  }

  override protectSync(
    address: AddressLike,
    size: number,
    newProtect: number,
  ): number {
    const addrVal = Number(resolveAddress(address));
    const block = this.findMallocBlock(addrVal);
    if (block) {
      if (newProtect !== MemoryProtection.READWRITE) {
        throw new Error(
          `Cannot change protection of indirect heap block at 0x${addrVal.toString(16)} to ${newProtect}. Only READWRITE is allowed.`,
        );
      }
      return MemoryProtection.READWRITE;
    }
    return super.protectSync(address, size, newProtect);
  }

  override async query(address: AddressLike): Promise<MemoryBasicInformation> {
    const addrVal = Number(resolveAddress(address));
    const block = this.findMallocBlock(addrVal);
    if (block) {
      return this.buildMallocBlockInfo(block);
    }
    return super.query(address);
  }

  override querySync(address: AddressLike): MemoryBasicInformation {
    const addrVal = Number(resolveAddress(address));
    const block = this.findMallocBlock(addrVal);
    if (block) {
      return this.buildMallocBlockInfo(block);
    }
    return super.querySync(address);
  }
}

/**
 * Middleware Accessor that automatically intercepts call arguments,
 * marshals complex types (strings, buffers) to remotely allocated memory blocks,
 * executes the native call, and cleans up the temporary allocations.
 */
export class MarshallingCallableAccessor extends MiddlewareAccessor {
  /**
   * Shared by call()/callSync() -- pure decision of "does this argument need
   * marshalling to a remote buffer, and if so, what bytes and whether to copy
   * remote modifications back to the caller's buffer/struct after the call".
   */
  private static marshalInfo(
    funcName: string | undefined,
    type: CTypeOrString | undefined | null,
    val: any,
  ): { buf: Buffer; writeBackTarget?: Buffer } | null {
    const normType = normalizeType(type);
    if (normType === 'cstring' && typeof val === 'string') {
      return { buf: Buffer.from(val + '\0', 'utf8') };
    }
    if (normType === 'cwstring' && typeof val === 'string') {
      return { buf: Buffer.from(val + '\0', 'utf16le') };
    }
    if (
      typeof val === 'string' &&
      (normType === 'ptr' ||
        normType === 'i64' ||
        normType === 'u64' ||
        normType === 'usize' ||
        normType === 'size_t')
    ) {
      const trimmed = val.trim();
      if (!/^-?0x[0-9a-fA-F]+$/.test(trimmed)) {
        const isAnsi = funcName ? funcName.endsWith('A') : false;
        return {
          buf: Buffer.from(val + '\0', isAnsi ? 'utf8' : 'utf16le'),
        };
      }
    }
    if (val && typeof val === 'object') {
      if (Buffer.isBuffer(val)) {
        return { buf: val, writeBackTarget: val };
      }
      if (Buffer.isBuffer((val as any)._backingBuffer)) {
        const backing = (val as any)._backingBuffer as Buffer;
        return { buf: backing, writeBackTarget: backing };
      }
      if (ArrayBuffer.isView(val)) {
        const viewBuf = Buffer.from(val.buffer, val.byteOffset, val.byteLength);
        return { buf: viewBuf, writeBackTarget: viewBuf };
      }
    }
    return null;
  }

  override async call(func: CFunction, ...args: any[]): Promise<CCallResult> {
    const modifiedArgs = [...args];
    const tempAllocations: {
      address: number;
      size: number;
      writeBackTarget?: Buffer;
    }[] = [];

    try {
      const signatureArgs = func.args || [];
      const totalArgs = Math.max(signatureArgs.length, args.length);
      for (let i = 0; i < totalArgs; i++) {
        const info = MarshallingCallableAccessor.marshalInfo(
          func.name,
          signatureArgs[i] || '',
          args[i],
        );
        if (!info) {
          if (
            typeof args[i] === 'string' &&
            /^-?0x[0-9a-fA-F]+$/.test(args[i].trim())
          ) {
            modifiedArgs[i] = Number(BigInt(args[i].trim()));
          }
          continue;
        }
        const allocLen = Math.max(info.buf.length, 1);
        const remoteAddr = Number(await this.root.alloc(allocLen));
        if (info.buf.length > 0) {
          await this.root.write(remoteAddr, info.buf);
        }
        tempAllocations.push({
          address: remoteAddr,
          size: allocLen,
          writeBackTarget: info.writeBackTarget,
        });
        modifiedArgs[i] = remoteAddr;
      }

      const result = await this.backend.call(func, ...modifiedArgs);

      for (const alloc of tempAllocations) {
        if (alloc.writeBackTarget && alloc.writeBackTarget.length > 0) {
          try {
            const remoteBytes = await this.root.read(
              alloc.address,
              alloc.writeBackTarget.length,
            );
            if (remoteBytes && remoteBytes.length > 0) {
              remoteBytes.copy(
                alloc.writeBackTarget,
                0,
                0,
                Math.min(remoteBytes.length, alloc.writeBackTarget.length),
              );
            }
          } catch {
            // ignore write-back errors
          }
        }
      }

      return result;
    } finally {
      for (const alloc of tempAllocations) {
        try {
          await this.root.free(alloc.address, alloc.size);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  override callSync(func: CFunction, ...args: any[]): CCallResult {
    const modifiedArgs = [...args];
    const tempAllocations: {
      address: number;
      size: number;
      writeBackTarget?: Buffer;
    }[] = [];

    try {
      const signatureArgs = func.args || [];
      const totalArgs = Math.max(signatureArgs.length, args.length);
      for (let i = 0; i < totalArgs; i++) {
        const info = MarshallingCallableAccessor.marshalInfo(
          func.name,
          signatureArgs[i] || '',
          args[i],
        );
        if (!info) {
          if (
            typeof args[i] === 'string' &&
            /^-?0x[0-9a-fA-F]+$/.test(args[i].trim())
          ) {
            modifiedArgs[i] = Number(BigInt(args[i].trim()));
          }
          continue;
        }
        const allocLen = Math.max(info.buf.length, 1);
        const remoteAddr = Number(this.root.allocSync(allocLen));
        if (info.buf.length > 0) {
          this.root.writeSync(remoteAddr, info.buf);
        }
        tempAllocations.push({
          address: remoteAddr,
          size: allocLen,
          writeBackTarget: info.writeBackTarget,
        });
        modifiedArgs[i] = remoteAddr;
      }

      const result = this.backend.callSync(func, ...modifiedArgs);

      for (const alloc of tempAllocations) {
        if (alloc.writeBackTarget && alloc.writeBackTarget.length > 0) {
          try {
            const remoteBytes = this.root.readSync(
              alloc.address,
              alloc.writeBackTarget.length,
            );
            if (remoteBytes && remoteBytes.length > 0) {
              remoteBytes.copy(
                alloc.writeBackTarget,
                0,
                0,
                Math.min(remoteBytes.length, alloc.writeBackTarget.length),
              );
            }
          } catch {
            // ignore write-back errors
          }
        }
      }

      return result;
    } finally {
      for (const alloc of tempAllocations) {
        try {
          this.root.freeSync(alloc.address, alloc.size);
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }
}

/**
 * Middleware Accessor that redirects write operations to run inside the target process's context
 * by executing msvcrt!memset calls. This is useful to optimize in-process memory initialization and avoid cross-process handle locks.
 * It optimizes writes by scanning the buffer for contiguous identical byte blocks
 * and writing them with a single memset call.
 */
export class MemsetWriteAccessor extends MsvcrtDependentMiddlewareAccessor {
  private _isExecuting = false;

  /**
   * Shared by writeAfterInit()/writeAfterInitSync() -- pure run-length scan
   * over the buffer, no I/O, so no need for two copies.
   */
  private static computeRuns(
    buffer: Buffer,
  ): { startOffset: number; value: number; count: number }[] {
    const runs: { startOffset: number; value: number; count: number }[] = [];
    let i = 0;
    while (i < buffer.length) {
      const val = buffer[i];
      if (val === undefined) break;
      let runLength = 1;
      while (i + runLength < buffer.length && buffer[i + runLength] === val) {
        runLength++;
      }
      runs.push({ startOffset: i, value: val, count: runLength });
      i += runLength;
    }
    return runs;
  }

  override async writeAfterInit(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): Promise<number> {
    if (this.isInitializing || this._isExecuting) {
      return super.writeAfterInit(address, data, offset);
    }
    this._isExecuting = true;
    try {
      const baseAddress = resolveAddress(address) + offset;
      const buffer = data instanceof Buffer ? data : Buffer.from(data);
      const runs = MemsetWriteAccessor.computeRuns(buffer);
      let totalWritten = 0;
      for (const run of runs) {
        const targetAddr = baseAddress + run.startOffset;
        await this.root.call(
          MsvcrtImpl.memset,
          targetAddr,
          run.value,
          run.count,
        );
        totalWritten += run.count;
      }
      return totalWritten;
    } finally {
      this._isExecuting = false;
    }
  }

  override writeAfterInitSync(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): number {
    if (this.isInitializingSync || this._isExecuting) {
      return super.writeAfterInitSync(address, data, offset);
    }
    this._isExecuting = true;
    try {
      const baseAddress = resolveAddress(address) + offset;
      const buffer = data instanceof Buffer ? data : Buffer.from(data);
      const runs = MemsetWriteAccessor.computeRuns(buffer);
      let totalWritten = 0;
      for (const run of runs) {
        const targetAddr = baseAddress + run.startOffset;
        this.root.callSync(MsvcrtImpl.memset, targetAddr, run.value, run.count);
        totalWritten += run.count;
      }
      return totalWritten;
    } finally {
      this._isExecuting = false;
    }
  }
}

/**
 * Middleware Accessor that reads memory using remote memcmp binary search.
 * This completely avoids ReadProcessMemory, making it extremely low-overhead
 * and independent of any custom machineCode execution.
 */
export class MemcmpReadAccessor extends MsvcrtDependentMiddlewareAccessor {
  private _isExecuting = false;

  override async readAfterInit(
    address: AddressLike,
    size: number,
    offset = 0,
  ): Promise<Buffer> {
    if (this.isInitializing || this._isExecuting) {
      return super.readAfterInit(address, size, offset);
    }
    this._isExecuting = true;
    const baseAddress = resolveAddress(address) + offset;
    const candidateAddr = Number(resolveAddress(await this.root.alloc(1)));
    const candidateBuf = Buffer.alloc(1);

    try {
      const result = Buffer.alloc(size);

      for (let i = 0; i < size; i++) {
        let low = 0;
        let high = 255;
        let foundByte = 0;

        while (low <= high) {
          const mid = (low + high) >> 1;
          candidateBuf[0] = mid;
          await this.root.write(candidateAddr, candidateBuf);

          const cmp = await this.root.call(
            MsvcrtImpl.memcmp,
            baseAddress + i,
            candidateAddr,
            1,
          );

          const cmpVal = Number(cmp);
          if (cmpVal === 0) {
            foundByte = mid;
            break;
          } else if (cmpVal < 0) {
            high = mid - 1;
          } else {
            low = mid + 1;
          }
        }
        result[i] = foundByte;
      }
      return result;
    } finally {
      this._isExecuting = false;
      await this.root.free(candidateAddr).catch(() => {});
    }
  }

  override readAfterInitSync(
    address: AddressLike,
    size: number,
    offset = 0,
  ): Buffer {
    if (this.isInitializingSync || this._isExecuting) {
      return super.readAfterInitSync(address, size, offset);
    }
    this._isExecuting = true;
    const baseAddress = resolveAddress(address) + offset;
    const candidateAddr = Number(resolveAddress(this.root.allocSync(1)));
    const candidateBuf = Buffer.alloc(1);

    try {
      const result = Buffer.alloc(size);

      for (let i = 0; i < size; i++) {
        let low = 0;
        let high = 255;
        let foundByte = 0;

        while (low <= high) {
          const mid = (low + high) >> 1;
          candidateBuf[0] = mid;
          this.root.writeSync(candidateAddr, candidateBuf);

          const cmp = this.root.callSync(
            MsvcrtImpl.memcmp,
            baseAddress + i,
            candidateAddr,
            1,
          );

          const cmpVal = Number(cmp);
          if (cmpVal === 0) {
            foundByte = mid;
            break;
          } else if (cmpVal < 0) {
            high = mid - 1;
          } else {
            low = mid + 1;
          }
        }
        result[i] = foundByte;
      }
      return result;
    } finally {
      this._isExecuting = false;
      try {
        this.root.freeSync(candidateAddr);
      } catch {
        /* ignore cleanup errors */
      }
    }
  }
}

/**
 * Dead-end fallback accessor that throws an error for every single memory operation.
 * Used as a strict base definition or safety guard for middleware accessor pipelines
 * to ensure unsupported operations are explicitly caught rather than silently ignored.
 */
export class ThrowingMemoryAccessor implements ISyncCallableMemoryAccessor {
  public readonly isLocal = false;
  public readonly processId: number;

  constructor(processId: number) {
    this.processId = processId;
  }

  private throwError(method: string): never {
    throw new Error(
      `ThrowingMemoryAccessor: '${method}' is not implemented or permitted.`,
    );
  }

  enableDebug(): void {}
  disableDebug(): void {}

  async read(
    _address: AddressLike,
    _size: number,
    _offset = 0,
  ): Promise<Buffer> {
    this.throwError('read');
  }

  readSync(_address: AddressLike, _size: number, _offset = 0): Buffer {
    this.throwError('readSync');
  }

  async write(
    _address: AddressLike,
    _data: Buffer | Uint8Array,
    _offset = 0,
  ): Promise<number> {
    this.throwError('write');
  }

  writeSync(
    _address: AddressLike,
    _data: Buffer | Uint8Array,
    _offset = 0,
  ): number {
    this.throwError('writeSync');
  }

  async alloc(
    _size: number,
    _address: AddressLike | null = null,
    _protection?: any,
    _allocationType?: any,
  ): Promise<AddressLike> {
    this.throwError('alloc');
  }

  allocSync(
    _size: number,
    _address: AddressLike | null = null,
    _protection?: any,
    _allocationType?: any,
  ): AddressLike {
    this.throwError('allocSync');
  }

  async allocNear(
    _target: AddressLike,
    _size: number,
    _options?: AllocNearOptions,
  ): Promise<AddressLike> {
    this.throwError('allocNear');
  }

  allocNearSync(
    _target: AddressLike,
    _size: number,
    _options?: AllocNearOptions,
  ): AddressLike {
    this.throwError('allocNearSync');
  }

  async free(
    _address: AddressLike,
    _size = 0,
    _freeType?: any,
  ): Promise<boolean> {
    this.throwError('free');
  }

  freeSync(_address: AddressLike, _size = 0, _freeType?: any): boolean {
    this.throwError('freeSync');
  }

  async protect(
    _address: AddressLike,
    _size: number,
    _newProtect: any,
  ): Promise<number> {
    this.throwError('protect');
  }

  protectSync(_address: AddressLike, _size: number, _newProtect: any): any {
    this.throwError('protectSync');
  }

  async query(_address: AddressLike): Promise<any> {
    this.throwError('query');
  }

  querySync(_address: AddressLike): any {
    this.throwError('querySync');
  }

  async call(_func: CFunction, ..._args: any[]): Promise<CCallResult> {
    this.throwError('call');
  }

  callSync(_func: CFunction, ..._args: any[]): CCallResult {
    this.throwError('callSync');
  }

  // eslint-disable-next-line require-yield
  async *scan(
    _address: AddressLike,
    _size: number,
    _pattern: Pattern | string,
  ): AsyncGenerator<NativeMemory> {
    this.throwError('scan');
  }

  // eslint-disable-next-line require-yield
  *scanSync(
    _address: AddressLike,
    _size: number,
    _pattern: Pattern | string,
  ): Generator<NativeMemory> {
    this.throwError('scanSync');
  }

  async readInt8(_address: AddressLike, _offset = 0): Promise<number> {
    this.throwError('readInt8');
  }
  readInt8Sync(_address: AddressLike, _offset = 0): number {
    this.throwError('readInt8Sync');
  }
  async readUInt8(_address: AddressLike, _offset = 0): Promise<number> {
    this.throwError('readUInt8');
  }
  readUInt8Sync(_address: AddressLike, _offset = 0): number {
    this.throwError('readUInt8Sync');
  }
  async readInt16(_address: AddressLike, _offset = 0): Promise<number> {
    this.throwError('readInt16');
  }
  readInt16Sync(_address: AddressLike, _offset = 0): number {
    this.throwError('readInt16Sync');
  }
  async readUInt16(_address: AddressLike, _offset = 0): Promise<number> {
    this.throwError('readUInt16');
  }
  readUInt16Sync(_address: AddressLike, _offset = 0): number {
    this.throwError('readUInt16Sync');
  }
  async readInt32(_address: AddressLike, _offset = 0): Promise<number> {
    this.throwError('readInt32');
  }
  readInt32Sync(_address: AddressLike, _offset = 0): number {
    this.throwError('readInt32Sync');
  }
  async readUInt32(_address: AddressLike, _offset = 0): Promise<number> {
    this.throwError('readUInt32');
  }
  readUInt32Sync(_address: AddressLike, _offset = 0): number {
    this.throwError('readUInt32Sync');
  }
  async readInt64(_address: AddressLike, _offset = 0): Promise<bigint> {
    this.throwError('readInt64');
  }
  readInt64Sync(_address: AddressLike, _offset = 0): bigint {
    this.throwError('readInt64Sync');
  }
  async readUInt64(_address: AddressLike, _offset = 0): Promise<bigint> {
    this.throwError('readUInt64');
  }
  readUInt64Sync(_address: AddressLike, _offset = 0): bigint {
    this.throwError('readUInt64Sync');
  }
  async readFloat(_address: AddressLike, _offset = 0): Promise<number> {
    this.throwError('readFloat');
  }
  readFloatSync(_address: AddressLike, _offset = 0): number {
    this.throwError('readFloatSync');
  }
  async readDouble(_address: AddressLike, _offset = 0): Promise<number> {
    this.throwError('readDouble');
  }
  readDoubleSync(_address: AddressLike, _offset = 0): number {
    this.throwError('readDoubleSync');
  }
  async readPointer(_address: AddressLike, _offset = 0): Promise<number> {
    this.throwError('readPointer');
  }
  readPointerSync(_address: AddressLike, _offset = 0): number {
    this.throwError('readPointerSync');
  }

  async writeInt8(
    _address: AddressLike,
    _value: number,
    _offset = 0,
  ): Promise<number> {
    this.throwError('writeInt8');
  }
  writeInt8Sync(_address: AddressLike, _value: number, _offset = 0): number {
    this.throwError('writeInt8Sync');
  }
  async writeUInt8(
    _address: AddressLike,
    _value: number,
    _offset = 0,
  ): Promise<number> {
    this.throwError('writeUInt8');
  }
  writeUInt8Sync(_address: AddressLike, _value: number, _offset = 0): number {
    this.throwError('writeUInt8Sync');
  }
  async writeInt16(
    _address: AddressLike,
    _value: number,
    _offset = 0,
  ): Promise<number> {
    this.throwError('writeInt16');
  }
  writeInt16Sync(_address: AddressLike, _value: number, _offset = 0): number {
    this.throwError('writeInt16Sync');
  }
  async writeUInt16(
    _address: AddressLike,
    _value: number,
    _offset = 0,
  ): Promise<number> {
    this.throwError('writeUInt16');
  }
  writeUInt16Sync(_address: AddressLike, _value: number, _offset = 0): number {
    this.throwError('writeUInt16Sync');
  }
  async writeInt32(
    _address: AddressLike,
    _value: number,
    _offset = 0,
  ): Promise<number> {
    this.throwError('writeInt32');
  }
  writeInt32Sync(_address: AddressLike, _value: number, _offset = 0): number {
    this.throwError('writeInt32Sync');
  }
  async writeUInt32(
    _address: AddressLike,
    _value: number,
    _offset = 0,
  ): Promise<number> {
    this.throwError('writeUInt32');
  }
  writeUInt32Sync(_address: AddressLike, _value: number, _offset = 0): number {
    this.throwError('writeUInt32Sync');
  }
  async writeInt64(
    _address: AddressLike,
    _value: bigint | number,
    _offset = 0,
  ): Promise<number> {
    this.throwError('writeInt64');
  }
  writeInt64Sync(
    _address: AddressLike,
    _value: bigint | number,
    _offset = 0,
  ): number {
    this.throwError('writeInt64Sync');
  }
  async writeUInt64(
    _address: AddressLike,
    _value: bigint | number,
    _offset = 0,
  ): Promise<number> {
    this.throwError('writeUInt64');
  }
  writeUInt64Sync(
    _address: AddressLike,
    _value: bigint | number,
    _offset = 0,
  ): number {
    this.throwError('writeUInt64Sync');
  }
  async writeFloat(
    _address: AddressLike,
    _value: number,
    _offset = 0,
  ): Promise<number> {
    this.throwError('writeFloat');
  }
  writeFloatSync(_address: AddressLike, _value: number, _offset = 0): number {
    this.throwError('writeFloatSync');
  }
  async writeDouble(
    _address: AddressLike,
    _value: number,
    _offset = 0,
  ): Promise<number> {
    this.throwError('writeDouble');
  }
  writeDoubleSync(_address: AddressLike, _value: number, _offset = 0): number {
    this.throwError('writeDoubleSync');
  }
  async writePointer(
    _address: AddressLike,
    _value: number | bigint,
    _offset = 0,
  ): Promise<number> {
    this.throwError('writePointer');
  }
  writePointerSync(
    _address: AddressLike,
    _value: number | bigint,
    _offset = 0,
  ): number {
    this.throwError('writePointerSync');
  }

  async machineCode(_machineCode: CMachineCode): Promise<number> {
    this.throwError('machineCode');
  }

  machineCodeSync(_machineCode: CMachineCode): number {
    this.throwError('machineCodeSync');
  }
}

/**
 * Middleware Accessor that redirects memory reads to transfer via a temporary file,
 * using standard C library calls (fopen, fwrite, fclose) in the target process.
 * This is useful to perform high-volume structured memory extraction through file I/O instead of raw memory streaming.
 */
export class FileTransferReadAccessor extends MsvcrtDependentMiddlewareAccessor {
  // The temp file is opened ONCE (fopen "wb") and the FILE* reused for every
  // transfer. Opening is lazy (first transfer) rather than in onInit: during
  // the init cascade the upper chain isn't ready yet, so a remote fopen/free
  // there triggers nested re-init and deadlocks the redirect thread. By first
  // transfer the chain is fully up. The path/mode buffers are written, fed to
  // fopen and freed immediately -- no per-transfer path re-spelling (the
  // dominant redirection overhead) and no lingering remote buffers. Closed in onDeinit.
  private hFile?: AddressLike;
  private tempFilePath?: string;

  protected override async onInit(): Promise<void> {
    await super.onInit();
    this.tempFilePath = path.join(
      os.tmpdir(),
      `exoproc-read-${randomUUID()}.tmp`,
    );
  }

  protected override onInitSync(): void {
    super.onInitSync();
    this.tempFilePath = path.join(
      os.tmpdir(),
      `exoproc-read-${randomUUID()}.tmp`,
    );
  }

  // Every internal call below goes through `this.backend` (the next stage
  // down the chain), never `this.root` -- `this.root` climbs back to the
  // *top* of the chain and back down through this very accessor, so a plain
  // plumbing write (the fopen path/mode strings) would re-enter
  // readAfterInit()/readAfterInitSync() while it's already running. Routing
  // through `this.backend` only ever moves further down the chain, so it
  // can't loop back into this class (or any class above it) at all --
  // no reentrancy is possible, so no reentrancy flag is needed either.
  private async ensureOpen(): Promise<void> {
    if (this.hFile) return;
    const pathBuf = Buffer.from(this.tempFilePath! + '\0', 'utf8');
    const modeBuf = Buffer.from('wb\0', 'utf8');

    const pathPtr = await this.backend.alloc(pathBuf.length);
    const modePtr = await this.backend.alloc(modeBuf.length);
    await this.backend.write(pathPtr, pathBuf);
    await this.backend.write(modePtr, modeBuf);

    this.hFile = await this.backend.call(MsvcrtImpl.fopen, pathPtr, modePtr);
    // fopen copied the path/mode strings, so the buffers can go right away.
    await this.backend.free(pathPtr).catch(() => {});
    await this.backend.free(modePtr).catch(() => {});

    if (!this.hFile || Number(this.hFile) === 0) {
      this.hFile = undefined;
      throw new Error(
        `fopen failed to open temp file in write mode: ${this.tempFilePath}`,
      );
    }
  }

  private ensureOpenSync(): void {
    if (this.hFile) return;
    const pathBuf = Buffer.from(this.tempFilePath! + '\0', 'utf8');
    const modeBuf = Buffer.from('wb\0', 'utf8');

    const pathPtr = this.backend.allocSync(pathBuf.length);
    const modePtr = this.backend.allocSync(modeBuf.length);
    this.backend.writeSync(pathPtr, pathBuf);
    this.backend.writeSync(modePtr, modeBuf);

    this.hFile = this.backend.callSync(MsvcrtImpl.fopen, pathPtr, modePtr);
    try {
      this.backend.freeSync(pathPtr);
    } catch {
      /* ignore cleanup errors */
    }
    try {
      this.backend.freeSync(modePtr);
    } catch {
      /* ignore cleanup errors */
    }

    if (!this.hFile || Number(this.hFile) === 0) {
      this.hFile = undefined;
      throw new Error(
        `fopen failed to open temp file in write mode: ${this.tempFilePath}`,
      );
    }
  }

  protected override async onDeinit(): Promise<void> {
    // Close via `this.backend` (not `this.root`): during teardown the chain
    // deinits top-down, so `this.root` is already deinitialized here and a
    // root.call would re-init the whole redirect chain via call()'s init guard.
    // `this.backend` is still initialized at onDeinit time (it deinits after us).
    if (this.hFile) {
      await this.backend.call(MsvcrtImpl.fclose, this.hFile).catch(() => {});
      this.hFile = undefined;
    }
    if (this.tempFilePath) {
      try {
        fs.unlinkSync(this.tempFilePath);
      } catch {
        /* ignore cleanup errors */
      }
      this.tempFilePath = undefined;
    }
  }

  protected override onDeinitSync(): void {
    if (this.hFile) {
      try {
        this.backend.callSync(MsvcrtImpl.fclose, this.hFile);
      } catch {
        /* ignore cleanup errors */
      }
      this.hFile = undefined;
    }
    if (this.tempFilePath) {
      try {
        fs.unlinkSync(this.tempFilePath);
      } catch {
        /* ignore cleanup errors */
      }
      this.tempFilePath = undefined;
    }
  }

  override async readAfterInit(
    address: AddressLike,
    size: number,
    offset = 0,
  ): Promise<Buffer> {
    if (this.isInitializing || !this.tempFilePath) {
      return super.readAfterInit(address, size, offset);
    }
    try {
      await this.ensureOpen();
      const targetAddr = resolveAddress(address) + offset;

      // Rewind so we overwrite from the start, dump target memory into the
      // file, then flush so the local read below sees the fresh bytes.
      await this.backend.call(MsvcrtImpl.rewind, this.hFile);
      const written = await this.backend.call(
        MsvcrtImpl.fwrite,
        targetAddr,
        1,
        size,
        this.hFile,
      );
      if (Number(written) === size) {
        await this.backend.call(MsvcrtImpl.fflush, this.hFile);
        return fs.readFileSync(this.tempFilePath!).subarray(0, size);
      }
    } catch {
      // Fall through to backend read on any CRT staging or file lock failure
    }
    return super.readAfterInit(address, size, offset);
  }

  override readAfterInitSync(
    address: AddressLike,
    size: number,
    offset = 0,
  ): Buffer {
    if (this.isInitializingSync || !this.tempFilePath) {
      return super.readAfterInitSync(address, size, offset);
    }
    try {
      this.ensureOpenSync();
      const targetAddr = resolveAddress(address) + offset;

      this.backend.callSync(MsvcrtImpl.rewind, this.hFile);
      const written = this.backend.callSync(
        MsvcrtImpl.fwrite,
        targetAddr,
        1,
        size,
        this.hFile,
      );
      if (Number(written) === size) {
        this.backend.callSync(MsvcrtImpl.fflush, this.hFile);
        return fs.readFileSync(this.tempFilePath!).subarray(0, size);
      }
    } catch {
      // Fall through to backend read on any CRT staging or file lock failure
    }
    return super.readAfterInitSync(address, size, offset);
  }
}

/**
 * Middleware Accessor that redirects memory writes to transfer via a temporary file,
 * using standard C library calls (fopen, fread, fclose) in the target process.
 * This is useful to perform structured memory staging via file systems to handle large block updates safely.
 */
export class FileTransferWriteAccessor extends MsvcrtDependentMiddlewareAccessor {
  // The temp file is opened ONCE in onInit (fopen "rb") and the FILE* reused for
  // every transfer (see FileTransferReadAccessor). Each write drops the payload
  // into the file locally, rewinds the shared handle, and freads it into target.
  private hFile?: AddressLike;
  private tempFilePath?: string;

  protected override async onInit(): Promise<void> {
    await super.onInit();
    this.tempFilePath = path.join(
      os.tmpdir(),
      `exoproc-write-${randomUUID()}.tmp`,
    );
  }

  protected override onInitSync(): void {
    super.onInitSync();
    this.tempFilePath = path.join(
      os.tmpdir(),
      `exoproc-write-${randomUUID()}.tmp`,
    );
  }

  // Lazy open on first transfer -- see FileTransferReadAccessor.ensureOpen for
  // why this can't run in onInit. The temp file must already exist on disk (the
  // caller writes the payload before calling this) so fopen("rb") succeeds.
  //
  // Every internal call below goes through `this.backend` (the next stage
  // down the chain), never `this.root` -- `this.root` climbs back to the
  // *top* of the chain and back down through this very accessor, so a plain
  // plumbing write (the fopen path/mode strings) would re-enter
  // writeAfterInit()/writeAfterInitSync() while it's already running. Routing
  // through `this.backend` only ever moves further down the chain, so it
  // can't loop back into this class (or any class above it) at all -- no
  // reentrancy is possible, so no reentrancy flag is needed either.
  private async ensureOpen(): Promise<void> {
    if (this.hFile) return;
    const pathBuf = Buffer.from(this.tempFilePath! + '\0', 'utf8');
    const modeBuf = Buffer.from('rb\0', 'utf8');

    const pathPtr = await this.backend.alloc(pathBuf.length);
    const modePtr = await this.backend.alloc(modeBuf.length);
    await this.backend.write(pathPtr, pathBuf);
    await this.backend.write(modePtr, modeBuf);

    this.hFile = await this.backend.call(MsvcrtImpl.fopen, pathPtr, modePtr);
    await this.backend.free(pathPtr).catch(() => {});
    await this.backend.free(modePtr).catch(() => {});

    if (!this.hFile || Number(this.hFile) === 0) {
      this.hFile = undefined;
      throw new Error(
        `fopen failed to open temp file in read mode: ${this.tempFilePath}`,
      );
    }
  }

  private ensureOpenSync(): void {
    if (this.hFile) return;
    const pathBuf = Buffer.from(this.tempFilePath! + '\0', 'utf8');
    const modeBuf = Buffer.from('rb\0', 'utf8');

    const pathPtr = this.backend.allocSync(pathBuf.length);
    const modePtr = this.backend.allocSync(modeBuf.length);
    this.backend.writeSync(pathPtr, pathBuf);
    this.backend.writeSync(modePtr, modeBuf);

    this.hFile = this.backend.callSync(MsvcrtImpl.fopen, pathPtr, modePtr);
    try {
      this.backend.freeSync(pathPtr);
    } catch {
      /* ignore cleanup errors */
    }
    try {
      this.backend.freeSync(modePtr);
    } catch {
      /* ignore cleanup errors */
    }

    if (!this.hFile || Number(this.hFile) === 0) {
      this.hFile = undefined;
      throw new Error(
        `fopen failed to open temp file in read mode: ${this.tempFilePath}`,
      );
    }
  }

  protected override async onDeinit(): Promise<void> {
    // Close via `this.backend` -- see FileTransferReadAccessor.onDeinit.
    if (this.hFile) {
      await this.backend.call(MsvcrtImpl.fclose, this.hFile).catch(() => {});
      this.hFile = undefined;
    }
    if (this.tempFilePath) {
      try {
        fs.unlinkSync(this.tempFilePath);
      } catch {
        /* ignore cleanup errors */
      }
      this.tempFilePath = undefined;
    }
  }

  protected override onDeinitSync(): void {
    if (this.hFile) {
      try {
        this.backend.callSync(MsvcrtImpl.fclose, this.hFile);
      } catch {
        /* ignore cleanup errors */
      }
      this.hFile = undefined;
    }
    if (this.tempFilePath) {
      try {
        fs.unlinkSync(this.tempFilePath);
      } catch {
        /* ignore cleanup errors */
      }
      this.tempFilePath = undefined;
    }
  }

  override async writeAfterInit(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): Promise<number> {
    if (this.isInitializing || !this.tempFilePath) {
      return super.writeAfterInit(address, data, offset);
    }
    const targetAddr = resolveAddress(address) + offset;
    const buffer = data instanceof Buffer ? data : Buffer.from(data);

    try {
      // Put the payload in the file (local, truncating write) BEFORE opening so
      // fopen("rb") sees a valid file, then rewind the shared FILE* so fread
      // re-reads the freshly written bytes from offset 0.
      fs.writeFileSync(this.tempFilePath!, buffer);
      await this.ensureOpen();
      await this.backend.call(MsvcrtImpl.rewind, this.hFile);

      const readBytes = await this.backend.call(
        MsvcrtImpl.fread,
        targetAddr,
        1,
        buffer.length,
        this.hFile,
      );
      if (Number(readBytes) === buffer.length) {
        return buffer.length;
      }
    } catch {
      // Fall through to backend write on any CRT staging or file lock failure
    }
    return super.writeAfterInit(address, data, offset);
  }

  override writeAfterInitSync(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): number {
    if (this.isInitializingSync || !this.tempFilePath) {
      return super.writeAfterInitSync(address, data, offset);
    }
    const targetAddr = resolveAddress(address) + offset;
    const buffer = data instanceof Buffer ? data : Buffer.from(data);

    try {
      fs.writeFileSync(this.tempFilePath!, buffer);
      this.ensureOpenSync();
      this.backend.callSync(MsvcrtImpl.rewind, this.hFile);

      const readBytes = this.backend.callSync(
        MsvcrtImpl.fread,
        targetAddr,
        1,
        buffer.length,
        this.hFile,
      );
      if (Number(readBytes) === buffer.length) {
        return buffer.length;
      }
    } catch {
      // Fall through to backend write on any CRT staging or file lock failure
    }
    return super.writeAfterInitSync(address, data, offset);
  }
}

/**
 * Middleware Accessor that caches target process metadata (bitness, process name, core modules status)
 * on demand, and intercepts dynamic module queries to cache returned module handles.
 */
export class ProcessCacheAccessor extends InittableMiddlewareAccessor {
  private static readonly TARGET_MODULE_NAMES = new Set([
    'msvcrt',
    'msvcrt.dll',
    'user32',
    'user32.dll',
  ]);

  /** Pure, no I/O -- shared by every place that needs to trim/lowercase a module name buffer. */
  private static extractModuleName(buf: Buffer): string {
    let len = buf.indexOf(0);
    if (len === -1) len = buf.length;
    return buf.subarray(0, len).toString('utf8').toLowerCase();
  }

  /** Pure, no I/O -- shared by callAfterInit()/callAfterInitSync(). */
  private static resolveTrackedAddrs() {
    return {
      getModuleHandleExAAddr: resolveAddress(
        Kernel32Impl.GetModuleHandleExA.ptr,
      ),
      getModuleHandleAAddr: resolveAddress(Kernel32Impl.GetModuleHandleA.ptr),
      getCurrentProcessAddr: resolveAddress(Kernel32Impl.GetCurrentProcess.ptr),
      getCurrentProcessIdAddr: resolveAddress(
        Kernel32Impl.GetCurrentProcessId.ptr,
      ),
    };
  }

  /** Pure, no I/O -- shared by getIs64Bit()/getIs64BitSync() to find an already-open handle in the chain. */
  private static findOpenHandleInChain(backend: any): any {
    let curr: any = backend;
    while (curr) {
      if (
        curr.handle !== undefined &&
        curr.handle !== null &&
        Number(curr.handle) !== 0
      ) {
        return curr.handle;
      }
      curr = curr.backend;
    }
    return null;
  }

  private writeMemoryCache = new Map<number, Buffer>();
  private moduleHandleCache = new Map<string, bigint>();
  private cachedIs64Bit: boolean | null = null;
  private cachedProcessName: string | null = null;
  private cachedCoreModules: CoreModulesStatus | null = null;

  protected async onInit(): Promise<void> {
    // Empty JIT initialization since metadata is queried on demand
  }

  protected onInitSync(): void {
    // Empty JIT initialization since metadata is queried on demand
  }

  /** Core of getIs64Bit()/getIs64BitSync() -- entirely local/synchronous Win32 calls already, so both share this verbatim. */
  private getIs64BitCore(): boolean {
    if (this.cachedIs64Bit !== null) {
      return this.cachedIs64Bit;
    }

    const handle = ProcessCacheAccessor.findOpenHandleInChain(this.backend);
    const hProcess =
      handle ||
      Kernel32Impl.OpenProcess(
        ProcessAccess.QUERY_INFORMATION | ProcessAccess.VM_READ,
        0,
        this.processId,
      );
    const ownsHandle = !handle && hProcess && Number(hProcess) !== 0;

    if (hProcess && Number(hProcess) !== 0) {
      try {
        const wow64Buf = Buffer.alloc(4);
        const success = Kernel32Impl.IsWow64Process(hProcess, wow64Buf);
        if (Number(success) !== 0) {
          const is32Bit = wow64Buf.readUInt32LE(0) !== 0;
          this.cachedIs64Bit = !is32Bit;
        } else {
          this.cachedIs64Bit = true; // Default to 64-bit on failure
        }
      } finally {
        if (ownsHandle) {
          Kernel32Impl.CloseHandle(hProcess);
        }
      }
    } else {
      this.cachedIs64Bit = true;
    }

    return this.cachedIs64Bit;
  }

  public async getIs64Bit(): Promise<boolean> {
    await this.init();
    return this.getIs64BitCore();
  }

  /** Sync twin of getIs64Bit() -- initializes the chain via initSync() if it hasn't run yet. */
  public getIs64BitSync(): boolean {
    if (!this.isInitializingSync) {
      this.initSync();
    }
    return this.getIs64BitCore();
  }

  /** Core of getProcessName()/getProcessNameSync() -- entirely local/synchronous Win32 calls already, so both share this verbatim. */
  private getProcessNameCore(): string {
    if (this.cachedProcessName !== null) {
      return this.cachedProcessName;
    }

    const hSnapshot = Kernel32Impl.CreateToolhelp32Snapshot(
      ToolhelpSnapshotFlag.PROCESS,
      0,
    );
    if (hSnapshot && Number(hSnapshot) !== 0 && Number(hSnapshot) !== -1) {
      try {
        const size = PROCESSENTRY32W_SIZE;
        const buf = Buffer.alloc(size);
        buf.writeUInt32LE(size, 0);

        let ok = Kernel32Impl.Process32FirstW(hSnapshot, buf);
        while (Number(ok) !== 0) {
          const pid = buf.readUInt32LE(8);
          if (pid === this.processId) {
            const nameBuf = buf.subarray(44, 44 + 520);
            let len = 0;
            for (let i = 0; i < nameBuf.length; i += 2) {
              if (nameBuf[i] === 0 && nameBuf[i + 1] === 0) {
                len = i;
                break;
              }
            }
            this.cachedProcessName = nameBuf
              .subarray(0, len)
              .toString('utf16le');
            break;
          }
          buf.writeUInt32LE(size, 0);
          ok = Kernel32Impl.Process32NextW(hSnapshot, buf);
        }
      } finally {
        Kernel32Impl.CloseHandle(hSnapshot);
      }
    }

    return this.cachedProcessName ?? '';
  }

  public async getProcessName(): Promise<string> {
    await this.init();
    return this.getProcessNameCore();
  }

  /** Sync twin of getProcessName() -- initializes the chain via initSync() if it hasn't run yet. */
  public getProcessNameSync(): string {
    if (!this.isInitializingSync) {
      this.initSync();
    }
    return this.getProcessNameCore();
  }

  public async getCoreModules(): Promise<CoreModulesStatus> {
    await this.init();
    if (this.cachedCoreModules !== null) {
      return this.cachedCoreModules;
    }

    this.cachedCoreModules = await verifyCoreModules(this);
    return this.cachedCoreModules;
  }

  /** Sync twin of getCoreModules() -- initializes the chain via initSync() if it hasn't run yet. */
  public getCoreModulesSync(): CoreModulesStatus {
    if (!this.isInitializingSync) {
      this.initSync();
    }
    if (this.cachedCoreModules !== null) {
      return this.cachedCoreModules;
    }

    this.cachedCoreModules = verifyCoreModulesSync(this);
    return this.cachedCoreModules;
  }

  protected override async writeAfterInit(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): Promise<number> {
    const addrVal = resolveAddress(address) + offset;
    const buf = data instanceof Buffer ? data : Buffer.from(data);
    this.writeMemoryCache.set(addrVal, buf);
    return super.writeAfterInit(address, data, offset);
  }

  protected override writeAfterInitSync(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): number {
    const addrVal = resolveAddress(address) + offset;
    const buf = data instanceof Buffer ? data : Buffer.from(data);
    this.writeMemoryCache.set(addrVal, buf);
    return super.writeAfterInitSync(address, data, offset);
  }

  /** Cache lookup for a module name buffer at `namePtr` -- pure, no I/O; `null` means the caller must read it remotely. */
  private cachedModuleName(namePtr: number): string | null {
    const writtenBuf = this.writeMemoryCache.get(namePtr);
    return writtenBuf
      ? ProcessCacheAccessor.extractModuleName(writtenBuf)
      : null;
  }

  private async resolveModuleName(namePtr: number): Promise<string> {
    const cached = this.cachedModuleName(namePtr);
    if (cached !== null) return cached;
    try {
      const buf = await this.root.read(namePtr, 256);
      return ProcessCacheAccessor.extractModuleName(buf);
    } catch {
      return '';
    }
  }

  private resolveModuleNameSync(namePtr: number): string {
    const cached = this.cachedModuleName(namePtr);
    if (cached !== null) return cached;
    try {
      const buf = this.root.readSync(namePtr, 256);
      return ProcessCacheAccessor.extractModuleName(buf);
    } catch {
      return '';
    }
  }

  protected override async callAfterInit(
    func: CFunction,
    args: any[],
  ): Promise<CCallResult> {
    const funcAddr = resolveAddress(func.ptr);
    const {
      getModuleHandleExAAddr,
      getModuleHandleAAddr,
      getCurrentProcessAddr,
      getCurrentProcessIdAddr,
    } = ProcessCacheAccessor.resolveTrackedAddrs();

    if (funcAddr === getCurrentProcessAddr) {
      return 0xffffffffffffffffn;
    } else if (funcAddr === getCurrentProcessIdAddr) {
      return this.processId;
    }

    if (funcAddr === getModuleHandleExAAddr && args.length >= 3) {
      const flags = Number(args[0]);
      const namePtr = resolveAddress(args[1]);
      const outPtr = resolveAddress(args[2]);

      const isFromAddress = (flags & 4) !== 0;
      if (!isFromAddress && BigInt(namePtr) !== 0n) {
        const moduleName = await this.resolveModuleName(namePtr);
        const isTargetModule =
          ProcessCacheAccessor.TARGET_MODULE_NAMES.has(moduleName);

        if (isTargetModule && this.moduleHandleCache.has(moduleName)) {
          const cachedHModule = this.moduleHandleCache.get(moduleName)!;
          const hModuleBuf = Buffer.alloc(8);
          hModuleBuf.writeBigUInt64LE(cachedHModule, 0);
          await this.root.write(outPtr, hModuleBuf);
          return 1;
        }

        const result = await this.backend.call(func, args);
        if (isTargetModule && Number(result) !== 0) {
          const hModuleBuf = await this.root.read(outPtr, 8);
          const hModule = hModuleBuf.readBigUInt64LE(0);
          this.moduleHandleCache.set(moduleName, hModule);
        }
        return result;
      }
    } else if (funcAddr === getModuleHandleAAddr && args.length >= 1) {
      const namePtr = resolveAddress(args[0]);
      if (BigInt(namePtr) !== 0n) {
        const moduleName = await this.resolveModuleName(namePtr);
        const isTargetModule =
          ProcessCacheAccessor.TARGET_MODULE_NAMES.has(moduleName);

        if (isTargetModule && this.moduleHandleCache.has(moduleName)) {
          return this.moduleHandleCache.get(moduleName)!;
        }

        const result = await this.backend.call(func, args);
        if (isTargetModule && result && Number(result) !== 0) {
          this.moduleHandleCache.set(moduleName, BigInt(result));
        }
        return result;
      }
    }

    return super.callAfterInit(func, args);
  }

  protected override callAfterInitSync(
    func: CFunction,
    args: any[],
  ): CCallResult {
    const funcAddr = resolveAddress(func.ptr);
    const {
      getModuleHandleExAAddr,
      getModuleHandleAAddr,
      getCurrentProcessAddr,
      getCurrentProcessIdAddr,
    } = ProcessCacheAccessor.resolveTrackedAddrs();

    if (funcAddr === getCurrentProcessAddr) {
      return 0xffffffffffffffffn;
    } else if (funcAddr === getCurrentProcessIdAddr) {
      return this.processId;
    }

    if (funcAddr === getModuleHandleExAAddr && args.length >= 3) {
      const flags = Number(args[0]);
      const namePtr = resolveAddress(args[1]);
      const outPtr = resolveAddress(args[2]);

      const isFromAddress = (flags & 4) !== 0;
      if (!isFromAddress && BigInt(namePtr) !== 0n) {
        const moduleName = this.resolveModuleNameSync(namePtr);
        const isTargetModule =
          ProcessCacheAccessor.TARGET_MODULE_NAMES.has(moduleName);

        if (isTargetModule && this.moduleHandleCache.has(moduleName)) {
          const cachedHModule = this.moduleHandleCache.get(moduleName)!;
          const hModuleBuf = Buffer.alloc(8);
          hModuleBuf.writeBigUInt64LE(cachedHModule, 0);
          this.root.writeSync(outPtr, hModuleBuf);
          return 1;
        }

        const result = this.backend.callSync(func, args);
        if (isTargetModule && Number(result) !== 0) {
          const hModuleBuf = this.root.readSync(outPtr, 8);
          const hModule = hModuleBuf.readBigUInt64LE(0);
          this.moduleHandleCache.set(moduleName, hModule);
        }
        return result;
      }
    } else if (funcAddr === getModuleHandleAAddr && args.length >= 1) {
      const namePtr = resolveAddress(args[0]);
      if (BigInt(namePtr) !== 0n) {
        const moduleName = this.resolveModuleNameSync(namePtr);
        const isTargetModule =
          ProcessCacheAccessor.TARGET_MODULE_NAMES.has(moduleName);

        if (isTargetModule && this.moduleHandleCache.has(moduleName)) {
          return this.moduleHandleCache.get(moduleName)!;
        }

        const result = this.backend.callSync(func, args);
        if (isTargetModule && result && Number(result) !== 0) {
          this.moduleHandleCache.set(moduleName, BigInt(result));
        }
        return result;
      }
    }

    return super.callAfterInitSync(func, args);
  }

  protected override async freeAfterInit(
    address: AddressLike,
    size?: number,
    freeType?: number,
  ): Promise<boolean> {
    const addrVal = resolveAddress(address);
    this.writeMemoryCache.delete(addrVal);
    return super.freeAfterInit(address, size, freeType);
  }

  protected override freeAfterInitSync(
    address: AddressLike,
    size?: number,
    freeType?: number,
  ): boolean {
    const addrVal = resolveAddress(address);
    this.writeMemoryCache.delete(addrVal);
    return super.freeAfterInitSync(address, size, freeType);
  }
}

export class MachineCodePoolMiddleware extends MiddlewareAccessor {
  private blocks: { address: number; size: number; used: number }[] = [];
  private alignment = DEFAULT_MACHINECODE_ALIGNMENT;
  private defaultBlockSize = 4096;

  /**
   * Shared by getOrAllocBlock()/getOrAllocBlockSync() -- pure scan for
   * existing space, no I/O, so no need for two copies. `null` means the
   * caller must allocate a fresh block itself (the only part that needs I/O).
   */
  private findBlockWithSpace(
    needed: number,
  ): { address: number; offset: number; blockIdx: number } | null {
    for (let i = 0; i < this.blocks.length; i++) {
      const block = this.blocks[i]!;
      const alignedUsed = alignUp(block.used, this.alignment);
      if (block.size - alignedUsed >= needed) {
        return { address: block.address, offset: alignedUsed, blockIdx: i };
      }
    }
    return null;
  }

  private async getOrAllocBlock(
    needed: number,
  ): Promise<{ address: number; offset: number; blockIdx: number }> {
    const existing = this.findBlockWithSpace(needed);
    if (existing) return existing;
    const blockSize = Math.max(this.defaultBlockSize, needed);
    const blockAddr = await this.root.alloc(
      blockSize,
      null,
      MemoryProtection.EXECUTE_READWRITE,
    );
    const address = Number(resolveAddress(blockAddr));
    this.blocks.push({ address, size: blockSize, used: 0 });
    return { address, offset: 0, blockIdx: this.blocks.length - 1 };
  }

  private getOrAllocBlockSync(needed: number): {
    address: number;
    offset: number;
    blockIdx: number;
  } {
    const existing = this.findBlockWithSpace(needed);
    if (existing) return existing;
    const blockSize = Math.max(this.defaultBlockSize, needed);
    const blockAddr = this.root.allocSync(
      blockSize,
      null,
      MemoryProtection.EXECUTE_READWRITE,
    );
    const address = Number(resolveAddress(blockAddr));
    this.blocks.push({ address, size: blockSize, used: 0 });
    return { address, offset: 0, blockIdx: this.blocks.length - 1 };
  }

  override async machineCode(machineCode: CMachineCode): Promise<number> {
    const size = machineCode.size;
    const bytes = Array.isArray(machineCode.bytes)
      ? new Uint8Array(machineCode.bytes)
      : machineCode.bytes;
    const { address, offset, blockIdx } = await this.getOrAllocBlock(size);
    const targetAddr = address + offset;
    await this.root.write(targetAddr, bytes);
    this.blocks[blockIdx]!.used = offset + size;
    return targetAddr;
  }

  override machineCodeSync(machineCode: CMachineCode): number {
    const size = machineCode.size;
    const bytes = Array.isArray(machineCode.bytes)
      ? new Uint8Array(machineCode.bytes)
      : machineCode.bytes;
    const { address, offset, blockIdx } = this.getOrAllocBlockSync(size);
    const targetAddr = address + offset;
    this.root.writeSync(targetAddr, bytes);
    this.blocks[blockIdx]!.used = offset + size;
    return targetAddr;
  }
}

export class ScannerMiddleware extends MiddlewareAccessor {
  /**
   * Shared by scan()/scanSync() -- pure decision of which memmemN machineCode
   * to upload and how to encode the needle for a given pattern width, no I/O.
   * `sc` still needs uploading (await machineCode() vs machineCodeSync()) by
   * the caller; `needleVal`/`isWithoutBuffer` are used directly once uploaded.
   */
  private static pickMemmemVariant(
    n: number,
    patBytes: Buffer,
  ): { sc: any; needleVal: bigint; isWithoutBuffer: boolean } {
    if (n === 1) {
      return {
        sc: memmem1,
        needleVal: BigInt(patBytes.readUInt8(0)),
        isWithoutBuffer: true,
      };
    } else if (n === 2) {
      return {
        sc: memmem2,
        needleVal: BigInt(patBytes.readUInt16LE(0)),
        isWithoutBuffer: true,
      };
    } else if (n === 3 || n === 5 || n === 6 || n === 7) {
      let val = 0n;
      for (let i = 0; i < n; i++) {
        val |= BigInt(patBytes[i]!) << BigInt(i * 8);
      }
      return { sc: memmemWithoutBuffer, needleVal: val, isWithoutBuffer: true };
    } else if (n === 4) {
      return {
        sc: memmem4,
        needleVal: BigInt(patBytes.readUInt32LE(0)),
        isWithoutBuffer: true,
      };
    } else if (n === 8) {
      return {
        sc: memmem8,
        needleVal: patBytes.readBigUInt64LE(0),
        isWithoutBuffer: true,
      };
    }
    return { sc: memmem, needleVal: 0n, isWithoutBuffer: false };
  }

  override async *scan(
    address: AddressLike,
    size: number,
    pattern: Pattern | string,
  ): AsyncGenerator<NativeMemory> {
    const pat = typeof pattern === 'string' ? new Pattern(pattern) : pattern;
    const startAddr = BigInt(resolveAddress(address));
    const end = startAddr + BigInt(size);
    let current = startAddr;

    while (current < end) {
      const mbi = await this.root.query(current);
      const regionBase = BigInt(resolveAddress(mbi.BaseAddress));
      const regionSize = BigInt(mbi.RegionSize);
      const regionEnd = regionBase + regionSize;
      const isReadable =
        mbi.State === MemoryState.COMMIT &&
        !(mbi.Protect & MemoryProtection.GUARD) &&
        !!(mbi.Protect & pat.protect);

      if (isReadable) {
        const scanStart = current > regionBase ? current : regionBase;
        const scanEnd = end < regionEnd ? end : regionEnd;
        const scanSize = Number(scanEnd - scanStart);
        if (scanSize >= pat.length) {
          const n = pat.length;
          const { sc, needleVal, isWithoutBuffer } =
            ScannerMiddleware.pickMemmemVariant(n, pat.bytes);
          const addr = await this.root.machineCode(sc);
          const memmemFnRemote = sc.cloneForAddress(addr);
          let needleRemoteAddr: any = 0n;
          if (!isWithoutBuffer) {
            needleRemoteAddr = await this.root.alloc(n);
            await this.root.write(needleRemoteAddr, pat.bytes);
          }

          try {
            const memmemFn = async (haystack: bigint, haystackLen: bigint) => {
              const callArgs: any[] = [
                haystack,
                haystackLen,
                isWithoutBuffer ? needleVal : needleRemoteAddr,
              ];
              if (n !== 1 && n !== 2 && n !== 4 && n !== 8) {
                callArgs.push(BigInt(n));
              }
              const res = await this.root.call(memmemFnRemote, ...callArgs);
              return BigInt(resolveAddress(res));
            };

            yield* Scanner.scan(
              new NativeMemory(scanStart, scanSize),
              pat,
              memmemFn,
            );
          } finally {
            if (BigInt(resolveAddress(needleRemoteAddr)) !== 0n) {
              await this.root.free(needleRemoteAddr, n);
            }
          }
        }
      }
      if (regionEnd <= current) break;
      current = regionEnd;
    }
  }

  override *scanSync(
    address: AddressLike,
    size: number,
    pattern: Pattern | string,
  ): Generator<NativeMemory> {
    const pat = typeof pattern === 'string' ? new Pattern(pattern) : pattern;
    const startAddr = BigInt(resolveAddress(address));
    const end = startAddr + BigInt(size);
    let current = startAddr;

    while (current < end) {
      const mbi = this.root.querySync(current);
      const regionBase = BigInt(resolveAddress(mbi.BaseAddress));
      const regionSize = BigInt(mbi.RegionSize);
      const regionEnd = regionBase + regionSize;
      const isReadable =
        mbi.State === MemoryState.COMMIT &&
        !(mbi.Protect & MemoryProtection.GUARD) &&
        !!(mbi.Protect & pat.protect);

      if (isReadable) {
        const scanStart = current > regionBase ? current : regionBase;
        const scanEnd = end < regionEnd ? end : regionEnd;
        const scanSize = Number(scanEnd - scanStart);
        if (scanSize >= pat.length) {
          const n = pat.length;
          const { sc, needleVal, isWithoutBuffer } =
            ScannerMiddleware.pickMemmemVariant(n, pat.bytes);
          const addr = this.root.machineCodeSync(sc);
          const memmemFnRemote = sc.cloneForAddress(addr);
          let needleRemoteAddr: any = 0n;
          if (!isWithoutBuffer) {
            needleRemoteAddr = this.root.allocSync(n);
            this.root.writeSync(needleRemoteAddr, pat.bytes);
          }

          try {
            const memmemFn = (haystack: bigint, haystackLen: bigint) => {
              const callArgs: any[] = [
                haystack,
                haystackLen,
                isWithoutBuffer ? needleVal : needleRemoteAddr,
              ];
              if (n !== 1 && n !== 2 && n !== 4 && n !== 8) {
                callArgs.push(BigInt(n));
              }
              const res = this.root.callSync(memmemFnRemote, ...callArgs);
              return BigInt(resolveAddress(res));
            };

            yield* Scanner.scanSync(
              new NativeMemory(scanStart, scanSize),
              pat,
              memmemFn,
            );
          } finally {
            if (BigInt(resolveAddress(needleRemoteAddr)) !== 0n) {
              this.root.freeSync(needleRemoteAddr, n);
            }
          }
        }
      }
      if (regionEnd <= current) break;
      current = regionEnd;
    }
  }
}
