import { ResourceUri } from 'win32-simulate/files';
import { ZipFsProvider } from '../src/shell/main/fs/zip-fs-provider';

/**
 * Builds a real zip archive byte-for-byte from the spec (central
 * directory + local headers + end-of-central-directory), independent of
 * `ZipFsProvider`'s own reading code, so this exercises the parser
 * honestly rather than checking it against its own assumptions.
 * Compression goes through the platform's own `CompressionStream`, and
 * `ZipFsProvider` decompresses with `DecompressionStream` -- if raw
 * deflate framing ever mismatched between them, this would catch it.
 */

interface ZipEntryInput {
  readonly name: string;
  readonly content?: Uint8Array;
  readonly store?: boolean; // true = method 0 (stored), default = method 8 (deflate)
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function u16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}
function u32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

async function buildZip(
  entries: readonly ZipEntryInput[],
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let cursor = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const raw = entry.content ?? new Uint8Array();
    const isStored = entry.store === true || raw.length === 0;
    const compressed = isStored ? raw : await deflateRaw(raw);
    const method = isStored ? 0 : 8;
    const localOffset = cursor;

    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    u32(localView, 0, 0x04034b50);
    u16(localView, 4, 20); // version needed
    u16(localView, 6, 0); // general purpose flag
    u16(localView, 8, method);
    u16(localView, 10, 0); // mod time
    u16(localView, 12, 0); // mod date
    u32(localView, 14, 0); // crc32 (unchecked by the reader under test)
    u32(localView, 18, compressed.length);
    u32(localView, 22, raw.length);
    u16(localView, 26, nameBytes.length);
    u16(localView, 28, 0); // extra field length

    localParts.push(localHeader, nameBytes, compressed);
    cursor += localHeader.length + nameBytes.length + compressed.length;

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    u32(centralView, 0, 0x02014b50);
    u16(centralView, 4, 20); // version made by
    u16(centralView, 6, 20); // version needed
    u16(centralView, 8, 0); // general purpose flag
    u16(centralView, 10, method);
    u16(centralView, 12, 0);
    u16(centralView, 14, 0);
    u32(centralView, 16, 0); // crc32
    u32(centralView, 20, compressed.length);
    u32(centralView, 24, raw.length);
    u16(centralView, 28, nameBytes.length);
    u16(centralView, 30, 0); // extra length
    u16(centralView, 32, 0); // comment length
    u16(centralView, 34, 0); // disk number start
    u16(centralView, 36, 0); // internal attrs
    u32(centralView, 38, 0); // external attrs
    u32(centralView, 42, localOffset);

    centralParts.push(centralHeader, nameBytes);
  }

  const centralDirectoryOffset = cursor;
  const centralBytes = concat(centralParts);
  cursor += centralBytes.length;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  u32(eocdView, 0, 0x06054b50);
  u16(eocdView, 4, 0);
  u16(eocdView, 6, 0);
  u16(eocdView, 8, entries.length);
  u16(eocdView, 10, entries.length);
  u32(eocdView, 12, centralBytes.length);
  u32(eocdView, 16, centralDirectoryOffset);
  u16(eocdView, 20, 0);

  return concat([...localParts, centralBytes, eocd]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const u = (path: string) => ResourceUri.from({ scheme: 'workspace', path });
const enc = new TextEncoder();
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  got=${a} want=${e}`}`,
  );
}

// ------------------------------------------ top-level prefix stripping
{
  const zip = await buildZip([
    {
      name: 'demo-main/README.md',
      content: enc.encode('hello from readme, '.repeat(20)),
    },
    {
      name: 'demo-main/src/main.ts',
      content: enc.encode('export const x = 1;\n'.repeat(10)),
    },
    {
      name: 'demo-main/src/util.ts',
      content: enc.encode('stored content'),
      store: true,
    },
    { name: 'demo-main/empty-dir/', content: new Uint8Array() },
  ]);

  const fs = new ZipFsProvider(zip);

  const root = (await fs.readDirectory(u('/'))).map(([n]) => n).sort();
  check('prefix stripped from root listing', root, [
    'README.md',
    'empty-dir',
    'src',
  ]);

  check(
    'deflated file decompresses correctly',
    dec(await fs.readFile(u('/README.md'))),
    'hello from readme, '.repeat(20),
  );
  check(
    'second deflated file decompresses correctly',
    dec(await fs.readFile(u('/src/main.ts'))),
    'export const x = 1;\n'.repeat(10),
  );
  check(
    'stored (uncompressed) file reads correctly',
    dec(await fs.readFile(u('/src/util.ts'))),
    'stored content',
  );

  const src = (await fs.readDirectory(u('/src'))).map(([n]) => n).sort();
  check('nested directory listing', src, ['main.ts', 'util.ts']);

  const emptyDirStat = await fs.stat(u('/empty-dir'));
  check(
    'explicit directory entry recognized',
    emptyDirStat.type,
    2 /* FileType.Directory */,
  );

  const fileStat = await fs.stat(u('/README.md'));
  check('file stat reports readonly', fileStat.readonly, true);
  check(
    'file stat reports correct size',
    fileStat.size,
    enc.encode('hello from readme, '.repeat(20)).length,
  );
}

// --------------------------------------------------- no common prefix
{
  const zip = await buildZip([
    { name: 'a.txt', content: enc.encode('a') },
    { name: 'b.txt', content: enc.encode('b') },
  ]);
  const fs = new ZipFsProvider(zip);
  const root = (await fs.readDirectory(u('/'))).map(([n]) => n).sort();
  check('no stripping when there is no shared top folder', root, [
    'a.txt',
    'b.txt',
  ]);
}

// -------------------------------------------------------- readonly writes
{
  const zip = await buildZip([{ name: 'only.txt', content: enc.encode('x') }]);
  const fs = new ZipFsProvider(zip);
  let rejected = false;
  try {
    await fs.writeFile(u('/only.txt'), enc.encode('y'), {
      create: false,
      overwrite: true,
    });
  } catch {
    rejected = true;
  }
  check('writes are rejected', rejected, true);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
