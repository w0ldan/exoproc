/**
 * A small recursive-descent compiler for C snippets submitted through the
 * simulator's compiler and FFI APIs.
 *
 * This is *not* a general C compiler. It supports a deliberately narrow set
 * of constructs: local variable declarations with initializers, the
 * usual arithmetic/comparison/logical-not operators, pointer/array
 * indexing (read + write), `struct`/`union` field access (`.`/`->`),
 * function-pointer typedefs + indirect calls, calling an extern/imported
 * function by name, `if`/`while`/`for`/`break`, and `return`. Every local
 * scalar is stored in its own 8-byte stack slot regardless of its declared
 * width -- only pointer/struct-field memory accesses care about the
 * narrower width (1/2/4/8 bytes) of the declared C type. All relational
 * comparisons in the real corpus are unsigned (`size_t`/pointer
 * arithmetic), so only unsigned conditional jumps are implemented; a
 * genuinely signed comparison throws a clear, recognizable error instead of
 * silently producing a wrong answer.
 *
 * Anything outside this subset (bitwise operators, `&&`/`||`, floating
 * point, `goto`, multiple translation units, ...) throws a descriptive
 * error rather than guessing. This is a narrow front end, not a general C
 * compiler.
 */
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CIntType {
  readonly kind: 'int';
  readonly size: 1 | 2 | 4 | 8;
  readonly signed: boolean;
}
export interface CVoidType {
  readonly kind: 'void';
}
export interface CPointerType {
  readonly kind: 'pointer';
  readonly pointee: CType;
}
export interface CStructField {
  readonly offset: number;
  readonly type: CType;
  readonly isArray: boolean;
  readonly arrayLength: number;
}
export interface CStructType {
  readonly kind: 'struct';
  readonly name: string;
  readonly size: number;
  readonly isUnion: boolean;
  readonly fields: ReadonlyMap<string, CStructField>;
}
export interface CFuncPtrType {
  readonly kind: 'funcptr';
  readonly name: string;
  readonly paramCount: number;
}
export type CType =
  CIntType | CVoidType | CPointerType | CStructType | CFuncPtrType;

const VOID: CVoidType = { kind: 'void' };

export function sizeOf(type: CType): number {
  switch (type.kind) {
    case 'int':
      return type.size;
    case 'pointer':
    case 'funcptr':
      return 8;
    case 'struct':
      return type.size;
    case 'void':
      return 1;
  }
}

/** Maps an FFI type string (`i32`, `u8`, `ptr`, `size_t`, ...) from the
 * compiler's symbol metadata to this module's `CType`. This avoids reparsing
 * the C parameter-list text. */
export function ffiTypeToCType(ffiType: string): CType {
  switch (ffiType) {
    case 'void':
      return VOID;
    case 'i8':
    case 'char':
      return { kind: 'int', size: 1, signed: true };
    case 'u8':
    case 'bool':
      return { kind: 'int', size: 1, signed: false };
    case 'i16':
      return { kind: 'int', size: 2, signed: true };
    case 'u16':
      return { kind: 'int', size: 2, signed: false };
    case 'i32':
      return { kind: 'int', size: 4, signed: true };
    case 'u32':
      return { kind: 'int', size: 4, signed: false };
    case 'i64':
      return { kind: 'int', size: 8, signed: true };
    case 'u64':
    case 'usize':
    case 'size_t':
      return { kind: 'int', size: 8, signed: false };
    case 'ptr':
    case 'cstring':
    case 'cwstring':
    case 'function':
    case 'buffer':
      return { kind: 'pointer', pointee: VOID };
    default:
      throw new CSubsetError(
        `unsupported FFI parameter/return type: ${ffiType}`,
      );
  }
}

export class CSubsetError extends Error {}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

interface Token {
  readonly kind: 'ident' | 'num' | 'punct' | 'eof';
  readonly text: string;
  readonly value?: bigint;
}

