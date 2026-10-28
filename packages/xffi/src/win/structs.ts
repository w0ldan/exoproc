import { struct } from '../struct.js';

/**
 * Windows MEMORY_BASIC_INFORMATION structure.
 * Unified under a single class definition extending the dynamically compiled struct.
 */
export class MemoryBasicInformation extends struct({
  BaseAddress: 'ptr',
  AllocationBase: 'ptr',
  AllocationProtect: 'DWORD',
  PartitionId: 'WORD',
  RegionSize: 'usize',
  State: 'DWORD',
  Protect: 'DWORD',
  Type: 'DWORD',
} as const) {
  static readonly structName = 'MEMORY_BASIC_INFORMATION';
}

export const MEMORY_BASIC_INFORMATION_SIZE = 48;
export const PROCESSENTRY32W_SIZE = 568;
export const MODULEENTRY32W_SIZE = 1080;
export const THREADENTRY32_SIZE = 28;
export const HEAPLIST32_SIZE = 32;
export const HEAPENTRY32_SIZE = 56;

/**
 * Windows POINT structure.
 */
export class Point extends struct({
  x: 'i32',
  y: 'i32',
} as const) {
  static readonly structName = 'POINT';
}

/**
 * Windows RECT structure.
 */
export class Rect extends struct({
  left: 'i32',
  top: 'i32',
  right: 'i32',
  bottom: 'i32',
} as const) {
  static readonly structName = 'RECT';
}

/**
 * Windows WNDCLASSEXW structure.
 */
export class WndClassExW extends struct({
  cbSize: 'u32',
  style: 'u32',
  lpfnWndProc: 'ptr',
  cbClsExtra: 'i32',
  cbWndExtra: 'i32',
  hInstance: 'ptr',
  hIcon: 'ptr',
  hCursor: 'ptr',
  hbrBackground: 'ptr',
  lpszMenuName: 'ptr',
  lpszClassName: 'ptr',
  hIconSm: 'ptr',
} as const) {
  static readonly structName = 'WNDCLASSEXW';
}

/**
 * Windows MSG structure.
 */
export class Msg extends struct({
  hwnd: 'ptr',
  message: 'u32',
  wParam: 'usize',
  lParam: 'isize',
  time: 'u32',
  pt: Point,
  lPrivate: 'u32',
} as const) {
  static readonly structName = 'MSG';
}

/**
 * Windows PAINTSTRUCT structure.
 */
export class PaintStruct extends struct({
  hdc: 'ptr',
  fErase: 'i32',
  rcPaint: Rect,
  fRestore: 'i32',
  fIncUpdate: 'i32',
  rgbReserved: ['u8', 32],
} as const) {
  static readonly structName = 'PAINTSTRUCT';
}

/**
 * Windows SECURITY_ATTRIBUTES structure.
 */
export class SecurityAttributes extends struct({
  nLength: 'DWORD',
  lpSecurityDescriptor: 'LPVOID',
  bInheritHandle: 'BOOL',
} as const) {
  static readonly structName = 'SECURITY_ATTRIBUTES';
}

/**
 * Windows STARTUPINFOA structure.
 */
export class StartupInfoA extends struct({
  cb: 'DWORD',
  lpReserved: 'ptr',
  lpDesktop: 'ptr',
  lpTitle: 'ptr',
  dwX: 'DWORD',
  dwY: 'DWORD',
  dwXSize: 'DWORD',
  dwYSize: 'DWORD',
  dwXCountChars: 'DWORD',
  dwYCountChars: 'DWORD',
  dwFillAttribute: 'DWORD',
  dwFlags: 'DWORD',
  wShowWindow: 'WORD',
  cbReserved2: 'WORD',
  lpReserved2: 'ptr',
  hStdInput: 'HANDLE',
  hStdOutput: 'HANDLE',
  hStdError: 'HANDLE',
} as const) {
  static readonly structName = 'STARTUPINFOA';
}

/**
 * Windows PROCESS_INFORMATION structure.
 */
export class ProcessInformation extends struct({
  hProcess: 'HANDLE',
  hThread: 'HANDLE',
  dwProcessId: 'DWORD',
  dwThreadId: 'DWORD',
} as const) {
  static readonly structName = 'PROCESS_INFORMATION';
}

/**
 * Windows SIZE structure.
 */
export class Size extends struct({
  cx: 'i32',
  cy: 'i32',
} as const) {
  static readonly structName = 'SIZE';
}

/**
 * Windows GUITHREADINFO structure.
 */
export class GuiThreadInfo extends struct({
  cbSize: 'DWORD',
  flags: 'DWORD',
  hwndActive: 'ptr',
  hwndFocus: 'ptr',
  hwndCapture: 'ptr',
  hwndMenuOwner: 'ptr',
  hwndMoveSize: 'ptr',
  hwndCaret: 'ptr',
  rcCaret: Rect,
} as const) {
  static readonly structName = 'GUITHREADINFO';
}

/**
 * Windows WINDOWPLACEMENT structure.
 */
export class WindowPlacement extends struct({
  length: 'u32',
  flags: 'u32',
  showCmd: 'u32',
  ptMinPosition: Point,
  ptMaxPosition: Point,
  rcNormalPosition: Rect,
} as const) {
  static readonly structName = 'WINDOWPLACEMENT';
}

/**
 * Windows COPYDATASTRUCT structure.
 */
export class CopyDataStruct extends struct({
  dwData: 'usize',
  cbData: 'DWORD',
  lpData: 'ptr',
} as const) {
  static readonly structName = 'COPYDATASTRUCT';
}

