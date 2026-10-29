import { existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { getAgentBytecodeSync, getAgentJarSync } from './agent-builder.js';
import { getRegisteredAgentContextFactory } from './loader.js';
import {
  generateObfuscationMappings,
  formatMappingsHumanReadable,
} from 'exoproc-jjit';
import {
  getOrCreateIpcServer,
  type IpcClientInfo,
  type IpcServer,
} from 'exoproc-ipc';

export interface AgentStatus {
  alive: boolean;
  pipePath: string;
  uptime: number;
  pid?: number;
  buildId?: string;
  targetName?: string;
  isStandalone?: boolean;
  targetJar?: string;
  classCount?: number;
}

export interface AgentEvalResult {
  success: boolean;
  result?: any;
  logs?: string[];
  error?: string;
}

export interface AgentDumpOptions {
  path?: string;
  format?: 'jar' | 'class' | 'mapping';
  javaVersion?: number;
  javaPath?: string;
  pipePath?: string;
  obfuscate?: boolean;
  dumpMappings?: boolean | string;
}

export interface AgentDumpResult {
  success: boolean;
  type: 'jar' | 'class' | 'mapping';
  path: string;
  size: number;
  javaVersion: number;
  obfuscated: boolean;
  className?: string;
  classesCount?: number;
  mappingsPath?: string;
  error?: string;
}

export interface AgentClientOptions {
  server?: IpcServer;
  pipePath?: string;
  name?: string;
  clientId?: string;
  buildId?: string;
  timeoutMs?: number;
}

/**
 * Zero-port Named Pipe / local socket controller for communicating with an injected Exoproc Java Agent.
 * Exoproc owns the IPC pipe server (`IpcServer`), and target JVM agents connect outward as clients.
 */
export class AgentClient {
  public readonly server: IpcServer;
  public readonly pipePath: string;
  public readonly clientId?: string;
  public readonly buildId?: string;
  public readonly timeoutMs: number;

  constructor(options: AgentClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.server =
      options.server ??
      getOrCreateIpcServer({
        pipePath: options.pipePath,
        name: options.name,
        timeoutMs: this.timeoutMs,
      });
    this.pipePath = this.server.pipePath;
    this.clientId = options.clientId;
    this.buildId = options.buildId;
  }

  /**
   * Starts listening on the underlying IPC pipe server if not already active.
   */
  public async listen(): Promise<string> {
    return await this.server.listen();
  }

  /**
   * Waits for an injected Java agent matching this client's filter to connect to the pipe.
   */
  public async waitForConnection(timeoutMs?: number): Promise<IpcClientInfo> {
    return await this.server.waitForClient(
      {
        kind: 'java-agent',
        clientId: this.clientId,
        buildId: this.buildId,
      },
      timeoutMs ?? this.timeoutMs,
    );
  }

  /**
   * Checks whether an agent is currently connected and responsive on the pipe.
   */
  public async isAlive(timeoutMs = 1500): Promise<boolean> {
    try {
      const clients = this.server.getClients({
        clientId: this.clientId,
        buildId: this.buildId,
      });
      if (clients.length === 0) return false;
      const res = await this.server.request<any>(
        'status',
        {},
        {
          clientId: this.clientId,
          buildId: this.buildId,
          timeoutMs,
        },
      );
      return Boolean(res?.alive !== false);
    } catch {
      return false;
    }
  }

  /**
   * Retrieves runtime status, active pipe path, PID, uptime, and target JVM details.
   */
  public async getStatus(): Promise<AgentStatus> {
    const res = await this.server.request<any>(
      'status',
      {},
      {
        clientId: this.clientId,
        buildId: this.buildId,
        timeoutMs: this.timeoutMs,
      },
    );
    if (!res || res.success === false) {
      throw new Error(res?.error || 'Agent status request failed');
    }
    return res as AgentStatus;
  }

  /**
   * Retrieves the running agent's unique build ID.
   */
  public async getBuildId(): Promise<string | undefined> {
    const status = await this.getStatus();
    return status.buildId;
  }

  /**
   * Executes a snippet inside the agent's script evaluation runtime.
   */
  public async eval(
    code: string,
    globals?: Record<string, any>,
    timeoutMs?: number,
  ): Promise<AgentEvalResult> {
    try {
      const res = await this.server.request<AgentEvalResult>(
        'eval',
        { code, globals },
        {
          clientId: this.clientId,
          buildId: this.buildId,
          timeoutMs: timeoutMs ?? this.timeoutMs,
        },
      );
      return res;
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || String(err),
        logs: [],
      };
    }
  }

  /**
   * Retrieves all loaded/inspected classes available to the agent.
   */
  public async getClasses(): Promise<string[]> {
    const res = await this.server.request<any>(
      'classes',
      {},
      {
        clientId: this.clientId,
        buildId: this.buildId,
        timeoutMs: this.timeoutMs,
      },
    );
    if (!res || res.success === false) {
      throw new Error(res?.error || 'Agent classes request failed');
    }
    return res.classes ?? [];
  }

  /**
   * Requests the connected Java agent to disconnect and stop its worker threads.
   */
  public async shutdown(): Promise<boolean> {
    try {
      const res = await this.server.request<any>(
        'shutdown',
        {},
        {
          clientId: this.clientId,
          buildId: this.buildId,
          timeoutMs: 5000,
        },
      );
      return Boolean(res?.success);
    } catch {
      return false;
    }
  }

  /**
   * Creates an async JavaContext reflection proxy connected directly to this agent over Named Pipe IPC.
   */
  public async getJavaContext(
    options: { mapper?: any; pool?: any } = {},
  ): Promise<any> {
    const factory = getRegisteredAgentContextFactory();
    if (!factory) {
      throw new Error(
        'Agent JavaContext factory is not registered. Import "bun-njava" before calling getJavaContext().',
      );
    }
    return factory({
      server: this.server,
      pipePath: this.pipePath,
      clientId: this.clientId,
      buildId: this.buildId,
      sync: false,
      mapper: options.mapper,
      pool: options.pool,
    });
  }

  /**
   * Dumps this agent's compiled binary (JAR or raw .class) and obfuscation mappings to disk.
   */
  public async dump(options: AgentDumpOptions = {}): Promise<AgentDumpResult> {
    return dumpAgent({ pipePath: this.pipePath, ...options });
  }
}

