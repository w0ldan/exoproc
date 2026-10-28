import type {
  Win64Machine,
  Win64Process,
  Win64Thread,
} from './win64-machine.js';
import type { X64Registers } from './types.js';
import type { Win32Console } from './console.js';
import { WIN32_WORKSPACE_PATH } from './file-system.js';

/**
 * Resolves host Node.js modules through dynamic imports. This keeps the
 * bridge's own filesystem/process operations distinct from modules imported
 * by guest code, which the execution bundler redirects to simulation shims.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamicImport = new Function('s', 'return import(s)') as (
  s: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => Promise<any>;

interface HostDirectoryEntry {
  readonly name: string;
  isDirectory(): boolean;
}
interface HostFs {
  mkdtempSync(prefix: string): string;
  readdirSync(
    path: string | URL,
    options: { withFileTypes: true },
  ): readonly HostDirectoryEntry[];
  readFileSync(path: string | URL, encoding: string): string;
  rmSync(path: string, options: { recursive: true; force: true }): void;
  writeFileSync(path: string, data: string, encoding: string): void;
}
interface HostExecutorProcess {
  on(event: 'message', listener: (response: WorkerResponse) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number | null) => void): this;
  terminate(): void;
}
interface HostOs {
  tmpdir(): string;
}
interface HostPath {
  join(...parts: string[]): string;
}
interface HostUrl {
  pathToFileURL(path: string): URL;
}

interface HostReadableStream {
  on(event: 'data', listener: (chunk: Uint8Array | string) => void): this;
}
interface HostSpawnedProcess {
  readonly stdout: HostReadableStream;
  readonly stderr: HostReadableStream;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number | null) => void): this;
  kill(): void;
}
interface HostChildProcess {
  spawn(
    command: string,
    args: readonly string[],
    options: {
      stdio: readonly ['ignore', 'pipe', 'pipe'];
      env?: Readonly<Record<string, string>>;
    },
  ): HostSpawnedProcess;
}

const hostEnvironment: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  ),
);
const hostNodeExecutable =
  hostEnvironment.NODE_EXEC_PATH ??
  (process.versions?.bun ? 'node' : process.execPath);

const hostFsCache: { value?: HostFs } = {};

const hostOsCache: { value?: HostOs } = {};
const hostPathCache: { value?: HostPath } = {};
const hostUrlCache: { value?: HostUrl } = {};

const hostChildProcessCache: { value?: HostChildProcess } = {};

async function hostFs(): Promise<HostFs> {
  if (!hostFsCache.value)
    hostFsCache.value = (await dynamicImport('node:fs')) as HostFs;
  return hostFsCache.value;
}

async function hostOs(): Promise<HostOs> {
  if (!hostOsCache.value)
    hostOsCache.value = (await dynamicImport('node:os')) as HostOs;
  return hostOsCache.value;
}
async function hostPath(): Promise<HostPath> {
  if (!hostPathCache.value)
    hostPathCache.value = (await dynamicImport('node:path')) as HostPath;
  return hostPathCache.value;
}

async function hostUrl(): Promise<HostUrl> {
  if (!hostUrlCache.value)
    hostUrlCache.value = (await dynamicImport('node:url')) as HostUrl;
  return hostUrlCache.value;
}

async function hostChildProcess(): Promise<HostChildProcess> {
  if (!hostChildProcessCache.value) {
    hostChildProcessCache.value = (await dynamicImport(
      'node:child_process',
    )) as HostChildProcess;
  }
  return hostChildProcessCache.value;
}

const CHILD_RESPONSE_PREFIX = '__EXOPROC_NODE_RESPONSE__';
const nodeHostDebugEnabled = hostEnvironment.EXOPROC_SIMULATE_DEBUG === '1';

function nodeHostDebug(message: string): void {
  if (nodeHostDebugEnabled) console.error(`[node-host] ${message}`);
}

async function createHostExecutorProcess(
  filename: string,
  request: WorkerRequest,
): Promise<HostExecutorProcess> {
  const [childProcess, fs, os, p] = await Promise.all([
    hostChildProcess(),
    hostFs(),
    hostOs(),
    hostPath(),
  ]);
  const requestDirectory = fs.mkdtempSync(
    p.join(os.tmpdir(), 'exoproc-node-request-'),
  );
  const requestPath = p.join(requestDirectory, 'request.json');
  fs.writeFileSync(requestPath, JSON.stringify(request), 'utf8');
  const child = childProcess.spawn(
    hostNodeExecutable,
    [filename, requestPath],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: hostEnvironment,
    },
  );
  const messageListeners: Array<(response: WorkerResponse) => void> = [];
  const errorListeners: Array<(error: Error) => void> = [];
  let stdoutBuffer = '';
  let stderrBuffer = '';

  child.stderr.on('data', (chunk) => {
    const text = Buffer.from(chunk).toString('utf8');
    stderrBuffer += text;
    nodeHostDebug(`child stderr: ${text.trim()}`);
  });
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += Buffer.from(chunk).toString('utf8');
    let separator = stdoutBuffer.indexOf('\n');
    while (separator !== -1) {
      const line = stdoutBuffer.slice(0, separator).trim();
      stdoutBuffer = stdoutBuffer.slice(separator + 1);
      separator = stdoutBuffer.indexOf('\n');
      nodeHostDebug(`child stdout: ${line.slice(0, 200)}`);
      if (!line.startsWith(CHILD_RESPONSE_PREFIX)) continue;
      try {
        const response = JSON.parse(
          line.slice(CHILD_RESPONSE_PREFIX.length),
        ) as WorkerResponse;
        for (const listener of messageListeners) listener(response);
      } catch (error) {
        const parseError = new Error(
          `node-executor returned an invalid response: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        for (const listener of errorListeners) listener(parseError);
      }
    }
  });

  const cleanupRequest = () => {
    fs.rmSync(requestDirectory, { recursive: true, force: true });
  };
  const worker: HostExecutorProcess = {
    on: (event, listener) => {
      if (event === 'message') {
        messageListeners.push(listener as (response: WorkerResponse) => void);
      } else if (event === 'error') {
        const errorListener = listener as (error: Error) => void;
        errorListeners.push(errorListener);
        child.on('error', (error) => {
          cleanupRequest();
          errorListener(error);
        });
      } else {
        const exitListener = listener as (code: number | null) => void;
        child.on('exit', (code) => {
          cleanupRequest();
          if (code !== 0 && stderrBuffer.trim()) {
            for (const errorListener of errorListeners) {
              errorListener(
                new Error(
                  `node-executor exited with code ${code}: ${stderrBuffer.trim()}`,
                ),
              );
            }
          }
          exitListener(code);
        });
      }
      return worker;
    },
    terminate: () => {
      cleanupRequest();
      child.kill();
    },
  };
  return worker;
}

export interface NodeHostBridgeOptions {
  /**
   * Override the directory where the Node executor bootstrap is written.
   * The legacy option name is retained for API compatibility. The default is
   * a fresh `os.tmpdir()` subdirectory per bridge.
   */
  readonly workerDirectory?: string;
}

