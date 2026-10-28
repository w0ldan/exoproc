import type {
  CpuStopReason,
  MemoryProtection as EngineMemoryProtection,
  Win64FirstScanCompare,
  Win64NextScanCompare,
  Win64ScanStringEncoding,
  Win64ScanValueType,
  Win64ThreadState,
  X64RegisterName,
} from 'win32-simulate';
import type {
  FirstScanCompare,
  MemoryProtection,
  NextScanCompare,
  RegisterName,
  ScanStringEncoding,
  ScanValueType,
  StopReason,
  ThreadState,
} from '../../common/channels';

/**
 * Compile-time guard against the contract and the engine drifting apart.
 *
 * `shell/common/channels.ts` restates the engine's string unions rather
 * than importing them, because it is reachable from the renderer and the
 * renderer may not see the engine. That restatement is only safe if
 * something checks it -- and the main process is the one place allowed
 * to look at both sides, so it checks it here.
 *
 * Add a register to the engine, or rename a thread state, and this file
 * stops compiling. That is the intended failure: it is far cheaper than
 * discovering the mismatch as a wrong value in the UI.
 */

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export const CONTRACT_MATCHES_ENGINE: readonly [
  Exact<RegisterName, X64RegisterName>,
  Exact<ThreadState, Win64ThreadState>,
  Exact<StopReason, CpuStopReason>,
  Exact<MemoryProtection, EngineMemoryProtection>,
  Exact<ScanValueType, Win64ScanValueType>,
  Exact<ScanStringEncoding, Win64ScanStringEncoding>,
  Exact<FirstScanCompare, Win64FirstScanCompare>,
  Exact<NextScanCompare, Win64NextScanCompare>,
] = [true, true, true, true, true, true, true, true];
