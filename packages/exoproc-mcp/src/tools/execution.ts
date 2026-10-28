import { concreteLocalMemoryAccessor, execute, User32Impl } from 'bun-xffi';
import { Handle, Module, Process, Thread, Window } from 'bun-winapi';
import {
  cachedWindowTitles,
  hasActiveSession,
  resolveAccessor,
  getSessionSavedArgs,
} from './session.js';

export interface ExecuteCodeOptions {
  session?: string | number;
  pid?: number;
  target?: string | number;
  code: string;
  unicode?: boolean;
  timeoutMs?: number;
  keepSessionOpen?: boolean;
}

export interface ExecuteLocalCodeOptions {
  code: string;
  unicode?: boolean;
  timeoutMs?: number;
}

export interface ExecutionResponse {
  success: boolean;
  pid?: number;
  result: any;
  logs: string[];
}

function normalizeResult(res: any): any {
  if (res === undefined) return null;
  if (typeof res === 'bigint') return `0x${res.toString(16)}`;
  if (res && typeof res === 'object') {
    if (
      '_view' in res &&
      'address' in res &&
      typeof res.toJSON === 'function'
    ) {
      return res.toJSON();
    }
  }
  return res;
}

/**
 * Discovers top-level windows and inner edit controls belonging to `pid`
 * so `HWND`, `EDIT_HWND`, `TID`, and `WINDOWS` can be pre-populated in `execute_code`.
 */
function inspectProcessWindows(pid: number): {
  hwnd: number;
  editHwnd: number;
  tid: number;
  windows: Array<{
    hwnd: number;
    editHwnd: number;
    title: string;
    className: string;
    threadId: number;
  }>;
} {
  const SYSTEM_CLASSES = new Set(['ime', 'msctfime ui', 'gdk_temp']);
  const isParked = hasActiveSession(pid);
  const windows: Array<{
    hwnd: number;
    editHwnd: number;
    title: string;
    className: string;
    threadId: number;
  }> = [];

  try {
    for (const win of Window.getWindows()) {
      const [tid, winPid] = win.getThreadProcessId();
      if (winPid !== pid) continue;
      const className = win.getClassName() || '';
      if (SYSTEM_CLASSES.has(className.toLowerCase())) continue;
      const hwnd = Number(win.rawHandle);
      let editHwnd = 0;
      for (const editClass of [
        'Edit',
        'RichEditD2DPT',
        'RichEdit20W',
        'Scintilla',
      ]) {
        try {
          const child = Number(
            User32Impl.FindWindowExW(hwnd, 0, editClass, null),
          );
          if (child !== 0) {
            editHwnd = child;
            break;
          }
        } catch {}
      }
      let title = cachedWindowTitles.get(hwnd) || '';
      if (!isParked) {
        title = win.getText() || title;
        if (title) cachedWindowTitles.set(hwnd, title);
      }
      windows.push({
        hwnd,
        editHwnd,
        title,
        className,
        threadId: tid,
      });
    }
  } catch {}

  const primary =
    windows.find((w) => w.editHwnd !== 0) ??
    windows.find((w) => w.title.length > 0) ??
    windows[0];

  return {
    hwnd: primary?.hwnd ?? 0,
    editHwnd: primary?.editHwnd || primary?.hwnd || 0,
    tid: primary?.threadId ?? 0,
    windows,
  };
}

/**
 * Executes a code snippet inside a remote target process with all Win32 `#define` constants,
 * structs (`RECT`, `MSG`, `POINT`, `WNDCLASSEXW`, etc.), macros (`RGB`, `LOWORD`, `HIWORD`, `MAKELPARAM`),
 * C functions (`SendMessage`, `PostMessage`, `FindWindow`, `SetWindowText`, `GetWindowRect`, `VirtualAlloc`, etc.),
 * pre-bound target context (`PID`, `TID`, `HWND`, `EDIT_HWND`, `WINDOWS`), and message pump (`pumpMessages`) globally in scope.
 */
export async function executeCode(
  options: ExecuteCodeOptions,
): Promise<ExecutionResponse> {
  const sessionKey = options.session ?? options.pid ?? options.target;
  const acc = await resolveAccessor(sessionKey);
  const pid = acc.processId;

  if (typeof (acc as any).init === 'function' && !(acc as any).isInitialized) {
    await (acc as any).init();
  }

  const winInfo = inspectProcessWindows(pid);
  const logs: string[] = [];

  // Wake the GUI thread's message queue via WM_NULL so queued messages process immediately when unparked
  const pumpMessages = (_maxMessages = 64): number => {
    try {
      if (winInfo.hwnd) {
        User32Impl.PostMessageW(winInfo.hwnd, 0n, 0n, 0n);
      }
      if (winInfo.editHwnd && winInfo.editHwnd !== winInfo.hwnd) {
        User32Impl.PostMessageW(winInfo.editHwnd, 0n, 0n, 0n);
      }
    } catch {}
    return 1;
  };

  const currentArgs = getSessionSavedArgs();
  const targetGlobals: Record<string, unknown> = {
    Window,
    Process,
    Thread,
    Module,
    Handle,
    PID: pid,
    TID: winInfo.tid,
    HWND: winInfo.hwnd,
    EDIT_HWND: winInfo.editHwnd,
    WINDOWS: winInfo.windows,
    pumpMessages,
    ARGS: currentArgs,
    savedArgs: currentArgs,
  };

  try {
    const res = await execute(acc, options.code, {
      unicode: options.unicode ?? true,
      sync: true,
      timeoutMs: options.timeoutMs ?? 15000,
      globals: targetGlobals,
      onLog: (line: string) => logs.push(line),
    });

    if (winInfo.hwnd !== 0) {
      pumpMessages(64);
    }

    return {
      success: true,
      pid,
      result: normalizeResult(res),
      logs,
    };
  } catch (err: any) {
    return {
      success: false,
      pid,
      result: {
        error: err?.message || String(err),
        stack: err?.stack,
      },
      logs,
    };
  }
}

/**
 * Executes a code snippet directly in the local runner process with all Win32 `#define` constants,
 * structs (`RECT`, `MSG`, `POINT`, `WNDCLASSEXW`, etc.), macros (`RGB`, `LOWORD`, `HIWORD`, `MAKELPARAM`),
 * and Win32 functions globally in scope.
 */
export async function executeLocalCode(
  options: ExecuteLocalCodeOptions,
): Promise<ExecutionResponse> {
  const logs: string[] = [];
  try {
    const currentArgs = getSessionSavedArgs();
    const res = await execute(concreteLocalMemoryAccessor, options.code, {
      unicode: options.unicode ?? true,
      sync: true,
      timeoutMs: options.timeoutMs ?? 15000,
      globals: {
        Window,
        Process,
        Thread,
        Module,
        Handle,
        ARGS: currentArgs,
        savedArgs: currentArgs,
      },
      onLog: (line: string) => logs.push(line),
    });

    return {
      success: true,
      result: normalizeResult(res),
      logs,
    };
  } catch (err: any) {
    return {
      success: false,
      result: {
        error: err?.message || String(err),
        stack: err?.stack,
      },
      logs,
    };
  }
}
