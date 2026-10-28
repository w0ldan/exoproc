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

export interface AgentBridgeOptions {
  host?: string;
  port?: number;
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

/**
 * Remote Reflection RPC Bridge connecting Bun (njava / njava-runtime) to njava-agent over HTTP.
 *
 * Implements the ReflectionBridge interface so that createJavaClassProxy,
 * createJavaObjectProxy, and JavaContext work transparently over the network without
 * running any JavaScript inside the JVM.
 */
export class AgentReflectionBridge {
  public readonly isAgentBridge = true;
  public readonly host: string;
  public readonly port: number;
  public readonly baseUrl: string;
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

  /**
   * Optional executor object handle. While set, every `/reflection/invoke` is routed through it
   * (the agent submits the call as a Runnable/Callable to that object and waits for completion).
   * Used via `Java.runOn(executor, fn)`.
   */
  private executorHandle: bigint | null = null;

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

  public readonly callbackRegistry = new Map<string, (...args: any[]) => any>();
  private callbackAbortController: AbortController | null = null;
  private isListeningCallbacks = false;

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
    if (this.isListeningCallbacks) return;
    this.isListeningCallbacks = true;
    this.callbackAbortController = new AbortController();
    this.runCallbackEventLoop(this.callbackAbortController.signal);
  }

  public stopCallbackListener(): void {
    this.isListeningCallbacks = false;
    if (this.callbackAbortController) {
      this.callbackAbortController.abort();
      this.callbackAbortController = null;
    }
  }

