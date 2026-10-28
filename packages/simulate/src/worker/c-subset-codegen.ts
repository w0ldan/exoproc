/**
 * Statement/expression parser + x64 codegen for `./c-subset-compiler.ts`'s
 * type system. See that file's header comment for the exact supported C
 * subset and why it is deliberately narrow.
 *
 * Codegen strategy (deliberately simple rather than maximally efficient):
 * every local variable and parameter gets its own
 * 8-byte stack slot relative to `rbp`, regardless of its declared width.
 * Binary operators always evaluate the left operand into `rax`, `push`
 * it, evaluate the right operand into `rax`, move it to `rbx`, `pop` the
 * left operand back into `rax`, then combine -- this never needs a real
 * register allocator and is correct for arbitrarily nested expressions at
 * the cost of some extra push/pop traffic. Only pointer dereferences and
 * struct-field memory accesses care about the narrower 1/2/4/8-byte width
 * of the underlying C type.
 */
import {
  X64Assembler,
  byte,
  dword,
  qword,
  word,
  type X64Label,
  type X64Register64,
} from '../bin/compiler.js';
import {
  CSubsetError,
  TypeTable,
  ffiTypeToCType,
  sizeOf,
  type CType,
} from './c-subset-compiler.js';

interface Token {
  readonly kind: 'ident' | 'num' | 'punct' | 'eof';
  readonly text: string;
  readonly value?: bigint;
}

