import {
  CType,
  createCFunction,
  createDummyFunction,
  resolveAddress,
  resolveRemoteExportAddress,
  InittableMiddlewareAccessor,
  type ISyncCallableMemoryAccessor,
  type IHostAccessor,
  type CFunction,
  type DummyFunction,
  type CTypeOrString,
} from 'bun-xffi';
import { Module } from 'bun-winapi';
import {
  JNI_INVOKE_INTERFACE_FIELDS,
  JNI_NATIVE_INTERFACE_FIELDS,
  readVtable,
  readVtableSync,
} from './jni-vtables.js';
import {
  JNI_INVOKE_SIGNATURES,
  JNI_NATIVE_SIGNATURES,
  JNI_PLAIN_SIGNATURES,
  type JniSignature,
} from './jni-signatures.js';
import {
  JvmModuleNotFoundError,
  JvmGetCreatedVmError,
  JvmGetEnvError,
  JniFunctionNotFoundError,
} from './errors.js';
import { ReflectionBridge } from './reflection-bridge.js';
import { SyncJavaContext, AsyncJavaContext } from './proxy.js';

const JNI_VERSION_1_8 = 0x00010008;
const JNI_OK = 0;
const JNI_EDETACHED = -2;

/** Normalizes an `i32` JNI status: the backend's `call()` returns JNI's
 * signed 32-bit return values as their unsigned 32-bit bit pattern (e.g.
 * `JNI_EDETACHED` (-2) comes back as `4294967294`) -- `| 0` forces the same
 * ToInt32 reinterpretation C would apply. */
function toJniStatus(raw: unknown): number {
  return Number(raw) | 0;
}

/**
 * `jni-signatures.ts`'s declared `args` never include an implicit
 * `jvm`/`env` "this" argument (by design -- see that file's own doc
 * comment), so this is the public signature as-is -- used both for a
 * "plain" (no implicit arg at all) real `CFunction` and for every bound
 * `DummyFunction`'s public signature.
 */
function toPlainSig(sig: JniSignature): [CTypeOrString, CTypeOrString[]] {
  return [sig.returns, Array.from(sig.args)];
}

/**
 * Adds the implicit `jvm`/`env` "this" pointer back on as a real, explicit
 * `args[0]` -- the actual ABI a `native`/`invoke` function's real `CFunction`
 * needs, as opposed to the arg-dropped public signature callers see.
 */
function toRealSig(sig: JniSignature): [CTypeOrString, CTypeOrString[]] {
  return [sig.returns, [CType.LPVOID, ...sig.args]];
}

/**
 * Builds both forms of one resolved JNI function at a known address:
 * `cfunction` is the real, full-arity `CFunction` (implicit arg included, if
 * any) -- pass it to `accessor.call(cfunction, implicitThis, ...args)`
 * yourself, e.g. to hand it to `minhook` as a hook target. `fn` is the bound
 * `DummyFunction` -- same address, public signature has the implicit arg
 * dropped, and its callable already redirects through `backend` with
 * `implicitThis` baked in, so `await fn(...)` alone is enough.
 *
 * `implicitThis === undefined` means a "plain" function (no `jvm`/`env` arg
 * at all, e.g. `JNI_GetCreatedJavaVMs`) -- `cfunction`'s signature is then
 * just `sig` as declared, and `fn`'s callable doesn't inject anything.
 */
function buildFunctionPair(
  addr: bigint,
  sig: JniSignature,
  implicitThis: bigint | undefined,
  backend: ISyncCallableMemoryAccessor,
  name: string,
): { cfunction: CFunction; fn: DummyFunction } {
  const cfunction = createCFunction(
    addr,
    implicitThis === undefined ? toPlainSig(sig) : toRealSig(sig),
  );
  const fn = createDummyFunction(
    addr,
    toPlainSig(sig),
    implicitThis === undefined
      ? (...args: any[]) => backend.call(cfunction, ...args)
      : (...args: any[]) => backend.call(cfunction, implicitThis, ...args),
    name,
  );
  (fn as any).callSync =
    implicitThis === undefined
      ? (...args: any[]) => backend.callSync(cfunction, ...args)
      : (...args: any[]) => backend.callSync(cfunction, implicitThis, ...args);
  return { cfunction, fn };
}

