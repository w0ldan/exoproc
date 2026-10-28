import { CType, type Win32Dll } from './types.js';

/**
 * Native User32 Definitions
 */
export const User32Definitions = {
  RegisterClassExW: {
    args: [CType.ptr],
    returns: CType.WORD,
  },
  CreateWindowExW: {
    args: [
      CType.DWORD, // dwExStyle
      'cwstring', // lpClassName
      'cwstring', // lpWindowName
      CType.DWORD, // dwStyle
      CType.INT, // X
      CType.INT, // Y
      CType.INT, // nWidth
      CType.INT, // nHeight
      CType.HWND, // hWndParent
      CType.ptr, // hMenu
      CType.ptr, // hInstance
      CType.LPVOID, // lpParam
    ],
    returns: CType.HWND,
  },
  ShowWindow: {
    args: [CType.HWND, CType.INT],
    returns: CType.BOOL,
  },
  UpdateWindow: {
    args: [CType.HWND],
    returns: CType.BOOL,
  },
  GetMessageW: {
    args: [CType.ptr, CType.HWND, CType.UINT, CType.UINT],
    returns: CType.BOOL,
  },
  PeekMessageW: {
    args: [CType.ptr, CType.HWND, CType.UINT, CType.UINT, CType.UINT],
    returns: CType.BOOL,
  },
  TranslateMessage: {
    args: [CType.ptr],
    returns: CType.BOOL,
  },
  DispatchMessageW: {
    args: [CType.ptr],
    returns: CType.INT_PTR,
  },
  PostQuitMessage: {
    args: [CType.INT],
    returns: CType.void,
  },
  DefWindowProcW: {
    args: [CType.HWND, CType.UINT, CType.usize, CType.i64],
    returns: CType.i64,
  },
  BeginPaint: {
    args: [CType.HWND, CType.ptr],
    returns: CType.ptr,
  },
  EndPaint: {
    args: [CType.HWND, CType.ptr],
    returns: CType.BOOL,
  },
  GetClientRect: {
    args: [CType.HWND, CType.ptr],
    returns: CType.BOOL,
  },
  DrawTextW: {
    args: [CType.ptr, 'cwstring', CType.INT, CType.ptr, CType.UINT],
    returns: CType.INT,
  },
  LoadCursorW: {
    args: [CType.ptr, CType.ptr], // CType.ptr allows numeric ID and HMODULE
    returns: CType.ptr,
  },
  LoadIconW: {
    args: [CType.ptr, CType.ptr], // CType.ptr allows numeric ID and HMODULE
    returns: CType.ptr,
  },
  FillRect: {
    args: [CType.ptr, CType.ptr, CType.ptr], // HDC, LPRECT, HBRUSH
    returns: CType.INT,
  },
  InvalidateRect: {
    args: [CType.HWND, CType.ptr, CType.BOOL],
    returns: CType.BOOL,
  },
  GetDC: {
    args: [CType.HWND],
    returns: CType.ptr,
  },
  ReleaseDC: {
    args: [CType.HWND, CType.ptr],
    returns: CType.INT,
  },
  GetSystemMetrics: {
    args: [CType.INT],
    returns: CType.INT,
  },
  MessageBoxA: {
    args: [CType.HWND, 'cstring', 'cstring', CType.UINT],
    returns: CType.INT,
  },
  MessageBoxW: {
    args: [CType.HWND, 'cwstring', 'cwstring', CType.UINT],
    returns: CType.INT,
  },
  SetTimer: {
    args: [CType.HWND, CType.usize, CType.UINT, CType.ptr],
    returns: CType.usize,
  },
  KillTimer: {
    args: [CType.HWND, CType.usize],
    returns: CType.BOOL,
  },
  GetWindowThreadProcessId: {
    args: [CType.HWND, CType.ptr],
    returns: CType.DWORD,
  },
  GetWindowTextLengthW: {
    args: [CType.HWND],
    returns: CType.INT,
  },
  GetWindowTextW: {
    args: [CType.HWND, CType.ptr, CType.INT],
    returns: CType.INT,
  },
  GetClassNameW: {
    args: [CType.HWND, CType.ptr, CType.INT],
    returns: CType.INT,
  },
  IsIconic: {
    args: [CType.HWND],
    returns: CType.BOOL,
  },
  IsZoomed: {
    args: [CType.HWND],
    returns: CType.BOOL,
  },
  GetWindowRect: {
    args: [CType.HWND, CType.ptr],
    returns: CType.BOOL,
  },
  GetGUIThreadInfo: {
    args: [CType.DWORD, CType.ptr],
    returns: CType.BOOL,
  },
  EnumWindows: {
    args: [CType.ptr, CType.LPVOID],
    returns: CType.BOOL,
  },
  FindWindowA: {
    args: ['cstring', 'cstring'],
    returns: CType.HWND,
  },
  FindWindowW: {
    args: ['cwstring', 'cwstring'],
    returns: CType.HWND,
  },
  FindWindowExA: {
    args: [CType.HWND, CType.HWND, 'cstring', 'cstring'],
    returns: CType.HWND,
  },
  FindWindowExW: {
    args: [CType.HWND, CType.HWND, 'cwstring', 'cwstring'],
    returns: CType.HWND,
  },
  PostMessageA: {
    args: [CType.HWND, CType.UINT, CType.usize, CType.i64],
    returns: CType.BOOL,
  },
  PostMessageW: {
    args: [CType.HWND, CType.UINT, CType.usize, CType.i64],
    returns: CType.BOOL,
  },
  SendMessageA: {
    args: [CType.HWND, CType.UINT, CType.usize, CType.ptr],
    returns: CType.i64,
  },
  SendMessageW: {
    args: [CType.HWND, CType.UINT, CType.usize, CType.ptr],
    returns: CType.i64,
  },
  SetWindowTextA: {
    args: [CType.HWND, 'cstring'],
    returns: CType.BOOL,
  },
  SetWindowTextW: {
    args: [CType.HWND, 'cwstring'],
    returns: CType.BOOL,
  },
  GetWindowTextLengthA: {
    args: [CType.HWND],
    returns: CType.INT,
  },
  GetWindowTextA: {
    args: [CType.HWND, CType.ptr, CType.INT],
    returns: CType.INT,
  },
  GetClassNameA: {
    args: [CType.HWND, CType.ptr, CType.INT],
    returns: CType.INT,
  },
  GetWindow: {
    args: [CType.HWND, CType.UINT],
    returns: CType.HWND,
  },
  GetParent: {
    args: [CType.HWND],
    returns: CType.HWND,
  },
  GetAncestor: {
    args: [CType.HWND, CType.UINT],
    returns: CType.HWND,
  },
  GetTopWindow: {
    args: [CType.HWND],
    returns: CType.HWND,
  },
  EnumChildWindows: {
    args: [CType.HWND, CType.ptr, CType.LPVOID],
    returns: CType.BOOL,
  },
  EnumThreadWindows: {
    args: [CType.DWORD, CType.ptr, CType.LPVOID],
    returns: CType.BOOL,
  },
  IsWindow: {
    args: [CType.HWND],
    returns: CType.BOOL,
  },
  IsWindowVisible: {
    args: [CType.HWND],
    returns: CType.BOOL,
  },
  IsWindowEnabled: {
    args: [CType.HWND],
    returns: CType.BOOL,
  },
  EnableWindow: {
    args: [CType.HWND, CType.BOOL],
    returns: CType.BOOL,
  },
  SetFocus: {
    args: [CType.HWND],
    returns: CType.HWND,
  },
  GetFocus: {
    args: [],
    returns: CType.HWND,
  },
  SetActiveWindow: {
    args: [CType.HWND],
    returns: CType.HWND,
  },
  GetActiveWindow: {
    args: [],
    returns: CType.HWND,
  },
  MoveWindow: {
    args: [CType.HWND, CType.INT, CType.INT, CType.INT, CType.INT, CType.BOOL],
    returns: CType.BOOL,
  },
  SetWindowPos: {
    args: [
      CType.HWND,
      CType.HWND,
      CType.INT,
      CType.INT,
      CType.INT,
      CType.INT,
      CType.UINT,
    ],
    returns: CType.BOOL,
  },
  DestroyWindow: {
    args: [CType.HWND],
    returns: CType.BOOL,
  },
  CloseWindow: {
    args: [CType.HWND],
    returns: CType.BOOL,
  },
  GetDlgItem: {
    args: [CType.HWND, CType.INT],
    returns: CType.HWND,
  },
  SendDlgItemMessageA: {
    args: [CType.HWND, CType.INT, CType.UINT, CType.usize, CType.ptr],
    returns: CType.i64,
  },
  SendDlgItemMessageW: {
    args: [CType.HWND, CType.INT, CType.UINT, CType.usize, CType.ptr],
    returns: CType.i64,
  },
  GetWindowLongA: {
    args: [CType.HWND, CType.INT],
    returns: CType.LONG,
  },
  GetWindowLongW: {
    args: [CType.HWND, CType.INT],
    returns: CType.LONG,
  },
  SetWindowLongA: {
    args: [CType.HWND, CType.INT, CType.LONG],
    returns: CType.LONG,
  },
  SetWindowLongW: {
    args: [CType.HWND, CType.INT, CType.LONG],
    returns: CType.LONG,
  },
  GetWindowLongPtrA: {
    args: [CType.HWND, CType.INT],
    returns: CType.ptr,
  },
  GetWindowLongPtrW: {
    args: [CType.HWND, CType.INT],
    returns: CType.ptr,
  },
  SetWindowLongPtrA: {
    args: [CType.HWND, CType.INT, CType.ptr],
    returns: CType.ptr,
  },
  SetWindowLongPtrW: {
    args: [CType.HWND, CType.INT, CType.ptr],
    returns: CType.ptr,
  },
  ClientToScreen: {
    args: [CType.HWND, CType.ptr],
    returns: CType.BOOL,
  },
  ScreenToClient: {
    args: [CType.HWND, CType.ptr],
    returns: CType.BOOL,
  },
  GetCursorPos: {
    args: [CType.ptr],
    returns: CType.BOOL,
  },
  SetCursorPos: {
    args: [CType.INT, CType.INT],
    returns: CType.BOOL,
  },
  GetAsyncKeyState: {
    args: [CType.INT],
    returns: CType.SHORT,
  },
  GetKeyState: {
    args: [CType.INT],
    returns: CType.SHORT,
  },
  MapVirtualKeyA: {
    args: [CType.UINT, CType.UINT],
    returns: CType.UINT,
  },
  MapVirtualKeyW: {
    args: [CType.UINT, CType.UINT],
    returns: CType.UINT,
  },
  OpenClipboard: {
    args: [CType.HWND],
    returns: CType.BOOL,
  },
  CloseClipboard: {
    args: [],
    returns: CType.BOOL,
  },
  EmptyClipboard: {
    args: [],
    returns: CType.BOOL,
  },
  GetClipboardData: {
    args: [CType.UINT],
    returns: CType.HANDLE,
  },
  SetClipboardData: {
    args: [CType.UINT, CType.HANDLE],
    returns: CType.HANDLE,
  },
  RedrawWindow: {
    args: [CType.HWND, CType.ptr, CType.ptr, CType.UINT],
    returns: CType.BOOL,
  },
  PrintWindow: {
    args: [CType.HWND, CType.ptr, CType.UINT], // hwnd, hdcBlt, nFlags
    returns: CType.BOOL,
  },
  GetDesktopWindow: {
    args: [],
    returns: CType.HWND,
  },
  GetForegroundWindow: {
    args: [],
    returns: CType.HWND,
  },
  SetForegroundWindow: {
    args: [CType.HWND],
    returns: CType.BOOL,
  },
  BringWindowToTop: {
    args: [CType.HWND],
    returns: CType.BOOL,
  },
  AttachThreadInput: {
    args: [CType.DWORD, CType.DWORD, CType.BOOL],
    returns: CType.BOOL,
  },
  VkKeyScanW: {
    args: [CType.WORD],
    returns: CType.SHORT,
  },
  SendInput: {
    args: [CType.UINT, CType.ptr, CType.INT],
    returns: CType.UINT,
  },
  mouse_event: {
    args: [CType.DWORD, CType.DWORD, CType.DWORD, CType.DWORD, CType.usize],
    returns: CType.void,
  },
  keybd_event: {
    args: [CType.BYTE, CType.BYTE, CType.DWORD, CType.usize],
    returns: CType.void,
  },
};

export const User32Dll = {
  name: 'user32',
  knownToLinker: true,
  definitions: User32Definitions,
} as const satisfies Win32Dll;