function tokenizeBody(source: string): Token[] {
  // Re-uses the exact same lexical rules as ./c-subset-compiler.ts's
  // top-level tokenizer (kept private there); duplicated here as a small,
  // self-contained copy to avoid exporting internal lexer plumbing across
  // the module boundary for a single shared function.
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
  const text = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
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
      if (text[j] === '0' && (text[j + 1] === 'x' || text[j + 1] === 'X')) {
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
      const digits = numText.replace(/[uUlL]+$/, '');
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
      if (text[j] !== "'")
        throw new CSubsetError(
          `unterminated char literal near ${text.slice(i, i + 8)}`,
        );
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

export interface CExternFunction {
  readonly address: bigint;
  readonly returns: CType;
}

export interface CompileFunctionOptions {
  readonly name: string;
  readonly params: readonly { readonly name: string; readonly type: CType }[];
  readonly returns: CType;
  readonly body: string;
  readonly types: TypeTable;
  readonly externs: ReadonlyMap<string, CExternFunction>;
}

const FRAME_SIZE = 0x400;
const ARG_REGISTERS: readonly X64Register64[] = ['rcx', 'rdx', 'r8', 'r9'];

interface Local {
  readonly offset: number;
  readonly type: CType;
}

function isPointer(type: CType): type is { kind: 'pointer'; pointee: CType } {
  return type.kind === 'pointer';
}
function isAggregate(type: CType): boolean {
  return type.kind === 'struct';
}

/**
 * Compiles one C function body into `code` (appending to whatever is
 * already emitted -- callers share one `X64Assembler`/module across
 * multiple functions in the same batch). Returns the byte offset (within
 * `code`) where this function's first instruction landed.
 */
export function compileFunctionBody(
  code: X64Assembler,
  options: CompileFunctionOptions,
): number {
  const compiler = new FunctionCompiler(code, options);
  return compiler.compile();
}

class FunctionCompiler {
  private readonly tokens: Token[];
  private index = 0;
  private nextSlotOffset = -8;
  private readonly locals = new Map<string, Local>();
  private readonly loopEndLabels: X64Label[] = [];
  private readonly labelPrefix: string;
  private labelSequence = 0;

  constructor(
    private readonly code: X64Assembler,
    private readonly options: CompileFunctionOptions,
  ) {
    this.tokens = tokenizeBody(options.body);
    this.labelPrefix = `${options.name}_${Math.random().toString(36).slice(2, 8)}_`;
  }

  compile(): number {
    const offset = this.code.length;
    this.code.push('rbp');
    this.code.mov('rbp', 'rsp');
    this.code.sub('rsp', FRAME_SIZE);

    this.options.params.forEach((param, index) => {
      if (index >= ARG_REGISTERS.length) {
        throw new CSubsetError(
          `function "${this.options.name}" has more than 4 parameters, unsupported`,
        );
      }
      const slotOffset = this.allocateSlot(param.name, param.type);
      this.code.mov(qword('rbp', slotOffset), ARG_REGISTERS[index]!);
    });

    while (this.peek().kind !== 'eof') {
      this.parseStatement();
    }
    this.emitEpilogueAndReturn();
    return offset;
  }

  // -- token helpers --------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[this.index + offset]!;
  }
  private consume(): Token {
    return this.tokens[this.index++]!;
  }
  private expect(text: string): Token {
    if (this.peek().text !== text) {
      throw new CSubsetError(
        `expected "${text}" but found "${this.peek().text}" in function "${this.options.name}"`,
      );
    }
    return this.consume();
  }
  private makeLabel(name: string): X64Label {
    this.labelSequence += 1;
    return this.code.createLabel(
      `${this.labelPrefix}${name}_${this.labelSequence}`,
    );
  }

  private allocateSlot(name: string, type: CType): number {
    const offset = this.nextSlotOffset;
    this.nextSlotOffset -= 8;
    if (-offset > FRAME_SIZE - 0x40) {
      throw new CSubsetError(
        `function "${this.options.name}" declares too many local variables`,
      );
    }
    this.locals.set(name, { offset, type });
    return offset;
  }

  private emitEpilogueAndReturn(): void {
    this.code.mov('rsp', 'rbp');
    this.code.pop('rbp');
    this.code.ret();
  }

  // -- type parsing (delegates to the shared lexical rules, but reads its
  // own token stream since function bodies are tokenized independently) --

  private tryParseType(): CType | undefined {
    const start = this.index;
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
        this.options.types.has(token.text)
      ) {
        named = this.options.types.get(token.text)!;
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
    if (named) base = named;
    else if (sawVoid) base = { kind: 'void' };
    else if (sawChar)
      base = { kind: 'int', size: 1, signed: unsigned !== true };
    else if (sawShort)
      base = { kind: 'int', size: 2, signed: unsigned !== true };
    else if (longCount >= 1)
      base = { kind: 'int', size: 8, signed: unsigned !== true };
    else base = { kind: 'int', size: 4, signed: unsigned !== true };

    // Return-type pointer stars come *before* the anonymous function-pointer
    // marker (`RET (*)(PARAMS)` and `RET* (*)(PARAMS)` both appear -- the
    // latter supports address macros shaped like
    // `#define NAME ((TYPEDEF)ADDR)` for functions returning pointers).
    let starCount = 0;
    while (this.peek().text === '*') {
      this.consume();
      starCount += 1;
    }
    while (this.peek().text === 'const' || this.peek().text === 'volatile')
      this.consume();

    if (this.peek().text === '(' && this.peek(1).text === '*') {
      const save = this.index;
      this.consume();
      this.consume();
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
              if (this.peek().kind === 'ident') this.consume();
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

  // -- statements -------------------------------------------------------

  private parseStatement(): void {
    const token = this.peek();
    if (token.text === '{') {
      this.consume();
      while (this.peek().text !== '}') this.parseStatement();
      this.consume();
      return;
    }
    if (token.text === 'if') {
      this.parseIf();
      return;
    }
    if (token.text === 'while') {
      this.parseWhile();
      return;
    }
    if (token.text === 'for') {
      this.parseFor();
      return;
    }
    if (token.text === 'break') {
      this.consume();
      this.expect(';');
      const target = this.loopEndLabels[this.loopEndLabels.length - 1];
      if (!target) throw new CSubsetError('"break" outside of a loop');
      this.code.jmp(target);
      return;
    }
    if (token.text === 'return') {
      this.consume();
      if (this.peek().text !== ';') {
        this.compileValue();
      }
      this.expect(';');
      this.emitEpilogueAndReturn();
      return;
    }
    if (token.text === 'typedef') {
      // Local typedefs were already hoisted out of the body text by
      // `extractTypedefs` before this compiler ever sees it.
      throw new CSubsetError(
        'unexpected "typedef" (should have been hoisted already)',
      );
    }

    const declStart = this.index;
    const declType = this.tryParseType();
    if (declType && this.peek().kind === 'ident') {
      this.index = declStart;
      this.parseVarDecl(true);
      return;
    }
    this.index = declStart;

    if (
      token.kind === 'ident' &&
      (this.peek(1).text === '++' ||
        (this.peek(1).text === '->' &&
          this.peek(2).kind === 'ident' &&
          this.peek(3).text === '++'))
    ) {
      this.parsePostfixIncrementStatement();
      return;
    }

    if (this.classifyAssignment()) {
      this.parseAssignmentStatement();
      this.expect(';');
      return;
    }

    this.compileValue();
    this.expect(';');
  }

  private parseVarDecl(consumeSemicolon: boolean): void {
    const type = this.tryParseType();
    if (!type) throw new CSubsetError('expected a type in declaration');
    if (this.peek().kind !== 'ident')
      throw new CSubsetError('expected a variable name');
    const name = this.consume().text;
    const offset = this.allocateSlot(name, type);
    if (this.peek().text === '=') {
      this.consume();
      this.compileAssignmentRhs();
      this.code.mov(qword('rbp', offset), 'rax');
    } else {
      this.code.mov(qword('rbp', offset), 0);
    }
    if (consumeSemicolon) this.expect(';');
  }

  /** Parses whatever precedence level assignment initializers use (our
   * corpus never nests an `=` inside an initializer, so this is just the
   * normal expression grammar). */
  private compileAssignmentRhs(): CType {
    return this.compileValue();
  }

  private emitIncrement(name: string): void {
    const local = this.locals.get(name);
    if (!local) throw new CSubsetError(`unknown variable "${name}"`);
    this.code.mov('rax', qword('rbp', local.offset));
    this.code.add('rax', 1);
    this.code.mov(qword('rbp', local.offset), 'rax');
  }

  private parsePostfixIncrementStatement(): void {
    const name = this.consume().text;
    if (this.peek().text === '++') {
      this.consume();
      this.expect(';');
      this.emitIncrement(name);
      return;
    }

    const local = this.locals.get(name);
    if (!local) throw new CSubsetError(`unknown variable "${name}"`);
    this.expect('->');
    const fieldName = this.consume().text;
    this.expect('++');
    this.expect(';');

    if (!isPointer(local.type) || local.type.pointee.kind !== 'struct') {
      throw new CSubsetError(
        `"->${fieldName}++" target is not a pointer-to-struct`,
      );
    }
    const field = local.type.pointee.fields.get(fieldName);
    if (!field || field.isArray) {
      throw new CSubsetError(
        `unknown or non-scalar field "${fieldName}" on ${local.type.pointee.name}`,
      );
    }

    this.code.mov('rax', qword('rbp', local.offset));
    if (field.offset !== 0) this.code.add('rax', field.offset);
    this.code.push('rax');
    this.loadTypedFromAddressInRax(field.type, 0);
    this.code.add('rax', 1);
    this.code.mov('rbx', 'rax');
    this.code.pop('rax');
    this.storeTypedToAddressInRax(field.type, 0);
  }

  private parseIf(): void {
    this.consume();
    this.expect('(');
    this.compileValue();
    this.expect(')');
    this.code.test('rax', 'rax');
    const falseLabel = this.makeLabel('if_false');
    this.code.je(falseLabel);
    this.parseStatement();
    if (this.peek().text === 'else') {
      this.consume();
      const endLabel = this.makeLabel('if_end');
      this.code.jmp(endLabel);
      this.code.bind(falseLabel);
      this.parseStatement();
      this.code.bind(endLabel);
    } else {
      this.code.bind(falseLabel);
    }
  }

  private parseWhile(): void {
    this.consume();
    this.expect('(');
    const startLabel = this.makeLabel('while_start');
    const endLabel = this.makeLabel('while_end');
    this.code.bind(startLabel);
    this.compileValue();
    this.expect(')');
    this.code.test('rax', 'rax');
    this.code.je(endLabel);
    this.loopEndLabels.push(endLabel);
    this.parseStatement();
    this.loopEndLabels.pop();
    this.code.jmp(startLabel);
    this.code.bind(endLabel);
  }

  private parseFor(): void {
    this.consume();
    this.expect('(');
    if (this.peek().text !== ';') {
      this.parseVarDecl(false);
    }
    this.expect(';');

    const condLabel = this.makeLabel('for_cond');
    const endLabel = this.makeLabel('for_end');
    this.code.bind(condLabel);
    if (this.peek().text !== ';') {
      this.compileValue();
      this.code.test('rax', 'rax');
      this.code.je(endLabel);
    }
    this.expect(';');

    let incrementName: string | undefined;
    if (this.peek().text !== ')') {
      if (this.peek().kind === 'ident' && this.peek(1).text === '++') {
        incrementName = this.consume().text;
        this.consume();
      } else {
        throw new CSubsetError(
          'unsupported for-loop increment clause (only "ident++" is supported)',
        );
      }
    }
    this.expect(')');

    this.loopEndLabels.push(endLabel);
    this.parseStatement();
    this.loopEndLabels.pop();
    if (incrementName) this.emitIncrement(incrementName);
    this.code.jmp(condLabel);
    this.code.bind(endLabel);
  }

  // -- assignment classification/parsing ---------------------------------

  private classifyAssignment(): boolean {
    const save = this.index;
    try {
      if (this.peek().text === '*') {
        // Deref-assignment shapes: `*p = ...`, `*(unsigned char*)arg0 = ...`,
        // `*(p + 1) = ...` -- scan for a top-level `=` (a `;`, a comparison
        // operator, or eof first means this is a plain expression statement).
        this.consume();
        let depth = 0;
        for (;;) {
          const token = this.peek();
          if (token.kind === 'eof') return false;
          if (token.text === '(' || token.text === '[') depth += 1;
          else if (token.text === ')' || token.text === ']') depth -= 1;
          else if (depth === 0) {
            if (token.text === '=') return true;
            if (
              token.text === ';' ||
              token.text === '==' ||
              token.text === '!=' ||
              token.text === '<=' ||
              token.text === '>=' ||
              token.text === '<' ||
              token.text === '>' ||
              token.text === ','
            ) {
              return false;
            }
          }
          this.consume();
        }
      }
      if (this.peek().kind !== 'ident') return false;
      this.consume();
      for (;;) {
        if (this.peek().text === '->' || this.peek().text === '.') {
          this.consume();
          if (this.peek().kind !== 'ident') return false;
          this.consume();
          continue;
        }
        if (this.peek().text === '[') {
          this.consume();
          let depth = 1;
          while (depth > 0) {
            if (this.peek().text === '[') depth += 1;
            if (this.peek().text === ']') depth -= 1;
            if (this.peek().kind === 'eof') return false;
            this.consume();
          }
          continue;
        }
        break;
      }
      return this.peek().text === '=';
    } finally {
      this.index = save;
    }
  }

  private parseAssignmentStatement(): void {
    if (this.peek().text === '*') {
      this.consume();
      const pointerType = this.compileValue(); // pointer value -> rax (this IS the address)
      if (!isPointer(pointerType))
        throw new CSubsetError(
          'cannot dereference a non-pointer in assignment',
        );
      this.expect('=');
      this.code.push('rax');
      this.compileAssignmentRhs();
      this.code.mov('rbx', 'rax');
      this.code.pop('rax');
      this.storeTypedToAddressInRax(pointerType.pointee, 0);
      return;
    }

    const name = this.consume().text;
    const local = this.locals.get(name);
    if (!local)
      throw new CSubsetError(`unknown variable "${name}" in assignment`);

    if (this.peek().text === '=') {
      this.consume();
      this.compileAssignmentRhs();
      this.code.mov(qword('rbp', local.offset), 'rax');
      return;
    }

    // Field/array assignment: navigate to the destination address, then
    // evaluate and store the right-hand side. This currently supports one
    // `->field` or `[index]` step; subscripts may be full expressions.
    this.code.mov('rax', qword('rbp', local.offset));
    if (this.peek().text === '->') {
      this.consume();
      const fieldName = this.consume().text;
      if (!isPointer(local.type) || local.type.pointee.kind !== 'struct') {
        throw new CSubsetError(
          `"->${fieldName}" assignment target is not a pointer-to-struct`,
        );
      }
      const structType = local.type.pointee;
      const field = structType.fields.get(fieldName);
      if (!field)
        throw new CSubsetError(
          `unknown field "${fieldName}" on ${structType.name}`,
        );
      if (field.offset !== 0) this.code.add('rax', field.offset);
      if (field.isArray) {
        this.expect('[');
        this.compileSubscriptAddress(field.type);
        this.expect(']');
        this.storeTypedToAddressInRaxAfterArg(field.type, 0);
        return;
      }
      this.storeTypedToAddressInRaxAfterArg(field.type, 0);
      return;
    }
    if (this.peek().text === '[') {
      this.consume();
      if (!isPointer(local.type))
        throw new CSubsetError('"[" used on a non-pointer value');
      const elementType = local.type.pointee;
      this.compileSubscriptAddress(elementType);
      this.expect(']');
      this.storeTypedToAddressInRaxAfterArg(elementType, 0);
      return;
    }

    throw new CSubsetError(
      `unsupported assignment target for variable "${name}"`,
    );
  }

  /** `rax` starts as the array base address and ends as the selected element
   * address. The index expression is evaluated normally and scaled according
   * to C pointer arithmetic. */
  private compileSubscriptAddress(elementType: CType): void {
    this.code.push('rax');
    this.compileValue();
    this.emitScaleByConstant('rax', sizeOf(elementType));
    this.code.mov('rbx', 'rax');
    this.code.pop('rax');
    this.code.add('rax', 'rbx');
  }

  private storeTypedToAddressInRaxAfterArg(
    type: CType,
    displacement: number,
  ): void {
    this.code.push('rax');
    this.expect('=');
    this.compileAssignmentRhs();
    this.code.mov('rbx', 'rax');
    this.code.pop('rax');
    this.storeTypedToAddressInRax(type, displacement);
  }

  // -- expressions --------------------------------------------------------

  /** Parses+compiles a full expression; result lands in `rax`. Returns its
   * (best-effort) `CType`. */
  private compileValue(): CType {
    return this.compileBitOr();
  }

  /** `cmacro.test.ts`'s `RGB` macro expands to `(r) | (g << 8) | (b << 16)`
   * -- the only construct in the real corpus needing bitwise `|`/`<<`, so
   * only those two (plus a constant-only shift amount, see
   * `compileShift()`) are implemented; `&`/`^`/`>>` throw a clear error
   * instead of silently producing a wrong answer. */
  private compileBitOr(): CType {
    const leftType = this.compileEquality();
    while (this.peek().text === '|') {
      this.consume();
      this.code.push('rax');
      this.compileEquality();
      this.code.mov('rbx', 'rax');
      this.code.pop('rax');
      this.code.or('rax', 'rbx');
    }
    return leftType;
  }

  private compileEquality(): CType {
    let leftType = this.compileRelational();
    for (;;) {
      const op = this.peek().text;
      if (op !== '==' && op !== '!=') break;
      this.consume();
      this.code.push('rax');
      this.compileRelational();
      this.code.mov('rbx', 'rax');
      this.code.pop('rax');
      this.code.cmp('rax', 'rbx');
      const trueLabel = this.makeLabel('cmp_true');
      const endLabel = this.makeLabel('cmp_end');
      if (op === '==') this.code.je(trueLabel);
      else this.code.jne(trueLabel);
      this.code.mov('rax', 0);
      this.code.jmp(endLabel);
      this.code.bind(trueLabel);
      this.code.mov('rax', 1);
      this.code.bind(endLabel);
      leftType = I32_TYPE;
    }
    return leftType;
  }

  private compileRelational(): CType {
    let leftType = this.compileShift();
    for (;;) {
      const op = this.peek().text;
      if (op !== '<' && op !== '<=' && op !== '>' && op !== '>=') break;
      this.consume();
      this.code.push('rax');
      this.compileShift();
      this.code.mov('rbx', 'rax');
      this.code.pop('rax');
      this.code.cmp('rax', 'rbx');
      const trueLabel = this.makeLabel('cmp_true');
      const endLabel = this.makeLabel('cmp_end');
      if (op === '<') this.code.jb(trueLabel);
      else if (op === '<=') this.code.jbe(trueLabel);
      else if (op === '>') this.code.ja(trueLabel);
      else this.code.jae(trueLabel);
      this.code.mov('rax', 0);
      this.code.jmp(endLabel);
      this.code.bind(trueLabel);
      this.code.mov('rax', 1);
      this.code.bind(endLabel);
      leftType = I32_TYPE;
    }
    return leftType;
  }

  /** Only a compile-time-constant shift amount is supported (the real
   * corpus's `RGB` macro only ever shifts by a literal, e.g. `g << 8`), so
   * this lowers to repeated `add reg, reg` (self-doubling) instead of
   * needing a real `shl` CPU opcode. */
  private compileShift(): CType {
    const leftType = this.compileAdditive();
    for (;;) {
      const op = this.peek().text;
      if (op !== '<<' && op !== '>>') break;
      this.consume();
      if (this.peek().kind !== 'num') {
        throw new CSubsetError(
          'only a constant shift amount is supported by this C subset compiler',
        );
      }
      const shiftAmount = Number(this.consume().value ?? 0n);
      if (op === '>>') {
        throw new CSubsetError(
          '">>" is not supported by this C subset compiler yet',
        );
      }
      for (let i = 0; i < shiftAmount; i += 1) this.code.add('rax', 'rax');
    }
    return leftType;
  }

  private compileAdditive(): CType {
    const leftType = this.compileMultiplicative();
    for (;;) {
      const op = this.peek().text;
      if (op !== '+' && op !== '-') break;
      this.consume();
      this.code.push('rax');
      const rightType = this.compileMultiplicative();
      this.code.mov('rbx', 'rax');
      this.code.pop('rax');
      if (isPointer(leftType) && !isPointer(rightType)) {
        this.emitScaleByConstant('rbx', sizeOf(leftType.pointee));
      }
      if (op === '+') this.code.add('rax', 'rbx');
      else this.code.sub('rax', 'rbx');
    }
    return leftType;
  }

  private compileMultiplicative(): CType {
    const leftType = this.compileCast();
    for (;;) {
      const op = this.peek().text;
      if (op !== '*' && op !== '/' && op !== '%') break;
      this.consume();
      this.code.push('rax');
      this.compileCast();
      this.code.mov('rbx', 'rax');
      this.code.pop('rax');
      if (op === '*') {
        this.code.mul('rbx');
      } else {
        this.code.mov('rdx', 0);
        this.code.div('rbx');
        if (op === '%') this.code.mov('rax', 'rdx');
      }
    }
    return leftType;
  }

  private compileUnary(): CType {
    const token = this.peek();
    if (token.text === '-') {
      this.consume();
      const type = this.compileCast();
      this.code.neg('rax');
      return type;
    }
    if (token.text === '!') {
      this.consume();
      this.compileCast();
      this.code.test('rax', 'rax');
      const trueLabel = this.makeLabel('not_true');
      const endLabel = this.makeLabel('not_end');
      this.code.je(trueLabel);
      this.code.mov('rax', 0);
      this.code.jmp(endLabel);
      this.code.bind(trueLabel);
      this.code.mov('rax', 1);
      this.code.bind(endLabel);
      return I32_TYPE;
    }
    if (token.text === '*') {
      this.consume();
      const pointerType = this.compileCast();
      if (!isPointer(pointerType))
        throw new CSubsetError('cannot dereference a non-pointer value');
      this.loadTypedFromAddressInRax(pointerType.pointee, 0);
      return pointerType.pointee;
    }
    if (token.text === '&') {
      this.consume();
      if (this.peek().kind !== 'ident') {
        throw new CSubsetError(
          '"&" is only supported directly on a local variable/parameter',
        );
      }
      const name = this.consume().text;
      const local = this.locals.get(name);
      if (!local) throw new CSubsetError(`unknown variable "${name}"`);
      this.code.lea('rax', qword('rbp', local.offset));
      return { kind: 'pointer', pointee: local.type };
    }
    return this.compilePostfix();
  }

  /** `cast-expression := '(' type-name ')' cast-expression | unary-expression`
   * -- entry point used by binary-operator levels (multiplicative,
   * additive, ...) so a leading `(TYPE)` cast is recognized before falling
   * through to `compileUnary()` (which handles `-`/`!`/`*`/`&` and
   * eventually `compilePostfix()`). */
  private compileCast(): CType {
    if (this.peek().text === '(') {
      const save = this.index;
      this.consume();
      const type = this.tryParseType();
      if (type && this.peek().text === ')') {
        this.consume();
        this.compileCast();
        // A casted value called immediately -- `((RET (*)(PARAMS))ADDR)(args)`
        // (`compileMode: 'machineCode'`'s direct-address macros, memmem.ts's
        // remoteCallDispatcher). The callee address is already in `rax`.
        let resultType = type;
        while (this.peek().text === '(') {
          this.consume();
          this.compileCall(resultType);
          resultType = this.lastCallReturnType;
        }
        return resultType;
      }
      this.index = save;
    }
    return this.compileUnary();
  }

  private compilePostfix(): CType {
    let type = this.compilePrimary();
    let pendingAddress = this.pendingAddressFromPrimary;
    let arrayElement: CType | undefined = this.pendingArrayElementFromPrimary;

    for (;;) {
      const token = this.peek();
      if (!pendingAddress && token.text === '(') {
        this.consume();
        this.compileCall(type);
        pendingAddress = false;
        type = this.lastCallReturnType;
        continue;
      }
      if (token.text === '->' || token.text === '.') {
        const isArrow = this.consume().text === '->';
        if (this.peek().kind !== 'ident')
          throw new CSubsetError('expected a field name');
        const fieldName = this.consume().text;
        let structType: CType;
        if (isArrow) {
          if (!isPointer(type) || type.pointee.kind !== 'struct') {
            throw new CSubsetError(
              `"->${fieldName}" used on a non-pointer-to-struct value`,
            );
          }
          structType = type.pointee; // rax already holds the pointer's value == the struct's address
        } else {
          if (!pendingAddress || type.kind !== 'struct') {
            throw new CSubsetError(
              `".${fieldName}" used on a non-struct value`,
            );
          }
          structType = type; // rax already holds the running struct address
        }
        const field = structType.fields.get(fieldName);
        if (!field)
          throw new CSubsetError(
            `unknown field "${fieldName}" on ${structType.name}`,
          );
        if (field.offset !== 0) this.code.add('rax', field.offset);
        if (field.isArray) {
          arrayElement = field.type;
          type = field.type;
          pendingAddress = true;
        } else if (isAggregate(field.type)) {
          type = field.type;
          pendingAddress = true;
          arrayElement = undefined;
        } else {
          this.loadTypedFromAddressInRax(field.type, 0);
          type = field.type;
          pendingAddress = false;
          arrayElement = undefined;
        }
        continue;
      }
      if (token.text === '[') {
        this.consume();
        if (!pendingAddress) {
          if (!isPointer(type))
            throw new CSubsetError('"[" used on a non-pointer value');
          const elementType = type.pointee;
          const elemSize = sizeOf(elementType);
          const literal = this.tryPeekIntegerLiteralAndConsume();
          if (literal !== undefined) {
            this.expect(']');
            this.loadTypedFromAddressInRax(elementType, literal * elemSize);
          } else {
            if (elemSize !== 1) {
              throw new CSubsetError(
                'only byte-scale pointers support a non-constant subscript expression',
              );
            }
            this.code.push('rax');
            this.compileValue();
            this.expect(']');
            this.code.mov('rbx', 'rax');
            this.code.pop('rax');
            this.code.add('rax', 'rbx');
            this.loadTypedFromAddressInRax(elementType, 0);
          }
          type = elementType;
          pendingAddress = false;
        } else {
          const elementType = arrayElement;
          if (!elementType)
            throw new CSubsetError('"[" used on a non-array field');
          const elemSize = sizeOf(elementType);
          const literal = this.tryPeekIntegerLiteralAndConsume();
          if (literal === undefined) {
            throw new CSubsetError(
              'only constant-index struct array field access is supported',
            );
          }
          this.expect(']');
          this.loadTypedFromAddressInRax(elementType, literal * elemSize);
          type = elementType;
          pendingAddress = false;
          arrayElement = undefined;
        }
        continue;
      }
      break;
    }

    if (pendingAddress && !isAggregate(type)) {
      this.loadTypedFromAddressInRax(type, 0);
    }
    return type;
  }

  private pendingAddressFromPrimary = false;
  private pendingArrayElementFromPrimary: CType | undefined;
  private lastCallReturnType: CType = { kind: 'void' };

  private tryPeekIntegerLiteralAndConsume(): number | undefined {
    if (this.peek().kind === 'num') {
      return Number(this.consume().value ?? 0n);
    }
    return undefined;
  }

  private compilePrimary(): CType {
    this.pendingAddressFromPrimary = false;
    this.pendingArrayElementFromPrimary = undefined;
    const token = this.peek();

    if (token.kind === 'num') {
      this.consume();
      const value = token.value ?? 0n;
      this.code.mov('rax', value);
      const isLong = /[uUlL]/.test(token.text);
      return isLong ? U64_TYPE : I32_TYPE;
    }

    if (token.text === '(') {
      this.consume();
      const type = this.compileValue();
      this.expect(')');
      return type;
    }

    if (token.kind === 'ident') {
      const name = this.consume().text;
      const local = this.locals.get(name);
      if (local) {
        this.code.mov('rax', qword('rbp', local.offset));
        return local.type;
      }
      const extern = this.options.externs.get(name);
      if (extern) {
        this.code.mov('rax', extern.address);
        return { kind: 'pointer', pointee: extern.returns };
      }
      throw new CSubsetError(
        `unknown identifier "${name}" in function "${this.options.name}"`,
      );
    }

    throw new CSubsetError(
      `unexpected token "${token.text}" in function "${this.options.name}"`,
    );
  }

  private compileCall(calleeType: CType): void {
    // Callee address is already sitting in `rax` (from compilePrimary()'s
    // extern lookup, or a local funcptr variable's loaded value). Preserve
    // it across argument evaluation on the stack (see this file's header
    // comment on the push-everything-then-pop-assign call pattern).
    this.code.push('rax');
    let argCount = 0;
    if (this.peek().text !== ')') {
      for (;;) {
        this.compileValue();
        this.code.push('rax');
        argCount += 1;
        if (this.peek().text === ',') {
          this.consume();
          continue;
        }
        break;
      }
    }
    this.expect(')');
    if (argCount > 4)
      throw new CSubsetError(
        'calls with more than 4 arguments are not supported',
      );

    const argRegistersReverse = [...ARG_REGISTERS].slice(0, argCount).reverse();
    for (const register of argRegistersReverse) {
      this.code.pop(register);
    }
    this.code.pop('r11'); // callee address
    this.code.sub('rsp', 0x20);
    this.code.callRegister('r11');
    this.code.add('rsp', 0x20);

    let returnType: CType = { kind: 'int', size: 8, signed: false };
    if (calleeType.kind === 'pointer' && calleeType.pointee.kind !== 'void') {
      returnType = calleeType.pointee;
    } else if (calleeType.kind === 'funcptr') {
      returnType = { kind: 'int', size: 8, signed: false };
    }
    this.lastCallReturnType = returnType;
  }

  // -- typed memory access helpers -----------------------------------------

  private loadTypedFromAddressInRax(type: CType, displacement: number): void {
    if (type.kind === 'void') {
      this.code.mov('rax', qword('rax', displacement));
      return;
    }
    if (
      type.kind === 'pointer' ||
      type.kind === 'funcptr' ||
      (type.kind === 'int' && type.size === 8)
    ) {
      this.code.mov('rax', qword('rax', displacement));
      return;
    }
    if (type.kind === 'int' && type.size === 4) {
      this.code.mov('eax', dword('rax', displacement));
      return;
    }
    if (type.kind === 'int' && type.size === 2) {
      this.code.movzxWord('eax', word('rax', displacement));
      return;
    }
    if (type.kind === 'int' && type.size === 1) {
      this.code.movzx('eax', byte('rax', displacement));
      return;
    }
    throw new CSubsetError(
      'cannot load an aggregate value directly (missing a final field/subscript?)',
    );
  }

  private storeTypedToAddressInRax(type: CType, displacement: number): void {
    if (
      type.kind === 'pointer' ||
      type.kind === 'funcptr' ||
      (type.kind === 'int' && type.size === 8)
    ) {
      this.code.mov(qword('rax', displacement), 'rbx');
      return;
    }
    if (type.kind === 'int' && type.size === 4) {
      this.code.mov(dword('rax', displacement), 'ebx');
      return;
    }
    if (type.kind === 'int' && type.size === 1) {
      this.code.movByteToMemory(byte('rax', displacement), 'rbx');
      return;
    }
    throw new CSubsetError(
      `unsupported store width for type kind "${type.kind}" (size ${sizeOf(type)})`,
    );
  }

  private emitScaleByConstant(register: X64Register64, factor: number): void {
    if (factor === 1) return;
    if (factor === 2) {
      this.code.add(register, register);
      return;
    }
    if (factor === 4) {
      this.code.add(register, register);
      this.code.add(register, register);
      return;
    }
    if (factor === 8) {
      this.code.add(register, register);
      this.code.add(register, register);
      this.code.add(register, register);
      return;
    }
    throw new CSubsetError(`unsupported pointer scale factor ${factor}`);
  }
}

const I32_TYPE: CType = { kind: 'int', size: 4, signed: true };
const U64_TYPE: CType = { kind: 'int', size: 8, signed: false };

export { ffiTypeToCType };
