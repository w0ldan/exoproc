import { existsSync, readFileSync } from 'node:fs';
import {
  getAgentJar,
  getAgentJarSync,
  getAgentBytecode,
  getAgentBytecodeSync,
  loadAgentMappings,
  type AgentBytecodeResult,
  type AgentBuildResult,
} from './agent-builder.js';
import {
  findIpcServer,
  getOrCreateIpcServer,
  type IpcClientFilter,
  type IpcServer,
} from 'exoproc-ipc';

export type AgentContextFactory = (options: {
  server?: IpcServer;
  pipePath?: string;
  name?: string;
  clientId?: string;
  buildId?: string;
  timeoutMs?: number;
  sync?: boolean;
  mapper?: any;
  pool?: any;
}) => any;

let registeredAgentContextFactory: AgentContextFactory | null = null;

/**
 * Registers the JavaContext factory (`createAgentContext` from `bun-njava`)
 * so `njava-agent` can construct agent contexts without dynamic circular imports.
 */
export function registerAgentContextFactory(
  factory: AgentContextFactory,
): void {
  registeredAgentContextFactory = factory;
}

export function getRegisteredAgentContextFactory(): AgentContextFactory | null {
  return registeredAgentContextFactory;
}

export interface AgentInjectionOptions {
  /**
   * Existing IPC server hub for the injected agent to connect back to.
   */
  server?: IpcServer;

  /**
   * Custom Named Pipe name (e.g. "my_pipe" -> `\\.\pipe\my_pipe` on Windows).
   */
  name?: string;

  /**
   * Explicit Named Pipe / socket path override.
   */
  pipePath?: string;

  /**
   * Path to the compiled agent JAR on disk.
   * If omitted, dynamically compiled/retrieved via jjit & getAgentJar.
   */
  jarPath?: string;

  /**
   * Target Java major version if compilation is required (e.g. 8, 11, 17, 21).
   */
  targetVersion?: number;

  /**
   * Java binary executable path if compilation is required.
   */
  javaPath?: string;

  /**
   * Parent ClassLoader in Java.
   * If omitted, Thread.currentThread().getContextClassLoader() or ClassLoader.getSystemClassLoader() is used.
   */
  parentClassLoader?: any;

  /**
   * Max time in milliseconds to wait for the agent to connect to the IPC pipe.
   * Defaults to 10000ms.
   */
  timeoutMs?: number;

  /**
   * Whether to log detailed diagnostic messages during injection.
   */
  verbose?: boolean;

  /**
   * Whether to obfuscate the agent when compiling.
   */
  obfuscate?: boolean;

  /**
   * Tiny v1 obfuscation mappings or path to a .tiny file to merge with the runtime mapper.
   */
  mappings?: string;

  /**
   * Runtime mapper or registry into which this build's mappings will be automatically merged.
   */
  mapper?: any;

  /**
   * MappingPool into which this build's mappings will be automatically merged.
   */
  pool?: any;

  /**
   * Specific pre-built agent result (from getAgentJar or getAgentBytecode).
   * When provided, exactly this build and its mappings are used with zero re-compilation.
   */
  buildResult?: AgentBuildResult | AgentBytecodeResult;
}

export interface AgentInjectionResult {
  pipePath: string;
  server: IpcServer;
  clientId?: string;
  jarPath: string;
  urlLoader: any;
  agentClass: any;
  agentContext?: any;
  mappings?: string;
}

export interface AgentMemoryInjectionOptions {
  server?: IpcServer;
  name?: string;
  pipePath?: string;
  targetVersion?: number;
  javaPath?: string;
  classPath?: string;
  bytecode?: Uint8Array;
  className?: string;
  parentClassLoader?: any;
  timeoutMs?: number;
  verbose?: boolean;
  obfuscate?: boolean;
  mappings?: string;
  mapper?: any;
  pool?: any;
  buildResult?: AgentBytecodeResult | AgentBuildResult;
}

