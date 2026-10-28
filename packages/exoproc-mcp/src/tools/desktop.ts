import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import zlib from 'node:zlib';
import { Window } from 'bun-winapi';
import { Gdi32Impl, User32Impl } from 'bun-xffi';

export interface WindowItem {
  hwnd: string;
  editHwnd?: string;
  title: string;
  pid: number;
  tid: number;
  className?: string;
  rect?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
}

function encodeUtf16CString(str: string): Buffer {
  return Buffer.from(str + '\0', 'utf16le');
}

const SYSTEM_IME_CLASSES = new Set(['IME', 'Wine IME', 'MSCTFIME UI']);
const EDIT_CHILD_CLASSES = [
  'Edit',
  'RichEditD2DPT',
  'RichEdit20W',
  'Scintilla',
];

function findEditChildHwnd(parentHwnd: bigint): bigint {
  for (const cls of EDIT_CHILD_CLASSES) {
    const clsBuf = encodeUtf16CString(cls);
    const child = BigInt(
      (User32Impl.FindWindowExW(parentHwnd, 0n, clsBuf as any, null) as any) ??
        0n,
    );
    if (child !== 0n) return child;
  }
  return 0n;
}

/**
 * Enumerates top-level windows on the desktop.
 */
export async function listWindows(options?: {
  includeSystemWindows?: boolean;
  processFilter?: string;
}): Promise<WindowItem[]> {
  const windows: WindowItem[] = [];
  const includeSystem = options?.includeSystemWindows ?? false;
  const filter = options?.processFilter?.toLowerCase().trim();

  for (const win of Window.getWindows()) {
    const title = win.getText();
    const className = win.getClassName();
    if (!title || title.trim().length === 0) continue;
    if (!includeSystem && className && SYSTEM_IME_CLASSES.has(className)) {
      continue;
    }

    if (
      filter &&
      !title.toLowerCase().includes(filter) &&
      !(className && className.toLowerCase().includes(filter))
    ) {
      continue;
    }

    const [tid, pid] = win.getThreadProcessId();
    const rect = win.getRect();
    const width = rect ? rect.right - rect.left : 0;
    const height = rect ? rect.bottom - rect.top : 0;
    const editChild = findEditChildHwnd(win.rawHandle);

    windows.push({
      hwnd: `0x${win.rawHandle.toString(16)}`,
      ...(editChild !== 0n ? { editHwnd: `0x${editChild.toString(16)}` } : {}),
      title,
      pid,
      tid,
      className,
      rect: rect ? { ...rect, width, height } : undefined,
    });
  }

  return windows;
}

async function resolveTargetWindowHwnd(options: {
  hwnd?: string;
  pid?: number;
  title?: string;
  windowTitle?: string;
}): Promise<bigint> {
  if (options.hwnd) {
    return BigInt(options.hwnd);
  }

  const titleQuery = options.title ?? options.windowTitle;
  if (options.pid || titleQuery) {
    const windows = await listWindows({ includeSystemWindows: false });
    const query = titleQuery?.toLowerCase();
    const match = windows.find(
      (w) =>
        (options.pid !== undefined && w.pid === options.pid) ||
        (query !== undefined &&
          (w.title.toLowerCase().includes(query) ||
            (w.className && w.className.toLowerCase().includes(query)))),
    );
    if (match) {
      return BigInt(match.hwnd);
    }
  }

  return 0n;
}

/**
 * Pure TypeScript BGRA to PNG encoder.
 */
function makePngChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);

  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c;
  }

  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) {
    const byte = chunk[i] ?? 0;
    const tableVal = crcTable[(crc ^ byte) & 0xff] ?? 0;
    crc = tableVal ^ (crc >>> 8);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  chunk.writeUInt32BE(crc, 8 + data.length);
  return chunk;
}

function encodePng(width: number, height: number, bgraBuffer: Buffer): Buffer {
  const rowStride = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowStride);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowStride;
    rawData[rowOffset] = 0; // Filter Type 0 (None)
    const srcRowOffset = y * width * 4;

    for (let x = 0; x < width; x++) {
      const srcIdx = srcRowOffset + x * 4;
      const dstIdx = rowOffset + 1 + x * 4;
      rawData[dstIdx] = bgraBuffer[srcIdx + 2] ?? 0; // R
      rawData[dstIdx + 1] = bgraBuffer[srcIdx + 1] ?? 0; // G
      rawData[dstIdx + 2] = bgraBuffer[srcIdx] ?? 0; // B
      rawData[dstIdx + 3] = 255; // A (opaque)
    }
  }

  const compressed = zlib.deflateSync(rawData, { level: 6 });
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // Color type: RGBA (6)
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdrData),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Captures a screenshot of the remote desktop or a target window.
 */
