import { existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { getAgentBytecodeSync, getAgentJarSync } from './agent-builder.js';
import {
  generateObfuscationMappings,
  formatMappingsHumanReadable,
} from 'exoproc-jjit';

export interface AgentStatus {
  alive: boolean;
  port: number;
  uptime: number;
  buildId?: string;
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
  host?: string;
  port?: number;
  timeoutMs?: number;
}

function timeoutSignal(ms: number): any {
  if (typeof (AbortSignal as any)?.timeout === 'function') {
    return (AbortSignal as any).timeout(ms);
  }
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}

/**
 * Universal HTTP Client for communicating with the NJava Agent (Exoproc.java).
 * Runs completely cross-platform on any OS without requiring Windows or native bindings.
 */
export class AgentClient {
  public readonly host: string;
  public readonly port: number;
  public readonly baseUrl: string;
  public readonly timeoutMs: number;

  constructor(options: AgentClientOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 43378;
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.baseUrl = `http://${this.host}:${this.port}`;
  }

  /**
   * Checks whether the agent HTTP server is currently alive and responsive.
   */
  public async isAlive(timeoutMs = 1500): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/status`, {
        signal: timeoutSignal(timeoutMs),
      });
      if (res.ok) {
        const json = (await res.json()) as any;
        return Boolean(json.alive !== false);
      }
    } catch {}
    return false;
  }

  /**
   * Retrieves runtime status, active port, uptime, and target JVM details.
   */
  public async getStatus(): Promise<AgentStatus> {
    const res = await fetch(`${this.baseUrl}/status`, {
      signal: timeoutSignal(this.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Agent status failed: HTTP ${res.status}`);
    }
    return (await res.json()) as AgentStatus;
  }

  /**
   * Retrieves the running agent's unique build ID.
   */
  public async getBuildId(): Promise<string | undefined> {
    const status = await this.getStatus();
    return status.buildId;
  }

  /**
   * Executes a JavaScript snippet inside the agent's embedded Nashorn runtime.
   */
  public async eval(
    code: string,
    globals?: Record<string, any>,
    timeoutMs?: number,
  ): Promise<AgentEvalResult> {
    try {
      const res = await fetch(`${this.baseUrl}/eval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, globals }),
        signal: timeoutSignal(timeoutMs ?? this.timeoutMs),
      });
      if (!res.ok) {
        return {
          success: false,
          error: `Agent eval HTTP ${res.status}`,
          logs: [],
        };
      }
      return (await res.json()) as AgentEvalResult;
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
    const res = await fetch(`${this.baseUrl}/classes`, {
      signal: timeoutSignal(this.timeoutMs),
    });
    if (!res.ok) {
      throw new Error(`Agent classes failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as any;
    return json.classes ?? [];
  }

  /**
   * Requests the agent HTTP server to stop and shut down.
   */
  public async shutdown(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/shutdown`, {
        signal: timeoutSignal(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Creates a JavaContext reflection proxy connected directly to this agent over HTTP.
   */
  public async getJavaContext(
    options: { sync?: boolean; mapper?: any; pool?: any } = {},
  ): Promise<any> {
    const njavaPkg = 'bun-njava';
    const { createAgentContext } = (await import(njavaPkg)) as any;
    return createAgentContext({
      host: this.host,
      port: this.port,
      sync: options.sync ?? true,
      mapper: options.mapper,
      pool: options.pool,
    });
  }

  /**
   * Dumps this agent's compiled binary (JAR or raw .class) and obfuscation mappings to disk.
   */
  public async dump(options: AgentDumpOptions = {}): Promise<AgentDumpResult> {
    return dumpAgent(options);
  }
}

/**
 * Creates a new AgentClient instance.
 */
export function createAgentClient(options?: AgentClientOptions): AgentClient {
  return new AgentClient(options);
}

/**
 * Helper to directly evaluate code on an agent without manually instantiating a client.
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
        ? `njava-agent-java${javaVersion}-obf.jar`
        : `njava-agent-java${javaVersion}.jar`;

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
