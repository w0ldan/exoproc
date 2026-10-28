import * as Native from 'bun-winapi';
import {
  registerStub,
  type Stub,
  type StubDescriptor,
  type StubScanRegion,
} from 'bun-xffi';
import { log } from './logger.js';

const globalsLog = log.add('Globals');

// ---------------------------------------------------------------------------
// GeneralPurposeRegs
// ---------------------------------------------------------------------------

/**
 * Supported 64-bit general purpose registers for x64 redirection.
 */
export type GeneralPurposeRegs = Extract<
  keyof Native.ThreadContext,
  | 'Rax'
  | 'Rcx'
  | 'Rdx'
  | 'Rbx'
  | 'Rsp'
  | 'Rbp'
  | 'Rsi'
  | 'Rdi'
  | 'R8'
  | 'R9'
  | 'R10'
  | 'R11'
  | 'R12'
  | 'R13'
  | 'R14'
  | 'R15'
>;

/**
 * Register priority sequence for redirection.
 * Prefers non-volatile registers (callee-saved) that are less likely to hold
 * critical live data at a random suspension point.
 */
export const leastClobberedRegs: GeneralPurposeRegs[] = [
  'Rbx',
  'Rbp',
  'Rdi',
  'Rsi',
];

// ---------------------------------------------------------------------------
// ThreadStubs
// ---------------------------------------------------------------------------

/**
 * A collection of addresses and register keys used for thread redirection.
 */
export interface ThreadStubs {
  /** 'jmp .' (EB FE) — parks the thread in an infinite loop */
  spinStub: Stub;
  /** 'push reg; ret' — stack pivot to redirect RIP via a register */
  pushRetStub: Stub;
  /** 'jmp reg' — direct register jump */
  jumpStub: Stub;
  /** 'ret' (C3) — single-instruction return */
  retStub: Stub;
  /** 'add rsp, 0x28; ret' — shadow-space bypass + return */
  addRsp28RetStub: Stub;
  /** Register used by the pushRet pivot (e.g. 'Rbx') */
  pushRetRegKey: GeneralPurposeRegs;
  /** Register used by the jump pivot (e.g. 'Rax') */
  jumpRegKey: GeneralPurposeRegs;
}

// ---------------------------------------------------------------------------
// Module regions helper (lazy — resolved once on first use)
// ---------------------------------------------------------------------------

let _regions: StubScanRegion[] | undefined;