/**
 * Creates a new AgentClient instance.
 */
export function createAgentClient(options?: AgentClientOptions): AgentClient {
  return new AgentClient(options);
}

/**
 * Helper to directly evaluate code on a connected agent without manually instantiating a client.
 */
export async function evalAgent(
  code: string,
  options?: AgentClientOptions & {
    globals?: Record<string, any>;
    timeoutMs?: number;
  },
): Promise<AgentEvalResult> {
  const client = new AgentClient(options);
  return client.eval(code, options?.globals, options?.timeoutMs);
}

/**
 * Dumps the compiled Exoproc Java Agent as a .jar or .class file, optionally with Tiny v1 mappings.
 */
export async function dumpAgent(
  options: AgentDumpOptions = {},
): Promise<AgentDumpResult> {
  try {
    const javaVersion =
      options.javaVersion !== undefined ? Number(options.javaVersion) : 8;
    const obfuscate = options.obfuscate ?? true;

    const isMappingOnly =
      options.format === 'mapping' ||
      (options.path &&
        (options.path.toLowerCase().endsWith('.tiny') ||
          options.path.toLowerCase().endsWith('.txt')));

    if (isMappingOnly) {
      const rawRes = getAgentBytecodeSync({
        javaVersion,
        javaPath: options.javaPath,
        pipePath: options.pipePath,
        obfuscate: false,
      });
      const tiny = generateObfuscationMappings(rawRes.bytecode);

      let targetPath = options.path
        ? resolve(process.cwd(), options.path)
        : undefined;
      const defaultFileName = 'mappings.txt';

      if (targetPath) {
        if (existsSync(targetPath) && statSync(targetPath).isDirectory()) {
          targetPath = join(targetPath, defaultFileName);
        } else if (targetPath.endsWith('/') || targetPath.endsWith('\\')) {
          mkdirSync(targetPath, { recursive: true });
          targetPath = join(targetPath, defaultFileName);
        }
      } else {
        targetPath = resolve(process.cwd(), defaultFileName);
      }

      const parentDir = dirname(targetPath);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      const content = targetPath.endsWith('.tiny')
        ? tiny
        : formatMappingsHumanReadable(tiny);
      writeFileSync(targetPath, content, 'utf8');

      return {
        success: true,
        type: 'mapping',
        path: targetPath,
        size: Buffer.byteLength(content),
        javaVersion,
        obfuscated: true,
        mappingsPath: targetPath,
      };
    }

    let targetPath = options.path
      ? resolve(process.cwd(), options.path)
      : undefined;
    const isClass =
      options.format === 'class' ||
      (targetPath && targetPath.toLowerCase().endsWith('.class'));

    const defaultFileName = isClass
      ? 'Exoproc.class'
      : obfuscate
        ? `exoproc-agent-java${javaVersion}-obf.jar`
        : `exoproc-agent-java${javaVersion}.jar`;

    if (targetPath) {
      if (existsSync(targetPath) && statSync(targetPath).isDirectory()) {
        targetPath = join(targetPath, defaultFileName);
      } else if (targetPath.endsWith('/') || targetPath.endsWith('\\')) {
        mkdirSync(targetPath, { recursive: true });
        targetPath = join(targetPath, defaultFileName);
      }
    } else {
      targetPath = resolve(process.cwd(), defaultFileName);
    }

    const parentDir = dirname(targetPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    let mappingsPath: string | undefined;

    if (isClass) {
      const res = getAgentBytecodeSync({
        javaVersion,
        javaPath: options.javaPath,
        pipePath: options.pipePath,
        obfuscate,
      });

      writeFileSync(targetPath, res.bytecode);

      if (options.dumpMappings && res.mappings) {
        const mPath =
          typeof options.dumpMappings === 'string'
            ? resolve(process.cwd(), options.dumpMappings)
            : targetPath.replace(/\.class$/, '') + '-mappings.txt';
        const mParent = dirname(mPath);
        if (!existsSync(mParent)) {
          mkdirSync(mParent, { recursive: true });
        }
        const mContent = mPath.endsWith('.tiny')
          ? res.mappings
          : formatMappingsHumanReadable(res.mappings);
        writeFileSync(mPath, mContent, 'utf8');
        mappingsPath = mPath;
      }

      return {
        success: true,
        type: 'class',
        path: targetPath,
        size: res.bytecode.length,
        javaVersion: res.javaVersion,
        obfuscated: obfuscate,
        className: res.className,
        mappingsPath,
      };
    } else {
      const res = getAgentJarSync({
        javaVersion,
        javaPath: options.javaPath,
        pipePath: options.pipePath,
        outputPath: targetPath,
        obfuscate,
        force: true,
      });

      if (options.dumpMappings && res.mappings) {
        const mPath =
          typeof options.dumpMappings === 'string'
            ? resolve(process.cwd(), options.dumpMappings)
            : targetPath.replace(/\.jar$/, '') + '-mappings.txt';
        const mParent = dirname(mPath);
        if (!existsSync(mParent)) {
          mkdirSync(mParent, { recursive: true });
        }
        const mContent = mPath.endsWith('.tiny')
          ? res.mappings
          : formatMappingsHumanReadable(res.mappings);
        writeFileSync(mPath, mContent, 'utf8');
        mappingsPath = mPath;
      }

      return {
        success: true,
        type: 'jar',
        path: res.jarPath,
        size: res.jarBuffer.length,
        javaVersion: res.javaVersion,
        classesCount: res.classesCount,
        obfuscated: obfuscate,
        mappingsPath,
      };
    }
  } catch (err: any) {
    return {
      success: false,
      type:
        options.format === 'class'
          ? 'class'
          : options.format === 'mapping'
            ? 'mapping'
            : 'jar',
      path: options.path || '',
      size: 0,
      javaVersion:
        options.javaVersion !== undefined ? Number(options.javaVersion) : 8,
      obfuscated: options.obfuscate ?? true,
      error: err?.message || String(err),
    };
  }
}
