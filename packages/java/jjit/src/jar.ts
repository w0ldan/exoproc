import { crc32, deflateRawSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface JarEntry {
  /** Relative path inside JAR, e.g. "org/example/MyClass.class" or "META-INF/MANIFEST.MF" */
  path: string;
  /** Binary data for this entry */
  data: Uint8Array;
}

export interface JarManifestOptions {
  mainClass?: string;
  premainClass?: string;
  agentClass?: string;
  canRedefineClasses?: boolean;
  canRetransformClasses?: boolean;
  attributes?: Record<string, string>;
}

/**
 * Builds a standard MANIFEST.MF content string.
 */
export function buildManifestContent(
  options: JarManifestOptions | Record<string, string> | string,
): string {
  if (typeof options === 'string') {
    return options.endsWith('\n') ? options : options + '\n';
  }

  const lines = ['Manifest-Version: 1.0', 'Created-By: Exoproc JJit'];

  if ('mainClass' in options && options.mainClass) {
    lines.push(`Main-Class: ${options.mainClass}`);
  }
  if ('premainClass' in options && options.premainClass) {
    lines.push(`Premain-Class: ${options.premainClass}`);
  }
  if ('agentClass' in options && options.agentClass) {
    lines.push(`Agent-Class: ${options.agentClass}`);
  }
  if (
    'canRedefineClasses' in options &&
    options.canRedefineClasses !== undefined
  ) {
    lines.push(`Can-Redefine-Classes: ${options.canRedefineClasses}`);
  }
  if (
    'canRetransformClasses' in options &&
    options.canRetransformClasses !== undefined
  ) {
    lines.push(`Can-Retransform-Classes: ${options.canRetransformClasses}`);
  }

  const attrs =
    'attributes' in options && options.attributes
      ? options.attributes
      : options;
  for (const [key, val] of Object.entries(attrs)) {
    if (
      key === 'mainClass' ||
      key === 'premainClass' ||
      key === 'agentClass' ||
      key === 'canRedefineClasses' ||
      key === 'canRetransformClasses' ||
      key === 'attributes'
    ) {
      continue;
    }
    lines.push(`${key}: ${val}`);
  }

  return lines.join('\r\n') + '\r\n\r\n';
}

/**
 * Builds an in-memory valid ZIP/JAR buffer with 0 external dependencies.
 */
export function buildJarBuffer(entries: JarEntry[]): Buffer {
  const parts: Buffer[] = [];
  const cdEntries: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const normPath = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const pathBuf = Buffer.from(normPath, 'utf8');
    const rawData = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(
          entry.data.buffer,
          entry.data.byteOffset,
          entry.data.byteLength,
        );

    const checksum = crc32(rawData);
    const compressed = deflateRawSync(rawData);
    const useDeflate = compressed.length < rawData.length;
    const method = useDeflate ? 8 : 0;
    const body = useDeflate ? compressed : rawData;

    // Local file header (30 bytes) + path
    const localHdr = Buffer.alloc(30 + pathBuf.length);
    localHdr.writeUInt32LE(0x04034b50, 0);
    localHdr.writeUInt16LE(20, 4); // version needed (2.0)
    localHdr.writeUInt16LE(0, 6); // flags
    localHdr.writeUInt16LE(method, 8);
    localHdr.writeUInt16LE(0, 10); // time
    localHdr.writeUInt16LE(0, 12); // date
    localHdr.writeUInt32LE(checksum, 14);
    localHdr.writeUInt32LE(body.length, 18);
    localHdr.writeUInt32LE(rawData.length, 22);
    localHdr.writeUInt16LE(pathBuf.length, 26);
    localHdr.writeUInt16LE(0, 28);
    pathBuf.copy(localHdr, 30);

    parts.push(localHdr);
    parts.push(body);

    // Central directory header (46 bytes) + path
    const cdHdr = Buffer.alloc(46 + pathBuf.length);
    cdHdr.writeUInt32LE(0x02014b50, 0);
    cdHdr.writeUInt16LE(20, 4); // version made by
    cdHdr.writeUInt16LE(20, 6); // version needed
    cdHdr.writeUInt16LE(0, 8); // flags
    cdHdr.writeUInt16LE(method, 10);
    cdHdr.writeUInt16LE(0, 12); // time
    cdHdr.writeUInt16LE(0, 14); // date
    cdHdr.writeUInt32LE(checksum, 16);
    cdHdr.writeUInt32LE(body.length, 20);
    cdHdr.writeUInt32LE(rawData.length, 24);
    cdHdr.writeUInt16LE(pathBuf.length, 28);
    cdHdr.writeUInt16LE(0, 30);
    cdHdr.writeUInt16LE(0, 32);
    cdHdr.writeUInt16LE(0, 34);
    cdHdr.writeUInt16LE(0, 36);
    cdHdr.writeUInt32LE(0, 38);
    cdHdr.writeUInt32LE(offset, 42);
    pathBuf.copy(cdHdr, 46);

    cdEntries.push(cdHdr);

    offset += localHdr.length + body.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cd of cdEntries) {
    parts.push(cd);
    cdSize += cd.length;
  }

  // End of Central Directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);
  parts.push(eocd);

  return Buffer.concat(parts);
}

/**
 * Writes a valid JAR file to disk.
 */
export function writeJarSync(jarPath: string, entries: JarEntry[]): void {
  const buf = buildJarBuffer(entries);
  const dir = dirname(jarPath);
  if (dir && dir !== '.' && dir !== '') {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(jarPath, buf);
}

/**
 * Builds a JAR Buffer from a Map or Record of class bytecode.
 */
export function buildJarFromClasses(
  classes: Map<string, Uint8Array> | Record<string, Uint8Array>,
  manifest?: JarManifestOptions | Record<string, string> | string,
): Buffer {
  const entries: JarEntry[] = [];

  if (manifest) {
    const manifestText = buildManifestContent(manifest);
    entries.push({
      path: 'META-INF/MANIFEST.MF',
      data: Buffer.from(manifestText, 'utf8'),
    });
  }

  const entriesIter =
    classes instanceof Map ? classes.entries() : Object.entries(classes);
  for (const [name, bytes] of entriesIter) {
    let entryPath = name.replace(/\\/g, '/');
    if (!entryPath.endsWith('.class')) {
      entryPath = entryPath.replace(/\./g, '/') + '.class';
    }
    entries.push({
      path: entryPath,
      data: bytes,
    });
  }

  return buildJarBuffer(entries);
}

/**
 * Writes a JAR file to disk directly from a Map or Record of class bytecode.
 */
export function writeJarFromClassesSync(
  jarPath: string,
  classes: Map<string, Uint8Array> | Record<string, Uint8Array>,
  manifest?: JarManifestOptions | Record<string, string> | string,
): void {
  const buf = buildJarFromClasses(classes, manifest);
  const dir = dirname(jarPath);
  if (dir && dir !== '.' && dir !== '') {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(jarPath, buf);
}
