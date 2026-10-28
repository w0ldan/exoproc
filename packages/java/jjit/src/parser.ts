import type { MappingPool } from 'exoproc-mappings';
import { JavaClassBuilder } from './builder.js';
import { JavaTypeResolver } from './type-resolver.js';
import type { JavaParamDef } from './types.js';

export interface MemberChunk {
  header: string;
  body?: string;
  isBlock: boolean;
}

function isEscaped(str: string, idx: number): boolean {
  let count = 0;
  for (let j = idx - 1; j >= 0 && str[j] === '\\'; j--) count++;
  return count % 2 === 1;
}

/**
 * Strips comments from Java source outside of string and character literals.
 */
export function stripComments(code: string): string {
  let inString = false;
  let inChar = false;
  let inLineComment = false;
  let inBlockComment = false;
  let result = '';

  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const next = i + 1 < code.length ? code[i + 1] : '';

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        result += '\n';
      }
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (char === '"' && !isEscaped(code, i)) inString = false;
      result += char;
      continue;
    }
    if (inChar) {
      if (char === "'" && !isEscaped(code, i)) inChar = false;
      result += char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (char === "'") {
      inChar = true;
      result += char;
      continue;
    }

    result += char;
  }
  return result;
}

/**
 * Splits class body into top-level member chunks (fields, methods, constructors, raw blocks).
 */
export function splitClassMembers(bodyContent: string): MemberChunk[] {
  const chunks: MemberChunk[] = [];
  let depth = 0;
  let inString = false;
  let inChar = false;
  let inLineComment = false;
  let inBlockComment = false;

  let currentHeader = '';
  let currentBody = '';

  for (let i = 0; i < bodyContent.length; i++) {
    const char = bodyContent[i];
    const next = i + 1 < bodyContent.length ? bodyContent[i + 1] : '';

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      if (depth > 0) currentBody += char;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        if (depth > 0) currentBody += '*/';
        i++;
        continue;
      }
      if (depth > 0) currentBody += char;
      continue;
    }
    if (inString) {
      if (char === '"' && !isEscaped(bodyContent, i)) inString = false;
      if (depth === 0) currentHeader += char;
      else currentBody += char;
      continue;
    }
    if (inChar) {
      if (char === "'" && !isEscaped(bodyContent, i)) inChar = false;
      if (depth === 0) currentHeader += char;
      else currentBody += char;
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      if (depth > 0) currentBody += '//';
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      if (depth > 0) currentBody += '/*';
      i++;
      continue;
    }
    if (char === '"') {
      inString = true;
      if (depth === 0) currentHeader += char;
      else currentBody += char;
      continue;
    }
    if (char === "'") {
      inChar = true;
      if (depth === 0) currentHeader += char;
      else currentBody += char;
      continue;
    }

    if (char === '{') {
      if (depth === 0) {
        depth = 1;
        currentBody = '';
        continue;
      }
      depth++;
      currentBody += char;
      continue;
    }

    if (char === '}') {
      depth--;
      if (depth === 0) {
        // Block completed!
        chunks.push({
          header: currentHeader.trim(),
          body: currentBody.trim(),
          isBlock: true,
        });
        currentHeader = '';
        currentBody = '';
        continue;
      }
      currentBody += char;
      continue;
    }

    if (char === ';' && depth === 0) {
      // Non-block statement (field or abstract method)
      chunks.push({
        header: currentHeader.trim(),
        isBlock: false,
      });
      currentHeader = '';
      currentBody = '';
      continue;
    }

    if (depth === 0) {
      currentHeader += char;
    } else {
      currentBody += char;
    }
  }

  if (currentHeader.trim().length > 0) {
    chunks.push({
      header: currentHeader.trim(),
      isBlock: false,
    });
  }

  return chunks;
}

/**
 * Parses method / constructor parameter signatures.
 */