export interface AgentMemoryInjectionResult {
  pipePath: string;
  server: IpcServer;
  clientId?: string;
  className: string;
  agentClass: any;
  agentContext?: any;
  bytecode?: Uint8Array;
  mappings?: string;
}

/**
 * Fast zero-dependency parser that extracts the fully-qualified class name
 * from raw Java .class bytecode (0xCAFEBABE).
 */
export function extractClassNameFromClassBytes(
  bytes: Uint8Array,
): string | null {
  if (!bytes || bytes.length < 10) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== 0xcafebabe) return null;

  const cpCount = view.getUint16(8);
  let offset = 10;
  const cp = new Map<
    number,
    { tag: number; str?: string; nameIndex?: number }
  >();

  for (let i = 1; i < cpCount; i++) {
    if (offset >= bytes.length) break;
    const tag = bytes[offset++];
    if (tag === 1) {
      const len = view.getUint16(offset);
      offset += 2;
      const str = Buffer.from(bytes.subarray(offset, offset + len)).toString(
        'utf8',
      );
      offset += len;
      cp.set(i, { tag, str });
    } else if (tag === 7) {
      const nameIndex = view.getUint16(offset);
      offset += 2;
      cp.set(i, { tag, nameIndex });
    } else if (tag === 3 || tag === 4) {
      offset += 4;
    } else if (tag === 5 || tag === 6) {
      offset += 8;
      i++;
    } else if (tag === 8) {
      offset += 2;
    } else if (tag === 9 || tag === 10 || tag === 11) {
      offset += 4;
    } else if (tag === 12) {
      offset += 4;
    } else if (tag === 15) {
      offset += 3;
    } else if (tag === 16 || tag === 19 || tag === 20) {
      offset += 2;
    } else if (tag === 17 || tag === 18) {
      offset += 4;
    }
  }

  if (offset + 4 > bytes.length) return null;
  const thisClass = view.getUint16(offset + 2);
  const classEntry = cp.get(thisClass);
  if (!classEntry || !classEntry.nameIndex) return null;
  const nameEntry = cp.get(classEntry.nameIndex);
  if (!nameEntry || !nameEntry.str) return null;

  return nameEntry.str.replace(/\//g, '.');
}

function resolveInjectionServer(options: {
  server?: IpcServer;
  pipePath?: string;
  name?: string;
}): IpcServer {
  if (options.server) return options.server;
  return getOrCreateIpcServer({
    pipePath: options.pipePath,
    name: options.name,
  });
}

/**
 * Checks whether an agent is currently connected and responding on the specified IPC server/pipe.
 */
export async function isAgentRunning(
  serverOrPipe?: IpcServer | string,
  timeoutMs = 1000,
): Promise<boolean> {
  const srv =
    serverOrPipe && typeof serverOrPipe === 'object'
      ? serverOrPipe
      : findIpcServer(serverOrPipe);
  if (!srv) return false;
  if (srv.getClients({ kind: 'java-agent' }).length === 0) return false;
  return await srv.ping({ kind: 'java-agent', timeoutMs });
}

/**
 * Waits until an injected Java agent connects to the IPC pipe server.
 */
