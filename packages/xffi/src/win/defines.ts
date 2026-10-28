/**
 * Windows Win32 API Constants and Definitions
 */

import { cdefines, type CDefineValueType } from '../cdefine.js';

// 1. WS (Window Styles)
export const WS = cdefines(
  {
    OVERLAPPED: 0x00000000,
    POPUP: 0x80000000,
    CHILD: 0x40000000,
    MINIMIZE: 0x20000000,
    VISIBLE: 0x10000000,
    DISABLED: 0x08000000,
    CLIPSIBLINGS: 0x04000000,
    CLIPCHILDREN: 0x02000000,
    MAXIMIZE: 0x01000000,
    CAPTION: 0x00c00000,
    BORDER: 0x00800000,
    DLGFRAME: 0x00400000,
    VSCROLL: 0x00200000,
    HSCROLL: 0x00100000,
    SYSMENU: 0x00080000,
    THICKFRAME: 0x00040000,
    GROUP: 0x00020000,
    TABSTOP: 0x00010000,
    MINIMIZEBOX: 0x00020000,
    MAXIMIZEBOX: 0x00010000,
    OVERLAPPEDWINDOW:
      0x00000000 |
      0x00c00000 |
      0x00080000 |
      0x00040000 |
      0x00020000 |
      0x00010000,
  },
  'WS',
);
export type WS = CDefineValueType<typeof WS>;

// 1b. WS_EX (Extended Window Styles)
export const WS_EX = cdefines(
  {
    DLGMODALFRAME: 0x00000001,
    NOPARENTNOTIFY: 0x00000004,
    TOPMOST: 0x00000008,
    ACCEPTFILES: 0x00000010,
    TRANSPARENT: 0x00000020,
    MDICHILD: 0x00000040,
    TOOLWINDOW: 0x00000080,
    WINDOWEDGE: 0x00000100,
    CLIENTEDGE: 0x00000200,
    CONTEXTHELP: 0x00000400,
    RIGHT: 0x00001000,
    LEFT: 0x00000000,
    RTLREADING: 0x00002000,
    LTRREADING: 0x00000000,
    LEFTSCROLLBAR: 0x00004000,
    RIGHTSCROLLBAR: 0x00000000,
    CONTROLPARENT: 0x00010000,
    STATICEDGE: 0x00020000,
    APPWINDOW: 0x00040000,
    OVERLAPPEDWINDOW: 0x00000100 | 0x00000200,
    PALETTEWINDOW: 0x00000100 | 0x00000080 | 0x00000008,
    LAYERED: 0x00080000,
    NOINHERITLAYOUT: 0x00100000,
    LAYOUTRTL: 0x00400000,
    COMPOSITED: 0x02000000,
    NOACTIVATE: 0x08000000,
  },
  'WS_EX',
);
export type WS_EX = CDefineValueType<typeof WS_EX>;

// 2. CS (Class Styles)
export const CS = cdefines(
  {
    VREDRAW: 0x0001,
    HREDRAW: 0x0002,
    DBLCLKS: 0x0008,
    OWNDC: 0x0020,
    CLASSDC: 0x0040,
    PARENTDC: 0x0080,
    NOCLOSE: 0x0200,
    SAVEBITS: 0x0800,
    BYTEALIGNCLIENT: 0x1000,
    BYTEALIGNWINDOW: 0x2000,
    GLOBALCLASS: 0x4000,
  },
  'CS',
);
export type CS = CDefineValueType<typeof CS>;

