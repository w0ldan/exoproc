import { toArrayBuffer } from 'bun:ffi';
import {
  Kernel32Impl,
  ProcessAccess,
  MemoryProtection,
  FileMapAccess,
  DuplicateHandleOptions,
  INVALID_HANDLE_VALUE,
  resolveAddress,
  MiddlewareAccessor,
  type AddressLike,
  type ICallableMemoryAccessor,
  type ISyncCallableMemoryAccessor,
  type IHostAccessor,
} from 'bun-xffi';
import {
  type DummyProcess,
  getGlobalDummyProcess as getSharedDummyProcess,
  closeGlobalDummyProcess as closeSharedDummyProcess,
} from 'exoproc-dummy';
import {
  CreateFileMappingFailedError,
  OpenDummyProcessFailedError,
  DuplicateHandleFailedError,
  MapViewOfFileFailedError,
} from './errors.js';

/** Access mask requested on every target-side `OpenProcess` of the dummy process. */
const DUMMY_PROCESS_ACCESS = ProcessAccess.ALL_ACCESS;

/**
 * `GetCurrentProcess()`'s pseudo-handle is always `(HANDLE)-1` by definition
 * (MSDN), so it's used as a literal here rather than round-tripping the call
 * through `Number()`/bigint conversion, which would lose precision on the
 * full-width unsigned bit pattern.
 */
const CURRENT_PROCESS_PSEUDO_HANDLE = INVALID_HANDLE_VALUE;

export interface NShmOptions {
  /**
   * Executable the shared dummy process (see `exoproc-dummy`) is spawned
   * from, the first time any `NShm` needs one. Default: `ping.exe` (an idle,
   * long-lived process). Ignored once a shared dummy process already exists
   * -- it's reused across every `NShm`/target regardless of which one asked
   * for it first.
   */
  dummyExecutable?: string;
  /**
   * Arguments for `dummyExecutable`. Default: `['127.0.0.1', '-n', '1000000']`
   * -- effectively-infinite but finite ping count, *not* `-t`. Wine's `ping.exe`
   * only implements `-n`/`-w`/`-l` (confirmed via `wine ping.exe <ip> -t`,
   * which prints a usage error and exits immediately rather than looping) --
   * `-t` makes the dummy exit within milliseconds under Wine, so by the time
   * the relay `DuplicateHandle` targets it the process is already
   * mid-teardown and wineserver's `dup_handle` handler refuses with
   * `STATUS_PROCESS_IS_TERMINATING`, which `RtlNtStatusToDosError` maps to
   * `ERROR_ACCESS_DENIED` (5) -- i.e. exactly the failure this whole file's
   * `DUMMY_PROCESS_ACCESS`/spawn-method history chased as an access-rights
   * problem, when the dummy was actually just already dead. `-n` with a
   * large finite count works identically on real Windows and is what
   * actually keeps the dummy alive under Wine.
   */
  dummyArgs?: string[];
  /** Desired access for the local `MapViewOfFile`. Default: read+write. */
  mapAccess?: FileMapAccess;
}

/** Per-`alloc()` bookkeeping for one shared memory region. */
interface NShmRegion {
  targetMappingHandle: bigint;
  targetView: number;
  localMappingHandle: number;
  localView: number;
  size: number;
}

/**
 * Adapts `NShmOptions`'s `dummyExecutable`/`dummyArgs` onto `exoproc-dummy`'s
 * shared singleton -- every `NShm`/target relays through the *same* dummy
 * process regardless of which one asked for it first (options are only
 * honored the first time, exactly like the singleton they now wrap).
 */
function getGlobalDummyProcess(options: NShmOptions): DummyProcess {
  return getSharedDummyProcess({
    executable: options.dummyExecutable,
    args: options.dummyArgs,
  });
}

/**
 * Opens a target-local handle to the (shared) dummy PID. This handle is
 * deliberately never closed target-side (see {@link NShm.alloc}): `hMapping`
 * -- the handle that actually matters -- gets closed as a side effect of the
 * relay `DuplicateHandle` itself via `DUPLICATE_CLOSE_SOURCE`, so there's
 * nothing left in the target worth spending a second hijacked-thread
 * round-trip on a `CloseHandle` call for. It just sits in the target's
 * handle table for the rest of the target's lifetime; the OS reclaims it
 * when the target process exits.
 */
