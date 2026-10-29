import {
  type ReflectionBridge,
  ReflectedClass,
  ReflectedMethod,
  ReflectedField,
} from './reflection-bridge.js';
import type { ParsedAccessibleObject } from './reflection-parser.js';
import { JavaContext, createJavaContext } from './proxy.js';
import { JavaMappingRegistry } from './mapping.js';
import type { MappingPool } from 'exoproc-mappings';
import { adaptBridgeArgument, globalCallbackRegistry } from './adapter.js';
import {
  getOrCreateIpcServer,
  type IpcCallbackPayload,
  type IpcCallbackResult,
  type IpcServer,
} from 'exoproc-ipc';
import { registerAgentContextFactory } from 'njava-agent';

export interface AgentBridgeOptions {
  server?: IpcServer;
  pipePath?: string;
  name?: string;
  clientId?: string;
  buildId?: string;
  timeoutMs?: number;
}

function serializeArg(arg: any): any {
  if (arg === null || arg === undefined) return null;
  if (typeof arg === 'bigint') {
    return { handle: Number(arg) };
  }
  if (typeof arg === 'object') {
    if ('$ptr' in arg) return { handle: Number(arg.$ptr) };
    if ('$classObj' in arg) return { handle: Number(arg.$classObj) };
    if (Array.isArray(arg)) return arg.map(serializeArg);
  }
  return arg;
}

function serializeArgs(args: readonly any[]): any[] {
  return args.map(serializeArg);
}

function throwAsyncRequired(op: string): never {
  throw new Error(
    `AgentReflectionBridge.${op} requires async execution (sync: false) over Named Pipe IPC.`,
  );
}

/**
 * Remote Reflection RPC Bridge connecting Bun (`bun-njava`) to an injected `Exoproc` Java agent
 * over zero-port Named Pipe / local socket IPC (`exoproc-ipc`).
 */
export class AgentReflectionBridge {
  public readonly isAgentBridge = true;
  public readonly server: IpcServer;
  public readonly pipePath: string;
  public readonly clientId?: string;
  public readonly buildId?: string;
  public readonly timeoutMs: number;

  private readonly classCache = new Map<string, ReflectedClass>();
  private readonly classById = new Map<
    bigint,
    { name: string; class: ReflectedClass }
  >();
  private readonly methodsByClassId = new Map<bigint, ReflectedMethod[]>();
  private readonly fieldsByClassId = new Map<
    bigint,
    Map<string, ReflectedField>
  >();
  private readonly fieldsById = new Map<bigint, ReflectedField>();
  private readonly ctorsByClassId = new Map<
    bigint,
    Array<{ ctorObj: bigint; paramTypes: readonly string[] }>
  >();
  private readonly superclassByClassId = new Map<bigint, string>();
  private readonly superclassChainByClassId = new Map<bigint, string[]>();

  private executorHandle: bigint | null = null;

  public readonly callbackRegistry = new Map<string, (...args: any[]) => any>();
  private unsubscribeCallbacks: (() => void) | null = null;

  constructor(options: AgentBridgeOptions = {}) {
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
    this.startCallbackListener();
  }

  public getExecutor(): bigint | null {
    return this.executorHandle;
  }

  public setExecutor(handle: bigint | null): void {
    this.executorHandle = handle;
  }

  private invokeBody(
    methodObj: bigint,
    targetPtr: bigint,
    args: readonly any[],
  ): any {
    const body: any = {
      methodId: Number(methodObj),
      targetHandle: Number(targetPtr),
      args: serializeArgs(args),
    };
    if (this.executorHandle !== null) {
      body.executor = { handle: Number(this.executorHandle) };
    }
    return body;
  }

  public registerCallback(
    callbackId: string,
    fn: (...args: any[]) => any,
  ): void {
    this.callbackRegistry.set(callbackId, fn);
    this.startCallbackListener();
  }

  public unregisterCallback(callbackId: string): void {
    this.callbackRegistry.delete(callbackId);
  }

  public getCallback(
    callbackId: string,
  ): ((...args: any[]) => any) | undefined {
    return this.callbackRegistry.get(callbackId);
  }

