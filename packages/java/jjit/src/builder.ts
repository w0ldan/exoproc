import type { MappingPool } from 'exoproc-mappings';
import {
  type ModifierInput,
  normalizeModifiers,
  parseModifiers,
  type JavaModifier,
} from './modifiers.js';
import { JavaTypeResolver } from './type-resolver.js';
import type { JavaParamDef } from './types.js';
import { parseJavaSource } from './parser.js';
import {
  compileJavaSync,
  type JavaCompileOptions,
  type JavaCompileResult,
} from './compiler.js';
import type { JJitBuildOptions, JJitBuildResult } from './index.js';

/**
 * Fluent builder for Java class fields.
 */
export class JavaFieldBuilder {
  private _annotations: string[] = [];
  private _modifiers = new Set<JavaModifier>();
  private _initialValue?: string;

  constructor(
    public readonly name: string,
    public type: string,
    private readonly resolver: JavaTypeResolver,
    public readonly classBuilder: JavaClassBuilder,
    initialModifiers?: ModifierInput,
  ) {
    if (initialModifiers) {
      for (const m of parseModifiers(initialModifiers)) {
        this._modifiers.add(m);
      }
    }
  }

  public public(): this {
    this._modifiers.delete('protected');
    this._modifiers.delete('private');
    this._modifiers.add('public');
    return this;
  }

  public protected(): this {
    this._modifiers.delete('public');
    this._modifiers.delete('private');
    this._modifiers.add('protected');
    return this;
  }

  public private(): this {
    this._modifiers.delete('public');
    this._modifiers.delete('protected');
    this._modifiers.add('private');
    return this;
  }

  public static(): this {
    this._modifiers.add('static');
    return this;
  }

  public final(): this {
    this._modifiers.add('final');
    return this;
  }

  public volatile(): this {
    this._modifiers.add('volatile');
    return this;
  }

  public transient(): this {
    this._modifiers.add('transient');
    return this;
  }

  public annotation(ann: string): this {
    const trimmed = ann.trim();
    this._annotations.push(trimmed.startsWith('@') ? trimmed : `@${trimmed}`);
    return this;
  }

  public modifier(mod: ModifierInput): this {
    for (const m of parseModifiers(mod)) {
      if (m === 'private' || m === 'protected') {
        this._modifiers.delete('public');
      } else if (m === 'public') {
        this._modifiers.delete('private');
        this._modifiers.delete('protected');
      }
      this._modifiers.add(m);
    }
    return this;
  }

  public initialValue(value: string): this {
    this._initialValue = value;
    return this;
  }

  // Fluent delegates back to classBuilder
  public field(
    name: string,
    type: string,
    modifiers?: ModifierInput,
    initialValue?: string,
  ): JavaFieldBuilder {
    return this.classBuilder.field(name, type, modifiers, initialValue);
  }

  public constructorDef(
    params?: Record<string, string> | JavaParamDef[],
    body?: string,
  ): JavaConstructorBuilder {
    return this.classBuilder.constructorDef(params, body);
  }

  public method(name: string, returnType = 'void'): JavaMethodBuilder {
    return this.classBuilder.method(name, returnType);
  }

  public endField(): JavaClassBuilder {
    return this.classBuilder;
  }

  public renderField(indent = '    '): string {
    const lines: string[] = [];
    for (const ann of this._annotations) {
      lines.push(`${indent}${ann}`);
    }
    const resolvedType = this.resolver.resolve(this.type);
    const modStr = normalizeModifiers(this._modifiers);
    const prefix = modStr ? `${modStr} ` : '';
    const valStr =
      this._initialValue !== undefined ? ` = ${this._initialValue}` : '';
    lines.push(
      `${indent}${prefix}${resolvedType.codeType} ${this.name}${valStr};`,
    );
    return lines.join('\n');
  }

  public toSource(): string {
    return this.classBuilder.toSource();
  }
}

/**
 * Fluent builder for Java class constructors.
 */
export class JavaConstructorBuilder {
  private _modifiers = new Set<JavaModifier>();
  private _params: JavaParamDef[] = [];
  private _throws: string[] = [];
  private _body = '';

  constructor(
    private readonly className: string,
    private readonly resolver: JavaTypeResolver,
    public readonly classBuilder: JavaClassBuilder,
  ) {
    this._modifiers.add('public');
  }

  public modifier(mod: ModifierInput): this {
    for (const m of parseModifiers(mod)) {
      this._modifiers.add(m);
    }
    return this;
  }

  public public(): this {
    this._modifiers.clear();
    this._modifiers.add('public');
    return this;
  }

  public protected(): this {
    this._modifiers.clear();
    this._modifiers.add('protected');
    return this;
  }