export function parseParams(paramStr: string): JavaParamDef[] {
  const trimmed = paramStr.trim();
  if (!trimmed) return [];

  // Split by comma, respecting generics <...>
  const parts: string[] = [];
  let genericDepth = 0;
  let cur = '';
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === '<') genericDepth++;
    else if (c === '>') genericDepth--;
    else if (c === ',' && genericDepth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());

  return parts.map((part) => {
    // Strip annotations and final
    const clean = part
      .replace(/@\w+(?:\([^)]*\))?\s+/g, '')
      .replace(/\bfinal\s+/g, '')
      .trim();
    const lastSpace = clean.lastIndexOf(' ');
    if (lastSpace === -1) {
      return { name: clean, type: 'Object' };
    }
    const type = clean.slice(0, lastSpace).trim();
    const name = clean.slice(lastSpace + 1).trim();
    return { name, type };
  });
}

/**
 * Splits string by whitespace while preserving generic types containing spaces (e.g. Map<String, Object>).
 */
export function splitTokensRespectingGenerics(str: string): string[] {
  const tokens: string[] = [];
  let genericDepth = 0;
  let cur = '';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '<') genericDepth++;
    else if (c === '>') genericDepth--;
    else if (c && /\s/.test(c) && genericDepth === 0) {
      if (cur.trim()) tokens.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  if (cur.trim()) tokens.push(cur.trim());
  return tokens;
}

/**
 * Parses raw Java source code back into a structured JavaClassBuilder object.
 */