/**
 * Windows KEYBDINPUT structure.
 */
export class KeybdInput extends struct({
  wVk: 'WORD',
  wScan: 'WORD',
  dwFlags: 'DWORD',
  time: 'DWORD',
  dwExtraInfo: 'usize',
} as const) {
  static readonly structName = 'KEYBDINPUT';
}

/**
 * Windows MOUSEINPUT structure.
 */
export class MouseInput extends struct({
  dx: 'i32',
  dy: 'i32',
  mouseData: 'DWORD',
  dwFlags: 'DWORD',
  time: 'DWORD',
  dwExtraInfo: 'usize',
} as const) {
  static readonly structName = 'MOUSEINPUT';
}

/**
 * Windows PROCESSENTRY32W structure.
 */
export class ProcessEntry32W extends struct({
  dwSize: 'DWORD',
  cntUsage: 'DWORD',
  th32ProcessID: 'DWORD',
  th32DefaultHeapID: 'usize',
  th32ModuleID: 'DWORD',
  cntThreads: 'DWORD',
  th32ParentProcessID: 'DWORD',
  pcPriClassBase: 'i32',
  dwFlags: 'DWORD',
  szExeFile: ['u16', 260],
} as const) {
  static readonly structName = 'PROCESSENTRY32W';
}

/**
 * Windows MODULEENTRY32W structure.
 */
export class ModuleEntry32W extends struct({
  dwSize: 'DWORD',
  th32ModuleID: 'DWORD',
  th32ProcessID: 'DWORD',
  GlblcntUsage: 'DWORD',
  ProccntUsage: 'DWORD',
  modBaseAddr: 'ptr',
  modBaseSize: 'DWORD',
  hModule: 'ptr',
  szModule: ['u16', 256],
  szExePath: ['u16', 260],
} as const) {
  static readonly structName = 'MODULEENTRY32W';
}

/**
 * Windows THREADENTRY32 structure.
 */
export class ThreadEntry32 extends struct({
  dwSize: 'DWORD',
  cntUsage: 'DWORD',
  th32ThreadID: 'DWORD',
  th32OwnerProcessID: 'DWORD',
  tpBasePri: 'i32',
  tpDeltaPri: 'i32',
  dwFlags: 'DWORD',
} as const) {
  static readonly structName = 'THREADENTRY32';
}

// C-style UPPERCASE struct aliases so scripts can write `new RECT()`, `new MSG()`, etc.
export const MEMORY_BASIC_INFORMATION = MemoryBasicInformation;
export const POINT = Point;
export const RECT = Rect;
export const SIZE = Size;
export const WNDCLASSEXW = WndClassExW;
export const WNDCLASSEX = WndClassExW;
export const MSG = Msg;
export const PAINTSTRUCT = PaintStruct;
export const SECURITY_ATTRIBUTES = SecurityAttributes;
export const STARTUPINFOA = StartupInfoA;
export const STARTUPINFOW = StartupInfoA;
export const STARTUPINFO = StartupInfoA;
export const PROCESS_INFORMATION = ProcessInformation;
export const GUITHREADINFO = GuiThreadInfo;
export const WINDOWPLACEMENT = WindowPlacement;
export const COPYDATASTRUCT = CopyDataStruct;
export const KEYBDINPUT = KeybdInput;
export const MOUSEINPUT = MouseInput;
export const PROCESSENTRY32W = ProcessEntry32W;
export const PROCESSENTRY32 = ProcessEntry32W;
export const MODULEENTRY32W = ModuleEntry32W;
export const MODULEENTRY32 = ModuleEntry32W;
export const THREADENTRY32 = ThreadEntry32;

export const ALL_WIN32_STRUCTS: Record<string, any> = {
  MemoryBasicInformation,
  MEMORY_BASIC_INFORMATION,
  MEMORY_BASIC_INFORMATION_SIZE,
  PROCESSENTRY32W_SIZE,
  MODULEENTRY32W_SIZE,
  THREADENTRY32_SIZE,
  HEAPLIST32_SIZE,
  HEAPENTRY32_SIZE,
  Point,
  POINT,
  Rect,
  RECT,
  Size,
  SIZE,
  WndClassExW,
  WNDCLASSEXW,
  WNDCLASSEX,
  Msg,
  MSG,
  PaintStruct,
  PAINTSTRUCT,
  SecurityAttributes,
  SECURITY_ATTRIBUTES,
  StartupInfoA,
  STARTUPINFOA,
  STARTUPINFOW,
  STARTUPINFO,
  ProcessInformation,
  PROCESS_INFORMATION,
  GuiThreadInfo,
  GUITHREADINFO,
  WindowPlacement,
  WINDOWPLACEMENT,
  CopyDataStruct,
  COPYDATASTRUCT,
  KeybdInput,
  KEYBDINPUT,
  MouseInput,
  MOUSEINPUT,
  ProcessEntry32W,
  PROCESSENTRY32W,
  PROCESSENTRY32,
  ModuleEntry32W,
  MODULEENTRY32W,
  MODULEENTRY32,
  ThreadEntry32,
  THREADENTRY32,
};

/**
 * Windows GUITHREADINFO structure interface.
 */
export interface GUIThreadInfo {
  cbSize: number;
  flags: number;
  hwndActive: bigint;
  hwndFocus: bigint;
  hwndCapture: bigint;
  hwndMenuOwner: bigint;
  hwndMoveSize: bigint;
  hwndCaret: bigint;
  rcCaret: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}