async function openDummyHandleInTarget(
  target: ICallableMemoryAccessor,
  dummyPid: number,
): Promise<bigint> {
  const hDummyInTarget = BigInt(
    await target.call(
      Kernel32Impl.OpenProcess,
      DUMMY_PROCESS_ACCESS,
      0,
      dummyPid,
    ),
  );
  if (hDummyInTarget === 0n) {
    throw new OpenDummyProcessFailedError(
      dummyPid,
      Number(await target.call(Kernel32Impl.GetLastError)),
      true,
    );
  }
  return hDummyInTarget;
}

/** Synchronous twin of {@link openDummyHandleInTarget}. */
function openDummyHandleInTargetSync(
  target: ISyncCallableMemoryAccessor,
  dummyPid: number,
): bigint {
  const hDummyInTarget = BigInt(
    target.callSync(
      Kernel32Impl.OpenProcess,
      DUMMY_PROCESS_ACCESS,
      0,
      dummyPid,
    ),
  );
  if (hDummyInTarget === 0n) {
    throw new OpenDummyProcessFailedError(
      dummyPid,
      Number(target.callSync(Kernel32Impl.GetLastError)),
      true,
    );
  }
  return hDummyInTarget;
}

/**
 * Terminates and releases the shared dummy process (see `exoproc-dummy`),
 * so the next region allocated through any `NShm` spawns a fresh one.
 * Existing regions remain valid (their own local mapping handle/view are
 * independent of the dummy once mapped). Re-exported here for existing
 * callers/tests -- forwards straight to `exoproc-dummy`'s own teardown.
 */
export const closeGlobalDummyProcess = closeSharedDummyProcess;

/**
 * A `MiddlewareAccessor` wrapping `backend` (an already hijacked/attached
 * target process accessor, e.g. `IndirectNThreadHostAccessor`) whose plain
 * `READWRITE` allocations (no specific address requested) are backed by
 * cross-process shared memory instead of the backend's normal remote
 * alloc/read/write -- obtained without this (Bun) process ever calling
 * `OpenProcess` on the target directly.
 *
 * `alloc()` still does real target-side work the first time for each region
 * (`CreateFileMappingA` + `MapViewOfFile` in the target, relayed to this
 * process through a shared dummy process -- see the flow notes below) and
 * returns a genuine target-side address, so callers see an ordinary pointer
 * usable anywhere a target address is expected. But every subsequent
 * `read`/`write` against an address inside that region is redirected to a
 * direct *local* memory access (this process's own mapped view of the same
 * section, via `readSync`/`writeSync`), skipping the backend's remote call
 * (e.g. a hijacked-thread round-trip) entirely. `free()` releases a known
 * region's *local* view/handle only -- see its own doc comment.
 *
 * Only plain `READWRITE` allocations with no explicit address are eligible
 * (mirroring `IndirectCallRedirectorAccessor`'s own malloc-redirection
 * heuristic): nshm can't honor a caller-requested address (`MapViewOfFile`
 * picks its own), so anything else falls through to the normal backend
 * alloc/read/write untouched. An `NShm` can back any number of independent
 * regions -- each `alloc()` call creates one more.
 *
 * Relay flow for each eligible `alloc()` (see CLAUDE.md / task notes for the
 * full rationale):
 *  1. This (Bun) process spawns a single relay ("dummy") process directly,
 *     in a de-elevated user-mode token via `CreateProcessAsUserA` (never
 *     `child_process.spawn`, which would just inherit this process's own
 *     token/privilege level unmodified). The dummy is reused for every
 *     subsequent `alloc()` regardless of which `NShm`/target is asking --
 *     every region, across every target, relays through the same dummy.
 *  2. Inside the target (via `backend.call`): `CreateFileMappingA` creates
 *     the section and `MapViewOfFile`s it -- the resulting view is the
 *     target's actual deliverable. `OpenProcess` then opens a target-local
 *     handle to the (shared) dummy PID purely to reach it (left open --
 *     not worth a `CloseHandle` round-trip, see
 *     {@link openDummyHandleInTarget}), and `DuplicateHandle` transfers the
 *     mapping handle from the target's own handle table into the dummy's
 *     *with* `DUPLICATE_CLOSE_SOURCE` -- closing the target's own mapping
 *     handle as a side effect of the same call, since the view stays valid
 *     without it (a mapped view doesn't need its creating handle to stay
 *     open). So the target ends up with zero handles related to any of
 *     this once `alloc()` returns -- no target-side `CloseHandle` call
 *     anywhere in the flow.
 *  3. This process `OpenProcess`es the dummy only once ever (the only direct
 *     `OpenProcess` call this process makes, cached and reused for every
 *     region) and `DuplicateHandle`s the mapping handle out of the dummy and
 *     into itself with `DUPLICATE_CLOSE_SOURCE` (so the dummy's own transit
 *     copy doesn't accumulate across allocations -- the dummy never actively
 *     uses the memory itself, so it has no reason to keep a handle around),
 *     then `MapViewOfFile`s it locally.
 */