  public startCallbackListener(): void {
    if (this.unsubscribeCallbacks) return;
    this.unsubscribeCallbacks = this.server.onCallback(
      async (payload: IpcCallbackPayload, incomingClientId: string) => {
        if (this.clientId && incomingClientId !== this.clientId) {
          return undefined;
        }
        if (
          !this.callbackRegistry.has(payload.callbackId) &&
          !globalCallbackRegistry.has(payload.callbackId)
        ) {
          return undefined;
        }
        return await this.dispatchIncomingCallback(payload);
      },
    );
  }

  public stopCallbackListener(): void {
    if (this.unsubscribeCallbacks) {
      this.unsubscribeCallbacks();
      this.unsubscribeCallbacks = null;
    }
  }

  public async dispatchIncomingCallback(payload: {
    id: number;
    callbackId: string;
    method: string;
    args: any[];
  }): Promise<IpcCallbackResult> {
    const { id, callbackId, method, args } = payload;
    const fn =
      this.callbackRegistry.get(callbackId) ||
      globalCallbackRegistry.get(callbackId);

    if (!fn) {
      return {
        id,
        success: false,
        error: `No callback function registered for callbackId: ${callbackId} (method: ${method})`,
      };
    }

    try {
      const safeArgs = Array.isArray(args) ? args : [];
      const result = await fn(...safeArgs);
      return { id, success: true, result };
    } catch (e: any) {
      return {
        id,
        success: false,
        error: e?.message || String(e),
      };
    }
  }

  public adaptArgument(arg: any, targetType?: string, context?: any): any {
    return adaptBridgeArgument(arg, targetType, this, context);
  }

  private async rpcAsync(
    action: string,
    data: Record<string, any> = {},
  ): Promise<any> {
    const cleanAction = action.startsWith('/') ? action.slice(1) : action;
    return await this.server.request(cleanAction, data, {
      kind: 'java-agent',
      clientId: this.clientId,
      buildId: this.buildId,
      timeoutMs: this.timeoutMs,
    });
  }

  // --- Class Metadata Processing & Caching ---

  private populateClass(data: any): ReflectedClass {
    if (!data?.success) {
      throw new Error(data?.error || 'Failed to inspect class');
    }

    const classObj = BigInt(data.classId);
    const className = data.name as string;

    const methods: ReflectedMethod[] = [];
    if (Array.isArray(data.methods)) {
      for (const m of data.methods) {
        const modifiers = new Set<string>();
        if (m.static) modifiers.add('static');
        const parsed: ParsedAccessibleObject = {
          kind: 'method',
          modifiers,
          type: m.returnType ?? null,
          declaringClass: className,
          name: m.name,
          paramTypes: m.params ?? [],
          exceptionTypes: [],
        };
        methods.push(
          new ReflectedMethod(
            BigInt(m.id),
            parsed,
            this as unknown as ReflectionBridge,
          ),
        );
      }
    }

    const fieldMap = new Map<string, ReflectedField>();
    if (Array.isArray(data.fields)) {
      for (const f of data.fields) {
        const modifiers = new Set<string>();
        if (f.static) modifiers.add('static');
        const parsed: ParsedAccessibleObject = {
          kind: 'field',
          modifiers,
          type: f.type ?? null,
          declaringClass: className,
          name: f.name,
          paramTypes: [],
          exceptionTypes: [],
        };
        const fld = new ReflectedField(
          BigInt(f.id),
          parsed,
          this as unknown as ReflectionBridge,
        );
        fieldMap.set(f.name, fld);
        this.fieldsById.set(BigInt(f.id), fld);
      }
    }

    const ctors: Array<{ ctorObj: bigint; paramTypes: readonly string[] }> = [];
    if (Array.isArray(data.constructors)) {
      for (const c of data.constructors) {
        ctors.push({
          ctorObj: BigInt(c.id),
          paramTypes: c.params ?? [],
        });
      }
    }

    this.methodsByClassId.set(classObj, methods);
    this.fieldsByClassId.set(classObj, fieldMap);
    this.ctorsByClassId.set(classObj, ctors);
    if (data.superclass) {
      this.superclassByClassId.set(classObj, data.superclass);
    }
    if (Array.isArray(data.superclassChain)) {
      this.superclassChainByClassId.set(classObj, data.superclassChain);
    }

    const reflectedClass = new ReflectedClass(
      classObj,
      className,
      this as unknown as ReflectionBridge,
    );
    if (typeof data.isInterface === 'boolean') {
      (reflectedClass as any).isInterface = data.isInterface;
    }
    this.classCache.set(className, reflectedClass);
    this.classById.set(classObj, { name: className, class: reflectedClass });
    return reflectedClass;
  }