const PUNCTUATORS = [
  '->',
  '==',
  '!=',
  '<=',
  '>=',
  '<<',
  '>>',
  '++',
  '&&',
  '||',
];

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function tokenize(source: string): Token[] {
  const text = stripComments(source);
  const tokens: Token[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(text[j]!)) j += 1;
      tokens.push({ kind: 'ident', text: text.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      let isHex = false;
      if (text[j] === '0' && (text[j + 1] === 'x' || text[j + 1] === 'X')) {
        isHex = true;
        j += 2;
        while (j < n && /[0-9a-fA-F]/.test(text[j]!)) j += 1;
      } else {
        while (j < n && /[0-9]/.test(text[j]!)) j += 1;
      }
      let numText = text.slice(i, j);
      while (j < n && /[uUlL]/.test(text[j]!)) {
        numText += text[j];
        j += 1;
      }
      const digits = isHex
        ? numText.replace(/[uUlL]+$/, '')
        : numText.replace(/[uUlL]+$/, '');
      tokens.push({ kind: 'num', text: numText, value: BigInt(digits) });
      i = j;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      let code: number;
      if (text[j] === '\\') {
        const escape = text[j + 1];
        const map: Record<string, number> = {
          '0': 0,
          n: 10,
          t: 9,
          r: 13,
          '\\': 92,
          "'": 39,
          '"': 34,
        };
        code = map[escape ?? ''] ?? escape?.charCodeAt(0) ?? 0;
        j += 2;
      } else {
        code = text.charCodeAt(j);
        j += 1;
      }
      if (text[j] !== "'") {
        throw new CSubsetError(
          `unterminated char literal near ${text.slice(i, i + 8)}`,
        );
      }
      j += 1;
      tokens.push({ kind: 'num', text: text.slice(i, j), value: BigInt(code) });
      i = j;
      continue;
    }
    const two = text.slice(i, i + 2);
    if (PUNCTUATORS.includes(two)) {
      tokens.push({ kind: 'punct', text: two });
      i += 2;
      continue;
    }
    tokens.push({ kind: 'punct', text: ch });
    i += 1;
  }
  tokens.push({ kind: 'eof', text: '' });
  return tokens;
}

// ---------------------------------------------------------------------------
// Macro expansion (textual, object-like and function-like #define)
// ---------------------------------------------------------------------------

function splitBalancedArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0 || args.length > 0) args.push(current.trim());
  return args;
}

interface MacroDef {
  readonly params?: readonly string[];
  readonly body: string;
}

/** Extracts every `#define` line (object-like or function-like) from
 * `text`, returning the macro table plus `text` with those lines removed.
 * Compiler inputs use single-line `#define` directives. */
export function extractDefines(text: string): {
  text: string;
  macros: Map<string, MacroDef>;
} {
  const macros = new Map<string, MacroDef>();
  const withoutIncludes = text.replace(/^#include.*$/gm, '');
  const lines = withoutIncludes.split('\n');
  const remaining: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*#define\s+(\w+)(\(([^)]*)\))?\s+(.*)$/);
    if (!match) {
      remaining.push(line);
      continue;
    }
    const name = match[1]!;
    const paramList = match[3];
    const body = match[4]!.trim();
    const params =
      paramList !== undefined
        ? paramList
            .split(',')
            .map((p) => p.trim())
            .filter((p) => p.length > 0)
        : undefined;
    macros.set(name, { params, body });
  }
  return { text: remaining.join('\n'), macros };
}

/** Expands function-like and object-like macros textually across `text`,
 * repeating until no more substitutions are made (bounded, so a
 * self-referential macro can't loop forever). */