export class NShm extends MiddlewareAccessor {
  private readonly regions = new Map<number, NShmRegion>();

  constructor(
    backend: ISyncCallableMemoryAccessor,
    root: IHostAccessor,
    private readonly options: NShmOptions = {},
  ) {
    super(backend, root);
  }

  private findRegion(
    address: AddressLike,
  ): { region: NShmRegion; offset: number } | null {
    const addr = Number(resolveAddress(address));
    for (const region of this.regions.values()) {
      if (addr >= region.targetView && addr < region.targetView + region.size) {
        return { region, offset: addr - region.targetView };
      }
    }
    return null;
  }

  override async alloc(
    size: number,
    address: AddressLike | null = null,
    protection: number = MemoryProtection.READWRITE,
    allocationType?: number,
  ): Promise<AddressLike> {
    if (protection !== MemoryProtection.READWRITE || address !== null) {
      return super.alloc(size, address, protection, allocationType);
    }

    // Every internal op below goes through `this.backend` directly (the raw
    // target accessor this NShm wraps), never `this.root` -- `this.root`
    // may route back down into this very `alloc()` override (if this NShm
    // is wired as an outer HostAccessor's backend, per the usual middleware
    // composition pattern), which would recurse forever on the scratch
    // `alloc(8)` below.
    const target = this.backend;
    const mapAccess =
      this.options.mapAccess ??
      FileMapAccess.combine(FileMapAccess.READ, FileMapAccess.WRITE);
    const sizeLow = size >>> 0;
    const sizeHigh = Math.floor(size / 0x100000000) >>> 0;

    const dummy = getGlobalDummyProcess(this.options);

    const hMapping = BigInt(
      await target.call(
        Kernel32Impl.CreateFileMappingA,
        INVALID_HANDLE_VALUE,
        0,
        protection,
        sizeHigh,
        sizeLow,
        0,
      ),
    );
    if (hMapping === 0n) {
      throw new CreateFileMappingFailedError(
        Number(await target.call(Kernel32Impl.GetLastError)),
      );
    }

    // MapViewOfFile in the target -- the resulting view is the target's
    // actual deliverable, not transient relay plumbing. `hMapping` itself,
    // on the other hand, is *not* kept: once a view is mapped, the mapping
    // handle that created it can be closed without invalidating the view
    // (standard Windows behavior -- the section stays alive as long as any
    // view or handle references it), so the relay `DuplicateHandle` below
    // closes it as a side effect via `DUPLICATE_CLOSE_SOURCE` instead of
    // leaving it open as a redundant second reference to something the view
    // already provides access to.
    const targetView = Number(
      await target.call(
        Kernel32Impl.MapViewOfFile,
        hMapping,
        mapAccess,
        0,
        0,
        size,
      ),
    );
    if (targetView === 0) {
      throw new MapViewOfFileFailedError(
        Number(await target.call(Kernel32Impl.GetLastError)),
        true,
      );
    }

    const hDummyInTarget = await openDummyHandleInTarget(target, dummy.pid);

    // ── DuplicateHandle inside the target: transfer the mapping to the
    //    dummy, closing `hMapping` in the target as a side effect
    //    (DUPLICATE_CLOSE_SOURCE) -- see the MapViewOfFile comment above for
    //    why that's safe. This also means there is nothing left in the
    //    target worth a separate `CloseHandle` round-trip for afterward:
    //    `hDummyInTarget` is left open (see {@link openDummyHandleInTarget}),
    //    and `hMapping` is already gone. The duplicate sitting in the
    //    dummy's handle table is a fully independent handle to the same
    //    section regardless (closing one handle to an object never affects
    //    any other handle to it).
    const dupOutAddr = await target.alloc(8);
    const dupOk = await target.call(
      Kernel32Impl.DuplicateHandle,
      INVALID_HANDLE_VALUE, // pseudo-handle for the target's own process
      hMapping,
      hDummyInTarget,
      resolveAddress(dupOutAddr),
      0,
      0,
      DuplicateHandleOptions.combine(
        DuplicateHandleOptions.SAME_ACCESS,
        DuplicateHandleOptions.CLOSE_SOURCE,
      ),
    );
    if (!dupOk) {
      throw new DuplicateHandleFailedError(
        Number(await target.call(Kernel32Impl.GetLastError)),
        true,
      );
    }
    const dummyMappingHandle = (
      await target.read(dupOutAddr, 8)
    ).readBigUInt64LE(0);

    // ── DuplicateHandle locally: pull the mapping handle out of the dummy,
    //    closing the dummy's own copy in the same call so its handle table
    //    doesn't grow without bound across many allocations ─────────────────
    const localDupOut = Buffer.alloc(8);
    const localDupOk = Kernel32Impl.DuplicateHandle(
      dummy.handle,
      dummyMappingHandle,
      CURRENT_PROCESS_PSEUDO_HANDLE,
      localDupOut,
      0,
      0,
      DuplicateHandleOptions.combine(
        DuplicateHandleOptions.SAME_ACCESS,
        DuplicateHandleOptions.CLOSE_SOURCE,
      ),
    );
    if (!localDupOk) {
      throw new DuplicateHandleFailedError(
        Number(Kernel32Impl.GetLastError()),
        false,
      );
    }
    const localMappingHandle = Number(localDupOut.readBigUInt64LE(0));

    // ── MapViewOfFile locally ───────────────────────────────────────────────
    const localView = Number(
      Kernel32Impl.MapViewOfFile(localMappingHandle, mapAccess, 0, 0, size),
    );
    if (localView === 0) {
      throw new MapViewOfFileFailedError(
        Number(Kernel32Impl.GetLastError()),
        false,
      );
    }

    this.regions.set(targetView, {
      targetMappingHandle: hMapping,
      targetView,
      localMappingHandle,
      localView,
      size,
    });
    return targetView;
  }

