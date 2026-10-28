import { log } from './logger.js';
import {
  NativePointer,
  NativeMemory,
  Pattern,
  ScanResult,
  ScanEntry,
  resolveAddress,
} from 'bun-xffi';
import { Kernel32Impl, PsapiImpl, ToolhelpSnapshotFlag } from 'bun-xffi';
type HANDLE = bigint;
type HMODULE = bigint;
import { Handle } from './handle.js';
import { resolveEncoding } from './encoding.js';
import {
  ModuleClosedError,
  ModuleNotFoundError,
  ModuleInfoError,
  ProcAddressError,
} from './errors.js';
import { ToolhelpSnapshot, ModuleEntry } from './snapshot.js';
import { currentProcess } from './process.js';
function getModuleLog() {
  return log.add('Module');
}

const moduleLog = {
  info: (m: string, d?: unknown) => getModuleLog().info(m, d),
  warn: (m: string, d?: unknown) => getModuleLog().warn(m, d),
  debug: (m: string, d?: unknown) => getModuleLog().debug(m, d),
  error: (m: string, d?: unknown) => getModuleLog().error(m, d),
  fatal: (m: string, d?: unknown) => getModuleLog().fatal(m, d),
  trace: (m: string, d?: unknown) => getModuleLog().trace(m, d),
};
export const STATIC_MODULES: Record<string, string> = {
  ntdll: 'ntdll.dll',
  kernel32: 'kernel32.dll',
  kernelbase: 'kernelbase.dll',
  crt: 'msvcrt.dll',
};
/**
 * Represents a loaded module
 */