export function expandMacros(
  text: string,
  macros: ReadonlyMap<string, MacroDef>,
): string {
  let current = text;
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const [name, def] of macros) {
      const pattern = new RegExp(`\\b${name}\\b(\\s*\\()?`, 'g');
      let result = '';
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(current))) {
        const hasParen = match[1] !== undefined;
        if (def.params && !hasParen) continue; // function-like macro used without call syntax -- leave alone
        result += current.slice(lastIndex, match.index);
        if (def.params) {
          const openParenIndex = match.index + match[0].length - 1;
          let depth = 1;
          let cursor = openParenIndex + 1;
          while (cursor < current.length && depth > 0) {
            if (current[cursor] === '(') depth += 1;
            else if (current[cursor] === ')') depth -= 1;
            cursor += 1;
          }
          const argsText = current.slice(openParenIndex + 1, cursor - 1);
          const args = splitBalancedArgs(argsText);
          let body = def.body;
          def.params.forEach((param, index) => {
            const argValue = args[index] ?? '';
            body = body.split(param).join(`(${argValue})`);
          });
          result += `(${body})`;
          lastIndex = cursor;
        } else {
          result += `(${def.body})`;
          lastIndex = match.index + match[0].length - (hasParen ? 1 : 0);
        }
        changed = true;
        pattern.lastIndex = lastIndex;
      }
      result += current.slice(lastIndex);
      current = result;
    }
    if (!changed) break;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Struct/union + function-pointer typedef extraction
// ---------------------------------------------------------------------------

class TypeTable {
  private readonly types = new Map<string, CType>();

  has(name: string): boolean {
    return this.types.has(name);
  }
  get(name: string): CType | undefined {
    return this.types.get(name);
  }
  set(name: string, type: CType): void {
    this.types.set(name, type);
  }
}

const BASE_C_TYPE_NAME: Record<string, string> = {
  char: 'char',
  'unsigned char': 'char',
};

function baseTypeFromKeyword(name: string): string {
  return BASE_C_TYPE_NAME[name] ?? name;
}

class TypeParser {
  constructor(
    private readonly tokens: readonly Token[],
    private index: number,
    private readonly types: TypeTable,
  ) {}

  getIndex(): number {
    return this.index;
  }
  setIndex(value: number): void {
    this.index = value;
  }
  private peek(): Token {
    return this.tokens[this.index]!;
  }
  private consume(): Token {
    return this.tokens[this.index++]!;
  }

