/**
 * Classifies the target of generated pointer-resolver functions from ordinary
 * C declarations. The parser intentionally understands only this small source
 * shape; it does not depend on a particular package, generator, helper name, or
 * helper implementation.
 *
 * A resolver module contains entries shaped like:
 *
 *   extern RETTYPE NAME(params);
 *   void* NAME_ptr() { return some_helper((void*)NAME); }
 *
 * or a local fallback definition:
 *
 *   RETTYPE NAME(params) { return 0; }
 *   void* NAME_ptr() { return (void*)NAME; }
 */

const IDENTIFIER_PATTERN = /^[A-Za-z_]\w*$/;

export type ResolverTargetKind = 'extern' | 'local';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns each resolver target keyed by its target function name. Requested
 * exports conventionally use a `_ptr` suffix, but the helper called inside the
 * resolver body is otherwise unrestricted.
 */
export function classifyResolverTargets(
  source: string,
  requestedNames: readonly string[],
): ReadonlyMap<string, ResolverTargetKind> {
  const result = new Map<string, ResolverTargetKind>();

  for (const requestedName of requestedNames) {
    if (!requestedName.endsWith('_ptr')) {
      throw new Error(
        `resolver export ${JSON.stringify(requestedName)} must use the _ptr suffix`,
      );
    }

    const targetName = requestedName.slice(0, -4);
    if (!IDENTIFIER_PATTERN.test(targetName)) {
      throw new Error(
        `resolver target is not a valid C identifier: ${JSON.stringify(targetName)}`,
      );
    }
    if (result.has(targetName)) continue;

    const escapedTarget = escapeRegExp(targetName);
    const escapedResolver = escapeRegExp(requestedName);
    const resolverPattern = new RegExp(
      `\\b${escapedResolver}\\s*\\([^)]*\\)\\s*\\{` +
        `[\\s\\S]*?\\breturn\\b[\\s\\S]*?\\b${escapedTarget}\\b[\\s\\S]*?;[\\s\\S]*?\\}`,
    );
    if (!resolverPattern.test(source)) {
      throw new Error(
        `cannot find resolver definition ${JSON.stringify(requestedName)} ` +
          `returning target ${JSON.stringify(targetName)}`,
      );
    }

    const externPattern = new RegExp(
      `\\bextern\\s+[\\w \\*]+?\\s+${escapedTarget}\\s*\\([^)]*\\)\\s*;`,
    );
    const localPattern = new RegExp(
      `(?:^|[;}])\\s*[\\w \\*]+?\\s+${escapedTarget}\\s*\\([^)]*\\)\\s*\\{`,
      'm',
    );

    if (externPattern.test(source)) {
      result.set(targetName, 'extern');
    } else if (localPattern.test(source)) {
      result.set(targetName, 'local');
    } else {
      throw new Error(
        `cannot find an extern declaration or local definition for resolver target ` +
          JSON.stringify(targetName),
      );
    }
  }

  return result;
}
