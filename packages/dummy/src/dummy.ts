import { ptr } from 'bun:ffi';
import {
  Kernel32Impl,
  Advapi32Impl,
  TokenAccess,
  CreateRestrictedTokenFlags,
  ProcessCreationFlags,
  StartupInfoFlags,
  ShowWindowCommand,
  StartupInfoA,
  ProcessInformation,
} from 'bun-xffi';

export interface DummyProcessOptions {
  /** Executable to spawn (default `ping.exe`, an idle, long-lived process). */
  executable?: string;
  /** Arguments for `executable` (default: an effectively-infinite ping). */
  args?: string[];
  /**
   * Spawn onto the interactive desktop with a real, visible window instead
   * of the default headless/no-window spawn (default `false`). Needed for
   * anything a human has to actually click into and type at (e.g. the
   * `notepad-keystroke-hook` example) -- most callers (tests, most examples)
   * want the default: `CREATE_NO_WINDOW` plus no explicit `lpDesktop`, so
   * nothing pops up during automated/headless runs.
   */
  visible?: boolean;
}

interface SpawnedProcess {
  pid: number;
  /** Fully-usable process handle. */
  handle: number;
}

/**
 * Spawns `executable` and returns its pid + a usable process handle. Pluggable
 * via {@link setSpawnStrategy} -- see that function for why.
 */
export type SpawnStrategy = (
  executable: string,
  args: string[],
  visible?: boolean,
) => SpawnedProcess;

/**
 * A single, throwaway Windows process spawned to act as a cross-process
 * target -- for hooking, memory access, thread redirection, etc.
 *
 * Spawned directly via `CreateProcessAsUserA` with a token derived (via
 * `CreateRestrictedToken`) from this (Bun) process's own token, rather than
 * `child_process.spawn` -- the spawned process must run in a plain
 * user-mode context even when this process itself is elevated, and `spawn`
 * would just inherit this process's token unmodified. `CreateRestrictedToken`
 * with `DISABLE_MAX_PRIVILEGE` strips administrative privileges from a
 * duplicate of the caller's own token; because the resulting token is still
 * derived from the caller's own primary token (not an arbitrary one),
 * `SE_ASSIGN_PRIMARYTOKEN_NAME` is not required to hand it to
 * `CreateProcessAsUser` (see MSDN).
 *
 * This call reliably crashes Bun (`EXCEPTION_ACCESS_VIOLATION` inside
 * `CreateProcessA`'s own one-time lazy initialization) specifically on
 * GitHub Actions' *hosted* runners -- confirmed via a standalone,
 * step-by-step diagnostic script identical in both environments: it
 * completes cleanly under Wine locally and on real Windows hardware
 * locally, and faults on the exact same `CreateProcessAsUserA` call on both
 * a GitHub-hosted Linux+Wine runner and a GitHub-hosted `windows-latest`
 * runner. Not a code bug and not Wine-specific -- an incompatibility
 * between this call and GitHub's hosted-runner virtualization specifically.
 * See `tests/setup.ts` for how the test suite substitutes a
 * `child_process.spawn`-based {@link SpawnStrategy} only when running in
 * that environment, without touching this implementation.
 */
export class DummyProcess {
  public readonly pid: number;
  public handle: number;

  /**
   * @param executable Executable to spawn (default `ping.exe`). Must be a
   *   process whose threads periodically return to user mode on their own
   *   (e.g. `ping.exe`'s ~1s timer wait between echoes) -- `nthread`'s
   *   hijack redirects RIP via `SetThreadContext`, but that only takes
   *   effect once the thread actually returns to user mode; a thread parked
   *   in an indefinite, event-driven kernel wait (e.g. `cmd.exe`'s
   *   `ReadConsoleInput` with nothing ever typed into it) never does, so the
   *   hijack times out waiting for it to land at the sleep stub.
   * @param args Arguments for `executable` (default: an effectively-infinite
   *   ping, so no caller ever runs long enough to see it exit underneath them).
   */
  constructor(options: DummyProcessOptions = {}) {
    const executable = options.executable ?? 'ping.exe';
    const args = options.args ?? ['127.0.0.1', '-n', '1000000'];

    const spawned = spawnStrategy(executable, args, options.visible);
    this.pid = spawned.pid;
    this.handle = spawned.handle;

    // Block synchronously until the process has actually started (its main
    // thread must exist before callers can enumerate/hijack it).
    Bun.sleepSync(2000);
  }