  /** Parses a C type name starting at the current position. Returns
   * `undefined` (restoring the position) if the current token cannot start
   * a type. Also recognizes the anonymous function-pointer cast form
   * `RET (*)(PARAMTYPES)`, used for address-resolved external functions. */
  tryParseType(): CType | undefined {
    const start = this.index;

    // Inline anonymous struct/union field type, such as
    // `struct { unsigned char r; ...; } name;`.
    if (
      (this.peek().text === 'struct' || this.peek().text === 'union') &&
      this.tokens[this.index + 1]?.text === '{'
    ) {
      const isUnion = this.peek().text === 'union';
      this.consume();
      this.consume(); // {
      const fields: Array<{
        name: string;
        type: CType;
        isArray: boolean;
        arrayLength: number;
      }> = [];
      while (this.peek().text !== '}') {
        const fieldType = this.tryParseType();
        if (!fieldType)
          throw new CSubsetError('expected field type in inline struct/union');
        if (this.peek().kind !== 'ident')
          throw new CSubsetError('expected field name in inline struct/union');
        const fieldName = this.consume().text;
        let isArray = false;
        let arrayLength = 0;
        if (this.peek().text === '[') {
          this.consume();
          isArray = true;
          arrayLength = Number(this.consume().value ?? 0n);
          if (this.peek().text !== ']') throw new CSubsetError('expected "]"');
          this.consume();
        }
        if (this.peek().text !== ';')
          throw new CSubsetError('expected ";" in inline field declaration');
        this.consume();
        fields.push({ name: fieldName, type: fieldType, isArray, arrayLength });
      }
      this.consume(); // }
      let offset = 0;
      let maxAlign = 1;
      const fieldMap = new Map<string, CStructField>();
      for (const field of fields) {
        const align = fieldAlignment(field.type);
        maxAlign = Math.max(maxAlign, align);
        const fieldOffset = isUnion ? 0 : alignUp(offset, align);
        fieldMap.set(field.name, {
          offset: fieldOffset,
          type: field.type,
          isArray: field.isArray,
          arrayLength: field.arrayLength,
        });
        const fieldSize =
          (field.isArray ? field.arrayLength : 1) * sizeOf(field.type);
        offset = isUnion
          ? Math.max(offset, fieldSize)
          : fieldOffset + fieldSize;
      }
      const size = alignUp(offset, maxAlign);
      return {
        kind: 'struct',
        name: '<anonymous>',
        size,
        isUnion,
        fields: fieldMap,
      };
    }

    let unsigned: boolean | undefined;
    let sawVoid = false;
    let sawChar = false;
    let sawShort = false;
    let longCount = 0;
    let sawIntKeyword = false;
    let named: CType | undefined;
    let consumedAny = false;

    for (;;) {
      const token = this.peek();
      if (token.kind !== 'ident') break;
      if (token.text === 'const' || token.text === 'volatile') {
        this.consume();
        consumedAny = true;
        continue;
      }
      if (token.text === 'unsigned') {
        unsigned = true;
        this.consume();
        consumedAny = true;
        continue;
      }
      if (token.text === 'signed') {
        unsigned = false;
        this.consume();
        consumedAny = true;
        continue;
      }
      if (token.text === 'void') {
        sawVoid = true;
        this.consume();
        consumedAny = true;
        continue;
      }
      if (token.text === 'char') {
        sawChar = true;
        this.consume();
        consumedAny = true;
        continue;
      }
      if (token.text === 'short') {
        sawShort = true;
        this.consume();
        consumedAny = true;
        continue;
      }
      if (token.text === 'int') {
        sawIntKeyword = true;
        this.consume();
        consumedAny = true;
        continue;
      }
      if (token.text === 'long') {
        longCount += 1;
        this.consume();
        consumedAny = true;
        continue;
      }
      if (
        !sawVoid &&
        !sawChar &&
        !sawShort &&
        !sawIntKeyword &&
        longCount === 0 &&
        !named &&
        this.types.has(token.text)
      ) {
        named = this.types.get(token.text)!;
        this.consume();
        consumedAny = true;
        break;
      }
      break;
    }

    if (!consumedAny) {
      this.index = start;
      return undefined;
    }

    let base: CType;
    if (named) {
      base = named;
    } else if (sawVoid) {
      base = VOID;
    } else if (sawChar) {
      base = { kind: 'int', size: 1, signed: unsigned !== true };
    } else if (sawShort) {
      base = { kind: 'int', size: 2, signed: unsigned !== true };
    } else if (longCount >= 1) {
      base = {
        kind: 'int',
        size: 8,
        signed: unsigned === true ? false : unsigned === false,
      };
    } else {
      base = { kind: 'int', size: 4, signed: unsigned !== true };
    }
    void baseTypeFromKeyword;

    // Return-type pointer stars come *before* the anonymous function-pointer
    // marker: both `RET (*)(PARAMS)` and `RET* (*)(PARAMS)` appear. The latter
    // supports address macros such as `#define NAME ((TYPEDEF)ADDR)` for a
    // function returning a pointer.
    let starCount = 0;
    while (this.peek().text === '*') {
      this.consume();
      starCount += 1;
    }
    while (this.peek().text === 'const' || this.peek().text === 'volatile') {
      this.consume();
    }

    // Anonymous function-pointer cast type: RET (*)(PARAMS)
    if (this.peek().text === '(' && this.tokens[this.index + 1]?.text === '*') {
      const save = this.index;
      this.consume(); // (
      this.consume(); // *
      if (this.peek().text === ')') {
        this.consume();
        if (this.peek().text === '(') {
          this.consume();
          let paramCount = 0;
          let paramsValid = true;
          if (this.peek().text !== ')') {
            for (;;) {
              const paramType = this.tryParseType();
              if (!paramType) {
                paramsValid = false;
                break;
              }
              if (this.peek().kind === 'ident') this.consume(); // optional param name
              paramCount += 1;
              if (this.peek().text === ',') {
                this.consume();
                continue;
              }
              break;
            }
          }
          if (paramsValid && this.peek().text === ')') {
            this.consume();
            return { kind: 'funcptr', name: '<anonymous>', paramCount };
          }
        }
      }
      this.index = save;
    }

    let result: CType = base;
    for (let index = 0; index < starCount; index += 1) {
      result = { kind: 'pointer', pointee: result };
    }
    return result;
  }
}

