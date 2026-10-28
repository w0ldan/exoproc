import { createSetupContext, detectClients } from '../setup/index.js';
import { inspectAllDeps, type DepCheckResult } from 'exoproc-utils';

export interface DoctorReport {
  platform: string;
  arch: string;
  bunVersion: string;
  detectedAgents: Array<{
    name: string;
    configPath: string;
    configured: boolean;
  }>;
  dependencies: DepCheckResult[];
  overallStatus: 'healthy' | 'warning' | 'error';
  messages: string[];
}

export function runDoctor(): DoctorReport {
  const platform = process.platform;
  const arch = process.arch;
  const bunVersion =
    process.versions?.bun || 'not detected (running under Node.js)';
  const messages: string[] = [];

  const ctx = createSetupContext();
  const statuses = detectClients(ctx);
  const detectedAgents = statuses
    .filter((s) => s.detected)
    .map((s) => ({
      name: s.client.displayName,
      configPath: s.configPath,
      configured: s.alreadyConfigured,
    }));

  const dependencies = inspectAllDeps();
  let overallStatus: 'healthy' | 'warning' | 'error' = 'healthy';

  // Check binary dependencies checksums
  const corruptedDeps = dependencies.filter((d) => d.status === 'mismatch');
  if (corruptedDeps.length > 0) {
    overallStatus = 'error';
    for (const d of corruptedDeps) {
      messages.push(
        `Corrupted dependency: ${d.name} (${d.filename}) failed checksum verification! ${d.error || ''}`,
      );
    }
  }

  if (detectedAgents.length === 0) {
    if (overallStatus !== 'error') overallStatus = 'warning';
    messages.push(
      'No supported AI coding agents detected in standard locations.',
    );
  } else {
    const unconfigured = detectedAgents.filter((a) => !a.configured);
    if (unconfigured.length > 0) {
      if (overallStatus !== 'error') overallStatus = 'warning';
      messages.push(
        `${unconfigured.length} detected agent(s) not yet configured with exoproc MCP. Run "exoproc setup" to configure them.`,
      );
    }
  }

  return {
    platform,
    arch,
    bunVersion,
    detectedAgents,
    dependencies,
    overallStatus,
    messages,
  };
}