  // Waits for the spawned process to *actually* be gone before returning:
  // TerminateProcess only requests death, so a slow/loaded CI runner could
  // otherwise resume while the OS is still mid-rundown of the killed process.
  async stop(): Promise<void> {
    const handle = this.handle;
    this.handle = 0;
    if (handle === 0) return;

    Kernel32Impl.TerminateProcess(handle, 0);

    // WAIT_OBJECT_0 = 0 (signaled/terminated); WAIT_TIMEOUT = 0x102 (still
    // alive). Poll up to ~5s so even a slow rundown fully completes before
    // we proceed, rather than being abandoned after a fixed wait.
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (Kernel32Impl.WaitForSingleObject(handle, 0) === 0) break;
      Bun.sleepSync(25);
    }
    Kernel32Impl.CloseHandle(handle);

    // Small extra grace period for the OS's own process-death handling to settle.
    await new Promise((r) => setTimeout(r, 250));
  }
}

function spawnDeElevated(
  executable: string,
  args: string[],
  visible = false,
): SpawnedProcess {
  const commandLine = `"${executable}"${args.length ? ` ${args.join(' ')}` : ''}`;
  const commandLineBuf = Buffer.concat([
    Buffer.from(commandLine + '\0', 'latin1'),
    Buffer.alloc(32),
  ]);

  // `CreateProcessAsUserA` with a token derived via `CreateRestrictedToken`
  // doesn't reliably land the spawned process on the caller's own
  // interactive window station/desktop unless `lpDesktop` says so
  // explicitly -- an unset (null) `lpDesktop` leaves that up to the OS's own
  // default, which isn't guaranteed to be the visible desktop. "winsta0"
  // is always the interactive window station; "default" is its default
  // desktop -- this is the standard fix for "spawned process's window never
  // shows up" with CreateProcessAsUser*. Kept alive for the whole call
  // (referenced by `startupInfo.lpDesktop` below via its native address).
  const desktopBuf = visible
    ? Buffer.from('winsta0\\default\0', 'latin1')
    : null;

  const tokenOut = Buffer.alloc(8);
  const gotToken = Advapi32Impl.OpenProcessToken(
    Kernel32Impl.GetCurrentProcess(),
    TokenAccess.combine(
      TokenAccess.DUPLICATE,
      TokenAccess.QUERY,
      TokenAccess.ASSIGN_PRIMARY,
      TokenAccess.ADJUST_DEFAULT,
      TokenAccess.ADJUST_SESSIONID,
    ),
    tokenOut,
  );
  if (!gotToken) {
    throw new Error(
      `OpenProcessToken failed for this process's own token (GetLastError=${Kernel32Impl.GetLastError()})`,
    );
  }
  const hToken = tokenOut.readBigUInt64LE(0);

  const restrictedOut = Buffer.alloc(8);
  const restricted = Advapi32Impl.CreateRestrictedToken(
    hToken,
    CreateRestrictedTokenFlags.DISABLE_MAX_PRIVILEGE,
    0,
    0,
    0,
    0,
    0,
    0,
    restrictedOut,
  );
  Kernel32Impl.CloseHandle(hToken);
  if (!restricted) {
    throw new Error(
      `CreateRestrictedToken failed (GetLastError=${Kernel32Impl.GetLastError()})`,
    );
  }
  const hRestrictedToken = restrictedOut.readBigUInt64LE(0);

  const startupInfo = StartupInfoA.allocSync();
  startupInfo.assign({
    cb: StartupInfoA.computed.totalSize,
    lpReserved: null,
    lpDesktop: desktopBuf ? ptr(desktopBuf) : null,
    lpTitle: null,
    dwX: 0,
    dwY: 0,
    dwXSize: 0,
    dwYSize: 0,
    dwXCountChars: 0,
    dwYCountChars: 0,
    dwFillAttribute: 0,
    dwFlags: visible ? StartupInfoFlags.USESHOWWINDOW : 0,
    wShowWindow: visible ? ShowWindowCommand.SW_SHOWNORMAL : 0,
    cbReserved2: 0,
    lpReserved2: null,
    hStdInput: 0n,
    hStdOutput: 0n,
    hStdError: 0n,
  });

  const processInfo = ProcessInformation.allocSync();
  processInfo.assign({
    hProcess: 0n,
    hThread: 0n,
    dwProcessId: 0,
    dwThreadId: 0,
  });

  const created = Advapi32Impl.CreateProcessAsUserA(
    hRestrictedToken,
    0,
    commandLineBuf,
    0,
    0,
    0,
    visible ? 0 : ProcessCreationFlags.CREATE_NO_WINDOW,
    0,
    0,
    startupInfo,
    processInfo,
  );
  Kernel32Impl.CloseHandle(hRestrictedToken);
  if (!created) {
    throw new Error(
      `CreateProcessAsUserA failed to spawn ${executable} (GetLastError=${Kernel32Impl.GetLastError()})`,
    );
  }

  const pid = Number(processInfo.dwProcessId);
  // CreateProcessAsUser hands back a fully-usable process handle directly --
  // no separate OpenProcess needed.
  const handle = Number(processInfo.hProcess);
  // processInfo.hThread is unused -- close it, we only care about the process.
  const hThread = Number(processInfo.hThread);
  if (hThread) Kernel32Impl.CloseHandle(hThread);

  return { pid, handle };
}