  public private(): this {
    this._modifiers.clear();
    this._modifiers.add('private');
    return this;
  }

  public param(name: string, type: string): this {
    this._params.push({ name, type });
    return this;
  }

  public params(params: Record<string, string> | JavaParamDef[]): this {
    if (Array.isArray(params)) {
      this._params.push(...params);
    } else {
      for (const [name, type] of Object.entries(params)) {
        this._params.push({ name, type });
      }
    }
    return this;
  }

  public throws(...exceptionTypes: string[]): this {
    this._throws.push(...exceptionTypes);
    return this;
  }

  public body(code: string): this {
    this._body = code.trim();
    return this;
  }

  // Fluent delegates back to classBuilder
  public field(
    name: string,
    type: string,
    modifiers?: ModifierInput,
    initialValue?: string,
  ): JavaFieldBuilder {
    return this.classBuilder.field(name, type, modifiers, initialValue);
  }

  public constructorDef(
    params?: Record<string, string> | JavaParamDef[],
    body?: string,
  ): JavaConstructorBuilder {
    return this.classBuilder.constructorDef(params, body);
  }

  public method(name: string, returnType = 'void'): JavaMethodBuilder {
    return this.classBuilder.method(name, returnType);
  }

  public endConstructor(): JavaClassBuilder {
    return this.classBuilder;
  }

  public renderConstructor(indent = '    '): string {
    const modStr = normalizeModifiers(this._modifiers);
    const prefix = modStr ? `${modStr} ` : '';

    const paramParts = this._params.map((p) => {
      const resolved = this.resolver.resolve(p.type);
      return `${resolved.codeType} ${p.name}`;
    });
    const paramsStr = paramParts.join(', ');

    let throwsStr = '';
    if (this._throws.length > 0) {
      const resolvedThrows = this._throws.map(
        (t) => this.resolver.resolve(t).codeType,
      );
      throwsStr = ` throws ${resolvedThrows.join(', ')}`;
    }

    const lines: string[] = [];
    lines.push(
      `${indent}${prefix}${this.className}(${paramsStr})${throwsStr} {`,
    );

    if (this._body) {
      for (const line of this._body.split('\n')) {
        lines.push(`${indent}    ${line}`);
      }
    }

    lines.push(`${indent}}`);
    return lines.join('\n');
  }

  public toSource(): string {
    return this.classBuilder.toSource();
  }
}

/**
 * Fluent builder for Java methods.
 */
export class JavaMethodBuilder {
  private _annotations: string[] = [];
  private _modifiers = new Set<JavaModifier>();
  private _returnType = 'void';
  private _params: JavaParamDef[] = [];
  private _throws: string[] = [];
  private _body = '';

  constructor(
    public readonly name: string,
    private readonly resolver: JavaTypeResolver,
    public readonly classBuilder: JavaClassBuilder,
    initialReturnType = 'void',
  ) {
    this._returnType = initialReturnType;
    this._modifiers.add('public');
  }

  public annotation(ann: string): this {
    const trimmed = ann.trim();
    this._annotations.push(trimmed.startsWith('@') ? trimmed : `@${trimmed}`);
    return this;
  }

  public public(): this {
    this._modifiers.delete('protected');
    this._modifiers.delete('private');
    this._modifiers.add('public');
    return this;
  }

  public protected(): this {
    this._modifiers.delete('public');
    this._modifiers.delete('private');
    this._modifiers.add('protected');
    return this;
  }

  public private(): this {
    this._modifiers.delete('public');
    this._modifiers.delete('protected');
    this._modifiers.add('private');
    return this;
  }

  public static(): this {
    this._modifiers.add('static');
    return this;
  }

  public final(): this {
    this._modifiers.add('final');
    return this;
  }

  public abstract(): this {
    this._modifiers.add('abstract');
    return this;
  }

  public synchronized(): this {
    this._modifiers.add('synchronized');
    return this;
  }

  public modifier(mod: ModifierInput): this {
    for (const m of parseModifiers(mod)) {
      if (m === 'private' || m === 'protected') {
        this._modifiers.delete('public');
      } else if (m === 'public') {
        this._modifiers.delete('private');
        this._modifiers.delete('protected');
      }
      this._modifiers.add(m);
    }
    return this;
  }

  public returns(type: string): this {
    this._returnType = type;
    return this;
  }

  public void(): this {
    this._returnType = 'void';
    return this;
  }

  public param(name: string, type: string): this {
    this._params.push({ name, type });
    return this;
  }

  public params(params: Record<string, string> | JavaParamDef[]): this {
    if (Array.isArray(params)) {
      this._params.push(...params);
    } else {
      for (const [name, type] of Object.entries(params)) {
        this._params.push({ name, type });
      }
    }
    return this;
  }