export interface NodeExecutionRequest {
  readonly code?: string;
  readonly scriptPath?: string;
  readonly testMode?: boolean;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly inputType?: 'module' | 'commonjs';
  readonly env?: Readonly<Record<string, string>>;
}

export interface NodeExecutionResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface PreparedNodeExecutionRequest extends NodeExecutionRequest {
  readonly temporaryDirectory?: string;
}

interface WorkerResponse {
  readonly id: number;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface WorkerRuntimeBindings {
  readonly setupUrl: string;
  readonly aliases: Readonly<Record<string, string>>;
}

interface WorkerRequest {
  readonly id: number;
  readonly runtime?: WorkerRuntimeBindings;
  readonly code?: string;
  readonly scriptPath?: string;
  readonly testMode: boolean;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly inputType: 'module' | 'commonjs';
  readonly env: Readonly<Record<string, string>>;
}

const WORKER_LOADER_SOURCE = `import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { tmpdir } from 'node:os';
import { join, resolve as hostResolve } from 'node:path';
import { mkdtemp, readFile as hostReadFile, rm, writeFile } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { run as runNodeTests } from 'node:test';
import readline from 'node:readline';

const customRequire = createRequire(import.meta.url);
let simulationInstalled = false;

async function installSimulation(runtime) {
  if (simulationInstalled) return;
  const simulatedBuiltins = new Set(['node:fs', 'fs', 'node:os', 'os']);
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const target = runtime.aliases[specifier];
      if (!target) return nextResolve(specifier, context);
      if (
        simulatedBuiltins.has(specifier) &&
        (context.parentURL?.includes('/node_modules/') ||
          context.parentURL?.endsWith('/runtime/file-system.js'))
      ) {
        return nextResolve(specifier, context);
      }
      return { url: target, shortCircuit: true };
    },
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (
        result.format !== 'module' ||
        !url.includes('/packages/') ||
        !url.includes('/dist/') ||
        result.source == null
      ) {
        return result;
      }
      const source = Buffer.isBuffer(result.source)
        ? result.source.toString('utf8')
        : String(result.source);
      if (!source.includes('import.meta.require')) return result;
      return {
        ...result,
        source:
          "import { createRequire as __nodeCreateRequire } from 'node:module';\\n" +
          source.replaceAll(
            'import.meta.require',
            '__nodeCreateRequire(import.meta.url)',
          ),
      };
    },
  });
  const setup = await import(runtime.setupUrl);
  setup.enterSimulatedProcess({ pid: 'host' });
  simulationInstalled = true;
}

class NodeExecutorExit {
  constructor(code) { this.code = code; }
}



function formatValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return Object.prototype.toString.call(value); }
  }
  return String(value);
}

function makeProcessShim(scriptArgs) {
  const argv = ['node', ...scriptArgs];
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[name] = value;
  }
  return {
    argv,
    env,
    pid: process.pid,
    platform: process.platform,
    version: process.version,
    versions: process.versions,
    arch: process.arch,
    execPath: process.execPath,
    cwd() { return process.cwd(); },
    chdir(directory) { process.chdir(directory); },
    nextTick(callback, ...args) { process.nextTick(callback, ...args); },
    on(event, listener) { process.on(event, listener); return this; },
    once(event, listener) { process.once(event, listener); return this; },
    off(event, listener) { process.off(event, listener); return this; },
    exit(code) { throw new NodeExecutorExit(code); },
  };
}

function installProcessShim(scriptArgs, env, cwd) {
  const argv = ['node', ...scriptArgs];
  const envCopy = {};
  for (const [name, value] of Object.entries(env)) envCopy[name] = value;
  try { process.chdir(cwd); } catch {}
  Object.defineProperty(process, 'argv', { value: argv, configurable: true, writable: true });
  Object.defineProperty(process, 'env', { value: envCopy, configurable: true, writable: true });
}

async function runModule(source, filename, scriptArgs, env, cwd, stdoutChunks, stderrChunks) {
  installProcessShim(scriptArgs, env, cwd);
  const scriptRequire = filename && filename !== '[eval]'
    ? createRequire(filename)
    : customRequire;
  const context = {
    process: makeProcessShim(scriptArgs),
    require: scriptRequire,
    crypto,
    console: {
      log: (...parts) => { stdoutChunks.push(parts.map(formatValue).join(' ') + '\\n'); },
      error: (...parts) => { stderrChunks.push(parts.map(formatValue).join(' ') + '\\n'); },
      warn: (...parts) => { stderrChunks.push(parts.map(formatValue).join(' ') + '\\n'); },
      info: (...parts) => { stdoutChunks.push(parts.map(formatValue).join(' ') + '\\n'); },
      debug: (...parts) => { stdoutChunks.push(parts.map(formatValue).join(' ') + '\\n'); },
    },
    setTimeout, setInterval, clearTimeout, clearInterval, queueMicrotask,
    performance, URL, Buffer, TextEncoder, TextDecoder,
  };
  vm.createContext(context);
  const wrapped = '(async () => { \\'use strict\\'; const exports = {}; const module = { exports };\\n' + source + '\\n})()';
  const script = new vm.Script(wrapped, { filename });
  try {
    await script.runInContext(context, { displayErrors: true, timeout: 10000 });
    return 0;
  } catch (error) {
    if (error instanceof NodeExecutorExit) return error.code;
    const message = error instanceof Error ? (error.stack || error.message) : String(error);
    stderrChunks.push(message + '\\n');
    return 1;
  }
}

async function runScript(source, filename, scriptArgs, env, cwd, stdoutChunks, stderrChunks) {
  installProcessShim(scriptArgs, env, cwd);
  const scriptRequire = filename && filename !== '[eval]'
    ? createRequire(filename)
    : customRequire;
  const context = {
    process: makeProcessShim(scriptArgs),
    module: { exports: {} },
    exports: {},
    require: scriptRequire,
    crypto,
    console: {
      log: (...parts) => { stdoutChunks.push(parts.map(formatValue).join(' ') + '\\n'); },
      error: (...parts) => { stderrChunks.push(parts.map(formatValue).join(' ') + '\\n'); },
      warn: (...parts) => { stderrChunks.push(parts.map(formatValue).join(' ') + '\\n'); },
      info: (...parts) => { stdoutChunks.push(parts.map(formatValue).join(' ') + '\\n'); },
      debug: (...parts) => { stdoutChunks.push(parts.map(formatValue).join(' ') + '\\n'); },
    },
    setTimeout, setInterval, clearTimeout, clearInterval, queueMicrotask,
    performance, URL, Buffer, TextEncoder, TextDecoder,
  };
  vm.createContext(context);
  const script = new vm.Script(source, { filename });
  try {
    script.runInContext(context, { displayErrors: true, timeout: 10000 });
    return 0;
  } catch (error) {
    if (error instanceof NodeExecutorExit) return error.code;
    const message = error instanceof Error ? (error.stack || error.message) : String(error);
    stderrChunks.push(message + '\\n');
    return 1;
  }
}

async function runNodeTestSource(source, filename, scriptArgs, env, cwd, stdoutChunks, stderrChunks) {
  installProcessShim(scriptArgs, env, cwd);
  const directory = filename === '[eval]'
    ? await mkdtemp(join(tmpdir(), 'exoproc-node-test-'))
    : undefined;
  const testFilename = directory ? join(directory, 'entry.mjs') : filename;
  let failures = 0;

  try {
    if (directory) await writeFile(testFilename, source);
    const stream = runNodeTests({
      files: [testFilename],
      concurrency: false,
      isolation: 'none',
    });
    for await (const event of stream) {
      const name = event.data?.name ?? 'unnamed test';
      if (event.type === 'test:pass') {
        stdoutChunks.push('PASS ' + name + '\\n');
      } else if (event.type === 'test:fail') {
        failures += 1;
        const error = event.data?.details?.error;
        const detail =
          error?.cause?.stack || error?.stack || error?.message || '';
        stderrChunks.push('FAIL ' + name + (detail ? '\\n' + detail : '') + '\\n');
      } else if (event.type === 'test:skip') {
        stdoutChunks.push('SKIP ' + name + '\\n');
      }
    }
    return failures === 0 ? 0 : 1;
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

async function execute(request) {
  const stdoutChunks = [];
  const stderrChunks = [];
  try {
    if (request.runtime) await installSimulation(request.runtime);
    let source, filename, isModule = request.inputType === 'module';
    if (request.code !== undefined) {
      source = request.code;
      filename = '[eval]';
      isModule = true;
    } else if (request.scriptPath !== undefined) {
      const absolute = hostResolve(request.scriptPath);
      source = await hostReadFile(absolute, 'utf8');
      filename = absolute;
      if (filename.endsWith('.mjs')) isModule = true;
      else if (filename.endsWith('.cjs')) isModule = false;
    } else {
      return { id: request.id, exitCode: 1, stdout: '', stderr: 'node-executor: no code or scriptPath provided\\n' };
    }
    const scriptArgs = request.scriptPath ? [request.scriptPath, ...request.args] : request.args;
    const cwd = request.cwd || process.cwd();
    const env = request.env;
    const exitCode = request.testMode
      ? await runNodeTestSource(source, filename, scriptArgs, env, cwd, stdoutChunks, stderrChunks)
      : isModule
        ? await runModule(source, filename, scriptArgs, env, cwd, stdoutChunks, stderrChunks)
        : await runScript(source, filename, scriptArgs, env, cwd, stdoutChunks, stderrChunks);
    return { id: request.id, exitCode, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { id: request.id, exitCode: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') + message + '\\n', error: message };
  }
}

const responsePrefix = '__EXOPROC_NODE_RESPONSE__';
async function processRequest(raw) {
  let response;
  try {
    response = await execute(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    response = { id: -1, exitCode: 1, stdout: '', stderr: message + '\\n' };
  }
  process.stdout.write(responsePrefix + JSON.stringify(response) + '\\n');
}

const requestPath = process.argv[2];
if (requestPath) {
  await processRequest(JSON.parse(await hostReadFile(requestPath, 'utf8')));
} else {
  const lines = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });
  let processing = Promise.resolve();
  lines.on('line', (line) => {
    processing = processing.then(() => processRequest(JSON.parse(line)));
  });
}
`;

/**
 * Connects the simulated `node.exe` builtin to a real Node child process that
 * executes JavaScript and `node:test` files.
 *
 * One bridge is installed per `Win64Machine`: it allocates a dynamic
 * syscall id via `machine.registerDynamicSyscall`, then the `node.exe`
 * guest program calls `syscall <id>` with `RCX` = pointer to the
 * already-loaded source code (inline `-e <code>` or file contents
 * read via msvcrt), `RDX` = source length, `R8` = pointer to a
 * writable 4-byte slot for the executor's exit code, `R9` = pointer to a
 * writable 8-byte ticket slot the bridge uses to cache the
 * invocation object id, `R10` = pointer to an argv-style array (each
 * slot is a `u64` pointer to a null-terminated string), and `R11` =
 * argv count.
 *
 * The first time a request is observed, the bridge allocates a fresh
 * `nodeInvocation` kernel object, launches `node-executor.mjs` in a Node child
 * process, parks the calling thread on the object (rewinding RIP by 7 to
 * re-execute the `mov eax, imm32; syscall` thunk on resume), and unblocks the
 * thread once the executor returns its result. The second pass through the
 * syscall reads the cached result, writes stdout/stderr to the
 * simulated console, writes the exit code to the caller's out-u32, and
 * returns it in RAX.
 *
 * The architecture is: simulated `node.exe` (x64 machine code) -> host
 * syscall bridge -> isolated Node child process -> real `node:test`/module
 * loader. The simulator remains cooperative while the guest thread is parked.
 *
 * Host Node modules are resolved through dynamic imports so bridge internals
 * stay separate from the module aliases installed for guest package code.
 */
export class NodeHostBridge {
  private readonly machine: Win64Machine;
  private workerScriptPath: string | null = null;
  private readonly syscallId: number;
  private requestId = 0;
  private readonly activeExecutors = new Set<HostExecutorProcess>();
  /**
   * Per-call cached results, keyed by the `nodeInvocation` kernel
   * object id. The first execution of the syscall parks the calling
   * thread on the object; the worker fills the result and signals the
   * object; the resumed thread re-executes the syscall, looks the
   * object up here, and returns the result without spawning a second
   * worker.
   */
  private readonly results = new Map<number, NodeExecutionResult>();
  /**
   * Pending kernel-object ids: every `nodeInvocation` object the
   * bridge has created that hasn't yet been signaled. When the worker
   * fires, the object is removed from this set. `waitForPending()`
   * polls it to know when the simulator is genuinely done.
   */
  private readonly pendingObjectIds = new Set<number>();
  private readonly workerDirectory: string | undefined;
  private initPromise: Promise<void> | null = null;
  private workspaceAliasesPromise: Promise<
    Readonly<Record<string, string>>
  > | null = null;

