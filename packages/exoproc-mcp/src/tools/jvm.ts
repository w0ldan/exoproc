import { readFileSync } from 'node:fs';

/**
 * Fast in-memory ZIP central directory reader to enumerate classes inside any .jar file
 */
export function getJarClasses(jarPath: string): string[] {
  const buf = readFileSync(jarPath);
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return [];
  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  const classes: string[] = [];
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    if (name.endsWith('.class') && !name.startsWith('META-INF/')) {
      classes.push(name.slice(0, -6).replace(/\//g, '.'));
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return classes;
}

export async function inspectJar(options: {
  jarPath: string;
  filter?: string;
}): Promise<{
  targetJar: string;
  totalClasses: number;
  matchedCount: number;
  classes: string[];
}> {
  const classes = getJarClasses(options.jarPath);
  let matched = classes;
  if (options.filter) {
    const reg = new RegExp(options.filter, 'i');
    matched = classes.filter((c) => reg.test(c));
  }
  return {
    targetJar: options.jarPath,
    totalClasses: classes.length,
    matchedCount: matched.length,
    classes: matched.slice(0, 500),
  };
}