  public throws(...exceptionTypes: string[]): this {
    this._throws.push(...exceptionTypes);
    return this;
  }

  public body(code: string): this {
    this._body = code.trim();
    return this;
  }

  // Fluent delegates back to classBuilder
  public field(
    name: string,
    type: string,
    modifiers?: ModifierInput,
    initialValue?: string,
  ): JavaFieldBuilder {
    return this.classBuilder.field(name, type, modifiers, initialValue);
  }

  public constructorDef(
    params?: Record<string, string> | JavaParamDef[],
    body?: string,
  ): JavaConstructorBuilder {
    return this.classBuilder.constructorDef(params, body);
  }

  public method(name: string, returnType = 'void'): JavaMethodBuilder {
    return this.classBuilder.method(name, returnType);
  }

  public endMethod(): JavaClassBuilder {
    return this.classBuilder;
  }

  public renderMethod(indent = '    '): string {
    const lines: string[] = [];

    for (const ann of this._annotations) {
      lines.push(`${indent}${ann}`);
    }

    const modStr = normalizeModifiers(this._modifiers);
    const prefix = modStr ? `${modStr} ` : '';
    const resolvedRet = this.resolver.resolve(this._returnType);

    const paramParts = this._params.map((p) => {
      const resolved = this.resolver.resolve(p.type);
      return `${resolved.codeType} ${p.name}`;
    });
    const paramsStr = paramParts.join(', ');

    let throwsStr = '';
    if (this._throws.length > 0) {
      const resolvedThrows = this._throws.map(
        (t) => this.resolver.resolve(t).codeType,
      );
      throwsStr = ` throws ${resolvedThrows.join(', ')}`;
    }

    if (this._modifiers.has('abstract')) {
      lines.push(
        `${indent}${prefix}${resolvedRet.codeType} ${this.name}(${paramsStr})${throwsStr};`,
      );
      return lines.join('\n');
    }

    lines.push(
      `${indent}${prefix}${resolvedRet.codeType} ${this.name}(${paramsStr})${throwsStr} {`,
    );
    if (this._body) {
      for (const line of this._body.split('\n')) {
        lines.push(`${indent}    ${line}`);
      }
    }
    lines.push(`${indent}}`);

    return lines.join('\n');
  }

  public toSource(): string {
    return this.classBuilder.toSource();
  }
}

/**
 * Main Java Class Builder.
 * Synthesizes typed Java source code with automatic MappingPool type resolution and imports.
 */
export class JavaClassBuilder {
  public readonly resolver: JavaTypeResolver;
  private _package?: string;
  private _annotations: string[] = [];
  private _modifiers = new Set<JavaModifier>();
  private _superClass?: string;
  private _interfaces: string[] = [];
  private _fields: JavaFieldBuilder[] = [];
  private _constructors: JavaConstructorBuilder[] = [];
  private _methods: JavaMethodBuilder[] = [];
  private _rawMembers: string[] = [];

  constructor(
    public readonly name: string,
    poolOrResolver?: MappingPool | JavaTypeResolver,
  ) {
    if (poolOrResolver instanceof JavaTypeResolver) {
      this.resolver = poolOrResolver;
    } else {
      this.resolver = new JavaTypeResolver(poolOrResolver);
    }
    this._modifiers.add('public');
  }

  public package(packageName: string): this {
    this._package = packageName.trim();
    return this;
  }

  public get packageName(): string | undefined {
    return this._package;
  }

  public get fqcn(): string {
    return this._package ? `${this._package}.${this.name}` : this.name;
  }

  public get fileName(): string {
    return `${this.name}.java`;
  }

  public get relativePath(): string {
    return this._package
      ? `${this._package.replace(/\./g, '/')}/${this.name}.java`
      : `${this.name}.java`;
  }

  public import(fqcn: string): this {
    this.resolver.addImport(fqcn);
    return this;
  }

  public annotation(ann: string): this {
    const trimmed = ann.trim();
    this._annotations.push(trimmed.startsWith('@') ? trimmed : `@${trimmed}`);
    return this;
  }

  public public(): this {
    this._modifiers.add('public');
    return this;
  }

  public final(): this {
    this._modifiers.add('final');
    return this;
  }

  public abstract(): this {
    this._modifiers.add('abstract');
    return this;
  }

  public modifier(mod: ModifierInput): this {
    for (const m of parseModifiers(mod)) {
      this._modifiers.add(m);
    }
    return this;
  }

  public extends(superClass: string): this {
    this._superClass = superClass.trim();
    return this;
  }

  public implements(...interfaces: string[]): this {
    for (const iface of interfaces) {
      const trimmed = iface.trim();
      if (trimmed && !this._interfaces.includes(trimmed)) {
        this._interfaces.push(trimmed);
      }
    }
    return this;
  }

