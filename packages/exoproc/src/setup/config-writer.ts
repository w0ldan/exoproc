import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { ClientDefinition } from './types.js';

export interface WriteConfigResult {
  path: string;
  status: 'configured' | 'already_current' | 'failed';
  error?: string;
  backupPath?: string;
}

function parseJsonc(content: string): any {
  if (!content || !content.trim()) return {};
  // Strip block and line comments while preserving strings
  const cleaned = content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\\:])\/\/.*$/gm, '$1')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
  if (!cleaned) return {};
  return JSON.parse(cleaned);
}

export function isClientConfigured(
  client: ClientDefinition,
  configPath: string,
  command: string[],
): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const raw = readFileSync(configPath, 'utf8');
    if (!raw.trim()) return false;
    const doc = parseJsonc(raw);
    if (client.format === 'zed') {
      const entry = doc?.context_servers?.exoproc;
      if (!entry) return false;
      const cmdPath = entry?.command?.path;
      const cmdArgs = entry?.command?.args;
      return (
        cmdPath === command[0] &&
        Array.isArray(cmdArgs) &&
        cmdArgs.join(' ') === command.slice(1).join(' ')
      );
    } else {
      const entry = doc?.mcpServers?.exoproc;
      if (!entry) return false;
      return (
        entry.command === command[0] &&
        Array.isArray(entry.args) &&
        entry.args.join(' ') === command.slice(1).join(' ')
      );
    }
  } catch {
    return false;
  }
}

export function updateClientConfig(
  client: ClientDefinition,
  configPath: string,
  command: string[],
  dryRun = false,
): WriteConfigResult {
  try {
    let doc: any = {};
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf8');
      if (content.trim()) {
        try {
          doc = parseJsonc(content);
        } catch (err: any) {
          return {
            path: configPath,
            status: 'failed',
            error: `Existing config at ${configPath} is not valid JSON/JSONC: ${err.message}`,
          };
        }
      }
    }

    if (isClientConfigured(client, configPath, command)) {
      return { path: configPath, status: 'already_current' };
    }

    if (dryRun) {
      return { path: configPath, status: 'configured' };
    }

    // Ensure parent directory exists
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Create backup if file exists
    let backupPath: string | undefined;
    if (existsSync(configPath)) {
      backupPath = `${configPath}.exoproc.bak`;
      copyFileSync(configPath, backupPath);
    }

    if (client.format === 'zed') {
      doc.context_servers = doc.context_servers || {};
      doc.context_servers.exoproc = {
        command: {
          path: command[0],
          args: command.slice(1),
        },
      };
    } else {
      doc.mcpServers = doc.mcpServers || {};
      doc.mcpServers.exoproc = {
        command: command[0],
        args: command.slice(1),
      };
    }

    writeFileSync(configPath, JSON.stringify(doc, null, 2) + '\n', 'utf8');

    return {
      path: configPath,
      status: 'configured',
      backupPath,
    };
  } catch (err: any) {
    return {
      path: configPath,
      status: 'failed',
      error: err?.message || String(err),
    };
  }
}