  // --- ReflectionBridge Interface Methods ---

  public async defineClass(
    name: string,
    bytecode: Uint8Array | Buffer,
  ): Promise<ReflectedClass> {
    const b64 = Buffer.from(bytecode).toString('base64');
    const data = await this.rpcAsync('reflection/defineClass', {
      name,
      bytecode: b64,
    });
    if (!data?.success) {
      throw new Error(data?.error || `Failed to define class ${name}`);
    }
    const resolvedName = (data.name as string) || name;
    this.classCache.delete(resolvedName);
    this.classCache.delete(name);
    return await this.getClass(resolvedName);
  }

  public async getClass(name: string): Promise<ReflectedClass> {
    const targetName =
      name === 'Exoproc' ? 'org.exoproc.njava.agent.utils.Exoproc' : name;
    const cached = this.classCache.get(targetName);
    if (cached) return cached;

    const data = await this.rpcAsync('reflection/class', {
      name: targetName,
    });
    const cls = this.populateClass(data);
    if (name !== targetName) {
      this.classCache.set(name, cls);
    }
    return cls;
  }

  public getClassSync(name: string): ReflectedClass {
    const targetName =
      name === 'Exoproc' ? 'org.exoproc.njava.agent.utils.Exoproc' : name;
    const cached = this.classCache.get(targetName);
    if (cached) return cached;
    return throwAsyncRequired('getClassSync');
  }

  public async findClass(name: string): Promise<ReflectedClass | undefined> {
    try {
      return await this.getClass(name);
    } catch {
      return undefined;
    }
  }

  public findClassSync(name: string): ReflectedClass | undefined {
    const targetName =
      name === 'Exoproc' ? 'org.exoproc.njava.agent.utils.Exoproc' : name;
    return this.classCache.get(targetName);
  }

  public async invokeUnboxed(
    methodObj: bigint,
    targetPtr = 0n,
    args: readonly any[] = [],
  ): Promise<any> {
    const data = await this.rpcAsync(
      'reflection/invoke',
      this.invokeBody(methodObj, targetPtr, args),
    );

    if (!data.success) {
      throw new Error(data.error || 'Method invocation failed');
    }

    if (data.isObject) {
      return BigInt(data.handle);
    }
    return data.value;
  }

  public invokeUnboxedSync(): any {
    return throwAsyncRequired('invokeUnboxedSync');
  }

  public async invokeMethod(
    methodObj: bigint,
    targetPtr = 0n,
    args: readonly any[] = [],
  ): Promise<any> {
    return await this.invokeUnboxed(methodObj, targetPtr, args);
  }

  public invokeMethodSync(): any {
    return throwAsyncRequired('invokeMethodSync');
  }

  public async invoke(
    methodObj: bigint,
    targetPtr = 0n,
    args: readonly any[] = [],
  ): Promise<bigint> {
    const res = await this.invokeUnboxed(methodObj, targetPtr, args);
    return typeof res === 'bigint' ? res : 0n;
  }

  public invokeSync(): bigint {
    return throwAsyncRequired('invokeSync');
  }

  public async readField(
    classObj: bigint,
    fieldName: string,
    targetPtr = 0n,
  ): Promise<any> {
    const data = await this.rpcAsync('reflection/field/get', {
      classId: Number(classObj),
      fieldName,
      targetHandle: Number(targetPtr),
    });

    if (!data.success) {
      throw new Error(data.error || `Failed to read field ${fieldName}`);
    }

    if (data.isObject) {
      return BigInt(data.handle);
    }
    return data.value;
  }

  public readFieldSync(): any {
    return throwAsyncRequired('readFieldSync');
  }

