import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

function resolveBunCommand(
  home: string,
  platform: NodeJS.Platform,
): string | null {
  if (
    process.execPath &&
    basename(process.execPath).toLowerCase().startsWith('bun')
  ) {
    return process.execPath;
  }

  const defaultBun = join(
    home,
    '.bun',
    'bin',
    platform === 'win32' ? 'bun.exe' : 'bun',
  );
  if (existsSync(defaultBun)) {
    return defaultBun;
  }

  try {
    const check = spawnSync('bun', ['--version'], {
      stdio: 'ignore',
      timeout: 3000,
    });
    if (check.status === 0) {
      return 'bun';
    }
  } catch {}

  return null;
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
  // 1. Standalone AOT binary (`exoproc.exe` / `exoproc`): point directly to `[process.execPath, 'mcp']`.
  // 2. Bun available: `[bunCmd, 'x', 'exoproc', 'mcp']` (with full path to bun.exe on Windows when possible).
  // 3. Node.js-only environment without Bun: `['npx' | 'npx.cmd', '-y', 'exoproc', 'mcp']` (bridges to cached AOT .exe).
  let command = options?.command;
  if (!command || command.length === 0) {
    const execBase = process.execPath
      ? basename(process.execPath).toLowerCase()
      : '';
    const isStandaloneBinary =
      execBase.startsWith('exoproc') &&
      !execBase.endsWith('.js') &&
      !execBase.endsWith('.mjs') &&
      !execBase.endsWith('.ts');

    const bunCmd = resolveBunCommand(home, platform);
    if (options?.dev) {
      const localDist = join(cwd, 'packages', 'exoproc', 'dist', 'cli.js');
      command = [bunCmd ?? 'bun', localDist, 'mcp'];
    } else if (isStandaloneBinary) {
      command = [process.execPath, 'mcp'];
    } else if (bunCmd) {
      command = [bunCmd, 'x', 'exoproc', 'mcp'];
    } else {
      command = [
        platform === 'win32' ? 'npx.cmd' : 'npx',
        '-y',
        'exoproc',
        'mcp',
      ];
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