// Pluggable so a caller (namely tests/setup.ts, for the GitHub-hosted-runner
// crash documented on DummyProcess above) can substitute a different spawn
// mechanism without patching this file -- defaults to the real, de-elevated
// implementation everywhere else (including production use and local dev).
let spawnStrategy: SpawnStrategy = spawnDeElevated;

/**
 * Overrides how every subsequently-constructed `DummyProcess` spawns its
 * child. Only intended for environments where {@link spawnDeElevated} itself
 * is known to be broken (see the crash writeup on `DummyProcess` above) --
 * production code and local development should never need this. Does not
 * affect a `DummyProcess` that's already been constructed.
 */
export function setSpawnStrategy(strategy: SpawnStrategy): void {
  spawnStrategy = strategy;
}

/** Restores the default de-elevated spawn strategy. */
export function resetSpawnStrategy(): void {
  spawnStrategy = spawnDeElevated;
}

// This (Bun) process spawns and owns a single shared dummy directly -- not
// per-caller. Every test file / package that just needs *some* cross-process
// target reuses the same one instead of spawning (and tearing down) its own,
// which both avoids the spawn+kill race documented above and cuts total
// suite time significantly. Lazily spawned on first use.
let globalDummy: DummyProcess | undefined;

/** Returns the shared dummy process, spawning it on first call. `options`
 * only take effect the first time -- once spawned, the same instance is
 * reused regardless of what's passed on later calls. */
export function getGlobalDummyProcess(
  options?: DummyProcessOptions,
): DummyProcess {
  if (!globalDummy) {
    globalDummy = new DummyProcess(options);
  }
  return globalDummy;
}

/** Terminates and releases the shared dummy process, if one was ever
 * spawned, and forgets the cached instance so the next
 * `getGlobalDummyProcess()` call spawns a fresh one. */
export async function closeGlobalDummyProcess(): Promise<void> {
  const dummy = globalDummy;
  globalDummy = undefined;
  if (!dummy) return;
  await dummy.stop();
}