/** {@link buildFunctionPair}, applied to every entry of a signature group. */
function buildFunctionGroup<Name extends string>(
  signatures: Record<Name, JniSignature>,
  resolveAddr: (name: Name) => bigint,
  implicitThis: bigint | undefined,
  backend: ISyncCallableMemoryAccessor,
): {
  cfunctions: Record<Name, CFunction>;
  functions: Record<Name, DummyFunction>;
} {
  const cfunctions = {} as Record<Name, CFunction>;
  const functions = {} as Record<Name, DummyFunction>;
  for (const name of Object.keys(signatures) as Name[]) {
    const { cfunction, fn } = buildFunctionPair(
      resolveAddr(name),
      signatures[name],
      implicitThis,
      backend,
      name,
    );
    cfunctions[name] = cfunction;
    functions[name] = fn;
  }
  return { cfunctions, functions };
}

function requireVtableAddr(
  table: Map<string, bigint>,
  name: string,
  tableKind: 'invoke' | 'native',
): bigint {
  const addr = table.get(name);
  if (!addr) throw new JniFunctionNotFoundError(name, tableKind);
  return addr;
}

/**
 * `jvm.dll` isn't loaded the instant `java.exe` starts -- the launcher does
 * real work (JRE/JDK detection, `-cp` parsing, ...) before it gets there, and
 * that takes noticeably longer under Wine than on real Windows. Polls for up
 * to ~15s rather than failing on the first miss, since a caller attaching
 * right after spawning the process (the common case) would otherwise race it.
 */
function findRemoteJvmModule(pid: number): { path: string; base: bigint } {
  const deadline = Date.now() + 15000;
  for (;;) {
    const modules = Module.getModules(pid);
    const jvm = modules.find((m: any) => m.name.toLowerCase() === 'jvm.dll');
    if (jvm) return { path: jvm.path, base: jvm.baseAddress };
    if (Date.now() >= deadline) throw new JvmModuleNotFoundError(pid);
    Bun.sleepSync(150);
  }
}

export type JniNativeFunctionName = keyof typeof JNI_NATIVE_SIGNATURES;
export type JniInvokeFunctionName = keyof typeof JNI_INVOKE_SIGNATURES;
export type JniPlainFunctionName = keyof typeof JNI_PLAIN_SIGNATURES;

/**
 * Middleware accessor that discovers a live `java.exe` process's
 * `JavaVM*`/`JNIEnv*` (Java 8 only, for now) during `init()`, then resolves
 * **every** entry across all three `jni-signatures.ts` groups -- `native`
 * (`JNIEnv*`-first), `invoke` (`JavaVM*`-first), and `plain` (no implicit
 * arg at all, e.g. `JNI_GetCreatedJavaVMs`) -- into both forms
 * ({@link buildFunctionPair}): a real `CFunction` and a bound
 * `DummyFunction`. `plain` entries are resolved fresh per attached process
 * via `resolveRemoteExportAddress` (`bun-xffi`), since `jvm.dll`'s base
 * address differs by process (ASLR) even though the DLL file itself is
 * identical.
 *
 * Retrieval: `getFunctions`/`getInvokeFunctions`/`getPlainFunctions` return
 * the bound (directly-callable) forms; `getCFunctions`/`getInvokeCFunctions`/
 * `getPlainCFunctions` return the raw forms (for handing to some other
 * accessor/tool, e.g. `minhook`). All six have a `*Sync` twin.
 *
 * `backend` should be an already-hijacked accessor over a live thread of the
 * target process (an `IndirectNThreadHostAccessor(pid, tid)`, per this
 * repo's usual convention -- see `tests/nthread/process-cache-accessor-nthread.test.ts`
 * for the same `new HostAccessor(backend)` / `new XAccessor(backend, host)` /
 * `host.backend = xAccessor` wiring this class is meant to be used with).
 */
export class NJavaAccessor extends InittableMiddlewareAccessor {
  public readonly isNJava = true;
  private jvmPtr!: bigint;
  private envPtr!: bigint;
  private invokeTable!: Map<string, bigint>;
  private nativeTable!: Map<string, bigint>;

  private resolvedNativeCFunctions!: Record<JniNativeFunctionName, CFunction>;
  private resolvedNativeFunctions!: Record<
    JniNativeFunctionName,
    DummyFunction
  >;
  private resolvedInvokeCFunctions!: Record<JniInvokeFunctionName, CFunction>;
  private resolvedInvokeFunctions!: Record<
    JniInvokeFunctionName,
    DummyFunction
  >;
  private resolvedPlainCFunctions!: Record<JniPlainFunctionName, CFunction>;
  private resolvedPlainFunctions!: Record<JniPlainFunctionName, DummyFunction>;
  private reflection: ReflectionBridge | undefined;