  public async writeField(
    classObj: bigint,
    fieldName: string,
    value: any,
    targetPtr = 0n,
  ): Promise<void> {
    const data = await this.rpcAsync('reflection/field/set', {
      classId: Number(classObj),
      fieldName,
      targetHandle: Number(targetPtr),
      value: serializeArg(value),
    });

    if (!data.success) {
      throw new Error(data.error || `Failed to write field ${fieldName}`);
    }
  }

  public writeFieldSync(): void {
    return throwAsyncRequired('writeFieldSync');
  }

  public async getFieldValueUnboxed(
    fieldObj: bigint,
    targetPtr = 0n,
  ): Promise<any> {
    const data = await this.rpcAsync('reflection/field/get', {
      fieldId: Number(fieldObj),
      targetHandle: Number(targetPtr),
    });

    if (!data.success) {
      throw new Error(data.error || `Failed to get field ${fieldObj}`);
    }

    if (data.isObject) {
      return BigInt(data.handle);
    }
    return data.value;
  }

  public getFieldValueUnboxedSync(): any {
    return throwAsyncRequired('getFieldValueUnboxedSync');
  }

  public async setFieldValue(
    fieldObj: bigint,
    value: any,
    targetPtr = 0n,
  ): Promise<void> {
    const data = await this.rpcAsync('reflection/field/set', {
      fieldId: Number(fieldObj),
      targetHandle: Number(targetPtr),
      value: serializeArg(value),
    });

    if (!data.success) {
      throw new Error(data.error || `Failed to set field ${fieldObj}`);
    }
  }

  public setFieldValueSync(): void {
    return throwAsyncRequired('setFieldValueSync');
  }

  public async construct(
    ctorObj: bigint,
    args: readonly any[] = [],
  ): Promise<bigint> {
    const data = await this.rpcAsync('reflection/construct', {
      ctorId: Number(ctorObj),
      args: serializeArgs(args),
    });

    if (!data.success) {
      throw new Error(data.error || 'Constructor invocation failed');
    }

    return BigInt(data.handle);
  }

  public constructSync(): bigint {
    return throwAsyncRequired('constructSync');
  }

  public async getObjectClass(objPtr: bigint): Promise<bigint> {
    const data = await this.rpcAsync('reflection/object/class', {
      handle: Number(objPtr),
      targetHandle: Number(objPtr),
    });

    if (!data.success) {
      throw new Error(data.error || `Failed to get class for object ${objPtr}`);
    }

    const classObj = BigInt(data.classId);
    if (!this.classById.has(classObj)) {
      await this.getClass(data.name);
    }
    return classObj;
  }

  public getObjectClassSync(): bigint {
    return throwAsyncRequired('getObjectClassSync');
  }

  public async getClassName(classObj: bigint): Promise<string> {
    const entry = this.classById.get(classObj);
    if (entry) return entry.name;
    return `Class@${classObj}`;
  }

  public getClassNameSync(classObj: bigint): string {
    const entry = this.classById.get(classObj);
    if (entry) return entry.name;
    return `Class@${classObj}`;
  }

  public async getObjectClassName(objPtr: bigint): Promise<string> {
    const classObj = await this.getObjectClass(objPtr);
    return await this.getClassName(classObj);
  }

  public getObjectClassNameSync(): string {
    return throwAsyncRequired('getObjectClassNameSync');
  }

  public async getAoString(objPtr: bigint): Promise<string> {
    const data = await this.rpcAsync('reflection/object/string', {
      handle: Number(objPtr),
      targetHandle: Number(objPtr),
    });

    if (!data.success) {
      return `[JavaObject @ 0x${objPtr.toString(16)}]`;
    }
    return data.value;
  }

  public getAoStringSync(): string {
    return throwAsyncRequired('getAoStringSync');
  }

  public async getAllReflectedMethods(
    classObj: bigint,
  ): Promise<ReflectedMethod[]> {
    const result: ReflectedMethod[] = [];
    const seenSigs = new Set<string>();
    const seenClasses = new Set<bigint>();
    let curr: bigint | undefined = classObj;
    while (curr && curr !== 0n && !seenClasses.has(curr)) {
      seenClasses.add(curr);
      const methods = this.methodsByClassId.get(curr) ?? [];
      for (const m of methods) {
        const sig = `${m.name}(${m.paramTypes.join(',')})`;
        if (!seenSigs.has(sig)) {
          seenSigs.add(sig);
          result.push(m);
        }
      }
      curr = await this.getSuperclass(curr);
    }
    return result;
  }