// 3. WM (Window Messages)
export const WM = cdefines(
  {
    NULL: 0x0000,
    CREATE: 0x0001,
    DESTROY: 0x0002,
    MOVE: 0x0003,
    SIZE: 0x0005,
    ACTIVATE: 0x0006,
    SETFOCUS: 0x0007,
    KILLFOCUS: 0x0008,
    ENABLE: 0x000a,
    SETREDRAW: 0x000b,
    SETTEXT: 0x000c,
    GETTEXT: 0x000d,
    GETTEXTLENGTH: 0x000e,
    PAINT: 0x000f,
    CLOSE: 0x0010,
    QUERYENDSESSION: 0x0011,
    QUIT: 0x0012,
    QUERYOPEN: 0x0013,
    ERASEBKGND: 0x0014,
    SYSCOLORCHANGE: 0x0015,
    ENDSESSION: 0x0016,
    SHOWWINDOW: 0x0018,
    CTLCOLOR: 0x0019,
    WININICHANGE: 0x001a,
    SETTINGCHANGE: 0x001a,
    DEVMODECHANGE: 0x001b,
    ACTIVATEAPP: 0x001c,
    FONTCHANGE: 0x001d,
    TIMECHANGE: 0x001e,
    CANCELMODE: 0x001f,
    SETCURSOR: 0x0020,
    MOUSEACTIVATE: 0x0021,
    CHILDACTIVATE: 0x0022,
    QUEUESYNC: 0x0023,
    GETMINMAXINFO: 0x0024,
    NEXTDLGCTL: 0x0028,
    DRAWITEM: 0x002b,
    MEASUREITEM: 0x002c,
    DELETEITEM: 0x002d,
    SETFONT: 0x0030,
    GETFONT: 0x0031,
    SETHOTKEY: 0x0032,
    GETHOTKEY: 0x0033,
    GETOBJECT: 0x003d,
    WINDOWPOSCHANGING: 0x0046,
    WINDOWPOSCHANGED: 0x0047,
    COPYDATA: 0x004a,
    NOTIFY: 0x004e,
    CONTEXTMENU: 0x007b,
    STYLECHANGING: 0x007c,
    STYLECHANGED: 0x007d,
    DISPLAYCHANGE: 0x007e,
    GETICON: 0x007f,
    SETICON: 0x0080,
    NCCREATE: 0x0081,
    NCDESTROY: 0x0082,
    NCCALCSIZE: 0x0083,
    NCHITTEST: 0x0084,
    NCPAINT: 0x0085,
    NCACTIVATE: 0x0086,
    GETDLGCODE: 0x0087,

    KEYFIRST: 0x0100,
    KEYDOWN: 0x0100,
    KEYUP: 0x0101,
    KEY: cdefines({
      DOWN: 0x0100,
      UP: 0x0101,
    }),

    CHAR: 0x0102,
    DEADCHAR: 0x0103,

    SYSKEYDOWN: 0x0104,
    SYSKEYUP: 0x0105,
    SYSKEY: cdefines({
      DOWN: 0x0104,
      UP: 0x0105,
    }),

    SYSCHAR: 0x0106,
    SYSDEADCHAR: 0x0107,
    UNICHAR: 0x0109,
    KEYLAST: 0x0109,

    INITDIALOG: 0x0110,
    COMMAND: 0x0111,
    SYSCOMMAND: 0x0112,
    TIMER: 0x0113,
    HSCROLL: 0x0114,
    VSCROLL: 0x0115,
    INITMENU: 0x0116,
    INITMENUPOPUP: 0x0117,
    MENUSELECT: 0x011f,
    ENTERIDLE: 0x0121,

    CTLCOLORMSGBOX: 0x0132,
    CTLCOLOREDIT: 0x0133,
    CTLCOLORLISTBOX: 0x0134,
    CTLCOLORBTN: 0x0135,
    CTLCOLORDLG: 0x0136,
    CTLCOLORSCROLLBAR: 0x0137,
    CTLCOLORSTATIC: 0x0138,

    MOUSEFIRST: 0x0200,
    MOUSEMOVE: 0x0200,
    LBUTTONDOWN: 0x0201,
    LBUTTONUP: 0x0202,
    LBUTTONDBLCLK: 0x0203,
    LBUTTON: cdefines({
      DOWN: 0x0201,
      UP: 0x0202,
      DBLCLK: 0x0203,
    }),

    RBUTTONDOWN: 0x0204,
    RBUTTONUP: 0x0205,
    RBUTTONDBLCLK: 0x0206,
    RBUTTON: cdefines({
      DOWN: 0x0204,
      UP: 0x0205,
      DBLCLK: 0x0206,
    }),

    MBUTTONDOWN: 0x0207,
    MBUTTONUP: 0x0208,
    MBUTTONDBLCLK: 0x0209,
    MBUTTON: cdefines({
      DOWN: 0x0207,
      UP: 0x0208,
      DBLCLK: 0x0209,
    }),
    MOUSEWHEEL: 0x020a,
    XBUTTONDOWN: 0x020b,
    XBUTTONUP: 0x020c,
    XBUTTONDBLCLK: 0x020d,
    MOUSEHWHEEL: 0x020e,
    MOUSELAST: 0x020e,

    PARENTNOTIFY: 0x0210,
    CAPTURECHANGED: 0x0215,
    MOVING: 0x0216,
    ENTERSIZEMOVE: 0x0231,
    EXITSIZEMOVE: 0x0232,
    DROPFILES: 0x0233,
    MOUSEHOVER: 0x02a1,
    MOUSELEAVE: 0x02a3,

    CUT: 0x0300,
    COPY: 0x0301,
    PASTE: 0x0302,
    CLEAR: 0x0303,
    UNDO: 0x0304,
    HOTKEY: 0x0312,
    PRINT: 0x0317,
    PRINTCLIENT: 0x0318,

    USER: 0x0400,
    APP: 0x8000,
  },
  'WM',
);
export type WM = CDefineValueType<typeof WM, true>;

// 3b. EM (Edit Control Messages)
export const EM = cdefines(
  {
    GETSEL: 0x00b0,
    SETSEL: 0x00b1,
    GETRECT: 0x00b2,
    SETRECT: 0x00b3,
    SETRECTNP: 0x00b4,
    SCROLL: 0x00b5,
    LINESCROLL: 0x00b6,
    SCROLLCARET: 0x00b7,
    GETMODIFY: 0x00b8,
    SETMODIFY: 0x00b9,
    GETLINECOUNT: 0x00ba,
    LINEINDEX: 0x00bb,
    SETHANDLE: 0x00bc,
    GETHANDLE: 0x00bd,
    GETTHUMB: 0x00be,
    LINELENGTH: 0x00c1,
    REPLACESEL: 0x00c2,
    GETLINE: 0x00c4,
    LIMITTEXT: 0x00c5,
    CANUNDO: 0x00c6,
    UNDO: 0x00c7,
    FMTLINES: 0x00c8,
    LINEFROMCHAR: 0x00c9,
    SETTABSTOPS: 0x00cb,
    SETPASSWORDCHAR: 0x00cc,
    EMPTYUNDOBUFFER: 0x00cd,
    GETFIRSTVISIBLELINE: 0x00ce,
    SETREADONLY: 0x00cf,
    GETPASSWORDCHAR: 0x00d2,
    SETMARGINS: 0x00d3,
    GETMARGINS: 0x00d4,
    SETLIMITTEXT: 0x00c5,
    GETLIMITTEXT: 0x00d5,
    POSFROMCHAR: 0x00d6,
    CHARFROMPOS: 0x00d7,
  },
  'EM',
);
export type EM = CDefineValueType<typeof EM, true>;