  constructor(
    backend: ISyncCallableMemoryAccessor,
    private readonly pid: number,
    root: IHostAccessor,
  ) {
    super(backend, root);
  }

  protected async onInit(): Promise<void> {
    if (this.explicitEnvPtr !== 0n) {
      this.envPtr = this.explicitEnvPtr;
      const nativeVtable = (
        await this.root.read(this.envPtr, 8)
      ).readBigUInt64LE();
      this.nativeTable = await readVtable(
        (addr, size) => this.root.read(addr, size),
        nativeVtable,
        JNI_NATIVE_INTERFACE_FIELDS,
      );

      const native = buildFunctionGroup(
        JNI_NATIVE_SIGNATURES,
        (name) => requireVtableAddr(this.nativeTable, name, 'native'),
        this.envPtr,
        this.backend,
      );
      this.resolvedNativeCFunctions = native.cfunctions;
      this.resolvedNativeFunctions = native.functions;

      const scratch = BigInt(resolveAddress(await this.root.alloc(8)));
      try {
        const getVmStatus = toJniStatus(
          await this.root.call(
            native.cfunctions.GetJavaVM,
            this.envPtr,
            scratch,
          ),
        );
        if (getVmStatus !== JNI_OK) throw new JvmGetCreatedVmError(getVmStatus);
        this.jvmPtr = (await this.root.read(scratch, 8)).readBigUInt64LE();
      } finally {
        await this.root.free(scratch);
      }

      const invokeVtable = (
        await this.root.read(this.jvmPtr, 8)
      ).readBigUInt64LE();
      this.invokeTable = await readVtable(
        (addr, size) => this.root.read(addr, size),
        invokeVtable,
        JNI_INVOKE_INTERFACE_FIELDS,
      );

      const invoke = buildFunctionGroup(
        JNI_INVOKE_SIGNATURES,
        (name) => requireVtableAddr(this.invokeTable, name, 'invoke'),
        this.jvmPtr,
        this.backend,
      );
      this.resolvedInvokeCFunctions = invoke.cfunctions;
      this.resolvedInvokeFunctions = invoke.functions;

      try {
        const { path, base } = findRemoteJvmModule(this.pid);
        const plain = buildFunctionGroup(
          JNI_PLAIN_SIGNATURES,
          (name) => resolveRemoteExportAddress(path, base, name),
          undefined,
          this.backend,
        );
        this.resolvedPlainCFunctions = plain.cfunctions;
        this.resolvedPlainFunctions = plain.functions;
      } catch {}
      return;
    }

    const { path, base } = findRemoteJvmModule(this.pid);

    const plain = buildFunctionGroup(
      JNI_PLAIN_SIGNATURES,
      (name) => resolveRemoteExportAddress(path, base, name),
      undefined,
      this.backend,
    );
    this.resolvedPlainCFunctions = plain.cfunctions;
    this.resolvedPlainFunctions = plain.functions;

    const scratch = BigInt(resolveAddress(await this.root.alloc(16)));
    const status = toJniStatus(
      await this.root.call(
        plain.cfunctions.JNI_GetCreatedJavaVMs,
        scratch,
        1,
        scratch + 8n,
      ),
    );
    if (status !== JNI_OK) throw new JvmGetCreatedVmError(status);

    // `jvmPtr` is a pointer to a `JavaVM_` object, not the vtable itself --
    // `JavaVM_`'s *first field* is the real `functions` pointer to the
    // shared `JNIInvokeInterface_` table (the C macro `(*jvm)->GetEnv(jvm,
    // ...)` dereferences once to reach it, but passes `jvm` itself, not
    // `*jvm`, as the implicit "this"). Same one-more-level-of-indirection
    // shape for `JNIEnv_`/`JNINativeInterface_` below.
    this.jvmPtr = (await this.root.read(scratch, 8)).readBigUInt64LE();
    const invokeVtable = (
      await this.root.read(this.jvmPtr, 8)
    ).readBigUInt64LE();
    this.invokeTable = await readVtable(
      (addr, size) => this.root.read(addr, size),
      invokeVtable,
      JNI_INVOKE_INTERFACE_FIELDS,
    );

    const invoke = buildFunctionGroup(
      JNI_INVOKE_SIGNATURES,
      (name) => requireVtableAddr(this.invokeTable, name, 'invoke'),
      this.jvmPtr,
      this.backend,
    );
    this.resolvedInvokeCFunctions = invoke.cfunctions;
    this.resolvedInvokeFunctions = invoke.functions;

    let envStatus = toJniStatus(
      await this.root.call(
        invoke.cfunctions.GetEnv,
        this.jvmPtr,
        scratch,
        JNI_VERSION_1_8,
      ),
    );
    if (envStatus === JNI_EDETACHED) {
      // The hijacked thread is a genuine OS thread inside the JVM process,
      // but not one the JVM itself created via JNI -- exactly the scenario
      // AttachCurrentThread(AsDaemon) exists for. `args` (JavaVMAttachArgs*)
      // is NULL for default name/group.
      envStatus = toJniStatus(
        await this.root.call(
          invoke.cfunctions.AttachCurrentThreadAsDaemon,
          this.jvmPtr,
          scratch,
          0n,
        ),
      );
    }
    if (envStatus !== JNI_OK) throw new JvmGetEnvError(envStatus);

    this.envPtr = (await this.root.read(scratch, 8)).readBigUInt64LE();
    const nativeVtable = (
      await this.root.read(this.envPtr, 8)
    ).readBigUInt64LE();
    this.nativeTable = await readVtable(
      (addr, size) => this.root.read(addr, size),
      nativeVtable,
      JNI_NATIVE_INTERFACE_FIELDS,
    );

    const native = buildFunctionGroup(
      JNI_NATIVE_SIGNATURES,
      (name) => requireVtableAddr(this.nativeTable, name, 'native'),
      this.envPtr,
      this.backend,
    );
    this.resolvedNativeCFunctions = native.cfunctions;
    this.resolvedNativeFunctions = native.functions;
  }

