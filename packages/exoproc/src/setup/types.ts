export interface SetupContext {
  home: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  cwd: string;
  command: string[];
}

export interface ClientDefinition {
  id: string;
  displayName: string;
  format: 'json' | 'zed';
  getConfigPaths: (ctx: SetupContext) => string[];
  getSkillPaths?: (ctx: SetupContext) => string[];
  detect: (ctx: SetupContext) => boolean;
}

export interface ClientConfigStatus {
  client: ClientDefinition;
  detected: boolean;
  configPath: string;
  alreadyConfigured: boolean;
  skillPaths: string[];
}

export interface SetupOptions {
  yes?: boolean;
  clients?: string[];
  dryRun?: boolean;
  command?: string[];
  skillOnly?: boolean;
  dev?: boolean;
}

export interface SetupSummary {
  configured: string[];
  alreadyCurrent: string[];
  failed: Array<{ client: string; error: string }>;
  skillsInstalled: string[];
  dryRun: boolean;
}
