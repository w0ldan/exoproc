export type AccessibleObjectKind = 'method' | 'constructor' | 'field';

export interface ParsedAccessibleObject {
  kind: AccessibleObjectKind;
  modifiers: ReadonlySet<string>;
  type: string | null; // return type for methods, field type for fields, null for constructors
  declaringClass: string;
  name: string | null; // null for constructors
  paramTypes: readonly string[]; // [] for fields
  exceptionTypes: readonly string[];
}

const KNOWN_MODIFIERS = new Set([
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
  'interface',
  'default',
]);

/**
 * Pure, no-JNI parser for `Method`, `Constructor`, and `Field.toString()` text
 * (also known as "ao-strings" in the C reference).
 *
 * Slices the text into its structured components without string mutation.
 */
export function parseAccessibleObjectString(
  text: string,
): ParsedAccessibleObject {
  const trimmed = text.trim();
  const parenIndex = trimmed.indexOf('(');

  if (parenIndex === -1) {
    // Field format: [modifiers] <type> <declaringClass>.<fieldName>
    const tokens = trimmed.split(/\s+/).filter(Boolean);
    const modifiers = new Set<string>();
    let tokenIndex = 0;
    while (tokenIndex < tokens.length - 2) {
      const tok = tokens[tokenIndex];
      if (!tok || !KNOWN_MODIFIERS.has(tok)) break;
      modifiers.add(tok);
      tokenIndex++;
    }

    const remainingTokens = tokens.slice(tokenIndex);
    const fieldType =
      remainingTokens.length >= 2 ? (remainingTokens[0] ?? null) : null;
    const fieldTarget = remainingTokens[remainingTokens.length - 1] ?? '';
    const lastDot = fieldTarget.lastIndexOf('.');
    const declaringClass =
      lastDot !== -1 ? fieldTarget.slice(0, lastDot) : fieldTarget;
    const name = lastDot !== -1 ? fieldTarget.slice(lastDot + 1) : fieldTarget;

    return {
      kind: 'field',
      modifiers,
      type: fieldType,
      declaringClass,
      name,
      paramTypes: [],
      exceptionTypes: [],
    };
  }

  // Method or Constructor format
  const beforeParen = trimmed.slice(0, parenIndex).trim();
  const afterParen = trimmed.slice(parenIndex + 1);

  const closeParenIndex = afterParen.indexOf(')');
  const paramsStr =
    closeParenIndex !== -1
      ? afterParen.slice(0, closeParenIndex).trim()
      : afterParen.trim();
  const paramTypes =
    paramsStr.length > 0 ? paramsStr.split(',').map((s) => s.trim()) : [];

  let exceptionTypes: string[] = [];
  if (closeParenIndex !== -1) {
    const afterCloseParen = afterParen.slice(closeParenIndex + 1).trim();
    if (afterCloseParen.startsWith('throws ')) {
      const throwsStr = afterCloseParen.slice('throws '.length).trim();
      exceptionTypes =
        throwsStr.length > 0 ? throwsStr.split(',').map((s) => s.trim()) : [];
    }
  }

  const tokens = beforeParen.split(/\s+/).filter(Boolean);
  const modifiers = new Set<string>();
  let tokenIndex = 0;
  while (tokenIndex < tokens.length - 1) {
    const tok = tokens[tokenIndex];
    if (!tok || !KNOWN_MODIFIERS.has(tok)) break;
    modifiers.add(tok);
    tokenIndex++;
  }

  const remainingTokens = tokens.slice(tokenIndex);

  if (remainingTokens.length <= 1) {
    // Constructor: [modifiers] <declaringClass>(...)
    const declaringClass = remainingTokens[0] ?? '';
    return {
      kind: 'constructor',
      modifiers,
      type: null,
      declaringClass,
      name: null,
      paramTypes,
      exceptionTypes,
    };
  }

  // Method: [modifiers] <returnType> <declaringClass>.<methodName>(...)
  const returnType = remainingTokens[0] ?? null;
  const methodTarget = remainingTokens[remainingTokens.length - 1] ?? '';
  const lastDot = methodTarget.lastIndexOf('.');
  const declaringClass =
    lastDot !== -1 ? methodTarget.slice(0, lastDot) : methodTarget;
  const name = lastDot !== -1 ? methodTarget.slice(lastDot + 1) : methodTarget;

  return {
    kind: 'method',
    modifiers,
    type: returnType,
    declaringClass,
    name,
    paramTypes,
    exceptionTypes,
  };
}