// 3c. BM (Button Control Messages)
export const BM = cdefines(
  {
    GETCHECK: 0x00f0,
    SETCHECK: 0x00f1,
    GETSTATE: 0x00f2,
    SETSTATE: 0x00f3,
    SETSTYLE: 0x00f4,
    CLICK: 0x00f5,
    GETIMAGE: 0x00f6,
    SETIMAGE: 0x00f7,
    SETDONTCLICK: 0x00f8,
  },
  'BM',
);
export type BM = CDefineValueType<typeof BM, true>;

// 3d. VK (Virtual-Key Codes)
export const VK = cdefines(
  {
    LBUTTON: 0x01,
    RBUTTON: 0x02,
    CANCEL: 0x03,
    MBUTTON: 0x04,
    XBUTTON1: 0x05,
    XBUTTON2: 0x06,
    BACK: 0x08,
    TAB: 0x09,
    CLEAR: 0x0c,
    RETURN: 0x0d,
    SHIFT: 0x10,
    CONTROL: 0x11,
    MENU: 0x12,
    PAUSE: 0x13,
    CAPITAL: 0x14,
    ESCAPE: 0x1b,
    SPACE: 0x20,
    PRIOR: 0x21,
    NEXT: 0x22,
    END: 0x23,
    HOME: 0x24,
    LEFT: 0x25,
    UP: 0x26,
    RIGHT: 0x27,
    DOWN: 0x28,
    SELECT: 0x29,
    PRINT: 0x2a,
    EXECUTE: 0x2b,
    SNAPSHOT: 0x2c,
    INSERT: 0x2d,
    DELETE: 0x2e,
    HELP: 0x2f,
    LWIN: 0x5b,
    RWIN: 0x5c,
    APPS: 0x5d,
    SLEEP: 0x5f,
    NUMPAD0: 0x60,
    NUMPAD1: 0x61,
    NUMPAD2: 0x62,
    NUMPAD3: 0x63,
    NUMPAD4: 0x64,
    NUMPAD5: 0x65,
    NUMPAD6: 0x66,
    NUMPAD7: 0x67,
    NUMPAD8: 0x68,
    NUMPAD9: 0x69,
    MULTIPLY: 0x6a,
    ADD: 0x6b,
    SEPARATOR: 0x6c,
    SUBTRACT: 0x6d,
    DECIMAL: 0x6e,
    DIVIDE: 0x6f,
    F1: 0x70,
    F2: 0x71,
    F3: 0x72,
    F4: 0x73,
    F5: 0x74,
    F6: 0x75,
    F7: 0x76,
    F8: 0x77,
    F9: 0x78,
    F10: 0x79,
    F11: 0x7a,
    F12: 0x7b,
    NUMLOCK: 0x90,
    SCROLL: 0x91,
    LSHIFT: 0xa0,
    RSHIFT: 0xa1,
    LCONTROL: 0xa2,
    RCONTROL: 0xa3,
    LMENU: 0xa4,
    RMENU: 0xa5,
    OEM_1: 0xba,
    OEM_PLUS: 0xbb,
    OEM_COMMA: 0xbc,
    OEM_MINUS: 0xbd,
    OEM_PERIOD: 0xbe,
    OEM_2: 0xbf,
    OEM_3: 0xc0,
  },
  'VK',
);
export type VK = CDefineValueType<typeof VK, true>;

// 3e. SWP (SetWindowPos Flags)
export const SWP = cdefines(
  {
    NOSIZE: 0x0001,
    NOMOVE: 0x0002,
    NOZORDER: 0x0004,
    NOREDRAW: 0x0008,
    NOACTIVATE: 0x0010,
    FRAMECHANGED: 0x0020,
    SHOWWINDOW: 0x0040,
    HIDEWINDOW: 0x0080,
    NOCOPYBITS: 0x0100,
    NOOWNERZORDER: 0x0200,
    NOSENDCHANGING: 0x0400,
    DRAWFRAME: 0x0020,
    NOREPOSITION: 0x0200,
    DEFERERASE: 0x2000,
    ASYNCWINDOWPOS: 0x4000,
  },
  'SWP',
);
export type SWP = CDefineValueType<typeof SWP>;

// 3f. GW (GetWindow Commands)
export const GW = cdefines(
  {
    HWNDFIRST: 0,
    HWNDLAST: 1,
    HWNDNEXT: 2,
    HWNDPREV: 3,
    OWNER: 4,
    CHILD: 5,
    ENABLEDPOPUP: 6,
  },
  'GW',
);
export type GW = CDefineValueType<typeof GW, true>;

// 3g. GWL / GWLP (GetWindowLong / GetWindowLongPtr Offsets)
export const GWL = cdefines(
  {
    WNDPROC: -4,
    HINSTANCE: -6,
    HWNDPARENT: -8,
    STYLE: -16,
    EXSTYLE: -20,
    USERDATA: -21,
    ID: -12,
  },
  'GWL',
);
export type GWL = CDefineValueType<typeof GWL, true>;