export function parseJavaSource(
  source: string,
  poolOrResolver?: MappingPool | JavaTypeResolver,
): JavaClassBuilder {
  // 1. Package
  const pkgMatch = source.match(/package\s+([a-zA-Z0-9_.]+)\s*;/);
  const packageName = pkgMatch && pkgMatch[1] ? pkgMatch[1].trim() : undefined;

  // 2. Imports
  const importRegex = /import\s+(?:static\s+)?([a-zA-Z0-9_.*]+)\s*;/g;
  const imports: string[] = [];
  let impMatch: RegExpExecArray | null;
  while ((impMatch = importRegex.exec(source)) !== null) {
    if (impMatch[1]) {
      imports.push(impMatch[1]);
    }
  }

  // 3. Class declaration
  const classDeclRegex =
    /((?:@\w+(?:\([^)]*\))?\s+)*)((?:(?:public|protected|private|static|final|abstract)\s+)*)(class|interface|enum)\s+([a-zA-Z0-9_]+)(?:<[^{]+?>)?(?:\s+extends\s+([^{]+?))?(?:\s+implements\s+([^{]+?))?\s*\{/s;
  const match = classDeclRegex.exec(source);
  if (!match || !match[4]) {
    throw new Error(
      'Could not find valid Java class/interface/enum declaration in source code.',
    );
  }

  const classAnnotations = match[1];
  const classModifiers = match[2];
  const className = match[4];
  const superClass = match[5];
  const ifaces = match[6];
  const builder = new JavaClassBuilder(className, poolOrResolver);

  if (packageName) {
    builder.package(packageName);
  }

  for (const imp of imports) {
    builder.import(imp);
  }

  if (classAnnotations) {
    for (const ann of classAnnotations.trim().split(/\s+/)) {
      if (ann.startsWith('@')) builder.annotation(ann);
    }
  }

  if (classModifiers && classModifiers.trim()) {
    builder.modifier(classModifiers.trim());
  }

  if (superClass && superClass.trim()) {
    builder.extends(superClass.trim());
  }

  if (ifaces && ifaces.trim()) {
    const list = ifaces
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    builder.implements(...list);
  }

  // 4. Find class body
  const openBraceIdx = match.index + match[0].length - 1;
  let bodyEndIdx = source.lastIndexOf('}');
  if (bodyEndIdx <= openBraceIdx) bodyEndIdx = source.length;
  const bodyContent = source.slice(openBraceIdx + 1, bodyEndIdx);

  // 5. Split members
  const memberChunks = splitClassMembers(bodyContent);

  for (const chunk of memberChunks) {
    const { header, body, isBlock } = chunk;
    if (!header && !body) continue;

    if (!isBlock) {
      // Semicolon-terminated statement: Field or Abstract Method
      const parenIdx = header.indexOf('(');
      const eqIdx = header.indexOf('=');

      if (parenIdx !== -1 && (eqIdx === -1 || parenIdx < eqIdx)) {
        // Abstract method: e.g. "public abstract int compute(int a, int b)"
        const closeParenIdx = header.lastIndexOf(')');
        const sigBeforeParen = header.slice(0, parenIdx).trim();
        const paramStr = header.slice(parenIdx + 1, closeParenIdx).trim();

        const annotations: string[] = [];
        const cleanSig = sigBeforeParen
          .replace(/@\w+(?:\([^)]*\))?/g, (m) => {
            annotations.push(m);
            return '';
          })
          .trim();

        const tokens = splitTokensRespectingGenerics(cleanSig);
        const methodName = tokens.pop()!;
        const returnType = tokens.pop() ?? 'void';
        const mods = tokens.join(' ');

        const mb = builder.method(methodName, returnType);
        for (const ann of annotations) mb.annotation(ann);
        if (mods) mb.modifier(mods);
        if (paramStr) mb.params(parseParams(paramStr));
      } else {
        // Field declaration: e.g. "public static final int CONSTANT = 100"
        let lhs = header;
        let initVal: string | undefined;
        if (eqIdx !== -1) {
          lhs = header.slice(0, eqIdx).trim();
          initVal = header.slice(eqIdx + 1).trim();
        }

        const annotations: string[] = [];
        const cleanLhs = lhs
          .replace(/@\w+(?:\([^)]*\))?/g, (m) => {
            annotations.push(m);
            return '';
          })
          .trim();

        const tokens = splitTokensRespectingGenerics(cleanLhs);
        const fieldName = tokens.pop()!;
        const fieldType = tokens.pop() ?? 'Object';
        const mods = tokens.join(' ');

        const fb = builder.field(fieldName, fieldType, mods, initVal);
        for (const ann of annotations) fb.annotation(ann);
      }
      continue;
    }

    // Block chunk: Constructor, Method, Static block, or Inner class
    if (header === 'static') {
      builder.rawMember(`static {\n    ${body}\n}`);
      continue;
    }

    const parenIdx = header.indexOf('(');
    if (parenIdx === -1) {
      // Unrecognized block or inner class
      builder.rawMember(`${header} {\n    ${body}\n}`);
      continue;
    }

    const closeParenIdx = header.lastIndexOf(')');
    const sigBeforeParen = header.slice(0, parenIdx).trim();
    const paramStr = header.slice(parenIdx + 1, closeParenIdx).trim();
    const afterParen = header.slice(closeParenIdx + 1).trim();

    // Check annotations
    const annotations: string[] = [];
    const cleanSig = sigBeforeParen
      .replace(/@\w+(?:\([^)]*\))?/g, (m) => {
        annotations.push(m);
        return '';
      })
      .trim();

    const tokens = splitTokensRespectingGenerics(cleanSig);
    const lastIdent = tokens.pop()!;

    // Check throws
    const throwsList: string[] = [];
    if (afterParen.startsWith('throws ')) {
      throwsList.push(
        ...afterParen
          .slice(7)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    }

    if (lastIdent === className) {
      // Constructor!
      const mods = tokens.join(' ');
      const cb = builder.constructorDef(parseParams(paramStr), body);
      if (mods) cb.modifier(mods);
      if (throwsList.length > 0) cb.throws(...throwsList);
    } else {
      // Method!
      const methodName = lastIdent;
      const returnType = tokens.pop() ?? 'void';
      const mods = tokens.join(' ');

      const mb = builder.method(methodName, returnType);
      for (const ann of annotations) mb.annotation(ann);
      if (mods) mb.modifier(mods);
      if (paramStr) mb.params(parseParams(paramStr));
      if (throwsList.length > 0) mb.throws(...throwsList);
      if (body) mb.body(body);
    }
  }

  return builder;
}
