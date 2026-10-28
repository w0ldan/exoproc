import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { User32Impl, type HostAccessor } from 'bun-xffi';
import { Window } from 'bun-winapi';
import { createAccessor } from 'exoproc-accessors';

export interface OpenAccessorOptions {
  pid: number;
  sharedMemory?: boolean;
  savePath?: string;
  njava?: boolean | 'auto' | 'stealth';
}

export interface OpenAccessorResult {
  success: boolean;
  sessionId: string;
  sessionFile: string;
  pid: number;
  threadId?: number;
  accessorType: string;
  sessionData: any;
  message: string;
}

export interface ActiveSessionEntry {
  sessionId: string;
  sessionFile: string;
  pid: number;
  threadId?: number;
  accessor: HostAccessor;
  openedAt: number;
  savedArgs: any[];
  capturedHit?: any | null;
  baseAccessor?: HostAccessor | null;
}

let activeSession: ActiveSessionEntry | null = null;
let globalSavedArgs: any[] = [];

export function setActiveSession(session: ActiveSessionEntry | null): void {
  activeSession = session;
}

export function getSessionSavedArgs(): any[] {
  const current = getActiveSession();
  if (current) {
    if (!current.savedArgs) current.savedArgs = [];
    return current.savedArgs;
  }
  return globalSavedArgs;
}

export function setSessionSavedArgs(args: any[]): void {
  const current = getActiveSession();
  if (current) {
    current.savedArgs = Array.isArray(args) ? args : [args];
  } else {
    globalSavedArgs = Array.isArray(args) ? args : [args];
  }
}

export const cachedWindowTitles = new Map<number, string>();

export function getActiveSession(): ActiveSessionEntry | null {
  if (activeSession && activeSession.accessor.isSealed) {
    activeSession = null;
  }
  return activeSession;
}

export function hasActiveSession(pid?: number): boolean {
  const current = getActiveSession();
  if (!current) return false;
  return pid !== undefined ? current.pid === pid : true;
}

export function getSessionFileForPid(pid: number): string {
  return join(tmpdir(), `exoproc-session-${pid}.json`);
}

export function pulseWakeTargetWindows(pid: number): () => void {
  const wakeTimer = setInterval(() => {
    try {
      for (const win of Window.getWindows()) {
        if (win.getThreadProcessId()[1] === pid) {
          User32Impl.PostMessageW(win.rawHandle, 0n /* WM_NULL */, 0n, 0n);
        }
      }
    } catch {}
  }, 40);
  return () => clearInterval(wakeTimer);
}

/**
 * Attaches to a target process, creates a persistent accessor, saves its state to a JSON session file,
 * and activates the single allowed MCP accessor session.
 */
export async function openAccessor(
  options: OpenAccessorOptions,
): Promise<OpenAccessorResult> {
  const current = getActiveSession();
  if (current) {
    throw new Error(
      `An accessor session is already active (sessionId: "${current.sessionId}", PID: ${current.pid}). ` +
        `The MCP server supports only 1 active accessor session at a time. Call close_accessor first before opening a new session.`,
    );
  }

  const sessionFile = options.savePath ?? getSessionFileForPid(options.pid);

  // Snapshot window titles before parking the GUI thread so GetWindowTextW (WM_GETTEXT)
  // never needs to be sent while the GUI thread is suspended at spinStub.
  try {
    for (const win of Window.getWindows()) {
      if (win.getThreadProcessId()[1] === options.pid) {
        const hwnd = Number(win.rawHandle);
        const title = win.getText();
        if (title) cachedWindowTitles.set(hwnd, title);
      }
    }
  } catch {}

  // For GUI processes whose main thread may be parked inside GetMessage/WaitMessage,
  // pulse WM_NULL so the thread returns to user mode and lands the nthread hijack immediately.
  const stopWake = pulseWakeTargetWindows(options.pid);

  let restored: HostAccessor;
  let sessionData: any;
  try {
    const accessor = await createAccessor(options.pid, {
      sharedMemory: options.sharedMemory ?? false,
      njava: options.njava ?? false,
    });
    sessionData = accessor.toJSON();
    writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2), 'utf8');
    restored = accessor;
  } finally {
    stopWake();
  }

  const nthreadLayer = sessionData.pipeline?.find(
    (p: any) => p.type === 'NThread',
  );

  const sessionId = `session-${options.pid}`;
  activeSession = {
    sessionId,
    sessionFile,
    pid: options.pid,
    threadId: nthreadLayer?.state?.threadId,
    accessor: restored,
    openedAt: Date.now(),
    savedArgs: [],
    capturedHit: null,
    baseAccessor: null,
  };

  return {
    success: true,
    sessionId,
    sessionFile,
    pid: options.pid,
    threadId: nthreadLayer?.state?.threadId,
    accessorType: sessionData.accessorType,
    sessionData,
    message: `Accessor opened successfully for PID ${options.pid}. Session "${sessionId}" is now active. All subsequent tools will operate on this session until close_accessor is called.`,
  };
}

