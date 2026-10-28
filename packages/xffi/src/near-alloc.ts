import { type AddressLike } from './pointer.js';
import { resolveAddress } from './ffi.js';
import { type AllocNearOptions } from './iaccessor.js';
import { MemoryBasicInformation } from './win/structs.js';
import { MemoryState } from './win/defines.js';

// ── allocNear / allocNearSync geometry ──────────────────────────────────────
// Pure, no-I/O helpers shared by AbstractMemoryAccessor.allocNear and
// AbstractSyncMemoryAccessor.allocNearSync. Those methods keep the actual
// query()/alloc() round-trips (so the async and sync variants each drive their
// own accessor calls); everything here is just address arithmetic + region
// classification, kept out of accessor.ts so it doesn't clutter it.

// Windows VirtualAlloc granularity: allocations always start on a 64KB
// boundary, even though pages themselves are 4KB (dwAllocationGranularity in
// SYSTEM_INFO). A candidate address must be aligned to this, not just to the
// page size, or VirtualAlloc(Ex) will silently round it -- possibly outside
// the free region a query() just reported.
const NEAR_ALLOC_GRANULARITY = 0x10000n;

// Real MinHook's search radius: the true reach of a 5-byte relative JMP
// (E9 rel32) is +/-2GB, but rel32 is relative to the *end* of the 5-byte
// instruction and offsets need headroom for the allocation itself, so stay
// a little inside the true limit.
const NEAR_ALLOC_DEFAULT_MAX_DISTANCE = 0x7fff0000n;

// Lowest and highest addresses `VirtualQueryEx` will ever report on x64
// Windows -- keeps the backward scan from wrapping below 0 and the forward
// scan from running past the top of user-mode address space.
const NEAR_ALLOC_MIN_ADDRESS = NEAR_ALLOC_GRANULARITY;
const NEAR_ALLOC_MAX_ADDRESS = 0x7ffffffeffffn;

function nearAllocAlignDown(addr: bigint, align: bigint): bigint {
  return (addr / align) * align;
}

function nearAllocAlignUp(addr: bigint, align: bigint): bigint {
  return nearAllocAlignDown(addr + align - 1n, align);
}

export interface NearAllocRange {
  target: bigint;
  minAddr: bigint;
  maxAddr: bigint;
  maxDistance: bigint;
}

export function computeNearAllocRange(
  target: AddressLike,
  options: AllocNearOptions,
): NearAllocRange {
  const targetAddr = BigInt(resolveAddress(target));
  const maxDistance = options.maxDistance ?? NEAR_ALLOC_DEFAULT_MAX_DISTANCE;
  const minAddr =
    targetAddr > maxDistance
      ? targetAddr - maxDistance
      : NEAR_ALLOC_MIN_ADDRESS;
  const maxAddr =
    targetAddr + maxDistance < NEAR_ALLOC_MAX_ADDRESS
      ? targetAddr + maxDistance
      : NEAR_ALLOC_MAX_ADDRESS;
  return { target: targetAddr, minAddr, maxAddr, maxDistance };
}

/**
 * Grid-aligned addresses to probe with `query()`, walking outward from
 * `range.target` toward `range.minAddr` (backward) or `range.maxAddr`
 * (forward) in `NEAR_ALLOC_GRANULARITY` steps.
 */
export function* nearProbeAddresses(
  range: NearAllocRange,
  direction: 'backward' | 'forward',
): Generator<bigint> {
  if (direction === 'backward') {
    for (
      let addr = nearAllocAlignDown(range.target, NEAR_ALLOC_GRANULARITY);
      addr >= range.minAddr;
      addr -= NEAR_ALLOC_GRANULARITY
    ) {
      yield addr;
    }
  } else {
    for (
      let addr = nearAllocAlignUp(range.target, NEAR_ALLOC_GRANULARITY);
      addr <= range.maxAddr;
      addr += NEAR_ALLOC_GRANULARITY
    ) {
      yield addr;
    }
  }
}

/**
 * Given a `query()` result at some probed address, returns an
 * allocation-granularity-aligned candidate address if the region is free and
 * large enough to hold `size` bytes within `range`; otherwise `null`.
 */
export function freeRegionCandidate(
  info: MemoryBasicInformation,
  size: number,
  range: NearAllocRange,
): bigint | null {
  if (Number(info.State) !== MemoryState.FREE) return null;
  const baseAddr = BigInt(resolveAddress(info.BaseAddress));
  const regionSize = BigInt(info.RegionSize) || NEAR_ALLOC_GRANULARITY;
  const regionEnd = baseAddr + regionSize;
  const candidate = nearAllocAlignUp(
    baseAddr > range.minAddr ? baseAddr : range.minAddr,
    NEAR_ALLOC_GRANULARITY,
  );
  if (candidate < range.minAddr || candidate + BigInt(size) > range.maxAddr) {
    return null;
  }
  if (candidate + BigInt(size) > regionEnd) return null;
  return candidate;
}

export class AllocNearRangeError extends Error {
  constructor(target: bigint, maxDistance: bigint) {
    super(
      `allocNear: no free region found within 0x${maxDistance.toString(16)} bytes of 0x${target.toString(16)}`,
    );
    this.name = 'AllocNearRangeError';
  }
}
