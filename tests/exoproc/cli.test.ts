import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDoctor } from '../../packages/exoproc/dist/doctor/index.js';
import {
  runSetup,
  createSetupContext,
  detectClients,
} from '../../packages/exoproc/dist/setup/index.js';

describe('exoproc CLI & setup', () => {
  it('runs doctor and returns health report', () => {
    const report = runDoctor();
    assert.ok(report);
    assert.ok(typeof report.platform === 'string');
    assert.ok(Array.isArray(report.detectedAgents));
    assert.ok(
      Array.isArray(report.dependencies),
      'Dependencies must be an array',
    );
    assert.ok(
      report.dependencies.length >= 2,
      'Must inspect at least capstone and jjit deps',
    );
    for (const dep of report.dependencies) {
      assert.ok(dep.name);
      assert.ok(['verified', 'mismatch', 'not_cached'].includes(dep.status));
      if (dep.status === 'verified') {
        assert.ok(dep.actualSha1 || dep.actualSha256);
      }
    }
    assert.ok(['healthy', 'warning', 'error'].includes(report.overallStatus));
  });

  it('creates setup context and detects clients', () => {
    const ctx = createSetupContext();
    assert.ok(ctx.home);
    assert.ok(Array.isArray(ctx.command));
    assert.equal(ctx.command[ctx.command.length - 1], 'mcp');

    const detected = detectClients(ctx);
    assert.ok(Array.isArray(detected));
    assert.ok(detected.length >= 5);
  });

  it('runs setup in dry-run mode without modifying files', async () => {
    const summary = await runSetup({ dryRun: true });
    assert.equal(summary.dryRun, true);
    assert.ok(
      Array.isArray(summary.configured) ||
        Array.isArray(summary.alreadyCurrent),
    );
  });
});
