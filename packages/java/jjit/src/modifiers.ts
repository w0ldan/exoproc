/**
 * @exoproc/jjit - Standard Java Modifier Flags & Normalization
 */

export const JavaModifierFlags = {
  PUBLIC: 0x0001,
  PRIVATE: 0x0002,
  PROTECTED: 0x0004,
  STATIC: 0x0008,
  FINAL: 0x0010,
  SYNCHRONIZED: 0x0020,
  VOLATILE: 0x0040,
  TRANSIENT: 0x0080,
  NATIVE: 0x0100,
  INTERFACE: 0x0200,
  ABSTRACT: 0x0400,
  STRICTFP: 0x0800,
} as const;

export type JavaModifier =
  | 'public'
  | 'protected'
  | 'private'
  | 'abstract'
  | 'static'
  | 'final'
  | 'synchronized'
  | 'volatile'
  | 'transient'
  | 'native'
  | 'strictfp';

const ORDERED_MODIFIERS: JavaModifier[] = [
  'public',
  'protected',
  'private',
  'abstract',
  'static',
  'final',
  'transient',
  'volatile',
  'synchronized',
  'native',
  'strictfp',
];

const FLAG_TO_MODIFIER: Array<[number, JavaModifier]> = [
  [JavaModifierFlags.PUBLIC, 'public'],
  [JavaModifierFlags.PROTECTED, 'protected'],
  [JavaModifierFlags.PRIVATE, 'private'],
  [JavaModifierFlags.ABSTRACT, 'abstract'],
  [JavaModifierFlags.STATIC, 'static'],
  [JavaModifierFlags.FINAL, 'final'],
  [JavaModifierFlags.TRANSIENT, 'transient'],
  [JavaModifierFlags.VOLATILE, 'volatile'],
  [JavaModifierFlags.SYNCHRONIZED, 'synchronized'],
  [JavaModifierFlags.NATIVE, 'native'],
  [JavaModifierFlags.STRICTFP, 'strictfp'],
];

export type ModifierInput =
  | number
  | JavaModifier
  | JavaModifier[]
  | Set<JavaModifier | string>
  | string
  | Partial<Record<JavaModifier, boolean>>
  | undefined
  | null;

/**
 * Parses modifier input (string, bitmask, Set, array, or boolean object) into a Set of JavaModifier strings.
 */
export function parseModifiers(input?: ModifierInput): Set<JavaModifier> {
  const result = new Set<JavaModifier>();
  if (!input) return result;

  if (typeof input === 'number') {
    for (const [flag, name] of FLAG_TO_MODIFIER) {
      if ((input & flag) !== 0) {
        result.add(name);
      }
    }
    return result;
  }

  if (typeof input === 'string') {
    const tokens = input.trim().split(/\s+/);
    for (const token of tokens) {
      const lower = token.toLowerCase() as JavaModifier;
      if (ORDERED_MODIFIERS.includes(lower)) {
        result.add(lower);
      }
    }
    return result;
  }

  if (input instanceof Set) {
    for (const item of input) {
      if (typeof item === 'string') {
        const lower = item.toLowerCase() as JavaModifier;
        if (ORDERED_MODIFIERS.includes(lower)) {
          result.add(lower);
        }
      }
    }
    return result;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'string') {
        const lower = item.toLowerCase() as JavaModifier;
        if (ORDERED_MODIFIERS.includes(lower)) {
          result.add(lower);
        }
      }
    }
    return result;
  }

  if (typeof input === 'object') {
    for (const [key, val] of Object.entries(input)) {
      if (val) {
        const lower = key.toLowerCase() as JavaModifier;
        if (ORDERED_MODIFIERS.includes(lower)) {
          result.add(lower);
        }
      }
    }
  }

  return result;
}

/**
 * Normalizes modifiers into a canonical, correctly ordered Java source string (e.g. "public static final").
 */
export function normalizeModifiers(input?: ModifierInput): string {
  const parsed = parseModifiers(input);
  if (parsed.size === 0) return '';

  const matched: string[] = [];
  for (const mod of ORDERED_MODIFIERS) {
    if (parsed.has(mod)) {
      matched.push(mod);
    }
  }
  return matched.join(' ');
}

/**
 * Converts modifier input into an integer bitmask.
 */
export function modifiersToFlags(input?: ModifierInput): number {
  const parsed = parseModifiers(input);
  let flags = 0;
  for (const [flag, name] of FLAG_TO_MODIFIER) {
    if (parsed.has(name)) {
      flags |= flag;
    }
  }
  return flags;
}

/**
 * Converts an integer bitmask into an array of JavaModifier strings.
 */
export function flagsToModifiers(flags: number): JavaModifier[] {
  const result: JavaModifier[] = [];
  for (const [flag, name] of FLAG_TO_MODIFIER) {
    if ((flags & flag) !== 0) {
      result.push(name);
    }
  }
  return result;
}
