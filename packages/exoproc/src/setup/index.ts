import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import { SUPPORTED_CLIENTS } from './clients.js';
import { updateClientConfig, isClientConfigured } from './config-writer.js';
import { installSkills } from './skill-installer.js';
import type {
  ClientConfigStatus,
  SetupContext,
  SetupOptions,
  SetupSummary,
} from './types.js';

export * from './types.js';
export * from './clients.js';
export * from './config-writer.js';
export * from './skill-installer.js';

function resolveBunCommand(home: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') {
    if (
      process.execPath &&
      basename(process.execPath).toLowerCase().startsWith('bun')
    ) {
      return process.execPath;
    }
    const defaultWinBun = join(home, '.bun', 'bin', 'bun.exe');
    if (existsSync(defaultWinBun)) {
      return defaultWinBun;
    }
  }
  return 'bun';
}

export function createSetupContext(options?: {
  command?: string[];
  dev?: boolean;
}): SetupContext {
  const home = homedir();
  const platform = process.platform;
  const env = process.env;
  const cwd = process.cwd();

  // Determine standard runner command:
  // By default, generate a portable, universal command suitable for npm / bunx / npx.
  // On Windows, resolve full path to bun.exe if available so GUI apps without modified PATH can spawn it.
  let command = options?.command;
  if (!command || command.length === 0) {
    const bunCmd = resolveBunCommand(home, platform);
    if (options?.dev) {
      const localDist = join(cwd, 'packages', 'exoproc', 'dist', 'cli.js');
      command = [bunCmd, localDist, 'mcp'];
    } else {
      command = [bunCmd, 'x', 'exoproc', 'mcp'];
    }
  }

  return {
    home,
    platform,
    env,
    cwd,
    command,
  };
}

export function detectClients(ctx: SetupContext): ClientConfigStatus[] {
  const results: ClientConfigStatus[] = [];

  for (const client of SUPPORTED_CLIENTS) {
    const detected = client.detect(ctx);
    const configPaths = client.getConfigPaths(ctx);
    const primaryConfig = configPaths[0] ?? '';
    const alreadyConfigured = isClientConfigured(
      client,
      primaryConfig,
      ctx.command,
    );
    const skillPaths = client.getSkillPaths ? client.getSkillPaths(ctx) : [];

    results.push({
      client,
      detected,
      configPath: primaryConfig,
      alreadyConfigured,
      skillPaths,
    });
  }

  return results;
}

export async function runSetup(
  options: SetupOptions = {},
): Promise<SetupSummary> {
  const ctx = createSetupContext({
    command: options.command,
    dev: options.dev,
  });
  const statuses = detectClients(ctx);

  const targetStatuses = statuses.filter((st) => {
    if (options.clients && options.clients.length > 0) {
      return options.clients.includes(st.client.id);
    }
    return st.detected;
  });

  const summary: SetupSummary = {
    configured: [],
    alreadyCurrent: [],
    failed: [],
    skillsInstalled: [],
    dryRun: !!options.dryRun,
  };

  for (const st of targetStatuses) {
    if (options.skillOnly) {
      if (st.skillPaths.length > 0) {
        const installed = installSkills(st.skillPaths, options.dryRun);
        summary.skillsInstalled.push(...installed);
      }
      continue;
    }

    const configPaths = st.client.getConfigPaths(ctx);
    for (const cfgPath of configPaths) {
      const res = updateClientConfig(
        st.client,
        cfgPath,
        ctx.command,
        options.dryRun,
      );
      if (res.status === 'configured') {
        summary.configured.push(`${st.client.displayName} (${cfgPath})`);
      } else if (res.status === 'already_current') {
        summary.alreadyCurrent.push(`${st.client.displayName} (${cfgPath})`);
      } else if (res.status === 'failed') {
        summary.failed.push({
          client: st.client.displayName,
          error: res.error || 'Unknown error',
        });
      }
    }

    if (st.skillPaths.length > 0) {
      const installed = installSkills(st.skillPaths, options.dryRun);
      summary.skillsInstalled.push(...installed);
    }
  }

  return summary;
}