  /** Synchronous twin of {@link NShm.alloc} -- same relay flow, driven with *Sync calls throughout. */
  override allocSync(
    size: number,
    address: AddressLike | null = null,
    protection: number = MemoryProtection.READWRITE,
    allocationType?: number,
  ): AddressLike {
    if (protection !== MemoryProtection.READWRITE || address !== null) {
      return super.allocSync(size, address, protection, allocationType);
    }

    // Same rationale as alloc(): always through `this.backend` directly, never
    // `this.root` (which could recurse back into this override).
    const target = this.backend;
    const mapAccess =
      this.options.mapAccess ??
      FileMapAccess.combine(FileMapAccess.READ, FileMapAccess.WRITE);
    const sizeLow = size >>> 0;
    const sizeHigh = Math.floor(size / 0x100000000) >>> 0;

    const dummy = getGlobalDummyProcess(this.options);

    const hMapping = BigInt(
      target.callSync(
        Kernel32Impl.CreateFileMappingA,
        INVALID_HANDLE_VALUE,
        0,
        protection,
        sizeHigh,
        sizeLow,
        0,
      ),
    );
    if (hMapping === 0n) {
      throw new CreateFileMappingFailedError(
        Number(target.callSync(Kernel32Impl.GetLastError)),
      );
    }

    const targetView = Number(
      target.callSync(
        Kernel32Impl.MapViewOfFile,
        hMapping,
        mapAccess,
        0,
        0,
        size,
      ),
    );
    if (targetView === 0) {
      throw new MapViewOfFileFailedError(
        Number(target.callSync(Kernel32Impl.GetLastError)),
        true,
      );
    }

    const hDummyInTarget = openDummyHandleInTargetSync(target, dummy.pid);

    const dupOutAddr = target.allocSync(8);
    const dupOk = target.callSync(
      Kernel32Impl.DuplicateHandle,
      INVALID_HANDLE_VALUE,
      hMapping,
      hDummyInTarget,
      resolveAddress(dupOutAddr),
      0,
      0,
      DuplicateHandleOptions.combine(
        DuplicateHandleOptions.SAME_ACCESS,
        DuplicateHandleOptions.CLOSE_SOURCE,
      ),
    );
    if (!dupOk) {
      throw new DuplicateHandleFailedError(
        Number(target.callSync(Kernel32Impl.GetLastError)),
        true,
      );
    }
    const dummyMappingHandle = target
      .readSync(dupOutAddr, 8)
      .readBigUInt64LE(0);

    const localDupOut = Buffer.alloc(8);
    const localDupOk = Kernel32Impl.DuplicateHandle(
      dummy.handle,
      dummyMappingHandle,
      CURRENT_PROCESS_PSEUDO_HANDLE,
      localDupOut,
      0,
      0,
      DuplicateHandleOptions.combine(
        DuplicateHandleOptions.SAME_ACCESS,
        DuplicateHandleOptions.CLOSE_SOURCE,
      ),
    );
    if (!localDupOk) {
      throw new DuplicateHandleFailedError(
        Number(Kernel32Impl.GetLastError()),
        false,
      );
    }
    const localMappingHandle = Number(localDupOut.readBigUInt64LE(0));

    const localView = Number(
      Kernel32Impl.MapViewOfFile(localMappingHandle, mapAccess, 0, 0, size),
    );
    if (localView === 0) {
      throw new MapViewOfFileFailedError(
        Number(Kernel32Impl.GetLastError()),
        false,
      );
    }

    this.regions.set(targetView, {
      targetMappingHandle: hMapping,
      targetView,
      localMappingHandle,
      localView,
      size,
    });
    return targetView;
  }