export async function waitForAgentReady(
  serverOrPipe?: IpcServer | string,
  timeoutMs = 10000,
  filter?: IpcClientFilter,
): Promise<boolean> {
  const srv =
    serverOrPipe && typeof serverOrPipe === 'object'
      ? serverOrPipe
      : getOrCreateIpcServer(
          typeof serverOrPipe === 'string'
            ? { pipePath: serverOrPipe }
            : undefined,
        );
  try {
    await srv.waitForClient({ kind: 'java-agent', ...filter }, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

/**
 * Injects the single consolidated Exoproc class directly into JVM memory
 * using ClassLoader.defineClass or JNI DefineClass and connects it back over Named Pipe IPC.
 *
 * ZERO disk files are written, ZERO jars are created, ZERO open TCP ports.
 */
export async function injectAgentInMemory(
  java: any,
  options: AgentMemoryInjectionOptions = {},
): Promise<AgentMemoryInjectionResult> {
  const server = resolveInjectionServer(options);
  await server.listen();
  const pipePath = server.pipePath;
  const timeoutMs = options.timeoutMs ?? 10000;
  const verbose = options.verbose ?? false;

  // 1. Get raw Exoproc single-class bytecode and exact build mappings
  let bytecode: Uint8Array;
  let className: string;
  let mappings = options.mappings;
  let buildId: string | undefined;

  if (options.classPath) {
    if (!existsSync(options.classPath)) {
      throw new Error(`Agent .class file not found at: ${options.classPath}`);
    }
    bytecode = new Uint8Array(readFileSync(options.classPath));
    className =
      options.className ||
      extractClassNameFromClassBytes(bytecode) ||
      'org.exoproc.njava.agent.utils.Exoproc';
  } else if (options.bytecode) {
    bytecode = options.bytecode;
    className =
      options.className ||
      extractClassNameFromClassBytes(bytecode) ||
      'org.exoproc.njava.agent.utils.Exoproc';
  } else if (options.buildResult && 'bytecode' in options.buildResult) {
    bytecode = options.buildResult.bytecode;
    className =
      options.className ||
      options.buildResult.className ||
      extractClassNameFromClassBytes(bytecode) ||
      'org.exoproc.njava.agent.utils.Exoproc';
    mappings = options.buildResult.mappings ?? mappings;
    buildId = options.buildResult.buildId;
  } else {
    if (verbose)
      console.log(
        `[njava-agent] Compiling/retrieving Exoproc bytecode for Java ${options.targetVersion ?? 'auto'}...`,
      );
    const buildRes = await getAgentBytecode({
      javaVersion: options.targetVersion,
      javaPath: options.javaPath,
      pipePath,
      obfuscate: options.obfuscate,
    });
    bytecode = buildRes.bytecode;
    className = options.className || buildRes.className;
    mappings = buildRes.mappings ?? mappings;
    buildId = buildRes.buildId;
  }

  // 2. Set pipe system property in the target JVM
  try {
    const System = java.type('java.lang.System');
    await System.setProperty('exoproc.pipe', pipePath);
  } catch (err: any) {
    if (verbose)
      console.warn(
        `[njava-agent] Warning setting exoproc.pipe: ${err?.message}`,
      );
  }

  // 3. Define class into target JVM memory (zero disk I/O, zero JARs)
  let agentClass: any = null;

  const bridgeAny = java.bridge as any;
  if (
    typeof bridgeAny?.defineClass === 'function' ||
    typeof bridgeAny?.defineClassSync === 'function'
  ) {
    try {
      if (verbose)
        console.log(
          `[njava-agent] Defining ${className} via JNI DefineClass...`,
        );
      if (typeof bridgeAny.defineClassSync === 'function') {
        bridgeAny.defineClassSync(className, bytecode);
      } else {
        await bridgeAny.defineClass(className, bytecode);
      }
      agentClass = java.type(className);
    } catch (err: any) {
      if (verbose)
        console.warn(
          `[njava-agent] JNI DefineClass failed: ${err?.message}, trying reflection...`,
        );
    }
  }

  if (!agentClass) {
    try {
      const ClassLoader = java.type('java.lang.ClassLoader');
      const Thread = java.type('java.lang.Thread');

      let targetLoader = options.parentClassLoader;
      if (!targetLoader) {
        try {
          const cur = await Thread.currentThread();
          targetLoader = await cur.getContextClassLoader();
        } catch {}
      }
      if (!targetLoader) {
        try {
          targetLoader = await ClassLoader.getSystemClassLoader();
        } catch {}
      }

      const b64 = Buffer.from(bytecode).toString('base64');
      let bytesInJava: any = null;

      try {
        const Base64 = java.type('java.util.Base64');
        const decoder = await Base64.getDecoder();
        bytesInJava = await decoder.decode(b64);
      } catch {
        try {
          const DatatypeConverter = java.type(
            'javax.xml.bind.DatatypeConverter',
          );
          bytesInJava = await DatatypeConverter.parseBase64Binary(b64);
        } catch {}
      }

      if (bytesInJava) {
        let currCl = await targetLoader.getClass();
        let defMethod: any = null;
        while (currCl && !defMethod) {
          try {
            const methods = await currCl.getDeclaredMethods();
            for (const m of methods) {
              if ((await m.getName()) === 'defineClass') {
                const pts = await m.getParameterTypes();
                if (
                  pts.length === 4 &&
                  (await pts[0].getName()) === 'java.lang.String'
                ) {
                  defMethod = m;
                  break;
                }
              }
            }
          } catch {}
          try {
            currCl = await currCl.getSuperclass();
          } catch {
            break;
          }
        }

        if (defMethod) {
          await defMethod.setAccessible(true);
          agentClass = await defMethod.invoke(
            targetLoader,
            className,
            bytesInJava,
            0,
            bytecode.length,
          );
        }
      }
    } catch (err: any) {
      if (verbose)
        console.warn(
          `[njava-agent] Reflection defineClass failed: ${err?.message}`,
        );
    }
  }

  if (!agentClass) {
    try {
      agentClass = java.type(className);
    } catch {}
  }

  if (!agentClass) {
    throw new Error(
      `Failed to define in-memory agent class ${className} in target JVM`,
    );
  }

  // 4. Invoke Exoproc.start(pipePath)
  if (verbose)
    console.log(`[njava-agent] Starting ${className} -> pipe ${pipePath}...`);
  let invoked = false;
  try {
    if (typeof agentClass.start === 'function') {
      await agentClass.start(pipePath);
      invoked = true;
    }
  } catch {}

  if (!invoked) {
    try {
      const StringCls = java.type('java.lang.String');
      const startMethod = await agentClass.getMethod(
        'start',
        StringCls.class ?? StringCls,
      );
      await startMethod.invoke(null, pipePath);
      invoked = true;
    } catch (err: any) {
      if (verbose)
        console.warn(`[njava-agent] Invocation error: ${err?.message}`);
    }
  }

  // 5. Wait for agent client handshake on the Named Pipe
  const connectedClient = await server.waitForClient(
    buildId ? { kind: 'java-agent', buildId } : { kind: 'java-agent' },
    timeoutMs,
  );

  if (verbose)
    console.log(
      `[njava-agent] In-memory agent connected on ${pipePath} (clientId=${connectedClient.clientId})!`,
    );

  // 6. Connect async agent context
  let agentContext: any = null;
  try {
    if (registeredAgentContextFactory) {
      agentContext = registeredAgentContextFactory({
        server,
        pipePath,
        clientId: connectedClient.clientId,
        buildId: connectedClient.buildId,
        sync: false,
      });
    }
  } catch {}

  // Merge build's exact mappings directly into runtime mapper / pool
  const targetMapper =
    options.mapper ?? options.pool ?? java?.mapper ?? java?.pool;
  if (targetMapper && mappings) {
    loadAgentMappings(targetMapper, mappings);
  }

  return {
    pipePath,
    server,
    clientId: connectedClient.clientId,
    className,
    bytecode,
    agentClass,
    agentContext,
    mappings,
  };
}

/**
 * Synchronous twin of injectAgentInMemory (kicks off pipe listener and injects bytecode synchronously).
 */
export function injectAgentInMemorySync(
  java: any,
  options: AgentMemoryInjectionOptions = {},
): AgentMemoryInjectionResult {
  const server = resolveInjectionServer(options);
  void server.listen();
  const pipePath = server.pipePath;

  let bytecode: Uint8Array;
  let className: string;
  let mappings = options.mappings;

  if (options.classPath) {
    if (!existsSync(options.classPath)) {
      throw new Error(`Agent .class file not found at: ${options.classPath}`);
    }
    bytecode = new Uint8Array(readFileSync(options.classPath));
    className =
      options.className ||
      extractClassNameFromClassBytes(bytecode) ||
      'org.exoproc.njava.agent.utils.Exoproc';
  } else if (options.bytecode) {
    bytecode = options.bytecode;
    className =
      options.className ||
      extractClassNameFromClassBytes(bytecode) ||
      'org.exoproc.njava.agent.utils.Exoproc';
  } else if (options.buildResult && 'bytecode' in options.buildResult) {
    bytecode = options.buildResult.bytecode;
    className =
      options.className ||
      options.buildResult.className ||
      extractClassNameFromClassBytes(bytecode) ||
      'org.exoproc.njava.agent.utils.Exoproc';
    mappings = options.buildResult.mappings ?? mappings;
  } else {
    const buildRes = getAgentBytecodeSync({
      javaVersion: options.targetVersion,
      javaPath: options.javaPath,
      pipePath,
      obfuscate: options.obfuscate,
    });
    bytecode = buildRes.bytecode;
    className = options.className || buildRes.className;
    mappings = buildRes.mappings ?? mappings;
  }

  try {
    const System = java.type('java.lang.System');
    System.setProperty('exoproc.pipe', pipePath);
  } catch {}

  let agentClass: any = null;
  const bridgeAny = java.bridge as any;
  if (typeof bridgeAny?.defineClassSync === 'function') {
    try {
      bridgeAny.defineClassSync(className, bytecode);
      agentClass = java.type(className);
    } catch {}
  }

  if (!agentClass) {
    try {
      const ClassLoader = java.type('java.lang.ClassLoader');
      const Thread = java.type('java.lang.Thread');

      let targetLoader = options.parentClassLoader;
      if (!targetLoader) {
        try {
          targetLoader = Thread.currentThread().getContextClassLoader();
        } catch {}
      }
      if (!targetLoader) {
        try {
          targetLoader = ClassLoader.getSystemClassLoader();
        } catch {}
      }

      const b64 = Buffer.from(bytecode).toString('base64');
      let bytesInJava: any = null;
      try {
        const Base64 = java.type('java.util.Base64');
        bytesInJava = Base64.getDecoder().decode(b64);
      } catch {
        try {
          const DatatypeConverter = java.type(
            'javax.xml.bind.DatatypeConverter',
          );
          bytesInJava = DatatypeConverter.parseBase64Binary(b64);
        } catch {}
      }

      if (bytesInJava) {
        let currCl = targetLoader.getClass();
        let defMethod: any = null;
        while (currCl && !defMethod) {
          try {
            const methods = currCl.getDeclaredMethods();
            for (const m of methods) {
              if (m.getName() === 'defineClass') {
                const pts = m.getParameterTypes();
                if (
                  pts.length === 4 &&
                  pts[0].getName() === 'java.lang.String'
                ) {
                  defMethod = m;
                  break;
                }
              }
            }
          } catch {}
          try {
            currCl = currCl.getSuperclass();
          } catch {
            break;
          }
        }

        if (defMethod) {
          defMethod.setAccessible(true);
          agentClass = defMethod.invoke(
            targetLoader,
            className,
            bytesInJava,
            0,
            bytecode.length,
          );
        }
      }
    } catch {}
  }

  if (!agentClass) {
    try {
      agentClass = java.type(className);
    } catch {}
  }

  if (!agentClass) {
    throw new Error(
      `Failed to define in-memory agent class ${className} in target JVM`,
    );
  }

  let invoked = false;
  try {
    if (typeof agentClass.start === 'function') {
      agentClass.start(pipePath);
      invoked = true;
    }
  } catch {}

  if (!invoked) {
    try {
      const StringCls = java.type('java.lang.String');
      const startMethod = agentClass.getMethod(
        'start',
        StringCls.class ?? StringCls,
      );
      startMethod.invoke(null, pipePath);
    } catch {}
  }

  const targetMapper =
    options.mapper ?? options.pool ?? java?.mapper ?? java?.pool;
  if (targetMapper && mappings) {
    loadAgentMappings(targetMapper, mappings);
  }

  return {
    pipePath,
    server,
    className,
    bytecode,
    agentClass,
    mappings,
  };
}

/**
 * Universal agent injector:
 * Tries fast in-memory bytecode injection first (zero disk writes, zero JAR files).
 * If in-memory injection fails, falls back seamlessly to URLClassLoader with a compiled JAR.
 */
export async function injectAgent(
  java: any,
  options: AgentInjectionOptions = {},
): Promise<AgentInjectionResult> {
  try {
    const memRes = await injectAgentInMemory(java, options);
    return {
      pipePath: memRes.pipePath,
      server: memRes.server,
      clientId: memRes.clientId,
      jarPath: ':memory:',
      urlLoader: null,
      agentClass: memRes.agentClass,
      agentContext: memRes.agentContext,
      mappings: memRes.mappings,
    };
  } catch (err: any) {
    if (options.verbose) {
      console.warn(
        `[njava-agent] In-memory injection failed (${err?.message}), falling back to URLClassLoader...`,
      );
    }
    return await injectAgentViaClassLoader(java, options);
  }
}

/**
 * Synchronous twin of injectAgent.
 */
export function injectAgentSync(
  java: any,
  options: AgentInjectionOptions = {},
): AgentInjectionResult {
  try {
    const memRes = injectAgentInMemorySync(java, options);
    return {
      pipePath: memRes.pipePath,
      server: memRes.server,
      jarPath: ':memory:',
      urlLoader: null,
      agentClass: memRes.agentClass,
      mappings: memRes.mappings,
    };
  } catch (err: any) {
    if (options.verbose) {
      console.warn(
        `[njava-agent] In-memory injection failed (${err?.message}), falling back to URLClassLoader...`,
      );
    }
    return injectAgentViaClassLoaderSync(java, options);
  }
}

/**
 * Dynamically injects and starts the Exoproc Java Agent inside a running JVM using URLClassLoader.
 */
export async function injectAgentViaClassLoader(
  java: any,
  options: AgentInjectionOptions = {},
): Promise<AgentInjectionResult> {
  const server = resolveInjectionServer(options);
  await server.listen();
  const pipePath = server.pipePath;
  const timeoutMs = options.timeoutMs ?? 10000;
  const verbose = options.verbose ?? false;

  // 1. Resolve or compile agent jar
  let jarPath = options.jarPath;
  let mappings = options.mappings;
  let buildId: string | undefined;

  if (options.buildResult && 'jarPath' in options.buildResult) {
    jarPath = options.buildResult.jarPath;
    mappings = options.buildResult.mappings ?? mappings;
    buildId = options.buildResult.buildId;
  } else if (!jarPath || !existsSync(jarPath)) {
    if (verbose)
      console.log(
        `[njava-agent] Compiling/resolving agent JAR for Java ${options.targetVersion ?? 'auto'}...`,
      );
    const buildRes = await getAgentJar({
      javaVersion: options.targetVersion,
      javaPath: options.javaPath,
      pipePath,
      obfuscate: options.obfuscate,
    });
    jarPath = buildRes.jarPath;
    mappings = buildRes.mappings ?? mappings;
    buildId = buildRes.buildId;
  } else if (jarPath && !mappings) {
    const tinyPath = jarPath.replace(/\.jar$/, '.tiny');
    if (existsSync(tinyPath)) {
      try {
        mappings = readFileSync(tinyPath, 'utf8');
      } catch {}
    }
  }

  if (verbose) console.log(`[njava-agent] Using agent JAR: ${jarPath}`);

  // 2. Set pipe system property in the target JVM
  try {
    const System = java.type('java.lang.System');
    await System.setProperty('exoproc.pipe', pipePath);
  } catch (err: any) {
    if (verbose)
      console.warn(
        `[njava-agent] Warning setting exoproc.pipe: ${err?.message}`,
      );
  }

  // 3. Resolve Java reflection classes in target JVM
  const File = java.type('java.io.File');
  const URLClassLoader = java.type('java.net.URLClassLoader');
  const ClassLoader = java.type('java.lang.ClassLoader');
  const Thread = java.type('java.lang.Thread');

  const jarFile = await new File(jarPath);
  const jarUri = await jarFile.toURI();
  const jarUrl = await jarUri.toURL();
  const urls =
    typeof java.to === 'function'
      ? await java.to([jarUrl], 'java.net.URL[]')
      : [jarUrl];

  let parentLoader = options.parentClassLoader;
  if (!parentLoader) {
    try {
      const curThread = await Thread.currentThread();
      parentLoader = await curThread.getContextClassLoader?.();
    } catch {}
  }
  if (!parentLoader) {
    try {
      parentLoader = await ClassLoader.getSystemClassLoader();
    } catch {}
  }

  if (verbose)
    console.log(`[njava-agent] Instantiating URLClassLoader for agent JAR...`);

  const urlLoader = await new URLClassLoader(urls, parentLoader);

  if (verbose) console.log(`[njava-agent] Loading agent class into JVM...`);
  let agentClass: any = null;
  try {
    agentClass = await urlLoader.loadClass(
      'org.exoproc.njava.agent.utils.Exoproc',
    );
  } catch {
    agentClass = await urlLoader.loadClass(
      'org.exoproc.njava.agent.NJavaAgent',
    );
  }

  // 6. Invoke start(pipePath, parentLoader) on agent class
  if (verbose)
    console.log(`[njava-agent] Invoking agent.start(${pipePath})...`);
  let invoked = false;

  try {
    const methods =
      typeof agentClass.getMethods === 'function'
        ? await agentClass.getMethods()
        : [];
    for (const m of methods) {
      const name = typeof m.getName === 'function' ? await m.getName() : m.name;
      if (name === 'start') {
        const paramTypes =
          typeof m.getParameterTypes === 'function'
            ? await m.getParameterTypes()
            : [];
        if (paramTypes.length === 2) {
          const invArgs =
            typeof java.to === 'function'
              ? await java.to([pipePath, parentLoader], 'java.lang.Object[]')
              : [pipePath, parentLoader];
          await m.invoke(null, invArgs);
          invoked = true;
          break;
        } else if (paramTypes.length === 1 && !invoked) {
          const invArgs =
            typeof java.to === 'function'
              ? await java.to([pipePath], 'java.lang.Object[]')
              : [pipePath];
          await m.invoke(null, invArgs);
          invoked = true;
        } else if (paramTypes.length === 0 && !invoked) {
          const invArgs =
            typeof java.to === 'function'
              ? await java.to([], 'java.lang.Object[]')
              : [];
          await m.invoke(null, invArgs);
          invoked = true;
        }
      }
    }
  } catch (err: any) {
    if (verbose)
      console.warn(
        `[njava-agent] Direct reflection invocation failed: ${err?.message}, trying fallback...`,
      );
  }

  if (!invoked) {
    try {
      if (typeof agentClass.start === 'function') {
        await agentClass.start(pipePath);
        invoked = true;
      }
    } catch {}
  }

  if (verbose)
    console.log(
      `[njava-agent] Waiting for agent to connect on pipe ${pipePath}...`,
    );
  const connectedClient = await server.waitForClient(
    buildId ? { kind: 'java-agent', buildId } : { kind: 'java-agent' },
    timeoutMs,
  );

  if (verbose)
    console.log(`[njava-agent] Agent connected on pipe ${pipePath}!`);

  let agentContext: any = null;
  try {
    if (registeredAgentContextFactory) {
      agentContext = registeredAgentContextFactory({
        server,
        pipePath,
        clientId: connectedClient.clientId,
        buildId: connectedClient.buildId,
        sync: false,
      });
    }
  } catch {}

  const targetMapper =
    options.mapper ?? options.pool ?? java?.mapper ?? java?.pool;
  if (targetMapper && mappings) {
    loadAgentMappings(targetMapper, mappings);
  }

  return {
    pipePath,
    server,
    clientId: connectedClient.clientId,
    jarPath,
    urlLoader,
    agentClass,
    agentContext,
    mappings,
  };
}

/**
 * Synchronous version of injectAgentViaClassLoader.
 */
export function injectAgentViaClassLoaderSync(
  java: any,
  options: AgentInjectionOptions = {},
): AgentInjectionResult {
  const server = resolveInjectionServer(options);
  void server.listen();
  const pipePath = server.pipePath;

  let jarPath = options.jarPath;
  let mappings = options.mappings;

  if (options.buildResult && 'jarPath' in options.buildResult) {
    jarPath = options.buildResult.jarPath;
    mappings = options.buildResult.mappings ?? mappings;
  } else if (!jarPath || !existsSync(jarPath)) {
    const buildRes = getAgentJarSync({
      javaVersion: options.targetVersion,
      javaPath: options.javaPath,
      pipePath,
      obfuscate: options.obfuscate,
    });
    jarPath = buildRes.jarPath;
    mappings = buildRes.mappings ?? mappings;
  } else if (jarPath && !mappings) {
    const tinyPath = jarPath.replace(/\.jar$/, '.tiny');
    if (existsSync(tinyPath)) {
      try {
        mappings = readFileSync(tinyPath, 'utf8');
      } catch {}
    }
  }

  try {
    const System = java.type('java.lang.System');
    System.setProperty('exoproc.pipe', pipePath);
  } catch {}

  const File = java.type('java.io.File');
  const URLClassLoader = java.type('java.net.URLClassLoader');
  const ClassLoader = java.type('java.lang.ClassLoader');
  const Thread = java.type('java.lang.Thread');

  const jarFile = new File(jarPath);
  const jarUrl = jarFile.toURI().toURL();
  const urls =
    typeof java.to === 'function'
      ? java.to([jarUrl], 'java.net.URL[]')
      : [jarUrl];

  let parentLoader = options.parentClassLoader;
  if (!parentLoader) {
    try {
      const curThread = Thread.currentThread();
      parentLoader = curThread.getContextClassLoader?.();
    } catch {}
  }
  if (!parentLoader) {
    try {
      parentLoader = ClassLoader.getSystemClassLoader();
    } catch {}
  }

  const urlLoader = new URLClassLoader(urls, parentLoader);
  let agentClass: any = null;
  try {
    agentClass = urlLoader.loadClass('org.exoproc.njava.agent.utils.Exoproc');
  } catch {
    agentClass = urlLoader.loadClass('org.exoproc.njava.agent.NJavaAgent');
  }

  let invoked = false;
  try {
    const methods =
      typeof agentClass.getMethods === 'function'
        ? agentClass.getMethods()
        : [];
    for (const m of methods) {
      const name = typeof m.getName === 'function' ? m.getName() : m.name;
      if (name === 'start') {
        const paramTypes =
          typeof m.getParameterTypes === 'function'
            ? m.getParameterTypes()
            : [];
        if (paramTypes.length === 2) {
          const invArgs =
            typeof java.to === 'function'
              ? java.to([pipePath, parentLoader], 'java.lang.Object[]')
              : [pipePath, parentLoader];
          m.invoke(null, invArgs);
          invoked = true;
          break;
        } else if (paramTypes.length === 1 && !invoked) {
          const invArgs =
            typeof java.to === 'function'
              ? java.to([pipePath], 'java.lang.Object[]')
              : [pipePath];
          m.invoke(null, invArgs);
          invoked = true;
        } else if (paramTypes.length === 0 && !invoked) {
          const invArgs =
            typeof java.to === 'function'
              ? java.to([], 'java.lang.Object[]')
              : [];
          m.invoke(null, invArgs);
          invoked = true;
        }
      }
    }
  } catch {}

  if (!invoked) {
    try {
      if (typeof agentClass.start === 'function') {
        agentClass.start(pipePath);
      }
    } catch {}
  }

  const targetMapper =
    options.mapper ?? options.pool ?? java?.mapper ?? java?.pool;
  if (targetMapper && mappings) {
    loadAgentMappings(targetMapper, mappings);
  }

  return {
    pipePath,
    server,
    jarPath,
    urlLoader,
    agentClass,
    mappings,
  };
}