function getSystemRegions(): StubScanRegion[] {
  if (_regions) return _regions;
  try {
    if (typeof process !== 'undefined' && process.platform !== 'win32') {
      return [];
    }
    _regions = [
      Native.Module.ntdll,
      Native.Module.kernel32,
      Native.Module.kernelbase,
    ].map((mod) => ({
      base: mod.base.address as bigint | number,
      size: mod.size,
    }));
    globalsLog.debug(
      `[Globals] Resolved ${_regions.length} system module regions`,
    );
    return _regions;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Stub registrations
// Plain 'C3', 'EB FE', etc. — no regKey at this layer.
// Per-register push/jmp stubs are tracked in separate Maps below.
// ---------------------------------------------------------------------------

const LIMIT = 50;

const _sleepDescriptor: StubDescriptor = registerStub('EB FE', {
  limit: LIMIT,
  regions: getSystemRegions(),
});
const _retDescriptor: StubDescriptor = registerStub('C3', {
  limit: LIMIT,
  regions: getSystemRegions(),
});
const _addRsp28RetDescriptor: StubDescriptor = registerStub('48 83 C4 28 C3', {
  limit: LIMIT,
  regions: getSystemRegions(),
});

/** push reg; ret → mapped by register key */
const _pushRetDescriptors = new Map<GeneralPurposeRegs, StubDescriptor>([
  ['Rax', registerStub('50 C3', { limit: LIMIT, regions: getSystemRegions() })],
  ['Rcx', registerStub('51 C3', { limit: LIMIT, regions: getSystemRegions() })],
  ['Rdx', registerStub('52 C3', { limit: LIMIT, regions: getSystemRegions() })],
  ['Rbx', registerStub('53 C3', { limit: LIMIT, regions: getSystemRegions() })],
  ['Rbp', registerStub('55 C3', { limit: LIMIT, regions: getSystemRegions() })],
  ['Rsi', registerStub('56 C3', { limit: LIMIT, regions: getSystemRegions() })],
  ['Rdi', registerStub('57 C3', { limit: LIMIT, regions: getSystemRegions() })],
  [
    'R8',
    registerStub('41 50 C3', { limit: LIMIT, regions: getSystemRegions() }),
  ],
  [
    'R9',
    registerStub('41 51 C3', { limit: LIMIT, regions: getSystemRegions() }),
  ],
  [
    'R10',
    registerStub('41 52 C3', { limit: LIMIT, regions: getSystemRegions() }),
  ],
  [
    'R11',
    registerStub('41 53 C3', { limit: LIMIT, regions: getSystemRegions() }),
  ],
  [
    'R12',
    registerStub('41 54 C3', { limit: LIMIT, regions: getSystemRegions() }),
  ],
  [
    'R13',
    registerStub('41 55 C3', { limit: LIMIT, regions: getSystemRegions() }),
  ],
  [
    'R14',
    registerStub('41 56 C3', { limit: LIMIT, regions: getSystemRegions() }),
  ],
  [
    'R15',
    registerStub('41 57 C3', { limit: LIMIT, regions: getSystemRegions() }),
  ],
]);

/** jmp reg → mapped by register key */
const _jumpDescriptors = new Map<GeneralPurposeRegs, StubDescriptor>([
  ['Rax', registerStub('FF E0', { limit: LIMIT, regions: getSystemRegions() })],
  ['Rcx', registerStub('FF E1', { limit: LIMIT, regions: getSystemRegions() })],
  ['Rdx', registerStub('FF E2', { limit: LIMIT, regions: getSystemRegions() })],
  ['Rbx', registerStub('FF E3', { limit: LIMIT, regions: getSystemRegions() })],
  ['Rbp', registerStub('FF E5', { limit: LIMIT, regions: getSystemRegions() })],
  ['Rsi', registerStub('FF E6', { limit: LIMIT, regions: getSystemRegions() })],
  ['Rdi', registerStub('FF E7', { limit: LIMIT, regions: getSystemRegions() })],
  [
    'R8',
    registerStub('41 FF E0', { limit: LIMIT, regions: getSystemRegions() }),
  ],
  [
    'R9',
    registerStub('41 FF E1', { limit: LIMIT, regions: getSystemRegions() }),
  ],
  [
    'R10',
    registerStub('41 FF E2', { limit: LIMIT, regions: getSystemRegions() }),
  ],
  [
    'R11',
    registerStub('41 FF E3', { limit: LIMIT, regions: getSystemRegions() }),
  ],
  [
    'R12',
    registerStub('41 FF E4', { limit: LIMIT, regions: getSystemRegions() }),
  ],
  [
    'R13',
    registerStub('41 FF E5', { limit: LIMIT, regions: getSystemRegions() }),
  ],
  [
    'R14',
    registerStub('41 FF E6', { limit: LIMIT, regions: getSystemRegions() }),
  ],
  [
    'R15',
    registerStub('41 FF E7', { limit: LIMIT, regions: getSystemRegions() }),
  ],
]);

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/**
 * Resolves once every registered stub descriptor's background scan has
 * completed -- every `getRandomXStub()` below is safe to call synchronously
 * after this resolves. Each `getRandomXStub()` swallows `StubNotReadyError`
 * (and `NoStubFoundError`) via its own try/catch and just returns
 * `undefined`, indistinguishable from "genuinely not found" -- so a caller
 * that races ahead of the scan (e.g. a short script that reaches
 * `NThread.onInit()` moments after process start, before these
 * process-wide, eagerly-started background scans have had time to finish)
 * gets a misleading `NoSleepAddressError`/etc. instead of the real
 * "still scanning" cause. Awaiting this first removes that race entirely.
 */
export function whenStubsReady(): Promise<void> {
  return Promise.all([
    _sleepDescriptor.whenReady(),
    _retDescriptor.whenReady(),
    _addRsp28RetDescriptor.whenReady(),
    ...Array.from(_pushRetDescriptors.values(), (d) => d.whenReady()),
    ...Array.from(_jumpDescriptors.values(), (d) => d.whenReady()),
  ]).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Public accessors — synchronous return, no wait
// ---------------------------------------------------------------------------

/** Returns a random sleep stub (EB FE) synchronously if available. */
export function getRandomSpinStub(): Stub | undefined {
  try {
    return _sleepDescriptor.getStub();
  } catch {
    return undefined;
  }
}

/** Returns a random ret stub (C3) synchronously if available. */
export function getRandomRetStub(): Stub | undefined {
  try {
    return _retDescriptor.getStub();
  } catch {
    return undefined;
  }
}

/** Returns a random 'add rsp, 0x28; ret' stub synchronously if available. */
export function getRandomAddRsp28RetStub(): Stub | undefined {
  try {
    return _addRsp28RetDescriptor.getStub();
  } catch {
    return undefined;
  }
}

/**
 * Returns a random push-reg; ret stub synchronously if available.
 *
 * @param regKey  When provided, returns a stub for that specific register.
 *                When omitted, walks `leastClobberedRegs` in order and returns
 *                the first available class.
 */
export function getRandomPushretStub(
  regKey?: GeneralPurposeRegs,
): { stub: Stub; regKey: GeneralPurposeRegs } | undefined {
  const regsToTry: GeneralPurposeRegs[] = regKey
    ? [regKey]
    : leastClobberedRegs;

  for (const reg of regsToTry) {
    const desc = _pushRetDescriptors.get(reg);
    if (!desc) continue;
    try {
      return { stub: desc.getStub(), regKey: reg };
    } catch {
      // not found for this reg — try next
    }
  }
  return undefined;
}

/**
 * Returns a random jmp-reg stub synchronously if available.
 *
 * @param regKey  When provided, returns a stub for that specific register.
 *                When omitted, walks `leastClobberedRegs` in order.
 */
export function getRandomJumpStub(
  regKey?: GeneralPurposeRegs,
): { stub: Stub; regKey: GeneralPurposeRegs } | undefined {
  const regsToTry: GeneralPurposeRegs[] = regKey
    ? [regKey]
    : leastClobberedRegs;

  for (const reg of regsToTry) {
    const desc = _jumpDescriptors.get(reg);
    if (!desc) continue;
    try {
      return { stub: desc.getStub(), regKey: reg };
    } catch {
      // not found for this reg — try next
    }
  }
  return undefined;
}
