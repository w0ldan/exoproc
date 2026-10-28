import { ExoprocError } from 'exoproc-utils';

// ── Base ──────────────────────────────────────────────────────────────────────

abstract class BaseError extends ExoprocError {
  constructor(
    message: string,
    options?: { data?: unknown; code?: string; cause?: Error },
  ) {
    super(message, options);
  }
}

// ── Trampoline errors ─────────────────────────────────────────────────────────

export class MinHookError extends BaseError {}

export class TrampolineSpaceError extends MinHookError {
  constructor(target: bigint, decodedBytes: number) {
    super(
      `Not enough room to hook 0x${target.toString(16)}: only decoded ${decodedBytes} bytes, need at least 5`,
    );
  }
}

export class TrampolineRelocationError extends MinHookError {
  constructor(reason: string) {
    super(`Cannot relocate target's prologue into a trampoline: ${reason}`);
  }
}

// ── Hook errors ───────────────────────────────────────────────────────────────

export class HookAlreadyEnabledError extends MinHookError {
  constructor(target: bigint) {
    super(`Hook at 0x${target.toString(16)} is already enabled`);
  }
}

export class HookNotEnabledError extends MinHookError {
  constructor(target: bigint) {
    super(`Hook at 0x${target.toString(16)} is not enabled`);
  }
}
