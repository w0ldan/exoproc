/**
 * Decodes a UTF-16LE array of numbers or a Buffer (e.g. from a Koffi struct) into a JS string.
 * Stops at the first null terminator (0).
 *
 * @param buffer - Array of uint16 code units (from ffi.decode) or a Buffer of raw UTF-16LE bytes
 * @returns The decoded JS string
 *
 * @example
 * const name = decodeStringW(entry.szExeFile); // "notepad.exe"
 * const name2 = decodeStringW(someBuffer);     // from raw Buffer
 */
export function decodeStringW(buffer: number[] | Buffer): string {
  if (Buffer.isBuffer(buffer)) {
    // Find null terminator (2 bytes per char in UTF-16LE)
    let byteLen = buffer.length;
    for (let i = 0; i < buffer.length - 1; i += 2) {
      if (buffer.readUInt16LE(i) === 0) {
        byteLen = i;
        break;
      }
    }
    return buffer.subarray(0, byteLen).toString('utf16le');
  }

  // number[] path
  let len = 0;
  while (len < buffer.length && buffer[len] !== 0) {
    len++;
  }
  const bytes = Buffer.alloc(len * 2);
  for (let i = 0; i < len; i++) {
    bytes.writeUInt16LE(buffer[i] as number, i * 2);
  }
  return bytes.toString('utf16le');
}

/**
 * Decodes an ANSI (single-byte) array of numbers or a Buffer into a JS string.
 * Stops at the first null terminator (0).
 *
 * @param buffer - Array of uint8 code units or a Buffer of raw ANSI bytes
 * @returns The decoded JS string
 *
 * @example
 * const name = decodeStringA(entry.szExeFile); // "notepad.exe"
 */
export function decodeStringA(buffer: number[] | Buffer): string {
  if (Buffer.isBuffer(buffer)) {
    const nullIdx = buffer.indexOf(0);
    return buffer
      .subarray(0, nullIdx === -1 ? buffer.length : nullIdx)
      .toString('utf8');
  }

  // number[] path
  let len = 0;
  while (len < buffer.length && buffer[len] !== 0) {
    len++;
  }
  return Buffer.from(buffer.slice(0, len)).toString('utf8');
}

/**
 * Decodes a string from either Wide (UTF-16LE) or ANSI encoding.
 *
 * @param buffer - Array of code units or a Buffer
 * @param wide - If true, decodes as UTF-16LE (W). If false, decodes as ANSI (A). Default: true.
 * @returns The decoded JS string
 *
 * @example
 * const name = decodeString(entry.szExeFile);        // Wide (default)
 * const name2 = decodeString(entry.szExeFile, false); // ANSI
 */
export function decodeString(
  buffer: number[] | Buffer,
  wide: boolean = true,
): string {
  return wide ? decodeStringW(buffer) : decodeStringA(buffer);
}