export const GWLP = cdefines(
  {
    WNDPROC: -4,
    HINSTANCE: -6,
    HWNDPARENT: -8,
    USERDATA: -21,
    ID: -12,
  },
  'GWLP',
);
export type GWLP = CDefineValueType<typeof GWLP, true>;

// 3h. PM (PeekMessage Options)
export const PM = cdefines(
  {
    NOREMOVE: 0x0000,
    REMOVE: 0x0001,
    NOYIELD: 0x0002,
  },
  'PM',
);
export type PM = CDefineValueType<typeof PM>;

// 3i. MB (MessageBox Flags)
export const MB = cdefines(
  {
    OK: 0x00000000,
    OKCANCEL: 0x00000001,
    ABORTRETRYIGNORE: 0x00000002,
    YESNOCANCEL: 0x00000003,
    YESNO: 0x00000004,
    RETRYCANCEL: 0x00000005,
    ICONHAND: 0x00000010,
    ICONQUESTION: 0x00000020,
    ICONEXCLAMATION: 0x00000030,
    ICONASTERISK: 0x00000040,
    ICONWARNING: 0x00000030,
    ICONERROR: 0x00000010,
    ICONINFORMATION: 0x00000040,
    ICONSTOP: 0x00000010,
    TOPMOST: 0x00040000,
  },
  'MB',
);
export type MB = CDefineValueType<typeof MB>;

// 3j. SM (GetSystemMetrics Codes)
export const SM = cdefines(
  {
    CXSCREEN: 0,
    CYSCREEN: 1,
    CXVSCROLL: 2,
    CYHSCROLL: 3,
    CYCAPTION: 4,
    CXBORDER: 5,
    CYBORDER: 6,
    CXFULLSCREEN: 16,
    CYFULLSCREEN: 17,
    XVIRTUALSCREEN: 76,
    YVIRTUALSCREEN: 77,
    CXVIRTUALSCREEN: 78,
    CYVIRTUALSCREEN: 79,
    CMONITORS: 80,
  },
  'SM',
);
export type SM = CDefineValueType<typeof SM, true>;

// 3k. SC (System Commands for WM_SYSCOMMAND)
export const SC = cdefines(
  {
    SIZE: 0xf000,
    MOVE: 0xf010,
    MINIMIZE: 0xf020,
    MAXIMIZE: 0xf030,
    NEXTWINDOW: 0xf040,
    PREVWINDOW: 0xf050,
    CLOSE: 0xf060,
    VSCROLL: 0xf070,
    HSCROLL: 0xf080,
    MOUSEMENU: 0xf090,
    KEYMENU: 0xf100,
    RESTORE: 0xf120,
    TASKLIST: 0xf130,
    SCREENSAVE: 0xf140,
    HOTKEY: 0xf150,
    DEFAULT: 0xf160,
    MONITORPOWER: 0xf170,
    CONTEXTHELP: 0xf180,
  },
  'SC',
);
export type SC = CDefineValueType<typeof SC, true>;

// 3l. RDW (RedrawWindow Flags)
export const RDW = cdefines(
  {
    INVALIDATE: 0x0001,
    INTERNALPAINT: 0x0002,
    ERASE: 0x0004,
    VALIDATE: 0x0008,
    NOINTERNALPAINT: 0x0010,
    NOERASE: 0x0020,
    NOCHILDREN: 0x0040,
    ALLCHILDREN: 0x0080,
    UPDATENOW: 0x0100,
    ERASENOW: 0x0200,
    FRAME: 0x0400,
    NOFRAME: 0x0800,
  },
  'RDW',
);
export type RDW = CDefineValueType<typeof RDW>;

// 3m. KEYEVENTF / MOUSEEVENTF (Input synthesis flags)
export const KEYEVENTF = cdefines(
  {
    EXTENDEDKEY: 0x0001,
    KEYUP: 0x0002,
    UNICODE: 0x0004,
    SCANCODE: 0x0008,
  },
  'KEYEVENTF',
);
export type KEYEVENTF = CDefineValueType<typeof KEYEVENTF>;

export const MOUSEEVENTF = cdefines(
  {
    MOVE: 0x0001,
    LEFTDOWN: 0x0002,
    LEFTUP: 0x0004,
    RIGHTDOWN: 0x0008,
    RIGHTUP: 0x0010,
    MIDDLEDOWN: 0x0020,
    MIDDLEUP: 0x0040,
    XDOWN: 0x0080,
    XUP: 0x0100,
    WHEEL: 0x0800,
    HWHEEL: 0x01000,
    ABSOLUTE: 0x8000,
  },
  'MOUSEEVENTF',
);
export type MOUSEEVENTF = CDefineValueType<typeof MOUSEEVENTF>;

// 4. SW (ShowWindow Commands)
export const SW = cdefines(
  {
    HIDE: 0,
    SHOWNORMAL: 1,
    NORMAL: 1,
    SHOWMINIMIZED: 2,
    SHOWMAXIMIZED: 3,
    MAXIMIZE: 3,
    SHOWNOACTIVATE: 4,
    SHOW: 5,
    MINIMIZE: 6,
    SHOWMINNOACTIVE: 7,
    SHOWNA: 8,
    RESTORE: 9,
    SHOWDEFAULT: 10,
    FORCEMINIMIZE: 11,
  },
  'SW',
);
export type SW = CDefineValueType<typeof SW, true>;