export async function takeScreenshot(options: {
  pid?: number;
  hwnd?: string;
  title?: string;
  windowTitle?: string;
  outputPath?: string;
}): Promise<{
  success: boolean;
  width?: number;
  height?: number;
  filePath?: string;
  base64?: string;
}> {
  let hwnd = await resolveTargetWindowHwnd(options);

  if (hwnd === 0n) {
    hwnd = BigInt((User32Impl.GetDesktopWindow() as any) ?? 0n);
  }

  let width = 0;
  let height = 0;

  if (hwnd && hwnd !== 0n) {
    const win = new Window(hwnd);
    const rect = win.getRect();
    if (rect) {
      width = rect.right - rect.left;
      height = rect.bottom - rect.top;
    }
  }

  if (width <= 0 || height <= 0) {
    width = User32Impl.GetSystemMetrics(0) || 1920;
    height = User32Impl.GetSystemMetrics(1) || 1080;
  }

  const hdcTarget =
    hwnd && hwnd !== 0n ? User32Impl.GetDC(hwnd) : User32Impl.GetDC(0n);

  const Gdi = Gdi32Impl as any;
  const hdcMem = Gdi.CreateCompatibleDC(hdcTarget);
  const hBitmap = Gdi.CreateCompatibleBitmap(hdcTarget, width, height);
  Gdi.SelectObject(hdcMem, hBitmap);

  const SRCCOPY = 0x00cc0020;
  Gdi.BitBlt(hdcMem, 0, 0, width, height, hdcTarget, 0, 0, SRCCOPY);

  // If this window has child controls (e.g. Notepad's Edit child), also blit the child control onto the surface
  if (hwnd && hwnd !== 0n) {
    const editChild = findEditChildHwnd(hwnd);
    if (editChild && editChild !== 0n) {
      const childWin = new Window(editChild);
      const childRect = childWin.getRect();
      const parentWin = new Window(hwnd);
      const parentRect = parentWin.getRect();
      if (childRect && parentRect) {
        const relX = childRect.left - parentRect.left;
        const relY = childRect.top - parentRect.top;
        const childW = childRect.right - childRect.left;
        const childH = childRect.bottom - childRect.top;
        const hdcChild = User32Impl.GetDC(editChild);
        if (hdcChild) {
          Gdi.BitBlt(
            hdcMem,
            relX,
            relY,
            childW,
            childH,
            hdcChild,
            0,
            0,
            SRCCOPY,
          );
          User32Impl.ReleaseDC(editChild, hdcChild);
        }
      }
    }
  }

  const bmi = Buffer.alloc(40);
  bmi.writeUInt32LE(40, 0);
  bmi.writeInt32LE(width, 4);
  bmi.writeInt32LE(-height, 8); // top-down
  bmi.writeUInt16LE(1, 12);
  bmi.writeUInt16LE(32, 14);
  bmi.writeUInt32LE(0, 16);
  bmi.writeUInt32LE(width * height * 4, 20);

  const pixelBuffer = Buffer.alloc(width * height * 4);
  Gdi.GetDIBits(hdcMem, hBitmap, 0, height, pixelBuffer, bmi, 0);

  Gdi.DeleteObject(hBitmap);
  Gdi.DeleteDC(hdcMem);
  if (hdcTarget) {
    User32Impl.ReleaseDC(hwnd && hwnd !== 0n ? hwnd : 0n, hdcTarget);
  }

  const outPath = options.outputPath
    ? resolve(process.cwd(), options.outputPath)
    : resolve(process.cwd(), `screenshot-${Date.now()}.png`);

  const pngBuffer = encodePng(width, height, pixelBuffer);
  writeFileSync(outPath, pngBuffer);

  return {
    success: true,
    width,
    height,
    filePath: outPath,
    base64: pngBuffer.toString('base64'),
  };
}