  public constructor(
    machine: Win64Machine,
    options: NodeHostBridgeOptions = {},
  ) {
    this.machine = machine;
    this.workerDirectory = options.workerDirectory;
    this.syscallId = machine.registerDynamicSyscall(
      (process, thread, registers) =>
        this.handleSyscall(process, thread, registers),
    );

    this.machine.registerHandler(
      'node.dll',
      'createJSProcess',
      (_process, _thread, _registers) => {
        const objectId = this.machine.createKernelObject({
          kind: 'nodeInvocation',
          signaled: false,
        });
        return BigInt(objectId);
      },
    );

    this.machine.registerHandler(
      'node.dll',
      'enterJSProcess',
      (process, thread, registers) => {
        const hProcess = Number(registers.RCX);
        const argc = Number(registers.RDX & 0xffffffffn);
        const argvPointer = registers.R8;
        return this.handleEnterJSProcess(
          process,
          thread,
          registers,
          hProcess,
          argc,
          argvPointer,
        );
      },
    );

    this.machine.registerHandler(
      'node.dll',
      'terminateJSProcess',
      (_process, _thread, registers) => {
        const hProcess = Number(registers.RCX);
        const object = this.machine.getKernelObject(hProcess);
        if (object && object.kind === 'nodeInvocation') {
          object.signaled = true;
        }
        return 1n;
      },
    );
  }