// 5. IDC (Standard Cursors)
export const IDC = cdefines(
  {
    ARROW: 32512,
    IBEAM: 32513,
    WAIT: 32514,
    CROSS: 32515,
    UPARROW: 32516,
    SIZE: 32640,
    ICON: 32641,
    SIZENWSE: 32642,
    SIZENESW: 32643,
    SIZEWE: 32644,
    SIZENS: 32645,
    SIZEALL: 32646,
    NO: 32648,
    HAND: 32649,
    APPSTARTING: 32650,
    HELP: 32651,
  },
  'IDC',
);
export type IDC = CDefineValueType<typeof IDC, true>;

// 6. IDI (Standard Icons)
export const IDI = cdefines(
  {
    APPLICATION: 32512,
    HAND: 32513,
    QUESTION: 32514,
    EXCLAMATION: 32515,
    ASTERISK: 32516,
    WINLOGO: 32517,
  },
  'IDI',
);
export type IDI = CDefineValueType<typeof IDI, true>;

// 7. STOCK (Stock Objects)
export const STOCK = cdefines({
  WHITE_BRUSH: 0,
  LTGRAY_BRUSH: 1,
  GRAY_BRUSH: 2,
  DKGRAY_BRUSH: 3,
  BLACK_BRUSH: 4,
  NULL_BRUSH: 5,
  HOLLOW_BRUSH: 5,
  WHITE_PEN: 6,
  BLACK_PEN: 7,
  NULL_PEN: 8,
  OEM_FIXED_FONT: 10,
  ANSI_FIXED_FONT: 11,
  ANSI_VAR_FONT: 12,
  SYSTEM_FONT: 13,
  DEVICE_DEFAULT_FONT: 14,
  DEFAULT_PALETTE: 15,
  SYSTEM_FIXED_FONT: 16,
  DEFAULT_GUI_FONT: 17,
});
export type STOCK = CDefineValueType<typeof STOCK, true>;

// 8. COLOR (System Colors)
export const COLOR = cdefines(
  {
    SCROLLBAR: 0,
    BACKGROUND: 1,
    ACTIVECAPTION: 2,
    INACTIVECAPTION: 3,
    MENU: 4,
    WINDOW: 5,
    WINDOWFRAME: 6,
    MENUTEXT: 7,
    WINDOWTEXT: 8,
    CAPTIONTEXT: 9,
    ACTIVEBORDER: 10,
    INACTIVEBORDER: 11,
    APPWORKSPACE: 12,
    HIGHLIGHT: 13,
    HIGHLIGHTTEXT: 14,
    BTNFACE: 15,
    BTNSHADOW: 16,
    GRAYTEXT: 17,
    BTNTEXT: 18,
    INACTIVECAPTIONTEXT: 19,
    BTNHIGHLIGHT: 20,
  },
  'COLOR',
);
export type COLOR = CDefineValueType<typeof COLOR, true>;

// 9. BARE (Bare un-prefixed constants)
export const BARE = cdefines({
  TRANSPARENT: 1,
  OPAQUE: 2,
  CW_USEDEFAULT: -2147483648,
  INFINITE: 0xffffffff,
  MAX_PATH: 260,
  SRCCOPY: 0x00cc0020,
  GENERIC_READ: 0x80000000,
  GENERIC_WRITE: 0x40000000,
  GENERIC_EXECUTE: 0x20000000,
  GENERIC_ALL: 0x10000000,
  FILE_SHARE_READ: 0x00000001,
  FILE_SHARE_WRITE: 0x00000002,
  FILE_SHARE_DELETE: 0x00000004,
  CREATE_NEW: 1,
  CREATE_ALWAYS: 2,
  OPEN_EXISTING: 3,
  OPEN_ALWAYS: 4,
  TRUNCATE_EXISTING: 5,
  FILE_ATTRIBUTE_NORMAL: 0x00000080,
  CF_TEXT: 1,
  CF_BITMAP: 2,
  CF_UNICODETEXT: 13,
  GA_PARENT: 1,
  GA_ROOT: 2,
  GA_ROOTOWNER: 3,
});
export type BARE = CDefineValueType<typeof BARE, true>;
export const INFINITE = 0xffffffff;
export const INVALID_HANDLE_VALUE = -1;
export const NULL = 0;
export const TRUE = 1;
export const FALSE = 0;
export const MAX_PATH = 260;
export const SRCCOPY = 0x00cc0020;
export const HWND_TOP = 0;
export const HWND_BOTTOM = 1;
export const HWND_TOPMOST = -1;
export const HWND_NOTOPMOST = -2;

// LoadLibraryEx flags
export const LoadLibraryExFlag = cdefines(
  {
    // Maps the module without running DllMain -- used to read a DLL's
    // export table (GetProcAddress) without executing its init code.
    DONT_RESOLVE_DLL_REFERENCES: 0x00000001,
  },
  'LOAD',
);
export type LoadLibraryExFlag = CDefineValueType<typeof LoadLibraryExFlag>;

