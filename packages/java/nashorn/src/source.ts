/**
 * @exoproc/njava-nashorn - Source, JavaCode, and ScriptFunction models.
 * Mimics Nashorn's internal runtime Source and ScriptFunction classes,
 * supporting lazy morphing / target casts on the Bridge side.
 */

/**
 * Base model representing source code in Nashorn.
 * Mirrors `jdk.nashorn.internal.runtime.Source`.
 */
export abstract class Source {
  public readonly $className: string = 'jdk.nashorn.internal.runtime.Source';
  public readonly name: string;

  constructor(name: string = '<eval>') {
    this.name = name;
  }

  /**
   * Returns the underlying code string.
   */
  public abstract getString(): string;

  public toString(): string {
    return this.getString();
  }

  public valueOf(): string {
    return this.getString();
  }

  public getName(): string {
    return this.name;
  }
}

/**
 * Explicit Java source code representation (`Java.code("...")`).
 * Inherits from `Source` and holds a cache of one-time target-type casts.
 */
export class JavaCode extends Source {
  public override readonly $className: string =
    'jdk.nashorn.internal.runtime.Source';
  public readonly __isJavaCode = true;
  public readonly code: string;

  /**
   * Multi-target morphing cache.
   * Maps target Java type (e.g. 'java.lang.String', 'java.lang.Runnable', 'java.util.concurrent.Callable')
   * to the generated representation.
   */
  private readonly targetCasts = new Map<string, any>();

  constructor(code: string, name: string = '<eval>') {
    super(name);
    this.code = code;
  }

  public override getString(): string {
    return this.code;
  }

  public getCast<T = any>(targetType: string): T | undefined {
    return this.targetCasts.get(targetType);
  }

  public setCast<T = any>(targetType: string, value: T): T {
    this.targetCasts.set(targetType, value);
    return value;
  }

  public hasCast(targetType: string): boolean {
    return this.targetCasts.has(targetType);
  }

  public get casts(): ReadonlyMap<string, any> {
    return this.targetCasts;
  }
}

/**
 * JavaScript/TypeScript function representation (`Java.code(fn)`).
 * Mirrors `jdk.nashorn.internal.runtime.ScriptFunction`.
 * Caches the function body code on first access so the bridge never re-extracts it.
 */
export class ScriptFunction extends Source {
  public override readonly $className: string =
    'jdk.nashorn.internal.runtime.ScriptFunction';
  public readonly __isScriptFunction = true;
  public readonly fn: (...args: any[]) => any;
  private _body?: string;

  private readonly targetCasts = new Map<string, any>();

  constructor(fn: (...args: any[]) => any, name?: string) {
    super(name || fn.name || '<anonymous>');
    this.fn = fn;
  }

  /**
   * Extracts and caches the function body code string on first access.
   */
  public override getString(): string {
    if (this._body === undefined) {
      this._body = this.fn.toString();
    }
    return this._body;
  }

  public get body(): string {
    return this.getString();
  }

  public getCast<T = any>(targetType: string): T | undefined {
    return this.targetCasts.get(targetType);
  }

  public setCast<T = any>(targetType: string, value: T): T {
    this.targetCasts.set(targetType, value);
    return value;
  }

  public hasCast(targetType: string): boolean {
    return this.targetCasts.has(targetType);
  }

  public get casts(): ReadonlyMap<string, any> {
    return this.targetCasts;
  }
}

/**
 * Factory for creating `JavaCode` or `ScriptFunction` instances.
 * - If given a function: converts directly to a `ScriptFunction`.
 * - If given a string or primitive: creates a `JavaCode`.
 */
export function createJavaCode(
  sourceOrFn: string | ((...args: any[]) => any),
  name?: string,
): JavaCode | ScriptFunction {
  if (typeof sourceOrFn === 'function') {
    return new ScriptFunction(sourceOrFn, name);
  }
  return new JavaCode(String(sourceOrFn), name);
}
