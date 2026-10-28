/**
 * Encodes a string into a wide string (UTF-16LE) null-terminated buffer.
 * @param value The string to encode
 */
export function encodeStringW(value: string): Buffer {
  const encoded = Buffer.from(value, 'utf16le');
  const buffer = Buffer.alloc(encoded.length + 2);
  encoded.copy(buffer);
  return buffer;
}

/**
 * Encodes a string into an ANSI string (UTF-8) null-terminated buffer.
 * @param value The string to encode
 */
export function encodeStringA(value: string): Buffer {
  const encoded = Buffer.from(value, 'utf8');
  const buffer = Buffer.alloc(encoded.length + 1);
  encoded.copy(buffer);
  return buffer;
}

/**
 * Encodes a string into a null-terminated buffer.
 * @param value The string to encode
 * @param wide If true, encodes as Wide (UTF-16LE). If false, encodes as ANSI (UTF-8). If undefined, automatically detects based on string content.
 */
export function encodeString(value: string, wide?: boolean): Buffer {
  // eslint-disable-next-line no-control-regex
  const isWide = wide ?? /[^\x00-\x7f]/.test(value);
  return isWide ? encodeStringW(value) : encodeStringA(value);
}

/**
 * Resolves the correct ANSI or Wide Win32 function variant based on string content,
 * and encodes the string into a null-terminated buffer using the optimized encoding methods.
 *
 * @param ansiFunc - The ANSI (A) variant of the function
 * @param wideFunc - The Wide (W) variant of the function
 * @param value - The string to encode
 * @param wide - Optional. If true, forces Wide (UTF-16LE). If false, forces ANSI (UTF-8). Auto-detects if undefined.
 * @returns A tuple of [encoded buffer, selected function]
 */
export function resolveEncoding<TFunc>(
  ansiFunc: TFunc,
  wideFunc: TFunc,
  value: string,
  wide?: boolean,
): [Buffer, TFunc] {
  // eslint-disable-next-line no-control-regex
  const isUnicode = wide ?? /[^\x00-\x7f]/.test(value);
  const buffer = isUnicode ? encodeStringW(value) : encodeStringA(value);
  return [buffer, isUnicode ? wideFunc : ansiFunc];
}