// 10. MemoryState
export const MemoryState = cdefines(
  {
    COMMIT: 0x1000,
    RESERVE: 0x2000,
    FREE: 0x10000,
  },
  'MEM',
);
export type MemoryState = CDefineValueType<typeof MemoryState>;

// 11. MemoryProtection
export const MemoryProtection = cdefines(
  {
    NOACCESS: 0x01,
    READONLY: 0x02,
    READWRITE: 0x04,
    WRITECOPY: 0x08,
    EXECUTE: 0x10,
    EXECUTE_READ: 0x20,
    EXECUTE_READWRITE: 0x40,
    EXECUTE_WRITECOPY: 0x80,
    GUARD: 0x100,
    NOCACHE: 0x200,
    WRITECOMBINE: 0x400,
  },
  'PAGE',
);
export type MemoryProtection = CDefineValueType<typeof MemoryProtection>;

// 12. MemoryFreeType
export const MemoryFreeType = cdefines(
  {
    RELEASE: 0x8000,
    DECOMMIT: 0x4000,
  },
  'MEM',
);
export type MemoryFreeType = CDefineValueType<typeof MemoryFreeType>;

// 13. ProcessAccess
export const ProcessAccess = cdefines(
  {
    TERMINATE: 0x0001,
    CREATE_THREAD: 0x0002,
    VM_OPERATION: 0x0008,
    VM_READ: 0x0010,
    VM_WRITE: 0x0020,
    DUP_HANDLE: 0x0040,
    QUERY_INFORMATION: 0x0400,
    SUSPEND_RESUME: 0x0800,
    QUERY_LIMITED_INFORMATION: 0x1000,
    ALL_ACCESS: 0x1fffff,
  },
  'PROCESS',
);
export type ProcessAccess = CDefineValueType<typeof ProcessAccess>;

// 14. ThreadAccess
export const ThreadAccess = cdefines(
  {
    TERMINATE: 0x0001,
    SUSPEND_RESUME: 0x0002,
    GET_CONTEXT: 0x0008,
    SET_CONTEXT: 0x0010,
    SET_INFORMATION: 0x0020,
    QUERY_INFORMATION: 0x0040,
    SET_THREAD_TOKEN: 0x0080,
    IMPERSONATE: 0x0100,
    DIRECT_IMPERSONATION: 0x0200,
    SET_LIMITED_INFORMATION: 0x0400,
    QUERY_LIMITED_INFORMATION: 0x0800,
    SYNCHRONIZE: 0x00100000,
    ALL_ACCESS: 0x1fffff,
  },
  'THREAD',
);
export type ThreadAccess = CDefineValueType<typeof ThreadAccess>;

// 15. ThreadCreationFlags
export const ThreadCreationFlags = cdefines(
  {
    IMMEDIATE: 0,
    CREATE_SUSPENDED: 0x00000004,
  },
  'THREAD_CREATE',
);
export type ThreadCreationFlags = CDefineValueType<typeof ThreadCreationFlags>;

// 16. ContextFlags
export const ContextFlags = cdefines(
  {
    AMD64: 0x00100000,
    CONTROL: 0x00100000 | 0x00000001,
    INTEGER: 0x00100000 | 0x00000002,
    SEGMENTS: 0x00100000 | 0x00000004,
    FLOATING_POINT: 0x00100000 | 0x00000008,
    DEBUG_REGISTERS: 0x00100000 | 0x00000010,
    FULL:
      0x00100000 |
      0x00000001 |
      (0x00100000 | 0x00000002) |
      (0x00100000 | 0x00000008),
    ALL:
      0x00100000 |
      0x00000001 |
      (0x00100000 | 0x00000002) |
      (0x00100000 | 0x00000008) |
      (0x00100000 | 0x00000004) |
      (0x00100000 | 0x00000010),
  },
  'CONTEXT',
);
export type ContextFlags = CDefineValueType<typeof ContextFlags>;

// 17. ToolhelpSnapshotFlag
export const ToolhelpSnapshotFlag = cdefines(
  {
    HEAPLIST: 0x00000001,
    PROCESS: 0x00000002,
    THREAD: 0x00000004,
    MODULE: 0x00000008,
    MODULE32: 0x00000010,
    ALL: 0x00000001 | 0x00000002 | 0x00000004 | 0x00000008,
    SNAPTHREAD: 0x00000004,
    SNAPPROCESS: 0x00000002,
    SNAPMODULE: 0x00000008,
    SNAPMODULE32: 0x00000010,
    SNAPHEAPLIST: 0x00000001,
    SNAPALL: 0x00000001 | 0x00000002 | 0x00000004 | 0x00000008,
  },
  'TH32CS',
);
export type ToolhelpSnapshotFlag = number;

// 18. GetModuleHandleExFlag
export const GetModuleHandleExFlag = cdefines(
  {
    PIN: 0x00000001,
    UNCHANGED_REFCOUNT: 0x00000002,
    FROM_ADDRESS: 0x00000004,
  },
  'GET_MODULE_HANDLE_EX',
);
export type GetModuleHandleExFlag = CDefineValueType<
  typeof GetModuleHandleExFlag
>;