  private explicitEnvPtr: bigint = 0n;

  /**
   * Initializes NJavaAccessor directly from a known `JNIEnv*` pointer
   * (e.g. intercepted from an NHook callback or native JVM function call),
   * resolving GetJavaVM via the native vtable to get `JavaVM*` with zero
   * JNI_GetCreatedJavaVMs calls.
   */
  public async initByEnv(envPtr: bigint): Promise<void> {
    this.explicitEnvPtr = envPtr;
    await this.init();
  }

  /** Synchronous counterpart of {@link initByEnv}. */
  public initByEnvSync(envPtr: bigint): void {
    this.explicitEnvPtr = envPtr;
    this.initSync();
  }

  protected override async onDeinit(): Promise<void> {
    if (this.jvmPtr && this.resolvedInvokeCFunctions?.DetachCurrentThread) {
      try {
        await this.root.call(
          this.resolvedInvokeCFunctions.DetachCurrentThread,
          this.jvmPtr,
        );
      } catch {}
    }
  }

  protected override onDeinitSync(): void {
    if (this.jvmPtr && this.resolvedInvokeCFunctions?.DetachCurrentThread) {
      try {
        this.root.callSync(
          this.resolvedInvokeCFunctions.DetachCurrentThread,
          this.jvmPtr,
        );
      } catch {}
    }
  }

