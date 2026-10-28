import { User32Impl } from 'bun-xffi';
type HWND = bigint;
import { FFIType } from 'bun:ffi';
import { type Rect, type GUIThreadInfo } from 'bun-xffi';
import { Handle } from './handle.js';
import { decodeString } from './decoding.js';
import { encodeStringW } from './encoding.js';
import { cjitopen } from 'bun-xffi';
import { currentProcess } from './process.js';

// EnumWindowsProc callback — compiled via TCC (bun:ffi cc)
// Args: rcx = hwnd, rdx = lParam (pointer to struct: { uint32 index, uint32 capacity, uint64 hwnds[] })
let _enumWindowsProcFn: any;
function getEnumWindowsProcFn() {
  if (!_enumWindowsProcFn) {
    _enumWindowsProcFn = cjitopen({
      EnumWindowsProc: {
        args: [FFIType.ptr, FFIType.ptr],
        returns: FFIType.i32,
        source: `
        typedef struct {
            unsigned int index;
            unsigned int capacity;
            void* hwnds[1]; // simplified for TCC
        } EnumCtx;

        int EnumWindowsProc(void* hwnd, void* lParam) {
            EnumCtx* ctx = (EnumCtx*)lParam;
            if (ctx->index >= ctx->capacity) return 0;
            void** hwnds = (void**)((char*)ctx + 8);
            hwnds[ctx->index] = hwnd;
            ctx->index++;
            return 1;
        }
        `,
      },
    }).symbols.EnumWindowsProc;
  }
  return _enumWindowsProcFn;
}

/**
 * Represents a Window handle (HWND).
 *
 * Provides methods for interacting with a specific window.
 */
export class Window extends Handle {
  /**
   * Initializes a new Window instance.
   *
   * @param handle The HWND handle, represented as a bigint.
   * @param isForeign Whether to auto-close the handle (default: false since HWNDs are mostly shared)
   */
  constructor(handle: bigint, isForeign: boolean = false) {
    super(handle, isForeign);
  }

  /**
   * Retrieves the current thread ID and process ID associated with this window.
   * @returns A tuple of [threadId, processId]
   */
  getThreadProcessId(): [number, number] {
    if (!this.isValid()) return [0, 0];

    const pidBuf = Buffer.alloc(4);
    const tid = User32Impl.GetWindowThreadProcessId(
      this.rawHandle as HWND,
      pidBuf,
    );
    const pid = pidBuf.readUInt32LE(0);
    return [tid, pid];
  }

  /**
   * Retrieves the length of the window's title bar text.
   */
  getTextLength(): number {
    if (!this.isValid()) return 0;
    return User32Impl.GetWindowTextLengthW(this.rawHandle as HWND);
  }

  /**
   * Retrieves the window's title bar text.
   */
  getText(): string {
    if (!this.isValid()) return '';

    const length = this.getTextLength();
    if (length === 0) return '';

    // Null terminator inclusive length
    const buf = Buffer.alloc((length + 1) * 2);
    const copiedLength = User32Impl.GetWindowTextW(
      this.rawHandle as HWND,
      buf,
      length + 1,
    );

    if (copiedLength === 0) return '';

    return decodeString(buf.subarray(0, copiedLength * 2), true);
  }

  /**
   * Retrieves the name of the class to which the specified window belongs.
   * @param maxCount Max length of the class name buffer (default 256)
   */
  getClassName(maxCount: number = 256): string {
    if (!this.isValid()) return '';

    const buf = Buffer.alloc(maxCount * 2);
    const copiedLength = User32Impl.GetClassNameW(
      this.rawHandle as HWND,
      buf,
      maxCount,
    );

    if (copiedLength === 0) return '';

    return decodeString(buf.subarray(0, copiedLength * 2), true);
  }

  /**
   * Determines whether the specified window is minimized (iconic).
   */
  isMinimized(): boolean {
    if (!this.isValid()) return false;
    return !!User32Impl.IsIconic(this.rawHandle as HWND);
  }

  /**
   * Determines whether the specified window is maximized (zoomed).
   */
  isMaximized(): boolean {
    if (!this.isValid()) return false;
    return !!User32Impl.IsZoomed(this.rawHandle as HWND);
  }