  /**
   * Releases a region's own *local* (Bun-side) view/handle only -- does
   * *not* touch the target: the target's own view is its actual, intended
   * deliverable, not transient plumbing, so it's left mapped (unmap it
   * yourself, e.g. `target.call(Kernel32Impl.UnmapViewOfFile, address)`,
   * once the target no longer needs it), and there's no target-side handle
   * left to close anyway (already closed inside `alloc()`, see its own
   * comments). `address` not matching a region allocated by this `NShm`
   * falls through to the wrapped backend's normal `free()`.
   */
  override async free(
    address: AddressLike,
    size = 0,
    freeType?: number,
  ): Promise<boolean> {
    const addr = Number(resolveAddress(address));
    const region = this.regions.get(addr);
    if (!region) {
      return super.free(address, size, freeType);
    }
    Kernel32Impl.UnmapViewOfFile(region.localView);
    Kernel32Impl.CloseHandle(region.localMappingHandle);
    this.regions.delete(addr);
    return true;
  }

  /** Synchronous twin of {@link NShm.free} -- the body is already fully synchronous, this only swaps the fallback to freeSync(). */
  override freeSync(
    address: AddressLike,
    size = 0,
    freeType?: number,
  ): boolean {
    const addr = Number(resolveAddress(address));
    const region = this.regions.get(addr);
    if (!region) {
      return super.freeSync(address, size, freeType);
    }
    Kernel32Impl.UnmapViewOfFile(region.localView);
    Kernel32Impl.CloseHandle(region.localMappingHandle);
    this.regions.delete(addr);
    return true;
  }

  override readSync(address: AddressLike, size: number, offset = 0): Buffer {
    const hit = this.findRegion(address);
    if (!hit) return super.readSync(address, size, offset);
    return Buffer.from(
      toArrayBuffer(hit.region.localView as any, hit.offset + offset, size),
    );
  }

  override writeSync(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): number {
    const hit = this.findRegion(address);
    if (!hit) return super.writeSync(address, data, offset);
    const dst = new Uint8Array(
      toArrayBuffer(
        hit.region.localView as any,
        hit.offset + offset,
        data.byteLength,
      ),
    );
    dst.set(data);
    return data.byteLength;
  }

  override async read(
    address: AddressLike,
    size: number,
    offset = 0,
  ): Promise<Buffer> {
    if (!this.findRegion(address)) return super.read(address, size, offset);
    return this.readSync(address, size, offset);
  }

  override async write(
    address: AddressLike,
    data: Buffer | Uint8Array,
    offset = 0,
  ): Promise<number> {
    if (!this.findRegion(address)) return super.write(address, data, offset);
    return this.writeSync(address, data, offset);
  }
}
