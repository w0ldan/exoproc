import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  getDepsCacheDir,
  resolveDepPath,
  findWorkspaceDepsConfigs,
  inspectDepChecksum,
  inspectAllDeps,
  downloadFileSync,
  extractEntryFromZipSync,
  computeHash,
  STANDARD_EXOPROC_DEPS,
  type PackageDep,
} from '../../packages/utils/dist/index.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { rmSync, statSync } from 'node:fs';

describe('exoproc-utils downloader', () => {
  it('returns valid deps cache directory', () => {
    const cacheDir = getDepsCacheDir();
    assert.ok(typeof cacheDir === 'string');
    assert.ok(cacheDir.length > 0);
  });

  it('locates workspace deps configs', () => {
    const configs = findWorkspaceDepsConfigs(process.cwd());
    assert.ok(Array.isArray(configs));
    assert.ok(
      configs.length >= 2,
      'Should find at least capstone and jjit deps.json',
    );

    const names = configs.map((c) => c.packageName);
    assert.ok(
      names.includes('bun-capstone') ||
        names.some((n) => n?.includes('capstone')),
    );
    assert.ok(
      names.includes('exoproc-jjit') || names.some((n) => n?.includes('jjit')),
    );
  });

  it('resolves existing cached or local dependency path', () => {
    const fakeDep: PackageDep = {
      name: 'Test Dep',
      url: 'https://example.com/fake.bin',
      target: 'fake.bin',
    };
    const resolved = resolveDepPath(fakeDep, process.cwd());
    // Since fake.bin does not exist, resolveDepPath should return null
    assert.equal(resolved, null);
  });

  it('inspects dependency checksums and detects mismatches or verified state', () => {
    const results = inspectAllDeps(process.cwd());
    assert.ok(Array.isArray(results));
    assert.ok(
      results.length >= 4,
      'Must inspect at least capstone + 3 java deps',
    );

    for (const res of results) {
      assert.ok(res.name);
      assert.ok(res.filename);
      assert.ok(['verified', 'mismatch', 'not_cached'].includes(res.status));
      if (res.status === 'verified') {
        assert.ok(res.resolvedPath);
        assert.ok(res.actualSha1 || res.actualSha256);
      }
    }
  });

  it('detects checksum mismatch when expected hash does not match', () => {
    // If a dep points to an existing file but has an incorrect sha1
    const capstoneDep: PackageDep = {
      ...STANDARD_EXOPROC_DEPS[0]!,
      sha1: '0000000000000000000000000000000000000000', // invalid sha
    };
    const inspected = inspectDepChecksum(capstoneDep);
    if (inspected.resolvedPath) {
      assert.equal(inspected.status, 'mismatch');
      assert.ok(inspected.error?.includes('mismatch'));
    }
  });

  it('extracts entries from zip archives synchronously in pure JS', () => {
    // Test pure JS in-memory ZIP decompression using the test capstone zip if available
    const testZip = '/tmp/test-capstone.zip';
    if (existsSync(testZip)) {
      const outDll = join(
        tmpdir(),
        `test-extract-${randomBytes(4).toString('hex')}.dll`,
      );
      try {
        extractEntryFromZipSync(testZip, outDll, 'capstone.dll');
        assert.ok(existsSync(outDll));
        assert.ok(statSync(outDll).size > 1000000);
        const sha1 = computeHash(outDll, 'sha1');
        assert.equal(sha1, 'c87eb26c07bb923b6a04da3cbc31b49f64c0c59a');
      } finally {
        rmSync(outDll, { force: true });
      }
    }
  });

  it('downloads files synchronously via native runtime process', () => {
    const testDest = join(
      tmpdir(),
      `test-sync-dl-${randomBytes(4).toString('hex')}.json`,
    );
    try {
      downloadFileSync(
        'https://raw.githubusercontent.com/w0ldan/exoproc/main/package.json',
        testDest,
      );
      assert.ok(existsSync(testDest));
      assert.ok(statSync(testDest).size > 10);
    } finally {
      rmSync(testDest, { force: true });
    }
  });
});
