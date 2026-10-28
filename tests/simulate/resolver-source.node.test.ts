import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyResolverTargets } from '../../packages/simulate/dist/worker/resolver-source.js';

function buildResolverSource(localTargets: ReadonlySet<string>): string {
  const blocks = [
    `void* normalize_address(void* address) {
      return address;
    }`,
  ];
  for (const name of ['SystemClock', 'MissingFeature', 'WriteMessage']) {
    if (localTargets.has(name)) {
      blocks.push(`
void* ${name}() { return 0; }
void* ${name}_ptr() { return (void*)${name}; }
`);
    } else {
      blocks.push(`
extern void* ${name}();
void* ${name}_ptr() { return normalize_address((void*)${name}); }
`);
    }
  }
  return blocks.join('\n');
}

describe('classifyResolverTargets', () => {
  it('classifies extern targets without depending on a helper name', () => {
    const kinds = classifyResolverTargets(buildResolverSource(new Set()), [
      'SystemClock_ptr',
      'MissingFeature_ptr',
      'WriteMessage_ptr',
    ]);
    assert.equal(kinds.get('SystemClock'), 'extern');
    assert.equal(kinds.get('MissingFeature'), 'extern');
    assert.equal(kinds.get('WriteMessage'), 'extern');
  });

  it('classifies local fallback definitions', () => {
    const kinds = classifyResolverTargets(
      buildResolverSource(new Set(['MissingFeature', 'WriteMessage'])),
      ['SystemClock_ptr', 'MissingFeature_ptr', 'WriteMessage_ptr'],
    );
    assert.equal(kinds.get('SystemClock'), 'extern');
    assert.equal(kinds.get('MissingFeature'), 'local');
    assert.equal(kinds.get('WriteMessage'), 'local');
  });

  it('rejects exports that are not pointer resolvers', () => {
    assert.throws(
      () => classifyResolverTargets('int main() { return 0; }', ['main']),
      /must use the _ptr suffix/,
    );
  });

  it('rejects a resolver missing from the source', () => {
    assert.throws(
      () =>
        classifyResolverTargets(buildResolverSource(new Set()), ['Absent_ptr']),
      /cannot find resolver definition/,
    );
  });
});
