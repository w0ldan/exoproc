/**
 * Exoproc JIT C-Macro abstraction library
 */

export interface CMacro<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): ReturnType<T>;
  readonly _isCMacro: boolean;
  toC(...argNames: string[]): string;
  toCDefinition(name: string): string;
}

/**
 * Defines a C-style function macro.
 * The provided function is evaluated directly in JavaScript.
 * The `toC` method is an optional utility that can generate the C string representation
 * if you intend to inject this macro into a C compiler via cjit, though for many cases
 * simply having the JS equivalent is enough.
 *
 * Note: Generating C code automatically from a JS function string is complex and error-prone,
 * so the `toC` currently is a stub or requires manual string definition if needed.
 * For now, `cmacro` primarily serves as a semantic marker that this function
 * mirrors a C macro, providing standard JS execution.
 *
 * @param fn The JavaScript implementation of the macro.
 * @param cStringTemplate Optional string template for C code generation.
 *                        Use placeholders like $1, $2 for arguments.
 *                        e.g., "(($1) | (($2) << 8) | (($3) << 16))"
 */
export function cmacro<T extends (...args: any[]) => any>(
  fn: T,
  cStringTemplate?: string,
): CMacro<T> {
  const macroFn = (...args: Parameters<T>): ReturnType<T> => {
    return fn(...args);
  };

  Object.defineProperty(macroFn, '_isCMacro', {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false,
  });

  macroFn.toC = (...argNames: string[]): string => {
    if (cStringTemplate) {
      let result = cStringTemplate;
      argNames.forEach((name, index) => {
        // Replace $1, $2, etc. with the argument name
        result = result.replace(new RegExp(`\\$${index + 1}`, 'g'), name);
      });
      return result;
    }

    // Fallback: If no template is provided, we can't reliably parse the JS AST
    // to generate C code in a lightweight way. Return a stub.
    return `/* CMacro translation not provided for this macro. */`;
  };

  macroFn.toCDefinition = (name: string): string => {
    if (cStringTemplate) {
      const args = Array.from({ length: fn.length }, (_, i) => `arg${i}`);
      const body = macroFn.toC(...args);
      return `#define ${name}(${args.join(', ')}) ${body}`;
    }
    return `/* CMacro translation not provided for ${name} */`;
  };

  return macroFn as CMacro<T>;
}