  public get id(): number {
    return this.syscallId;
  }

  public get pendingInvocationCount(): number {
    return this.pendingObjectIds.size;
  }

  public dispose(): void {
    this.machine.unregisterDynamicSyscall(this.syscallId);
    for (const worker of this.activeExecutors) {
      worker.terminate();
    }
    this.activeExecutors.clear();
    this.results.clear();
  }

  /**
   * Returns a promise that resolves once every currently-pending
   * `nodeInvocation` has been resolved by its child executor and the simulator
   * has been pumped past the resulting thread resumption. Use this after a
   * synchronous `commandPrompt.execute('node ...')` to await real completion.
   */
  public async waitForPending(timeoutMs = 30_000): Promise<void> {
    // Give the main loop a chance to deliver child-process I/O callbacks,
    // then drain the simulator until the pending invocation set is empty.
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
      this.machine.pumpScheduler();
      if (this.pendingObjectIds.size === 0) return;
    }
    throw new Error(
      `NodeHostBridge.waitForPending: timed out after ${timeoutMs}ms waiting for executors to complete`,
    );
  }

  /**
   * Bypasses the syscall path entirely and runs a request through the
   * same worker pool. Used by the test suite so it can exercise the
   * bridge without going through the guest program.
   */
  public async runDirect(
    request: NodeExecutionRequest,
  ): Promise<NodeExecutionResult> {
    await this.ensureInitialized();
    return this.spawnAndWait({
      ...request,
      env: request.env ?? this.deriveHostEnv(),
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.workerScriptPath !== null) return;
    if (this.initPromise === null) {
      this.initPromise = this.initialize();
    }
    await this.initPromise;
  }

  private async initialize(): Promise<void> {
    const [fs, os, p] = await Promise.all([hostFs(), hostOs(), hostPath()]);
    const tmpDir =
      this.workerDirectory ??
      fs.mkdtempSync(p.join(os.tmpdir(), 'exoproc-sim-node-'));
    this.workerScriptPath = p.join(tmpDir, 'node-executor.mjs');
    fs.writeFileSync(this.workerScriptPath, WORKER_LOADER_SOURCE, 'utf8');
  }

  private deriveHostEnv(): Readonly<Record<string, string>> {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (typeof value === 'string') env[name] = value;
    }
    return env;
  }