export class Module extends Handle {
  protected _name: string;
  public readonly base: NativeMemory;
  public readonly size: number;
  public readonly entryPoint: NativePointer;
  public readonly end: NativePointer;
  // Type declarations for dynamically generated static getters
  declare static readonly ntdll: Module;
  declare static readonly kernel32: Module;
  declare static readonly kernelbase: Module;
  declare static readonly crt: Module;
  private static _staticCache: Record<string, Module> = {};
  constructor(handle: HMODULE, name: string) {
    // Module handles from GetModuleHandle should not be closed with CloseHandle
    super(handle as unknown as HANDLE);
    this._name = name;
    const processHandle = Kernel32Impl.GetCurrentProcess();
    const moduleInfoBuffer = Buffer.alloc(24); // sizeof(MODULEINFO)
    let success = false;
    try {
      success = Boolean(
        PsapiImpl.GetModuleInformation(
          processHandle,
          handle,
          moduleInfoBuffer,
          24,
        ),
      );
    } catch {}

    if (success) {
      const baseAddr = moduleInfoBuffer.readBigUInt64LE(0);
      this.size = moduleInfoBuffer.readUInt32LE(8);
      this.base = new NativeMemory(baseAddr, this.size);
      this.entryPoint = new NativePointer(moduleInfoBuffer.readBigUInt64LE(16));
      this.end = new NativePointer(
        BigInt(this.base.address) + BigInt(this.size),
      );
    } else {
      // Robust Fallback: In Win32 / Wine, HMODULE is the base virtual address of the mapped PE image.
      // Read SizeOfImage and AddressOfEntryPoint directly from PE headers in memory.
      try {
        const baseAddr = BigInt(handle);
        const dosHeader = Buffer.alloc(0x40);
        Kernel32Impl.ReadProcessMemory(
          processHandle,
          baseAddr,
          dosHeader,
          0x40,
          0,
        );
        const e_lfanew = dosHeader.readUInt32LE(0x3c);
        const ntHeaders = Buffer.alloc(0x100);
        Kernel32Impl.ReadProcessMemory(
          processHandle,
          baseAddr + BigInt(e_lfanew),
          ntHeaders,
          0x100,
          0,
        );
        // OptionalHeader for PE32+ (64-bit):
        // Offset 0x18: OptionalHeader starts
        // +16 (offset 0x28): AddressOfEntryPoint (uint32 RVA)
        // +56 (offset 0x50): SizeOfImage (uint32)
        const entryPointRva = ntHeaders.readUInt32LE(0x18 + 16);
        const sizeOfImage = ntHeaders.readUInt32LE(0x18 + 56);
        this.size = sizeOfImage;
        this.base = new NativeMemory(baseAddr, this.size);
        this.entryPoint = new NativePointer(baseAddr + BigInt(entryPointRva));
        this.end = new NativePointer(baseAddr + BigInt(this.size));
      } catch {
        throw new ModuleInfoError(name);
      }
    }
  }
  /**
   * Gets a module handle for the specified module name
   * Automatically detects if the name is ANSI or Unicode
   * @param name Module name (e.g., 'kernel32.dll')
   */
  static get(name: string): Module {
    const lowerName = name.toLowerCase();
    // Fast path for static core modules to prevent redundant handle requests
    for (const key of Object.keys(STATIC_MODULES)) {
      if (
        lowerName === STATIC_MODULES[key]?.toLowerCase() &&
        this._staticCache[key]
      ) {
        return this._staticCache[key];
      }
    }
    moduleLog.debug(`Getting module handle for: ${name}`);
    const [buffer, getModuleHandle] = resolveEncoding(
      Kernel32Impl.GetModuleHandleA,
      Kernel32Impl.GetModuleHandleW,
      name,
    );
    const handle = getModuleHandle(buffer);
    if (!handle) {
      throw new ModuleNotFoundError(name);
    }
    return new Module(handle, name);
  }
  /**
   * Loads a module into the current process.
   * Automatically switches between ANSI and Unicode versions of LoadLibrary.
   * @param name Name or path of the module to load.
   */
  static load(name: string): Module {
    moduleLog.debug(`Loading module: ${name}`);
    const [buffer, loadLibrary] = resolveEncoding(
      Kernel32Impl.LoadLibraryA,
      Kernel32Impl.LoadLibraryW,
      name,
    );
    const handle = loadLibrary(buffer);
    if (!handle) {
      throw new ModuleNotFoundError(name);
    }
    return new Module(handle, name);
  }
  /**
   * Enumerates all modules of a process, optionally filtered by process ID.
   * @param pid Process ID (0 = current process)
   */
  static getModules(pid: number = 0): ModuleEntry[] {
    const snapshot = new ToolhelpSnapshot(
      (ToolhelpSnapshotFlag.SNAPMODULE |
        ToolhelpSnapshotFlag.SNAPMODULE32) as ToolhelpSnapshotFlag,
      pid,
    );
    const entries = [...snapshot.getModules()];
    snapshot.close();
    return entries;
  }
  /**
   * Frees the loaded library.
   * @returns true if successful.
   */
  override async free(): Promise<boolean> {
    if (!this.isValid()) return false;
    moduleLog.debug(`Freeing ${this}`);
    const success = Kernel32Impl.FreeLibrary(this.rawHandle as HMODULE);
    return !!success;
  }
  getProcAddress(procName: string): NativePointer {
    if (!this.isValid()) throw new ModuleClosedError();
    const address = Kernel32Impl.GetProcAddress(
      this.rawHandle as HMODULE,
      procName,
    );
    if (!address) {
      throw new ProcAddressError(procName);
    }
    return new NativePointer(address as unknown as bigint);
  }
  get name(): string {
    return this._name;
  }
  /**
   * Finds pattern matches within this module.
   * Configure limit and protect filter on the Pattern object.
   * @returns ScanResult with each entry tagged with this module
   */
  findPattern(pattern: Pattern): ScanResult {
    const size = this.base.size;
    const startAddr = BigInt(resolveAddress(this.base.address));
    const generator = async function* (mod: Module) {
      try {
        for await (const ptr of currentProcess.memory.scan(
          startAddr,
          size,
          pattern,
        )) {
          yield new ScanEntry(BigInt(resolveAddress(ptr)), pattern.length, mod);
        }
      } catch {
        // Range partially unmapped or scan finished
      }
    };
    return new ScanResult(generator(this), pattern);
  }
  /**
   * Finds pattern matches across specified modules (default: all static modules).
   * Each entry in the result is tagged with its source module.
   * Configure limit and protect filter on the Pattern object.
   */
  static scan(
    pattern: Pattern,
    moduleNames: string[] = Object.values(STATIC_MODULES),
  ): ScanResult {
    return new ScanResult(Module.scanGenerator(pattern, moduleNames), pattern);
  }
  private static async *scanGenerator(
    pattern: Pattern,
    moduleNames: string[],
  ): AsyncGenerator<ScanEntry, void, undefined> {
    for (const name of moduleNames) {
      try {
        const mod = Module.get(name);
        yield* mod.findPattern(pattern);
      } catch (err) {
        moduleLog.warn(`scan: Failed to process module ${name}: ${err}`);
      }
    }
  }
  override toString(): string {
    return `Module(${this.name})[${this.base.toString()}-${this.end.toString()}]`;
  }
  /**
   * Checks if the module is still loaded in the process.
   * Uses GetModuleHandleEx with GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS and
   * GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT.
   */
  isLoaded(): boolean {
    const GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT = 0x00000002;
    const GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS = 0x00000004;
    const hModuleOut = Buffer.alloc(8);
    const success = Kernel32Impl.GetModuleHandleExA(
      GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT |
        GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
      this.base.address as any,
      hModuleOut,
    );
    const isValid = !!success;
    if (!isValid) {
      this.closed = true;
    }
    return isValid;
  }
}
// Initialize dynamic static getters for modules
for (const [propName, dllName] of Object.entries(STATIC_MODULES)) {
  Object.defineProperty(Module, propName, {
    get() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const self = Module as any;
      if (!self._staticCache[propName]) {
        self._staticCache[propName] = Module.get(dllName);
      }
      return self._staticCache[propName];
    },
    enumerable: true,
    configurable: true,
  });
}