/**
 * Resolves the currently active HostAccessor.
 * Requires open_accessor to have been called first. Never automatically opens an accessor.
 */
export async function resolveAccessor(
  sessionInput?: string | number,
): Promise<HostAccessor> {
  const current = getActiveSession();
  if (!current) {
    throw new Error(
      'No active accessor session is currently open. You must call open_accessor({ pid: <PID> }) first before executing code or accessing memory.',
    );
  }

  if (
    sessionInput !== undefined &&
    sessionInput !== null &&
    String(sessionInput).trim() !== ''
  ) {
    const key = String(sessionInput).trim();
    const pidMatch = key.match(/^(?:session-)?(\d+)$/i);
    const numericPid = pidMatch ? parseInt(pidMatch[1]!, 10) : NaN;

    const matches =
      key === current.sessionId ||
      key === current.sessionFile ||
      (!isNaN(numericPid) && numericPid === current.pid);

    if (!matches) {
      throw new Error(
        `Session identifier "${sessionInput}" does not match the active session (active: "${current.sessionId}", PID: ${current.pid}). ` +
          `Call close_accessor first if you wish to attach to a different process.`,
      );
    }
  }

  return current.accessor;
}

/**
 * Closes the active accessor session, safely restores target thread execution / hooks, and cleans up session files.
 */
export async function closeAccessor(options?: {
  session?: string | number;
}): Promise<{ success: boolean; message: string }> {
  const current = getActiveSession();
  if (!current) {
    return {
      success: true,
      message: 'No active session was open.',
    };
  }

  if (
    options?.session !== undefined &&
    options?.session !== null &&
    String(options.session).trim() !== ''
  ) {
    const key = String(options.session).trim();
    const pidMatch = key.match(/^(?:session-)?(\d+)$/i);
    const numericPid = pidMatch ? parseInt(pidMatch[1]!, 10) : NaN;

    const matches =
      key === current.sessionId ||
      key === current.sessionFile ||
      (!isNaN(numericPid) && numericPid === current.pid);

    if (!matches) {
      return {
        success: false,
        message: `Specified session "${options.session}" does not match the active session ("${current.sessionId}"). Active session was left open.`,
      };
    }
  }

  const s = current;
  activeSession = null;

  // 1. Resume any thread currently captured
  if (s.capturedHit) {
    try {
      if (typeof (s.accessor as any).deinit === 'function') {
        await (s.accessor as any).deinit();
      }
    } catch (err) {
      console.error('Failed to auto-resume captured thread on close:', err);
    }
    s.capturedHit = null;
  }

  // 2. Deinit base accessor if different from captured accessor
  if (s.baseAccessor && s.baseAccessor !== s.accessor) {
    try {
      if (typeof (s.baseAccessor as any).deinit === 'function') {
        await (s.baseAccessor as any).deinit();
      }
      const nt = (s.baseAccessor as any)?.nthread;
      if (nt && typeof nt.deinit === 'function') {
        await nt.deinit();
      }
      s.baseAccessor.close();
    } catch {}
    s.baseAccessor = null;
  }

  try {
    if (typeof (s.accessor as any).deinit === 'function') {
      await (s.accessor as any).deinit();
    }
  } catch (err) {
    console.error('[closeAccessor] s.accessor.deinit error:', err);
  }

  try {
    if (existsSync(s.sessionFile)) {
      unlinkSync(s.sessionFile);
    }
  } catch {}

  return {
    success: true,
    message: `Session "${s.sessionId}" (PID: ${s.pid}) closed and thread execution restored successfully.`,
  };
}