  protected onInitSync(): void {
    if (this.explicitEnvPtr !== 0n) {
      this.envPtr = this.explicitEnvPtr;
      const nativeVtable = this.root.readSync(this.envPtr, 8).readBigUInt64LE();
      this.nativeTable = readVtableSync(
        (addr, size) => this.root.readSync(addr, size),
        nativeVtable,
        JNI_NATIVE_INTERFACE_FIELDS,
      );

      const native = buildFunctionGroup(
        JNI_NATIVE_SIGNATURES,
        (name) => requireVtableAddr(this.nativeTable, name, 'native'),
        this.envPtr,
        this.backend,
      );
      this.resolvedNativeCFunctions = native.cfunctions;
      this.resolvedNativeFunctions = native.functions;

      const scratch = BigInt(resolveAddress(this.root.allocSync(8)));
      try {
        const getVmStatus = toJniStatus(
          this.root.callSync(native.cfunctions.GetJavaVM, this.envPtr, scratch),
        );
        if (getVmStatus !== JNI_OK) throw new JvmGetCreatedVmError(getVmStatus);
        this.jvmPtr = this.root.readSync(scratch, 8).readBigUInt64LE();
      } finally {
        this.root.freeSync(scratch);
      }

      const invokeVtable = this.root.readSync(this.jvmPtr, 8).readBigUInt64LE();
      this.invokeTable = readVtableSync(
        (addr, size) => this.root.readSync(addr, size),
        invokeVtable,
        JNI_INVOKE_INTERFACE_FIELDS,
      );

      const invoke = buildFunctionGroup(
        JNI_INVOKE_SIGNATURES,
        (name) => requireVtableAddr(this.invokeTable, name, 'invoke'),
        this.jvmPtr,
        this.backend,
      );
      this.resolvedInvokeCFunctions = invoke.cfunctions;
      this.resolvedInvokeFunctions = invoke.functions;

      try {
        const { path, base } = findRemoteJvmModule(this.pid);
        const plain = buildFunctionGroup(
          JNI_PLAIN_SIGNATURES,
          (name) => resolveRemoteExportAddress(path, base, name),
          undefined,
          this.backend,
        );
        this.resolvedPlainCFunctions = plain.cfunctions;
        this.resolvedPlainFunctions = plain.functions;
      } catch {}
      return;
    }

    const { path, base } = findRemoteJvmModule(this.pid);

    const plain = buildFunctionGroup(
      JNI_PLAIN_SIGNATURES,
      (name) => resolveRemoteExportAddress(path, base, name),
      undefined,
      this.backend,
    );
    this.resolvedPlainCFunctions = plain.cfunctions;
    this.resolvedPlainFunctions = plain.functions;

    const scratch = BigInt(resolveAddress(this.root.allocSync(16)));
    const status = toJniStatus(
      this.root.callSync(
        plain.cfunctions.JNI_GetCreatedJavaVMs,
        scratch,
        1,
        scratch + 8n,
      ),
    );
    if (status !== JNI_OK) throw new JvmGetCreatedVmError(status);

    this.jvmPtr = this.root.readSync(scratch, 8).readBigUInt64LE();
    const invokeVtable = this.root.readSync(this.jvmPtr, 8).readBigUInt64LE();
    this.invokeTable = readVtableSync(
      (addr, size) => this.root.readSync(addr, size),
      invokeVtable,
      JNI_INVOKE_INTERFACE_FIELDS,
    );

    const invoke = buildFunctionGroup(
      JNI_INVOKE_SIGNATURES,
      (name) => requireVtableAddr(this.invokeTable, name, 'invoke'),
      this.jvmPtr,
      this.backend,
    );
    this.resolvedInvokeCFunctions = invoke.cfunctions;
    this.resolvedInvokeFunctions = invoke.functions;

    let envStatus = toJniStatus(
      this.root.callSync(
        invoke.cfunctions.GetEnv,
        this.jvmPtr,
        scratch,
        JNI_VERSION_1_8,
      ),
    );
    if (envStatus === JNI_EDETACHED) {
      envStatus = toJniStatus(
        this.root.callSync(
          invoke.cfunctions.AttachCurrentThreadAsDaemon,
          this.jvmPtr,
          scratch,
          0n,
        ),
      );
    }
    if (envStatus !== JNI_OK) throw new JvmGetEnvError(envStatus);

    this.envPtr = this.root.readSync(scratch, 8).readBigUInt64LE();
    const nativeVtable = this.root.readSync(this.envPtr, 8).readBigUInt64LE();
    this.nativeTable = readVtableSync(
      (addr, size) => this.root.readSync(addr, size),
      nativeVtable,
      JNI_NATIVE_INTERFACE_FIELDS,
    );

    const native = buildFunctionGroup(
      JNI_NATIVE_SIGNATURES,
      (name) => requireVtableAddr(this.nativeTable, name, 'native'),
      this.envPtr,
      this.backend,
    );
    this.resolvedNativeCFunctions = native.cfunctions;
    this.resolvedNativeFunctions = native.functions;
  }

  private async ensureInit(): Promise<void> {
    if (!this.isInitializing) {
      await this.init();
    }
  }

  private ensureInitSync(): void {
    if (!this.isInitializingSync) {
      this.initSync();
    }
  }

  /** Bound `JNINativeInterface_` functions (`JNIEnv*` auto-injected), keyed by `JNI_NATIVE_SIGNATURES`'s entries (e.g. `.GetVersion`). */
  public async getFunctions(): Promise<
    Record<JniNativeFunctionName, DummyFunction>
  > {
    await this.ensureInit();
    return this.resolvedNativeFunctions;
  }

  /** Sync twin of {@link getFunctions}. */
  public getFunctionsSync(): Record<JniNativeFunctionName, DummyFunction> {
    this.ensureInitSync();
    return this.resolvedNativeFunctions;
  }