function fieldAlignment(type: CType): number {
  return Math.min(8, sizeOf(type));
}

function alignUp(value: number, alignment: number): number {
  if (alignment <= 1) return value;
  return Math.ceil(value / alignment) * alignment;
}

/** Parses every `typedef struct/union { ... } Name;` and
 * `typedef RET (*Name)(PARAMS);` declaration anywhere in `text` (top-level
 * header content, or inline inside a function body -- both appear in the
 * supported input) into `types`, in textual order (later typedefs can
 * reference earlier ones). Returns `text` with those typedef statements
 * removed, since the statement parser never needs to see them again once
 * registered. */
export function extractTypedefs(text: string, types: TypeTable): string {
  const tokens = tokenize(text);
  let index = 0;
  const removedRanges: Array<[number, number]> = [];

  while (tokens[index]!.kind !== 'eof') {
    if (tokens[index]!.text !== 'typedef') {
      index += 1;
      continue;
    }
    const startIndex = index;
    index += 1;
    if (tokens[index]!.text === 'struct' || tokens[index]!.text === 'union') {
      const isUnion = tokens[index]!.text === 'union';
      index += 1;
      if (tokens[index]!.text !== '{') {
        throw new CSubsetError('expected "{" after typedef struct/union');
      }
      index += 1;
      const fields: Array<{
        name: string;
        type: CType;
        isArray: boolean;
        arrayLength: number;
      }> = [];
      while (tokens[index]!.text !== '}') {
        const parser = new TypeParser(tokens, index, types);
        const fieldType = parser.tryParseType();
        if (!fieldType)
          throw new CSubsetError('expected field type in typedef struct/union');
        index = parser.getIndex();
        if (tokens[index]!.kind !== 'ident') {
          throw new CSubsetError('expected field name in typedef struct/union');
        }
        const fieldName = tokens[index]!.text;
        index += 1;
        let isArray = false;
        let arrayLength = 0;
        if (tokens[index]!.text === '[') {
          index += 1;
          isArray = true;
          arrayLength = Number(tokens[index]!.value ?? 0n);
          index += 1;
          if (tokens[index]!.text !== ']')
            throw new CSubsetError('expected "]"');
          index += 1;
        }
        if (tokens[index]!.text !== ';')
          throw new CSubsetError('expected ";" in field declaration');
        index += 1;
        fields.push({ name: fieldName, type: fieldType, isArray, arrayLength });
      }
      index += 1; // }
      if (tokens[index]!.kind !== 'ident') {
        throw new CSubsetError('expected typedef name after struct/union body');
      }
      const typedefName = tokens[index]!.text;
      index += 1;
      if (tokens[index]!.text !== ';')
        throw new CSubsetError('expected ";" after typedef');
      index += 1;

      let offset = 0;
      let maxAlign = 1;
      const fieldMap = new Map<string, CStructField>();
      for (const field of fields) {
        const align = fieldAlignment(field.type);
        maxAlign = Math.max(maxAlign, align);
        const fieldOffset = isUnion ? 0 : alignUp(offset, align);
        fieldMap.set(field.name, {
          offset: fieldOffset,
          type: field.type,
          isArray: field.isArray,
          arrayLength: field.arrayLength,
        });
        const fieldSize =
          (field.isArray ? field.arrayLength : 1) * sizeOf(field.type);
        offset = isUnion
          ? Math.max(offset, fieldSize)
          : fieldOffset + fieldSize;
      }
      const size = alignUp(offset, maxAlign);
      types.set(typedefName, {
        kind: 'struct',
        name: typedefName,
        size,
        isUnion,
        fields: fieldMap,
      });
      removedRanges.push([startIndex, index]);
      continue;
    }

    // Function-pointer typedef: typedef RET (*Name)(PARAMS);
    const parser = new TypeParser(tokens, index, types);
    parser.tryParseType(); // return type -- irrelevant, discarded
    index = parser.getIndex();
    if (tokens[index]!.text !== '(' || tokens[index + 1]?.text !== '*') {
      throw new CSubsetError(
        'unsupported typedef form (expected struct/union or function pointer)',
      );
    }
    index += 2;
    if (tokens[index]!.kind !== 'ident')
      throw new CSubsetError('expected typedef name');
    const funcName = tokens[index]!.text;
    index += 1;
    if (tokens[index]!.text !== ')') throw new CSubsetError('expected ")"');
    index += 1;
    if (tokens[index]!.text !== '(') throw new CSubsetError('expected "("');
    index += 1;
    let paramCount = 0;
    if (tokens[index]!.text !== ')') {
      for (;;) {
        const paramParser = new TypeParser(tokens, index, types);
        const paramType = paramParser.tryParseType();
        if (!paramType)
          throw new CSubsetError(
            'expected parameter type in function-pointer typedef',
          );
        index = paramParser.getIndex();
        if (tokens[index]!.kind === 'ident') index += 1; // optional param name
        paramCount += 1;
        if (tokens[index]!.text === ',') {
          index += 1;
          continue;
        }
        break;
      }
    }
    if (tokens[index]!.text !== ')') throw new CSubsetError('expected ")"');
    index += 1;
    if (tokens[index]!.text !== ';') throw new CSubsetError('expected ";"');
    index += 1;
    types.set(funcName, { kind: 'funcptr', name: funcName, paramCount });
    removedRanges.push([startIndex, index]);
  }

  if (removedRanges.length === 0) return text;
  const keep: string[] = [];
  let cursor = 0;
  for (const [rangeStart, rangeEnd] of removedRanges) {
    for (let i = cursor; i < rangeStart; i += 1) keep.push(tokens[i]!.text);
    cursor = rangeEnd;
  }
  for (let i = cursor; i < tokens.length; i += 1) keep.push(tokens[i]!.text);
  return keep.join(' ');
}

