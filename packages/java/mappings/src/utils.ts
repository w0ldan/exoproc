/**
 * @exoproc/njava-mappings - Mapping utilities and obfuscation detection helpers
 */

export const JAVA_PRIMITIVES = new Set<string>([
  'int',
  'float',
  'double',
  'long',
  'boolean',
  'byte',
  'short',
  'char',
  'void',
]);

export function isPrimitiveType(type: string): boolean {
  return JAVA_PRIMITIVES.has(type);
}

export const STANDARD_PACKAGES = [
  'java.',
  'javax.',
  'sun.',
  'jdk.',
  'org.lwjgl.',
  'com.google.',
  'org.apache.',
  'io.netty.',
  'scala.',
  'kotlin.',
];

export const STANDARD_UNOBFUSCATED_METHODS = new Set<string>([
  'toString',
  'equals',
  'hashCode',
  'clone',
  'compareTo',
  'run',
  'close',
  'call',
  'iterator',
  'hasNext',
  'next',
  'init',
  '<init>',
  '<clinit>',
  'finalize',
  'values',
  'valueOf',
  'getClass',
  'notify',
  'notifyAll',
  'wait',
]);

export function isObfuscatedClassName(className: string): boolean {
  if (!className) return false;
  const clean = className.replace(/^(class|interface)\s+/, '').trim();
  if (isPrimitiveType(clean)) return false;
  for (const pkg of STANDARD_PACKAGES) {
    if (clean.startsWith(pkg)) return false;
  }
  const parts = clean.split('.');
  const simpleName = parts[parts.length - 1] ?? '';
  if (parts.length === 1 && simpleName.length <= 4) {
    return true;
  }
  if (parts.length <= 2 && simpleName.length <= 3) {
    return true;
  }
  return false;
}

export function isObfuscatedMethodName(methodName: string): boolean {
  if (!methodName) return false;
  if (STANDARD_UNOBFUSCATED_METHODS.has(methodName)) return false;
  if (methodName.startsWith('func_')) return true;
  if (methodName.length <= 3) return true;
  return false;
}

const KNOWN_DEOBF_SHORT_NAMES = new Set([
  'id',
  'tag',
  'dim',
  'pos',
  'x',
  'y',
  'z',
  'yaw',
  'pitch',
  'age',
  'air',
  'red',
  'hue',
  'eye',
  'key',
  'val',
  'raw',
  'src',
  'dst',
  'len',
  'buf',
  'min',
  'max',
]);

export function isObfuscatedFieldName(fieldName: string): boolean {
  if (!fieldName) return false;
  if (fieldName.startsWith('field_')) return true;
  if (KNOWN_DEOBF_SHORT_NAMES.has(fieldName.toLowerCase())) return false;
  if (fieldName.length <= 3) return true;
  return false;
}

export function parseJavaVersion(versionStr: string): number {
  if (!versionStr) return 8;
  const match =
    versionStr.match(/(?:version\s+)?"?(\d+)(?:\.(\d+))?/i) ??
    versionStr.match(/(\d+)(?:\.(\d+))?/);
  if (!match) return 8;
  const major = parseInt(match[1]!, 10);
  if (major === 1 && match[2]) {
    return parseInt(match[2]!, 10);
  }
  return isNaN(major) ? 8 : major;
}
