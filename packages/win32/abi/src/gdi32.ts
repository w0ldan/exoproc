import { CType, type Win32Dll } from './types.js';

/**
 * Native Gdi32 Definitions
 */
export const Gdi32Definitions = {
  GetStockObject: {
    args: [CType.INT],
    returns: CType.ptr,
  },
  SetTextColor: {
    args: [CType.ptr, CType.DWORD], // HDC, COLORREF
    returns: CType.DWORD,
  },
  SetBkMode: {
    args: [CType.ptr, CType.INT], // HDC, int
    returns: CType.INT,
  },
  SetBkColor: {
    args: [CType.ptr, CType.DWORD], // HDC, COLORREF
    returns: CType.DWORD,
  },
  CreateSolidBrush: {
    args: [CType.DWORD], // COLORREF
    returns: CType.ptr, // HBRUSH
  },
  DeleteObject: {
    args: [CType.ptr], // HGDIOBJ
    returns: CType.BOOL,
  },
  SelectObject: {
    args: [CType.ptr, CType.ptr], // HDC, HGDIOBJ
    returns: CType.ptr, // HGDIOBJ
  },
  Ellipse: {
    args: [CType.ptr, CType.INT, CType.INT, CType.INT, CType.INT], // HDC, left, top, right, bottom
    returns: CType.BOOL,
  },
  CreateCompatibleDC: {
    args: [CType.ptr], // HDC
    returns: CType.ptr, // HDC
  },
  CreateCompatibleBitmap: {
    args: [CType.ptr, CType.INT, CType.INT], // HDC, width, height
    returns: CType.ptr, // HBITMAP
  },
  BitBlt: {
    args: [
      CType.ptr, // hdcDest
      CType.INT, // nXDest
      CType.INT, // nYDest
      CType.INT, // nWidth
      CType.INT, // nHeight
      CType.ptr, // hdcSrc
      CType.INT, // nXSrc
      CType.INT, // nYSrc
      CType.DWORD, // dwRop
    ],
    returns: CType.BOOL,
  },
  GetDIBits: {
    args: [
      CType.ptr, // hdc
      CType.ptr, // hbmp
      CType.UINT, // uStartScan
      CType.UINT, // cScanLines
      CType.ptr, // lpvBits (buffer)
      CType.ptr, // lpbi (BITMAPINFO)
      CType.UINT, // uUsage
    ],
    returns: CType.INT,
  },
  DeleteDC: {
    args: [CType.ptr], // HDC
    returns: CType.BOOL,
  },
  GetDeviceCaps: {
    args: [CType.ptr, CType.INT], // HDC, nIndex
    returns: CType.INT,
  },
};

export const Gdi32Dll = {
  name: 'gdi32',
  knownToLinker: true,
  definitions: Gdi32Definitions,
} as const satisfies Win32Dll;
