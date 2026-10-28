import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ClientDefinition, SetupContext } from './types.js';

export const SUPPORTED_CLIENTS: ClientDefinition[] = [
  {
    id: 'claude_code',
    displayName: 'Claude Code',
    format: 'json',
    getConfigPaths: (ctx: SetupContext) => [join(ctx.home, '.claude.json')],
    getSkillPaths: (ctx: SetupContext) => [
      join(ctx.home, '.claude', 'skills', 'exoproc', 'SKILL.md'),
      join(ctx.home, '.claude', 'commands', 'exoproc.md'),
    ],
    detect: (ctx: SetupContext) =>
      existsSync(join(ctx.home, '.claude')) ||
      existsSync(join(ctx.home, '.claude.json')),
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    format: 'json',
    getConfigPaths: (ctx: SetupContext) => {
      const paths = [join(ctx.home, '.cursor', 'mcp.json')];
      const localCursor = join(ctx.cwd, '.cursor');
      if (existsSync(localCursor)) {
        paths.push(join(localCursor, 'mcp.json'));
      }
      return paths;
    },
    getSkillPaths: (ctx: SetupContext) => [
      join(ctx.home, '.cursor', 'rules', 'exoproc.mdc'),
    ],
    detect: (ctx: SetupContext) =>
      existsSync(join(ctx.home, '.cursor')) ||
      existsSync(join(ctx.cwd, '.cursor')),
  },
  {
    id: 'windsurf',
    displayName: 'Windsurf',
    format: 'json',
    getConfigPaths: (ctx: SetupContext) => [
      join(ctx.home, '.codeium', 'windsurf', 'mcp_config.json'),
    ],
    detect: (ctx: SetupContext) =>
      existsSync(join(ctx.home, '.codeium', 'windsurf')),
  },
  {
    id: 'claude_desktop',
    displayName: 'Claude Desktop',
    format: 'json',
    getConfigPaths: (ctx: SetupContext) => {
      if (ctx.platform === 'win32') {
        const appData = ctx.env.APPDATA || join(ctx.home, 'AppData', 'Roaming');
        return [join(appData, 'Claude', 'claude_desktop_config.json')];
      }
      if (ctx.platform === 'darwin') {
        return [
          join(
            ctx.home,
            'Library',
            'Application Support',
            'Claude',
            'claude_desktop_config.json',
          ),
        ];
      }
      return [
        join(ctx.home, '.config', 'Claude', 'claude_desktop_config.json'),
      ];
    },
    detect: (ctx: SetupContext) => {
      const paths = SUPPORTED_CLIENTS.find(
        (c) => c.id === 'claude_desktop',
      )!.getConfigPaths(ctx);
      return paths.some((p) => existsSync(dirname(p)) || existsSync(p));
    },
  },
  {
    id: 'gemini_cli',
    displayName: 'Gemini CLI / Antigravity',
    format: 'json',
    getConfigPaths: (ctx: SetupContext) => [
      join(ctx.home, '.gemini', 'config', 'mcp_config.json'),
    ],
    getSkillPaths: (ctx: SetupContext) => [
      join(ctx.home, '.gemini', 'config', 'skills', 'exoproc', 'SKILL.md'),
      join(ctx.home, '.gemini', 'antigravity', 'skills', 'exoproc', 'SKILL.md'),
      join(ctx.cwd, '.agents', 'skills', 'exoproc', 'SKILL.md'),
    ],
    detect: (ctx: SetupContext) =>
      existsSync(join(ctx.home, '.gemini')) ||
      existsSync(join(ctx.home, '.agents')) ||
      existsSync(join(ctx.cwd, '.agents')),
  },
  {
    id: 'cline',
    displayName: 'VS Code Cline / Roo Code',
    format: 'json',
    getConfigPaths: (ctx: SetupContext) => {
      const paths: string[] = [];
      const codeDir =
        ctx.platform === 'win32'
          ? join(
              ctx.env.APPDATA || join(ctx.home, 'AppData', 'Roaming'),
              'Code',
              'User',
              'globalStorage',
            )
          : ctx.platform === 'darwin'
            ? join(
                ctx.home,
                'Library',
                'Application Support',
                'Code',
                'User',
                'globalStorage',
              )
            : join(ctx.home, '.config', 'Code', 'User', 'globalStorage');

      paths.push(
        join(
          codeDir,
          'saoudrizwan.claude-dev',
          'settings',
          'cline_mcp_settings.json',
        ),
        join(
          codeDir,
          'rooveterinaryinc.roo-cline',
          'settings',
          'cline_mcp_settings.json',
        ),
      );
      if (existsSync(join(ctx.cwd, '.vscode'))) {
        paths.push(join(ctx.cwd, '.vscode', 'mcp.json'));
      }
      return paths;
    },
    detect: (ctx: SetupContext) => {
      const paths = SUPPORTED_CLIENTS.find(
        (c) => c.id === 'cline',
      )!.getConfigPaths(ctx);
      return paths.some((p) => existsSync(dirname(p)) || existsSync(p));
    },
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    format: 'json',
    getConfigPaths: (ctx: SetupContext) => [
      join(ctx.home, '.config', 'opencode', 'opencode.json'),
      join(ctx.home, '.config', 'opencode', 'mcp.json'),
    ],
    detect: (ctx: SetupContext) =>
      existsSync(join(ctx.home, '.config', 'opencode')),
  },
  {
    id: 'zed',
    displayName: 'Zed',
    format: 'zed',
    getConfigPaths: (ctx: SetupContext) => {
      if (ctx.platform === 'win32') {
        const appData = ctx.env.APPDATA || join(ctx.home, 'AppData', 'Roaming');
        return [join(appData, 'Zed', 'settings.json')];
      }
      return [join(ctx.home, '.config', 'zed', 'settings.json')];
    },
    detect: (ctx: SetupContext) => {
      const paths = SUPPORTED_CLIENTS.find(
        (c) => c.id === 'zed',
      )!.getConfigPaths(ctx);
      return paths.some((p) => existsSync(dirname(p)) || existsSync(p));
    },
  },
];