  private async runCallbackEventLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && this.isListeningCallbacks) {
      try {
        const res = await fetch(`${this.baseUrl}/callback/events`, {
          headers: {
            Accept: 'text/event-stream',
          },
          signal,
        });

        if (!res.ok) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        const reader = res.body?.getReader();
        if (!reader) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (!signal.aborted && this.isListeningCallbacks) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() || '';

          for (const block of blocks) {
            await this.handleSseBlock(block.trim());
          }
        }
      } catch {
        if (signal.aborted || !this.isListeningCallbacks) break;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  private async handleSseBlock(block: string): Promise<void> {
    if (!block || block.startsWith(':')) return;

    const lines = block.split('\n');
    let eventName = 'message';
    let dataStr = '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.substring(6).trim();
      } else if (line.startsWith('data:')) {
        dataStr = line.substring(5).trim();
      }
    }

    if (eventName === 'callback' && dataStr) {
      try {
        const payload = JSON.parse(dataStr);
        await this.dispatchIncomingCallback(payload);
      } catch (err) {
        console.error('[AgentBridge] Failed to handle callback event:', err);
      }
    }
  }

  public async dispatchIncomingCallback(payload: {
    id: number;
    callbackId: string;
    method: string;
    args: any[];
  }): Promise<{ id: number; success: boolean; result?: any; error?: string }> {
    const { id, callbackId, method, args } = payload;
    const fn =
      this.callbackRegistry.get(callbackId) ||
      globalCallbackRegistry.get(callbackId);

    let success = true;
    let result: any = null;
    let error: string | undefined;

    if (!fn) {
      success = false;
      error = `No callback function registered for callbackId: ${callbackId} (method: ${method})`;
    } else {
      try {
        const safeArgs = Array.isArray(args) ? args : [];
        result = await fn(...safeArgs);
      } catch (e: any) {
        success = false;
        error = e?.message || String(e);
      }
    }

    try {
      await fetch(`${this.baseUrl}/callback/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, success, result, error }),
      });
    } catch (e) {
      console.error(
        `[AgentBridge] Failed to send callback reply for id ${id}:`,
        e,
      );
    }

    return { id, success, result, error };
  }

  public async pollCallbackOnce(timeoutMs = 2000): Promise<any> {
    try {
      const res = await fetch(
        `${this.baseUrl}/callback/poll?timeout=${timeoutMs}`,
      );
      if (!res.ok) return null;
      const data = (await res.json()) as any;
      if (!data || data.empty || !data.id) return null;
      return await this.dispatchIncomingCallback(data);
    } catch {
      return null;
    }
  }

  public adaptArgument(arg: any, targetType?: string, context?: any): any {
    return adaptBridgeArgument(arg, targetType, this, context);
  }

  constructor(options: AgentBridgeOptions = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 43378;
    this.baseUrl = `http://${this.host}:${this.port}`;
    this.timeoutMs = options.timeoutMs || 15000;
  }

  // --- HTTP RPC Helpers ---

  private postSync(endpoint: string, data: any): any {
    const url = `${this.baseUrl}${endpoint}`;
    const body = JSON.stringify(data);
    const proc = Bun.spawnSync([
      'curl',
      '-s',
      '-H',
      'Connection: close',
      '-H',
      'Content-Type: application/json',
      '-X',
      'POST',
      url,
      '-d',
      body,
    ]);

    if (proc.exitCode !== 0) {
      throw new Error(
        `Agent RPC error: curl failed with code ${proc.exitCode}: ${proc.stderr?.toString()}`,
      );
    }

    const text = proc.stdout.toString().trim();
    if (!text) {
      throw new Error(`Agent RPC error: empty response from ${endpoint}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(
        `Agent RPC error: invalid JSON from ${endpoint}: ${text}`,
      );
    }
  }

  private async postAsync(endpoint: string, data: any): Promise<any> {
    const url = `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Connection: 'close',
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Agent RPC error (${res.status}): ${errText}`);
    }

    return await res.json();
  }

  // --- Class Metadata Processing & Caching ---

  private populateClass(data: any): ReflectedClass {
    if (!data.success) {
      throw new Error(data.error || 'Failed to inspect class');
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

    const reflectedClass = new ReflectedClass(
      classObj,
      className,
      this as unknown as ReflectionBridge,
    );
    this.classCache.set(className, reflectedClass);
    this.classById.set(classObj, { name: className, class: reflectedClass });
    return reflectedClass;
  }

  // --- ReflectionBridge Interface Methods ---

  public async getClass(name: string): Promise<ReflectedClass> {
    const targetName =
      name === 'Exoproc' ? 'org.exoproc.njava.agent.utils.Exoproc' : name;
    const cached = this.classCache.get(targetName);
    if (cached) return cached;

    const data = await this.postAsync('/reflection/class', {
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

    const data = this.postSync('/reflection/class', { name: targetName });
    const cls = this.populateClass(data);
    if (name !== targetName) {
      this.classCache.set(name, cls);
    }
    return cls;
  }

  public async findClass(name: string): Promise<ReflectedClass | undefined> {
    try {
      return await this.getClass(name);
    } catch {
      return undefined;
    }
  }

  public findClassSync(name: string): ReflectedClass | undefined {
    try {
      return this.getClassSync(name);
    } catch {
      return undefined;
    }
  }

  public async invokeUnboxed(
    methodObj: bigint,
    targetPtr = 0n,
    args: readonly any[] = [],
  ): Promise<any> {
    const data = await this.postAsync(
      '/reflection/invoke',
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

  public invokeUnboxedSync(
    methodObj: bigint,
    targetPtr = 0n,
    args: readonly any[] = [],
  ): any {
    const data = this.postSync(
      '/reflection/invoke',
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

  public async invokeMethod(
    methodObj: bigint,
    targetPtr = 0n,
    args: readonly any[] = [],
  ): Promise<any> {
    return await this.invokeUnboxed(methodObj, targetPtr, args);
  }

  public invokeMethodSync(
    methodObj: bigint,
    targetPtr = 0n,
    args: readonly any[] = [],
  ): any {
    return this.invokeUnboxedSync(methodObj, targetPtr, args);
  }

  public async invoke(
    methodObj: bigint,
    targetPtr = 0n,
    args: readonly any[] = [],
  ): Promise<bigint> {
    const res = await this.invokeUnboxed(methodObj, targetPtr, args);
    return typeof res === 'bigint' ? res : 0n;
  }

  public invokeSync(
    methodObj: bigint,
    targetPtr = 0n,
    args: readonly any[] = [],
  ): bigint {
    const res = this.invokeUnboxedSync(methodObj, targetPtr, args);
    return typeof res === 'bigint' ? res : 0n;
  }

  public async readField(
    classObj: bigint,
    fieldName: string,
    targetPtr = 0n,
  ): Promise<any> {
    const data = await this.postAsync('/reflection/field/get', {
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

  public readFieldSync(
    classObj: bigint,
    fieldName: string,
    targetPtr = 0n,
  ): any {
    const data = this.postSync('/reflection/field/get', {
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

  public async writeField(
    classObj: bigint,
    fieldName: string,
    value: any,
    targetPtr = 0n,
  ): Promise<void> {
    const data = await this.postAsync('/reflection/field/set', {
      classId: Number(classObj),
      fieldName,
      targetHandle: Number(targetPtr),
      value: serializeArg(value),
    });

    if (!data.success) {
      throw new Error(data.error || `Failed to write field ${fieldName}`);
    }
  }

  public writeFieldSync(
    classObj: bigint,
    fieldName: string,
    value: any,
    targetPtr = 0n,
  ): void {
    const data = this.postSync('/reflection/field/set', {
      classId: Number(classObj),
      fieldName,
      targetHandle: Number(targetPtr),
      value: serializeArg(value),
    });

    if (!data.success) {
      throw new Error(data.error || `Failed to write field ${fieldName}`);
    }
  }

  public async getFieldValueUnboxed(
    fieldObj: bigint,
    targetPtr = 0n,
  ): Promise<any> {
    const data = await this.postAsync('/reflection/field/get', {
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

  public getFieldValueUnboxedSync(fieldObj: bigint, targetPtr = 0n): any {
    const data = this.postSync('/reflection/field/get', {
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

  public async setFieldValue(
    fieldObj: bigint,
    value: any,
    targetPtr = 0n,
  ): Promise<void> {
    const data = await this.postAsync('/reflection/field/set', {
      fieldId: Number(fieldObj),
      targetHandle: Number(targetPtr),
      value: serializeArg(value),
    });

    if (!data.success) {
      throw new Error(data.error || `Failed to set field ${fieldObj}`);
    }
  }

  public setFieldValueSync(fieldObj: bigint, value: any, targetPtr = 0n): void {
    const data = this.postSync('/reflection/field/set', {
      fieldId: Number(fieldObj),
      targetHandle: Number(targetPtr),
      value: serializeArg(value),
    });

    if (!data.success) {
      throw new Error(data.error || `Failed to set field ${fieldObj}`);
    }
  }

  public async construct(
    ctorObj: bigint,
    args: readonly any[] = [],
  ): Promise<bigint> {
    const data = await this.postAsync('/reflection/construct', {
      ctorId: Number(ctorObj),
      args: serializeArgs(args),
    });

    if (!data.success) {
      throw new Error(data.error || 'Constructor invocation failed');
    }

    return BigInt(data.handle);
  }

  public constructSync(ctorObj: bigint, args: readonly any[] = []): bigint {
    const data = this.postSync('/reflection/construct', {
      ctorId: Number(ctorObj),
      args: serializeArgs(args),
    });

    if (!data.success) {
      throw new Error(data.error || 'Constructor invocation failed');
    }

    return BigInt(data.handle);
  }

  public async getObjectClass(objPtr: bigint): Promise<bigint> {
    const data = await this.postAsync('/reflection/object/class', {
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

  public getObjectClassSync(objPtr: bigint): bigint {
    const data = this.postSync('/reflection/object/class', {
      handle: Number(objPtr),
      targetHandle: Number(objPtr),
    });

    if (!data.success) {
      throw new Error(data.error || `Failed to get class for object ${objPtr}`);
    }

    const classObj = BigInt(data.classId);
    if (!this.classById.has(classObj)) {
      this.getClassSync(data.name);
    }
    return classObj;
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

  public getObjectClassNameSync(objPtr: bigint): string {
    const classObj = this.getObjectClassSync(objPtr);
    return this.getClassNameSync(classObj);
  }

  public async getAoString(objPtr: bigint): Promise<string> {
    const data = await this.postAsync('/reflection/object/string', {
      handle: Number(objPtr),
      targetHandle: Number(objPtr),
    });

    if (!data.success) {
      return `[JavaObject @ 0x${objPtr.toString(16)}]`;
    }
    return data.value;
  }

  public getAoStringSync(objPtr: bigint): string {
    const data = this.postSync('/reflection/object/string', {
      handle: Number(objPtr),
      targetHandle: Number(objPtr),
    });

    if (!data.success) {
      return `[JavaObject @ 0x${objPtr.toString(16)}]`;
    }
    return data.value;
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
    try {
      const sc = this.getClassSync(scName);
      return sc.classObj;
    } catch {
      return undefined;
    }
  }

  public async getSuperclassChain(classObj: bigint): Promise<string[]> {
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
    const chain: string[] = [];
    let currentName = this.superclassByClassId.get(classObj);
    while (currentName) {
      chain.push(currentName);
      if (currentName === 'java.lang.Object') break;
      const sc = this.getClassSync(currentName);
      currentName = this.superclassByClassId.get(sc.classObj);
    }
    return chain;
  }

  public async releaseHandles(handles: bigint[]): Promise<void> {
    if (!handles.length) return;
    await this.postAsync('/reflection/release', {
      handles: handles.map((h) => Number(h)),
    });
  }

  public releaseHandlesSync(handles: bigint[]): void {
    if (!handles.length) return;
    this.postSync('/reflection/release', {
      handles: handles.map((h) => Number(h)),
    });
  }
}

/**
 * Creates a JavaContext backed by the remote njava-agent reflection RPC bridge.
 */
export function createAgentContext(options?: {
  host?: string;
  port?: number;
  sync?: boolean;
  mapper?: JavaMappingRegistry;
  pool?: MappingPool;
}): JavaContext {
  const host = options?.host ?? '127.0.0.1';
  const port = options?.port ?? 43378;
  const sync = options?.sync ?? true;
  const bridge = new AgentReflectionBridge({ host, port });
  return createJavaContext(bridge as unknown as ReflectionBridge, {
    sync,
    mapper: options?.mapper,
    pool: options?.pool,
  });
}