  /** Raw `JNINativeInterface_` functions (`JNIEnv*` explicit, real full-arity `CFunction`s) -- call via some accessor's `call(fn, envPtr, ...)` yourself. */
  public async getCFunctions(): Promise<
    Record<JniNativeFunctionName, CFunction>
  > {
    await this.ensureInit();
    return this.resolvedNativeCFunctions;
  }

  /** Sync twin of {@link getCFunctions}. */
  public getCFunctionsSync(): Record<JniNativeFunctionName, CFunction> {
    this.ensureInitSync();
    return this.resolvedNativeCFunctions;
  }

  /** Bound `JNIInvokeInterface_` functions (`JavaVM*` auto-injected), keyed by `JNI_INVOKE_SIGNATURES`'s entries (e.g. `.DestroyJavaVM`). */
  public async getInvokeFunctions(): Promise<
    Record<JniInvokeFunctionName, DummyFunction>
  > {
    await this.ensureInit();
    return this.resolvedInvokeFunctions;
  }

  /** Sync twin of {@link getInvokeFunctions}. */
  public getInvokeFunctionsSync(): Record<
    JniInvokeFunctionName,
    DummyFunction
  > {
    this.ensureInitSync();
    return this.resolvedInvokeFunctions;
  }

  /** Raw `JNIInvokeInterface_` functions (`JavaVM*` explicit). */
  public async getInvokeCFunctions(): Promise<
    Record<JniInvokeFunctionName, CFunction>
  > {
    await this.ensureInit();
    return this.resolvedInvokeCFunctions;
  }

  /** Sync twin of {@link getInvokeCFunctions}. */
  public getInvokeCFunctionsSync(): Record<JniInvokeFunctionName, CFunction> {
    this.ensureInitSync();
    return this.resolvedInvokeCFunctions;
  }

  /** Bound plain JNI functions (no implicit arg -- e.g. `.JNI_GetCreatedJavaVMs`), resolved fresh per process via `GetProcAddress`. */
  public async getPlainFunctions(): Promise<
    Record<JniPlainFunctionName, DummyFunction>
  > {
    await this.ensureInit();
    return this.resolvedPlainFunctions;
  }

  /** Sync twin of {@link getPlainFunctions}. */
  public getPlainFunctionsSync(): Record<JniPlainFunctionName, DummyFunction> {
    this.ensureInitSync();
    return this.resolvedPlainFunctions;
  }

  /** Raw plain JNI functions (no implicit arg). */
  public async getPlainCFunctions(): Promise<
    Record<JniPlainFunctionName, CFunction>
  > {
    await this.ensureInit();
    return this.resolvedPlainCFunctions;
  }

  /** Sync twin of {@link getPlainCFunctions}. */
  public getPlainCFunctionsSync(): Record<JniPlainFunctionName, CFunction> {
    this.ensureInitSync();
    return this.resolvedPlainCFunctions;
  }

  /** The resolved `JNIEnv*` pointer address. */
  public getEnvPtr(): bigint {
    return this.envPtr;
  }

  /** The resolved `JavaVM*` pointer address. */
  public getJvmPtr(): bigint {
    return this.jvmPtr;
  }

  /**
   * Retrieves the Java reflection bridge asynchronously.
   */
  public async getReflection(): Promise<ReflectionBridge> {
    await this.ensureInit();
    if (!this.reflection) {
      this.reflection = new ReflectionBridge(
        await this.getFunctions(),
        this.root,
      );
      await this.reflection.init();
    }
    return this.reflection;
  }

  /**
   * Synchronous twin of {@link getReflection}.
   */
  public getReflectionSync(): ReflectionBridge {
    this.ensureInitSync();
    if (!this.reflection) {
      this.reflection = new ReflectionBridge(
        this.getFunctionsSync(),
        this.root,
      );
      this.reflection.initSync();
    }
    return this.reflection;
  }

  /**
   * Returns an {@link AsyncJavaContext} providing Nashorn-style `Java.type(...)` and dynamic class/object proxies asynchronously.
   */
  public async getJava(): Promise<AsyncJavaContext> {
    const reflection = await this.getReflection();
    return new AsyncJavaContext(reflection);
  }

  /**
   * Synchronous twin of {@link getJava}, providing immediate `Java.type(...)` and dynamic object access without `await`.
   */
  public getJavaSync(): SyncJavaContext {
    const reflection = this.getReflectionSync();
    return new SyncJavaContext(reflection);
  }
}