  /**
   * Retrieves the dimensions of the bounding rectangle of the specified window.
   */
  getRect(): Rect | null {
    if (!this.isValid()) return null;

    const buf = Buffer.alloc(16); // RECT is 16 bytes (4 x 4 bytes)
    const success = User32Impl.GetWindowRect(this.rawHandle as HWND, buf);

    if (!success) return null;

    return {
      left: buf.readInt32LE(0),
      top: buf.readInt32LE(4),
      right: buf.readInt32LE(8),
      bottom: buf.readInt32LE(12),
    } as Rect;
  }

  /**
   * Retrieves information about the active window or a specified graphical user interface (GUI) thread.
   * @param threadId The ID of the thread (0 for the foreground thread)
   */
  static getGUIThreadInfo(threadId: number = 0): GUIThreadInfo | null {
    const size = 72; // GUITHREADINFO_SIZE for x64
    const buf = Buffer.alloc(size);
    buf.writeUInt32LE(size, 0); // cbSize = sizeof(GUITHREADINFO)

    const success = User32Impl.GetGUIThreadInfo(threadId, buf);
    if (!success) return null;

    return {
      cbSize: buf.readUInt32LE(0),
      flags: buf.readUInt32LE(4),
      hwndActive: buf.readBigUInt64LE(8),
      hwndFocus: buf.readBigUInt64LE(16),
      hwndCapture: buf.readBigUInt64LE(24),
      hwndMenuOwner: buf.readBigUInt64LE(32),
      hwndMoveSize: buf.readBigUInt64LE(40),
      hwndCaret: buf.readBigUInt64LE(48),
      rcCaret: {
        left: buf.readInt32LE(56),
        top: buf.readInt32LE(60),
        right: buf.readInt32LE(64),
        bottom: buf.readInt32LE(68),
      },
    } as GUIThreadInfo;
  }

  /**
   * Enumerates all top-level windows on the screen natively.
   */
  static *getWindows(maxHwnds = 1024): Generator<Window> {
    const seen = new Set<bigint>();

    // 1. Walk top-level desktop windows via FindWindowExW (reliable under Wine/Wayland and native Win32)
    if (User32Impl.FindWindowExW) {
      let child = BigInt(
        (User32Impl.FindWindowExW(0n, 0n, null, null) as any) ?? 0n,
      );
      while (child !== 0n && seen.size < maxHwnds) {
        if (!seen.has(child)) {
          seen.add(child);
          yield new Window(child as unknown as bigint, false);
        }
        const next = BigInt(
          (User32Impl.FindWindowExW(0n, child, null, null) as any) ?? 0n,
        );
        if (next === child) break;
        child = next;
      }
    }

    // 2. Also run EnumWindows to catch any top-level windows not in FindWindowExW chain
    const memSize = 8 + maxHwnds * 8;
    const addr = currentProcess.memory.allocSync(memSize);

    const initBuf = Buffer.alloc(memSize);
    initBuf.writeUInt32LE(0, 0); // index = 0
    initBuf.writeUInt32LE(maxHwnds, 4); // capacity = maxHwnds

    currentProcess.memory.writeSync(addr, initBuf);

    User32Impl.EnumWindows(getEnumWindowsProcFn().ptr, addr as any);

    const readBuf = currentProcess.memory.readSync(addr, memSize);
    currentProcess.memory.freeSync(addr);

    const resultCount = Math.min(readBuf.readUInt32LE(0), maxHwnds);

    for (let i = 0; i < resultCount; i++) {
      if (8 + i * 8 + 8 > readBuf.length) break;
      const hwndBytes = readBuf.subarray(8 + i * 8, 8 + i * 8 + 8);
      const hwnd = hwndBytes.readBigUInt64LE(0);

      if (hwnd !== 0n && !seen.has(hwnd)) {
        seen.add(hwnd);
        yield new Window(hwnd as unknown as bigint, false);
      }
    }
  }

  /**
   * Retrieves a handle to the top-level window whose class name and window name match the specified strings.
   * @param className The class name (or null)
   * @param windowName The window name (or null)
   */
  static find(
    className: string | null,
    windowName: string | null = null,
  ): Window | null {
    if (!className && !windowName) return null;

    const clsBuffer = className ? encodeStringW(className) : null;
    const nameBuffer = windowName ? encodeStringW(windowName) : null;

    const hwnd = User32Impl.FindWindowW(clsBuffer, nameBuffer);
    return hwnd ? new Window(hwnd as unknown as bigint) : null;
  }
}