// 19. DT (DrawText Alignment Options)
export const DT = cdefines(
  {
    LEFT: 0x00000000,
    TOP: 0x00000000,
    CENTER: 0x00000001,
    RIGHT: 0x00000002,
    VCENTER: 0x00000004,
    BOTTOM: 0x00000008,
    WORDBREAK: 0x00000010,
    SINGLELINE: 0x00000020,
    EXPANDTABS: 0x00000040,
    TABSTOP: 0x00000080,
    NOCLIP: 0x00000100,
    EXTERNALLEADING: 0x00000200,
    CALCRECT: 0x00000400,
    NOPREFIX: 0x00000800,
    INTERNAL: 0x00001000,
  },
  'DT',
);
export type DT = CDefineValueType<typeof DT>;

// 20. MACROS (Common Windows Macros like RGB, LOWORD, HIWORD, MAKELPARAM, etc.)
import { cmacro } from '../cmacro.js';

export const MACROS = {
  RGB: cmacro((r: number, g: number, b: number) => {
    return (r & 0xff) | ((g & 0xff) << 8) | ((b & 0xff) << 16);
  }, '((($1) | (($2) << 8)) | (($3) << 16))'),
  GetRValue: cmacro((rgb: number) => Number(rgb) & 0xff, '(($1) & 0xFF)'),
  GetGValue: cmacro(
    (rgb: number) => (Number(rgb) >> 8) & 0xff,
    '((($1) >> 8) & 0xFF)',
  ),
  GetBValue: cmacro(
    (rgb: number) => (Number(rgb) >> 16) & 0xff,
    '((($1) >> 16) & 0xFF)',
  ),
  LOWORD: cmacro(
    (l: number | bigint) => Number(BigInt(l) & 0xffffn),
    '(($1) & 0xFFFF)',
  ),
  HIWORD: cmacro(
    (l: number | bigint) => Number((BigInt(l) >> 16n) & 0xffffn),
    '((($1) >> 16) & 0xFFFF)',
  ),
  LOBYTE: cmacro(
    (w: number | bigint) => Number(BigInt(w) & 0xffn),
    '(($1) & 0xFF)',
  ),
  HIBYTE: cmacro(
    (w: number | bigint) => Number((BigInt(w) >> 8n) & 0xffn),
    '((($1) >> 8) & 0xFF)',
  ),
  MAKELONG: cmacro(
    (a: number, b: number) => ((a & 0xffff) | ((b & 0xffff) << 16)) >>> 0,
    '((($1) & 0xFFFF) | ((($2) & 0xFFFF) << 16))',
  ),
  MAKELPARAM: cmacro(
    (low: number, high: number) =>
      ((low & 0xffff) | ((high & 0xffff) << 16)) >>> 0,
    '((($1) & 0xFFFF) | ((($2) & 0xFFFF) << 16))',
  ),
  MAKEWPARAM: cmacro(
    (low: number, high: number) =>
      ((low & 0xffff) | ((high & 0xffff) << 16)) >>> 0,
    '((($1) & 0xFFFF) | ((($2) & 0xFFFF) << 16))',
  ),
  MAKELRESULT: cmacro(
    (low: number, high: number) =>
      ((low & 0xffff) | ((high & 0xffff) << 16)) >>> 0,
    '((($1) & 0xFFFF) | ((($2) & 0xFFFF) << 16))',
  ),
  MAKEWORD: cmacro(
    (a: number, b: number) => (a & 0xff) | ((b & 0xff) << 8),
    '((($1) & 0xFF) | ((($2) & 0xFF) << 8))',
  ),
  MAKEINTRESOURCE: cmacro((i: number) => i & 0xffff, '(($1) & 0xFFFF)'),
};

export const RGB = MACROS.RGB;
export const GetRValue = MACROS.GetRValue;
export const GetGValue = MACROS.GetGValue;
export const GetBValue = MACROS.GetBValue;
export const LOWORD = MACROS.LOWORD;
export const HIWORD = MACROS.HIWORD;
export const LOBYTE = MACROS.LOBYTE;
export const HIBYTE = MACROS.HIBYTE;
export const MAKELONG = MACROS.MAKELONG;
export const MAKELPARAM = MACROS.MAKELPARAM;
export const MAKEWPARAM = MACROS.MAKEWPARAM;
export const MAKELRESULT = MACROS.MAKELRESULT;
export const MAKEWORD = MACROS.MAKEWORD;
export const MAKEINTRESOURCE = MACROS.MAKEINTRESOURCE;

// 21. WaitReturn
export const WaitReturn = cdefines(
  {
    OBJECT_0: 0,
    TIMEOUT: 258,
    FAILED: 0xffffffff,
  },
  'WAIT',
);
export type WaitReturn = CDefineValueType<typeof WaitReturn>;

// 22. Default alignments
export const DEFAULT_MACHINECODE_ALIGNMENT = 16;

// 23. ProcessCreationFlags (for CreateProcess*)
export const ProcessCreationFlags = cdefines({
  DEBUG_PROCESS: 0x00000001,
  DEBUG_ONLY_THIS_PROCESS: 0x00000002,
  CREATE_SUSPENDED: 0x00000004,
  DETACHED_PROCESS: 0x00000008,
  CREATE_NEW_CONSOLE: 0x00000010,
  NORMAL_PRIORITY_CLASS: 0x00000020,
  IDLE_PRIORITY_CLASS: 0x00000040,
  HIGH_PRIORITY_CLASS: 0x00000080,
  REALTIME_PRIORITY_CLASS: 0x00000100,
  CREATE_NEW_PROCESS_GROUP: 0x00000200,
  CREATE_UNICODE_ENVIRONMENT: 0x00000400,
  CREATE_SEPARATE_WOW_VDM: 0x00000800,
  CREATE_PROTECTED_PROCESS: 0x00040000,
  EXTENDED_STARTUPINFO_PRESENT: 0x00080000,
  CREATE_DEFAULT_ERROR_MODE: 0x04000000,
  CREATE_NO_WINDOW: 0x08000000,
});
export type ProcessCreationFlags = CDefineValueType<
  typeof ProcessCreationFlags