  public field(
    name: string,
    type: string,
    modifiers?: ModifierInput,
    initialValue?: string,
  ): JavaFieldBuilder {
    const fb = new JavaFieldBuilder(name, type, this.resolver, this, modifiers);
    if (initialValue !== undefined) {
      fb.initialValue(initialValue);
    }
    this._fields.push(fb);
    return fb;
  }

  public constructorDef(
    params?: Record<string, string> | JavaParamDef[],
    body?: string,
  ): JavaConstructorBuilder {
    const cb = new JavaConstructorBuilder(this.name, this.resolver, this);
    if (params) cb.params(params);
    if (body) cb.body(body);
    this._constructors.push(cb);
    return cb;
  }

  public method(name: string, returnType = 'void'): JavaMethodBuilder {
    const mb = new JavaMethodBuilder(name, this.resolver, this, returnType);
    this._methods.push(mb);
    return mb;
  }

  public rawMember(code: string): this {
    this._rawMembers.push(code);
    return this;
  }

  /**
   * Generates clean, complete, ready-to-compile Java source code string.
   */
  public toSource(): string {
    const sections: string[] = [];

    // 1. Process header declarations to trigger type resolution & imports
    let extendsClause = '';
    if (this._superClass) {
      const resolvedSuper = this.resolver.resolve(this._superClass);
      extendsClause = ` extends ${resolvedSuper.codeType}`;
    }

    let implementsClause = '';
    if (this._interfaces.length > 0) {
      const resolvedIfaces = this._interfaces.map(
        (i) => this.resolver.resolve(i).codeType,
      );
      implementsClause = ` implements ${resolvedIfaces.join(', ')}`;
    }

    // 2. Pre-render body to ensure all inner types register their imports
    const bodyLines: string[] = [];

    // Fields
    if (this._fields.length > 0) {
      for (const field of this._fields) {
        bodyLines.push(field.renderField());
      }
      bodyLines.push('');
    }

    // Constructors
    if (this._constructors.length > 0) {
      for (const ctor of this._constructors) {
        bodyLines.push(ctor.renderConstructor());
        bodyLines.push('');
      }
    }

    // Methods
    if (this._methods.length > 0) {
      for (const method of this._methods) {
        bodyLines.push(method.renderMethod());
        bodyLines.push('');
      }
    }

    // Raw members
    if (this._rawMembers.length > 0) {
      for (const raw of this._rawMembers) {
        bodyLines.push(raw);
        bodyLines.push('');
      }
    }

    // 3. Render Package Header
    if (this._package) {
      sections.push(`package ${this._package};\n`);
    }

    // 4. Render Imports
    const imports = this.resolver.getImports();
    if (imports.length > 0) {
      for (const imp of imports) {
        sections.push(`import ${imp};`);
      }
      sections.push('');
    }

    // 5. Render Class Annotations & Declaration
    for (const ann of this._annotations) {
      sections.push(ann);
    }

    const modStr = normalizeModifiers(this._modifiers);
    const prefix = modStr ? `${modStr} ` : '';
    sections.push(
      `${prefix}class ${this.name}${extendsClause}${implementsClause} {`,
    );

    // 6. Append Class Body
    sections.push(bodyLines.join('\n').trimEnd());
    sections.push('}\n');

    return sections.join('\n');
  }

  /**
   * Associated MappingPool, if any.
   */
  public get pool(): MappingPool | undefined {
    return this.resolver.pool;
  }

  /**
   * Parses raw Java source code back into a structured JavaClassBuilder object.
   */
  public static fromSource(
    source: string,
    poolOrResolver?: MappingPool | JavaTypeResolver,
  ): JavaClassBuilder {
    return parseJavaSource(source, poolOrResolver);
  }

  /**
   * Compiles this builder directly using ECJ.
   */
  public async compile(
    options: Omit<JavaCompileOptions, 'source'> = {},
  ): Promise<JavaCompileResult> {
    const { compileJava } = await import('./compiler.js');
    return compileJava({
      ...options,
      source: this,
      pool: options.pool ?? this.pool,
    });
  }

  /**
   * Compiles this builder synchronously using ECJ.
   */
  public compileSync(
    options: Omit<JavaCompileOptions, 'source'> = {},
  ): JavaCompileResult {
    return compileJavaSync({
      ...options,
      source: this,
      pool: options.pool ?? this.pool,
    });
  }

  /**
   * Builds, compiles, and optionally remaps this builder using the JJit pipeline.
   */
  public async build(options: JJitBuildOptions = {}): Promise<JJitBuildResult> {
    const { jjit } = await import('./index.js');
    return jjit.build(this, {
      pool: this.pool,
      ...options,
    });
  }
}