  private handleSyscall(
    process: Win64Process,
    thread: Win64Thread,
    registers: X64Registers,
  ): bigint {
    const sourcePointer = registers.RCX;
    const sourceLength = Number(registers.RDX & 0xffffffffn);
    const outExitCodePointer = registers.R8;
    const ticketPointer = registers.R9;
    const argsPointer = registers.R10;
    const argsCount = Number(registers.R11 & 0xffffffffn);

    // The second time the syscall is reached (after the worker
    // signaled), the slot at `ticketPointer` carries the kernel
    // object id the bridge wrote out the first time around; look it
    // up to retrieve the cached result.
    if (ticketPointer !== 0n) {
      const existing = this.readTicket(process, ticketPointer);
      if (existing !== undefined) {
        const result = this.results.get(existing.objectId);
        if (result) {
          this.results.delete(existing.objectId);
          this.finalizeResult(process, result, outExitCodePointer);
          return BigInt(result.exitCode >>> 0);
        }
      }
    }

    let parsed: NodeExecutionRequest;
    try {
      if (sourcePointer === 0n || sourceLength === 0) {
        throw new Error('node.exe: no source provided');
      }
      const sourceBytes = process.memory.read(sourcePointer, sourceLength);
      const source = new TextDecoder('utf-8').decode(sourceBytes);
      const args = this.readArgs(process, argsPointer, argsCount);
      parsed = {
        code: source,
        args,
        cwd: process.machine.fileSystem.resolveHostPath(
          process.currentDirectory,
        ),
        inputType: 'module',
        env: this.resolveEnv(process, undefined),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.writeConsole(
        process,
        new TextEncoder().encode(`node.exe: ${message}\r\n`),
        'error',
      );
      if (outExitCodePointer !== 0n) {
        try {
          process.memory.writeU32(outExitCodePointer, 1);
        } catch {
          // ignore: caller did not provide a writable out-pointer
        }
      }
      return 1n;
    }

    const objectId = this.machine.createKernelObject({
      kind: 'nodeInvocation',
      signaled: false,
    });
    this.pendingObjectIds.add(objectId);

    if (ticketPointer !== 0n) {
      try {
        process.memory.writeU64(ticketPointer, BigInt(objectId));
      } catch {
        // ignore: caller did not provide a writable slot
      }
    }

    this.spawnExecutor(objectId, parsed).catch((error: Error) => {
      const result: NodeExecutionResult = {
        exitCode: 1,
        stdout: '',
        stderr: `node-executor bridge error: ${error.message}\n`,
      };
      this.completeWith(objectId, result);
    });

    thread.state = 'waiting';
    this.machine.scheduler.blockOnObject(thread, objectId);
    registers.RIP -= 7n;
    return 0n;
  }

  private handleEnterJSProcess(
    process: Win64Process,
    thread: Win64Thread,
    registers: X64Registers,
    objectId: number,
    argc: number,
    argvPointer: bigint,
  ): bigint {
    const existingResult = this.results.get(objectId);
    if (existingResult) {
      this.results.delete(objectId);
      this.finalizeResult(process, existingResult, 0n);
      return BigInt(existingResult.exitCode >>> 0);
    }

    let parsed: NodeExecutionRequest;
    try {
      const fullArgs = this.readArgs(process, argvPointer, argc);
      const scriptArgs = fullArgs.slice(1);
      let code: string | undefined;
      let scriptPath: string | undefined;
      let runtimeArgs: string[] = [];

      if (scriptArgs.length > 0 && scriptArgs[0] === '-e') {
        if (scriptArgs.length < 2) {
          throw new Error("option '-e' requires an argument");
        }
        code = scriptArgs[1];
        if (
          code &&
          ((code.startsWith("'") && code.endsWith("'")) ||
            (code.startsWith('"') && code.endsWith('"')))
        ) {
          code = code.slice(1, -1);
        }
        if (code) {
          code = code.replace(/\\+"/g, '"').replace(/\\+'/g, "'");
        }
        runtimeArgs = scriptArgs.slice(2);
      } else if (scriptArgs.length > 0) {
        scriptPath = scriptArgs[0];
        runtimeArgs = scriptArgs.slice(1);

        const normalized = process.machine.fileSystem.normalize(
          scriptPath!,
          process.currentDirectory,
        );
        const entry = process.machine.fileSystem.getEntry(normalized);
        if (entry && entry.kind === 'file') {
          const hostPath =
            process.machine.fileSystem.resolveHostPath(normalized);
          if (hostPath) {
            scriptPath = hostPath;
          } else {
            const fileBytes = process.machine.fileSystem.readFile(normalized);
            code = new TextDecoder('utf-8').decode(fileBytes);
          }
        }
      } else {
        throw new Error('no code or script path provided');
      }

      parsed = {
        code,
        scriptPath,
        args: runtimeArgs,
        cwd: process.machine.fileSystem.resolveHostPath(
          process.currentDirectory,
        ),
        inputType: 'module',
        env: this.resolveEnv(process, undefined),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.writeConsole(
        process,
        new TextEncoder().encode(`node: ${message}\r\n`),
        'error',
      );
      return 1n;
    }

    this.pendingObjectIds.add(objectId);

    this.spawnExecutor(objectId, parsed).catch((error: Error) => {
      const result: NodeExecutionResult = {
        exitCode: 1,
        stdout: '',
        stderr: `node-executor bridge error: ${error.message}\n`,
      };
      this.completeWith(objectId, result);
    });

    thread.state = 'waiting';
    this.machine.scheduler.blockOnObject(thread, objectId);
    registers.RIP -= 7n;
    return 0n;
  }

  private completeWith(objectId: number, result: NodeExecutionResult): void {
    if (this.results.has(objectId)) return;
    this.results.set(objectId, result);
    this.pendingObjectIds.delete(objectId);
    const object = this.machine.getKernelObject(objectId);
    if (object && object.kind === 'nodeInvocation') {
      object.signaled = true;
    }
    this.machine.scheduler.signalObject(objectId);
    // Re-pump so the now-runnable guest thread actually runs to the
    // next settle point. The bridge is called asynchronously from
    // the worker thread, so the simulator's own pump is long since
    // returned; without this, a `commandPrompt.execute('node ...')`
    // would return *before* the simulated `node.exe` finished and
    // the worker output never made it to the simulated console.
    this.machine.pumpScheduler();
  }

  private finalizeResult(
    process: Win64Process,
    result: NodeExecutionResult,
    outExitCodePointer: bigint,
  ): void {
    this.writeConsole(
      process,
      new TextEncoder().encode(result.stdout),
      'output',
    );
    this.writeConsole(
      process,
      new TextEncoder().encode(result.stderr),
      'error',
    );
    if (outExitCodePointer !== 0n) {
      try {
        process.memory.writeU32(outExitCodePointer, result.exitCode);
        console.error(
          '[bridge] wrote exitCode=%s to slot=%s',
          result.exitCode,
          outExitCodePointer.toString(16),
        );
      } catch (e) {
        console.error('[bridge] writeU32 failed: %s', (e as Error).message);
        // ignore: caller did not provide a writable out-pointer
      }
    }
  }

  private readTicket(
    process: Win64Process,
    ticketPointer: bigint,
  ): { objectId: number } | undefined {
    try {
      const value = process.memory.readU64(ticketPointer);
      if (value === 0n) return undefined;
      return { objectId: Number(value) };
    } catch {
      return undefined;
    }
  }

  /**
   * Reads an argv-style array from guest memory.
   *
   * Each argument slot holds a `u64` pointer to a null-terminated
   * string. Slots after the first null are ignored, mirroring how
   * real C runtimes terminate `argv`. The caller passes the explicit
   * `argsCount` so we never run past the guest-declared end of the
   * array.
   */
  private readArgs(
    process: Win64Process,
    argsPointer: bigint,
    argsCount: number,
  ): readonly string[] {
    if (argsPointer === 0n || argsCount === 0) return [];
    const args: string[] = [];
    for (let index = 0; index < argsCount; index += 1) {
      const slot = argsPointer + BigInt(index * 8);
      const stringPointer = process.memory.readU64(slot);
      if (stringPointer === 0n) break;
      args.push(process.memory.readCString(stringPointer));
    }
    return args;
  }

  private resolveEnv(
    process: Win64Process,
    override: unknown,
  ): Readonly<Record<string, string>> {
    const env: Record<string, string> = {};
    if (override && typeof override === 'object') {
      for (const [name, value] of Object.entries(override)) {
        if (typeof value === 'string') env[name] = value;
      }
    } else {
      for (const [name, value] of process.environment.entries()) {
        env[name] = value;
      }
    }
    return env;
  }

  private writeConsole(
    process: Win64Process,
    bytes: Uint8Array,
    kind: 'output' | 'error',
  ): void {
    if (bytes.length === 0) return;
    const handleValue =
      kind === 'error'
        ? process.standardHandles.error
        : process.standardHandles.output;
    if (handleValue === 0) {
      this.writeConsoleFallback(process.console, bytes);
      return;
    }
    const handle = process.handles.get(handleValue);
    const object = handle
      ? this.machine.getKernelObject(handle.objectId)
      : undefined;
    if (object?.kind === 'output') {
      object.device.write(bytes);
      return;
    }
    this.writeConsoleFallback(process.console, bytes);
  }

  private writeConsoleFallback(console: Win32Console, bytes: Uint8Array): void {
    console.write(bytes);
  }

  private async createWorkerRuntimeBindings(): Promise<WorkerRuntimeBindings> {
    const workspaceAliases = await this.getWorkspacePackageAliases();
    const simulateEntry =
      workspaceAliases['win32-simulate'] ?? workspaceAliases['simulate'];
    if (!simulateEntry) {
      throw new Error('Workspace package win32-simulate was not found');
    }
    const workerDirectory = new URL('./worker/', simulateEntry);
    const workerUrl = (filename: string) =>
      new URL(filename, workerDirectory).href;

    return {
      setupUrl: workerUrl('enter-simulated-process.js'),
      aliases: {
        ...workspaceAliases,
        'bun:ffi': workerUrl('bun-ffi-module.js'),
        'bun:test': workerUrl('bun-test-module.js'),
        'node:fs': workerUrl('node-fs-shim.js'),
        fs: workerUrl('node-fs-shim.js'),
        'node:os': workerUrl('node-os-shim.js'),
        os: workerUrl('node-os-shim.js'),
      },
    };
  }

  private async getWorkspacePackageAliases(): Promise<
    Readonly<Record<string, string>>
  > {
    if (!this.workspaceAliasesPromise) {
      this.workspaceAliasesPromise = (async () => {
        const [fs, p, url] = await Promise.all([
          hostFs(),
          hostPath(),
          hostUrl(),
        ]);
        const workspaceRoot =
          this.machine.fileSystem.resolveHostPath(WIN32_WORKSPACE_PATH);
        if (!workspaceRoot) {
          throw new Error(
            `${WIN32_WORKSPACE_PATH} must be bound to the repository root`,
          );
        }
        const readEntries = (dir: string) => {
          try {
            return fs.readdirSync(dir, { withFileTypes: true });
          } catch {
            return [];
          }
        };

        let packagesDirectory = p.join(workspaceRoot, 'packages');
        let entries = readEntries(packagesDirectory);
        if (entries.length === 0) {
          const monorepoPackages = p.join(
            workspaceRoot,
            '..',
            '..',
            'packages',
          );
          const monorepoEntries = readEntries(monorepoPackages);
          if (monorepoEntries.length > 0) {
            packagesDirectory = monorepoPackages;
            entries = monorepoEntries;
          }
        }
        const aliases: Record<string, string> = {};

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const packageDirectory = p.join(packagesDirectory, entry.name);
          try {
            const manifest = JSON.parse(
              fs.readFileSync(p.join(packageDirectory, 'package.json'), 'utf8'),
            ) as {
              name?: string;
              main?: string;
              exports?: Record<string, unknown>;
            };
            if (!manifest.name) continue;
            const addAlias = (specifier: string, target: string) => {
              const relativeTarget = target.replace(/^\.\//, '');
              aliases[specifier] = url.pathToFileURL(
                p.join(packageDirectory, relativeTarget),
              ).href;
            };
            addAlias(manifest.name, manifest.main ?? './dist/index.js');

            for (const [subpath, targetValue] of Object.entries(
              manifest.exports ?? {},
            )) {
              if (subpath === '.') continue;
              const target = this.resolvePackageExportTarget(targetValue);
              if (!target || !subpath.startsWith('./')) continue;
              const suffix = subpath.slice(1);
              addAlias(`${manifest.name}${suffix}`, target);
            }
          } catch {
            // A directory under packages/ without a package manifest is ignored.
          }
        }
        return aliases;
      })();
    }
    return this.workspaceAliasesPromise;
  }

  private resolvePackageExportTarget(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return undefined;
    const conditions = value as Record<string, unknown>;
    return (
      this.resolvePackageExportTarget(conditions.import) ??
      this.resolvePackageExportTarget(conditions.default)
    );
  }

  private async spawnExecutor(
    objectId: number,
    request: NodeExecutionRequest,
  ): Promise<void> {
    await this.ensureInitialized();
    nodeHostDebug(`preparing request for object ${objectId}`);
    request = await this.prepareRequest(request);
    nodeHostDebug(`prepared request for object ${objectId}`);
    const cleanupRequest = () => this.cleanupPreparedRequest(request);
    const workerScriptPath = this.workerScriptPath;
    if (workerScriptPath === null) {
      throw new Error('NodeHostBridge: worker script path is null after init');
    }
    const id = this.requestId++;
    const payload: WorkerRequest = {
      id,
      runtime: await this.createWorkerRuntimeBindings(),
      code: request.code,
      scriptPath: request.scriptPath,
      testMode: request.testMode ?? false,
      args: request.args,
      cwd: request.cwd ?? process.cwd(),
      inputType: request.inputType ?? 'module',
      env: request.env ?? {},
    };
    nodeHostDebug(`launching request ${id} for object ${objectId}`);
    const worker = await createHostExecutorProcess(workerScriptPath, payload);
    this.activeExecutors.add(worker);
    const onResult = (result: NodeExecutionResult) => {
      this.completeWith(objectId, result);
    };
    worker.on('message', (response: WorkerResponse) => {
      if (response.id !== id) return;
      onResult({
        exitCode: response.exitCode,
        stdout: response.stdout,
        stderr: response.stderr,
      });
      this.activeExecutors.delete(worker);
      worker.terminate();
      cleanupRequest();
    });
    worker.on('error', (error: Error) => {
      cleanupRequest();
      onResult({
        exitCode: 1,
        stdout: '',
        stderr: `node-executor worker error: ${error.message}\n`,
      });
    });
    worker.on('exit', (code: number | null) => {
      this.activeExecutors.delete(worker);
      cleanupRequest();
      if (!this.results.has(objectId) && code !== 0) {
        onResult({
          exitCode: code ?? 1,
          stdout: '',
          stderr: `node-executor: worker exited with code ${code}\n`,
        });
      }
    });
  }

  private async prepareRequest(
    request: NodeExecutionRequest,
  ): Promise<PreparedNodeExecutionRequest> {
    if (!request.scriptPath) return request;

    return {
      ...request,
      testMode:
        request.testMode ?? /\.test\.(?:cjs|js|mjs)$/i.test(request.scriptPath),
      inputType: request.scriptPath.endsWith('.cjs') ? 'commonjs' : 'module',
    };
  }

  private cleanupPreparedRequest(request: NodeExecutionRequest): void {
    const temporaryDirectory = (request as PreparedNodeExecutionRequest)
      .temporaryDirectory;
    if (!temporaryDirectory) return;
    void hostFs()
      .then((fs) => {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
      })
      .catch((error: unknown) => {
        nodeHostDebug(
          `unable to clean temporary execution directory: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  private spawnAndWait(
    request: NodeExecutionRequest,
  ): Promise<NodeExecutionResult> {
    return new Promise((resolve, reject) => {
      this.ensureInitialized()
        .then(async () => {
          const preparedRequest = await this.prepareRequest(request);
          const cleanupRequest = () =>
            this.cleanupPreparedRequest(preparedRequest);
          const workerScriptPath = this.workerScriptPath;
          if (workerScriptPath === null) {
            throw new Error(
              'NodeHostBridge: worker script path is null after init',
            );
          }
          const id = this.requestId++;
          const payload: WorkerRequest = {
            id,
            runtime: await this.createWorkerRuntimeBindings(),
            code: preparedRequest.code,
            scriptPath: preparedRequest.scriptPath,
            testMode: preparedRequest.testMode ?? false,
            args: preparedRequest.args,
            cwd: preparedRequest.cwd ?? process.cwd(),
            inputType: preparedRequest.inputType ?? 'module',
            env: preparedRequest.env ?? {},
          };
          const worker = await createHostExecutorProcess(
            workerScriptPath,
            payload,
          );
          this.activeExecutors.add(worker);
          worker.on('message', (response: WorkerResponse) => {
            if (response.id !== id) return;
            this.activeExecutors.delete(worker);
            worker.terminate();
            cleanupRequest();
            resolve({
              exitCode: response.exitCode,
              stdout: response.stdout,
              stderr: response.stderr,
            });
          });
          worker.on('error', (error: Error) => {
            this.activeExecutors.delete(worker);
            worker.terminate();
            cleanupRequest();
            reject(error);
          });
          worker.on('exit', (code: number | null) => {
            this.activeExecutors.delete(worker);
            cleanupRequest();
            if (code !== 0) {
              resolve({
                exitCode: code ?? 1,
                stdout: '',
                stderr: `node-executor: worker exited with code ${code}\n`,
              });
            }
          });
        })
        .catch((error: Error) => reject(error));
    });
  }
}