>;

// 24. FileMapAccess (for MapViewOfFile)
export const FileMapAccess = cdefines(
  {
    COPY: 0x00000001,
    WRITE: 0x00000002,
    READ: 0x00000004,
    EXECUTE: 0x00000020,
    LARGE_PAGES: 0x20000000,
    TARGETS_INVALID: 0x40000000,
    ALL_ACCESS: 0x000f001f,
  },
  'FILE_MAP',
);
export type FileMapAccess = CDefineValueType<typeof FileMapAccess>;

// 25. DuplicateHandleOptions (for DuplicateHandle)
export const DuplicateHandleOptions = cdefines(
  {
    CLOSE_SOURCE: 0x00000001,
    SAME_ACCESS: 0x00000002,
  },
  'DUPLICATE',
);
export type DuplicateHandleOptions = CDefineValueType<
  typeof DuplicateHandleOptions
>;

// 26. TokenAccess (for OpenProcessToken)
export const TokenAccess = cdefines(
  {
    ASSIGN_PRIMARY: 0x0001,
    DUPLICATE: 0x0002,
    IMPERSONATE: 0x0004,
    QUERY: 0x0008,
    QUERY_SOURCE: 0x0010,
    ADJUST_PRIVILEGES: 0x0020,
    ADJUST_GROUPS: 0x0040,
    ADJUST_DEFAULT: 0x0080,
    ADJUST_SESSIONID: 0x0100,
  },
  'TOKEN',
);
export type TokenAccess = CDefineValueType<typeof TokenAccess>;

// 27. CreateRestrictedTokenFlags (for CreateRestrictedToken -- de-elevates a
// token derived from the caller's own primary token, so no
// SE_ASSIGN_PRIMARYTOKEN_NAME privilege is required to CreateProcessAsUser
// with the result)
export const CreateRestrictedTokenFlags = cdefines({
  DISABLE_MAX_PRIVILEGE: 0x1,
  SANDBOX_INERT: 0x2,
  LUA_TOKEN: 0x4,
  WRITE_RESTRICTED: 0x8,
});
export type CreateRestrictedTokenFlags = CDefineValueType<
  typeof CreateRestrictedTokenFlags
>;

// 28. StartupInfoFlags (STARTUPINFO.dwFlags)
export const StartupInfoFlags = cdefines({
  USESHOWWINDOW: 0x00000001,
});
export type StartupInfoFlags = CDefineValueType<typeof StartupInfoFlags>;

// 29. ShowWindowCommand (STARTUPINFO.wShowWindow / ShowWindow's nCmdShow)
export const ShowWindowCommand = cdefines({
  SW_HIDE: 0,
  SW_SHOWNORMAL: 1,
});
export type ShowWindowCommand = CDefineValueType<typeof ShowWindowCommand>;

/**
 * All Win32 define groups and flattened C-style `#define` constants
 * (e.g. both `WM.SETTEXT` and `WM_SETTEXT`, `VK.RETURN` and `VK_RETURN`,
 * `MemoryState.COMMIT` and `MEM_COMMIT`, `RGB`, `LOWORD`, `HIWORD`, etc.).
 */
const DEFINE_GROUPS = {
  WS,
  WS_EX,
  CS,
  WM,
  EM,
  BM,
  VK,
  SWP,
  GW,
  GWL,
  GWLP,
  PM,
  MB,
  SM,
  SC,
  RDW,
  KEYEVENTF,
  MOUSEEVENTF,
  SW,
  IDC,
  IDI,
  STOCK,
  COLOR,
  BARE,
  LoadLibraryExFlag,
  MemoryState,
  MemoryProtection,
  MemoryFreeType,
  ProcessAccess,
  ThreadAccess,
  ThreadCreationFlags,
  ContextFlags,
  ToolhelpSnapshotFlag,
  GetModuleHandleExFlag,
  DT,
  WaitReturn,
  ProcessCreationFlags,
  FileMapAccess,
  DuplicateHandleOptions,
  TokenAccess,
  CreateRestrictedTokenFlags,
  StartupInfoFlags,
  ShowWindowCommand,
};

export const ALL_WIN32_DEFINES: Record<string, any> = {
  ...DEFINE_GROUPS,
  ...MACROS,
  MACROS,
  INFINITE,
  INVALID_HANDLE_VALUE,
  NULL,
  TRUE,
  FALSE,
  MAX_PATH,
  SRCCOPY,
  HWND_TOP,
  HWND_BOTTOM,
  HWND_TOPMOST,
  HWND_NOTOPMOST,
  DEFAULT_MACHINECODE_ALIGNMENT,
};

for (const group of Object.values(DEFINE_GROUPS)) {
  if (group && typeof group === 'object' && '_cDefines' in group) {
    Object.assign(ALL_WIN32_DEFINES, (group as any)._cDefines);
  }
}