/** Extracts every `extern RETTYPE NAME(params);` declaration from `text`.
 * The compiler resolves each referenced address separately, so only the name
 * and return type are needed here; authoritative FFI signatures are supplied
 * as metadata rather than re-derived from this text. */
export interface ExternDeclaration {
  readonly name: string;
  readonly returnType: CType;
}

export function extractExternDeclarations(
  text: string,
  types: TypeTable,
): ExternDeclaration[] {
  const declarations: ExternDeclaration[] = [];
  const pattern = /extern\s+([\w *]+?)\s+(\w+)\s*\([^)]*\)\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const returnTypeText = match[1]!;
    const name = match[2]!;
    const tokens = tokenize(returnTypeText);
    const parser = new TypeParser(tokens, 0, types);
    const returnType = parser.tryParseType() ?? {
      kind: 'int',
      size: 4,
      signed: true,
    };
    declarations.push({ name, returnType });
  }
  return declarations;
}

/**
 * Some compiler inputs provide a local fallback definition, rather than an
 * `extern` declaration, for an imported symbol unavailable in the simulated
 * runtime: `RETTYPE NAME(params) { return 0; }` (with an empty body for a
 * `void` return). This recognizes that shape so the compiler can synthesize a
 * tiny `mov eax, 0; ret` (or bare `ret`) stub instead of treating `NAME` as an
 * unresolved identifier.
 */
export function extractDummyExternDeclarations(
  text: string,
  types: TypeTable,
): ExternDeclaration[] {
  const declarations: ExternDeclaration[] = [];
  const pattern =
    /(?:^|[^\w])([\w ]+?[\w *]*?)\s+(\w+)\s*\([^)]*\)\s*\{\s*(?:return\s+0\s*;)?\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const returnTypeText = match[1]!.trim();
    if (returnTypeText === 'typedef' || returnTypeText.length === 0) continue;
    const name = match[2]!;
    const tokens = tokenize(returnTypeText);
    const parser = new TypeParser(tokens, 0, types);
    const returnType = parser.tryParseType();
    if (!returnType) continue;
    declarations.push({ name, returnType });
  }
  return declarations;
}

export { TypeTable };