  public getAllReflectedMethodsSync(classObj: bigint): ReflectedMethod[] {
    const result: ReflectedMethod[] = [];
    const seenSigs = new Set<string>();
    const seenClasses = new Set<bigint>();
    let curr: bigint | undefined = classObj;
    while (curr && curr !== 0n && !seenClasses.has(curr)) {
      seenClasses.add(curr);
      const methods = this.methodsByClassId.get(curr) ?? [];
      for (const m of methods) {
        const sig = `${m.name}(${m.paramTypes.join(',')})`;
        if (!seenSigs.has(sig)) {
          seenSigs.add(sig);
          result.push(m);
        }
      }
      curr = this.getSuperclassSync(curr);
    }
    return result;
  }

  public async getDeclaredReflectedMethods(
    classObj: bigint,
  ): Promise<ReflectedMethod[]> {
    return this.methodsByClassId.get(classObj) ?? [];
  }

  public getDeclaredReflectedMethodsSync(classObj: bigint): ReflectedMethod[] {
    return this.methodsByClassId.get(classObj) ?? [];
  }

  public async findReflectedFields(
    classObj: bigint,
    names?: readonly string[],
  ): Promise<Map<string, ReflectedField>> {
    const all =
      this.fieldsByClassId.get(classObj) ?? new Map<string, ReflectedField>();
    if (!names) return all;
    const res = new Map<string, ReflectedField>();
    for (const name of names) {
      const f = all.get(name);
      if (f) res.set(name, f);
    }
    return res;
  }

  public findReflectedFieldsSync(
    classObj: bigint,
    names?: readonly string[],
  ): Map<string, ReflectedField> {
    const all =
      this.fieldsByClassId.get(classObj) ?? new Map<string, ReflectedField>();
    if (!names) return all;
    const res = new Map<string, ReflectedField>();
    for (const name of names) {
      const f = all.get(name);
      if (f) res.set(name, f);
    }
    return res;
  }

  public async findReflectedField(
    classObj: bigint,
    name: string,
  ): Promise<ReflectedField | undefined> {
    let curr: bigint | undefined = classObj;
    const seen = new Set<bigint>();
    while (curr && curr !== 0n && !seen.has(curr)) {
      seen.add(curr);
      const f = this.fieldsByClassId.get(curr)?.get(name);
      if (f) return f;
      curr = await this.getSuperclass(curr);
    }
    return undefined;
  }

  public findReflectedFieldSync(
    classObj: bigint,
    name: string,
  ): ReflectedField | undefined {
    let curr: bigint | undefined = classObj;
    const seen = new Set<bigint>();
    while (curr && curr !== 0n && !seen.has(curr)) {
      seen.add(curr);
      const f = this.fieldsByClassId.get(curr)?.get(name);
      if (f) return f;
      curr = this.getSuperclassSync(curr);
    }
    return undefined;
  }

  public async getField(
    classObj: bigint,
    name: string,
  ): Promise<ReflectedField> {
    const f = await this.findReflectedField(classObj, name);
    if (!f) throw new Error(`Field ${name} not found on class ${classObj}`);
    return f;
  }

  public getFieldSync(classObj: bigint, name: string): ReflectedField {
    const f = this.findReflectedFieldSync(classObj, name);
    if (!f) throw new Error(`Field ${name} not found on class ${classObj}`);
    return f;
  }

  public async findReflectedMethod(
    classObj: bigint,
    name: string,
  ): Promise<ReflectedMethod | undefined> {
    let curr: bigint | undefined = classObj;
    const seen = new Set<bigint>();
    while (curr && curr !== 0n && !seen.has(curr)) {
      seen.add(curr);
      const m = this.methodsByClassId
        .get(curr)
        ?.find((meth) => meth.name === name);
      if (m) return m;
      curr = await this.getSuperclass(curr);
    }
    return undefined;
  }

  public findReflectedMethodSync(
    classObj: bigint,
    name: string,
  ): ReflectedMethod | undefined {
    let curr: bigint | undefined = classObj;
    const seen = new Set<bigint>();
    while (curr && curr !== 0n && !seen.has(curr)) {
      seen.add(curr);
      const m = this.methodsByClassId
        .get(curr)
        ?.find((meth) => meth.name === name);
      if (m) return m;
      curr = this.getSuperclassSync(curr);
    }
    return undefined;
  }

  public async getMethod(
    classObj: bigint,
    name: string,
  ): Promise<ReflectedMethod> {
    const m = await this.findReflectedMethod(classObj, name);
    if (!m) throw new Error(`Method ${name} not found on class ${classObj}`);
    return m;
  }

  public getMethodSync(classObj: bigint, name: string): ReflectedMethod {
    const m = this.findReflectedMethodSync(classObj, name);
    if (!m) throw new Error(`Method ${name} not found on class ${classObj}`);
    return m;
  }

  public async getAllConstructors(
    classObj: bigint,
  ): Promise<Array<{ ctorObj: bigint; paramTypes: readonly string[] }>> {
    return this.ctorsByClassId.get(classObj) ?? [];
  }

  public getAllConstructorsSync(
    classObj: bigint,
  ): Array<{ ctorObj: bigint; paramTypes: readonly string[] }> {
    return this.ctorsByClassId.get(classObj) ?? [];
  }

  public async getSuperclass(classObj: bigint): Promise<bigint | undefined> {
    const scName = this.superclassByClassId.get(classObj);
    if (!scName) return undefined;
    try {
      const sc = await this.getClass(scName);
      return sc.classObj;
    } catch {
      return undefined;
    }
  }

  public getSuperclassSync(classObj: bigint): bigint | undefined {
    const scName = this.superclassByClassId.get(classObj);
    if (!scName) return undefined;
    const cached = this.classCache.get(scName);
    return cached?.classObj;
  }

  public async getSuperclassChain(classObj: bigint): Promise<string[]> {
    const precomputed = this.superclassChainByClassId.get(classObj);
    if (precomputed) return [...precomputed];
    const chain: string[] = [];
    let currentName = this.superclassByClassId.get(classObj);
    while (currentName) {
      chain.push(currentName);
      if (currentName === 'java.lang.Object') break;
      const sc = await this.getClass(currentName);
      currentName = this.superclassByClassId.get(sc.classObj);
    }
    return chain;
  }

  public getSuperclassChainSync(classObj: bigint): string[] {
    const precomputed = this.superclassChainByClassId.get(classObj);
    if (precomputed) return [...precomputed];
    const chain: string[] = [];
    let currentName = this.superclassByClassId.get(classObj);
    while (currentName) {
      chain.push(currentName);
      if (currentName === 'java.lang.Object') break;
      const sc = this.classCache.get(currentName);
      if (!sc) break;
      currentName = this.superclassByClassId.get(sc.classObj);
    }
    return chain;
  }

  public async releaseHandles(handles: bigint[]): Promise<void> {
    if (!handles.length) return;
    await this.rpcAsync('reflection/release', {
      handles: handles.map((h) => Number(h)),
    });
  }

  public releaseHandlesSync(): void {
    return throwAsyncRequired('releaseHandlesSync');
  }
}

/**
 * Creates an async JavaContext backed by the remote Named Pipe `Exoproc` Java agent reflection RPC bridge.
 */
export function createAgentContext(
  options?: AgentBridgeOptions & {
    sync?: boolean;
    mapper?: JavaMappingRegistry;
    pool?: MappingPool;
  },
): JavaContext {
  const sync = options?.sync ?? false;
  const bridge = new AgentReflectionBridge({
    server: options?.server,
    pipePath: options?.pipePath,
    name: options?.name,
    clientId: options?.clientId,
    buildId: options?.buildId,
    timeoutMs: options?.timeoutMs,
  });
  return createJavaContext(bridge as unknown as ReflectionBridge, {
    sync,
    mapper: options?.mapper,
    pool: options?.pool,
  });
}

registerAgentContextFactory(createAgentContext);
