/**
 * The single source of truth for every channel name and every payload
 * shape that crosses the process boundary.
 *
 * Both sides import from here, so a rename or a payload change is a type
 * error on both ends rather than a runtime mismatch.
 *
 * ## Why these types are restated rather than imported
 *
 * This file is reachable from the renderer, so it may not import the
 * simulation engine -- not even for types. The unions below therefore
 * restate the engine's shapes instead of aliasing them. That is
 * deliberate: the contract belongs to the shell, not to the engine. The
 * main process asserts conformance at compile time (see
 * `main/modules/conformance.ts`), so if the engine ever drifts, it
 * breaks in the one place allowed to see both sides.
 *
 * ## What may appear in a payload
 *
 * The transport is `postMessage`, i.e. structured clone -- which handles
 * `bigint`, `Uint8Array`, `Map` and `Set` natively. So addresses stay
 * `bigint` and memory stays `Uint8Array`; there is no need to
 * string-encode anything the way an HTTP boundary would force. What may
 * *not* cross is anything live, cyclic, or unboundedly large: class
 * instances, the engine's CoW page tables, and whole mapping buffers.
 */

/* ---------------------------------------------------------------- app */

export const AppChannel = {
  getVersion: 'app:getVersion',
  getPath: 'app:getPath',
} as const;

export type AppPathName = 'home' | 'temp' | 'userData' | 'workspace';

export interface AppApi {
  getVersion(): Promise<string>;
  getPath(name: AppPathName): Promise<string>;
}

/* ------------------------------------------------------------ cpu core */

export type RegisterName =
  | 'RAX'
  | 'RBX'
  | 'RCX'
  | 'RDX'
  | 'RSI'
  | 'RDI'
  | 'RSP'
  | 'RBP'
  | 'RIP'
  | 'R8'
  | 'R9'
  | 'R10'
  | 'R11'
  | 'R12'
  | 'R13'
  | 'R14'
  | 'R15'
  | 'RFLAGS';

export type RegisterFile = Readonly<Record<RegisterName, bigint>>;

export type ThreadState =
  'ready' | 'running' | 'waiting' | 'stopped' | 'terminated' | 'faulted';

export type StopReason =
  'step' | 'breakpoint' | 'watchpoint' | 'halted' | 'fault';

export type MemoryProtection = 'r' | 'rw' | 'rx' | 'rwx';

/** Decoded instruction. Every member is already clone-safe. */
export interface InstructionDto {
  readonly address: bigint;
  readonly size: number;
  readonly bytes: Uint8Array;
  readonly mnemonic: string;
  readonly operands: string;
  readonly branchTarget?: bigint;
}

export interface AccessDto {
  readonly address: bigint;
  readonly size: number;
}

/**
 * Result of one instruction. Mirrors the engine's step result except
 * that a thrown `Error` is flattened to a message -- an `Error` would
 * technically clone, but the renderer has no use for an engine-internal
 * stack and shipping one invites treating it as actionable.
 */
export interface StepResultDto {
  readonly instruction: InstructionDto;
  readonly reason: StopReason;
  readonly changedRegisters: readonly RegisterName[];
  readonly memoryWrite?: AccessDto;
  readonly memoryRead?: AccessDto;
  readonly error?: string;
}

/* ------------------------------------------------------------- machine */

/**
 * A memory region's *shape*. The engine's own mapping additionally
 * carries the backing bytes and a CoW page table; both are stripped
 * here. Content is fetched explicitly and by range through
 * `MemoryChannel.read`, so listing regions never drags megabytes across
 * the boundary.
 */
export interface MappingDto {
  readonly id: string;
  readonly label: string;
  readonly base: bigint;
  readonly size: number;
  readonly protection: MemoryProtection;
}

/**
 * Everything the UI reads *synchronously* while rendering a thread.
 *
 * This is the load-bearing decision of the whole boundary. The UI reads
 * `registers.RIP` on the order of a dozen times per render; turning each
 * of those into an async call would mean rewriting every consumer around
 * promises. Instead the main process pushes a whole snapshot whenever
 * the thread stops, the renderer keeps it in state, and reads stay
 * synchronous exactly as they are today. Only *commands* are async.
 */
export interface ThreadSnapshotDto {
  readonly tid: number;
  readonly state: ThreadState;
  readonly registers: RegisterFile;
  readonly stackMappingId?: string;
  readonly lastStep?: StepResultDto;
  readonly breakpoints: readonly bigint[];
  readonly suspendCount: number;
}

/**
 * A loaded module's shape, restated so `resolveSymbol`-style label
 * lookups (`module!export`, `module+offset`) can run entirely on the
 * renderer side against the snapshot -- computing a label is cheap and
 * happens on nearly every render (registers, call stack, breakpoint
 * messages), so it must not cost a round trip. `exports` is a plain
 * array of pairs rather than the engine's `ReadonlyMap`, which does not
 * structured-clone the way a `Map` itself would need re-hydrating on the
 * other side of a type boundary that also has to stay JSON-shaped-enough
 * for `Exact<>` conformance checking in `conformance.ts`.
 */
export interface ModuleDto {
  readonly name: string;
  readonly base: bigint;
  readonly size: number;
  readonly exports: readonly (readonly [name: string, address: bigint])[];
}

export interface ProcessSnapshotDto {
  readonly pid: number;
  readonly image: string;
  readonly imageBase: bigint;
  readonly threads: readonly ThreadSnapshotDto[];
  readonly mappings: readonly MappingDto[];
  readonly modules: readonly ModuleDto[];
}

export const MachineChannel = {
  listProcesses: 'machine:listProcesses',
  getProcess: 'machine:getProcess',
  createDemoProcess: 'machine:createDemoProcess',
  /** push: the process list changed (spawned/exited). */
  onDidChangeProcesses: 'machine:onDidChangeProcesses',
} as const;

export interface MachineApi {
  listProcesses(): Promise<readonly ProcessSnapshotDto[]>;
  getProcess(pid: number): Promise<ProcessSnapshotDto | undefined>;
  createDemoProcess(): Promise<ProcessSnapshotDto>;
  onDidChangeProcesses(listener: () => void): () => void;
}

/* --------------------------------------------------------------- debug */

export const DebugChannel = {
  getThread: 'debug:getThread',
  step: 'debug:step',
  stepOver: 'debug:stepOver',
  stepOut: 'debug:stepOut',
  continueRun: 'debug:continueRun',
  runToCursor: 'debug:runToCursor',
  getCallStack: 'debug:getCallStack',
  writeRegister: 'debug:writeRegister',
  addBreakpoint: 'debug:addBreakpoint',
  removeBreakpoint: 'debug:removeBreakpoint',
  disassemble: 'debug:disassemble',
  decode: 'debug:decode',
  /** push: a thread stopped; payload is a fresh {@link ThreadSnapshotDto}. */
  onDidChangeThread: 'debug:onDidChangeThread',
} as const;

export interface DebugThreadRef {
  readonly pid: number;
  readonly tid: number;
}

/**
 * Why a multi-step run stopped. Mirrors the pre-shell `useDebugSession`'s
 * `RunStop` union exactly -- Step Over/Step Out/Continue/Run-to-Cursor
 * each run a bounded, condition-specific loop (their stop condition is a
 * closure over local values like a call's own return address, which
 * cannot cross the IPC boundary), so each gets its own channel operation
 * that runs the *entire* loop inside the main process and reports back
 * once, rather than the renderer driving `step()` one instruction at a
 * time over dozens of thousands of round trips.
 */
export type RunStopReason =
  | 'target'
  | 'breakpoint'
  | 'int3'
  | 'fault'
  | 'halted'
  | 'budget'
  | 'terminated'
  | 'waiting'
  | 'error';

export interface RunOutcomeDto {
  readonly executed: number;
  readonly lastStep?: StepResultDto;
  /** Capped the same way the pre-shell trace panel capped it client-side -- a 50k-step Continue must not ship 50k instructions. */
  readonly trace: readonly InstructionDto[];
  readonly stop: RunStopReason;
  readonly error?: string;
}

export interface DebugApi {
  getThread(ref: DebugThreadRef): Promise<ThreadSnapshotDto | undefined>;
  /** Runs `count` instructions, then pushes a snapshot. Returns the last step. */
  step(ref: DebugThreadRef, count?: number): Promise<StepResultDto | undefined>;
  /** Single steps unless RIP is on a `call`, in which case it runs to that call's own return. */
  stepOver(ref: DebugThreadRef): Promise<RunOutcomeDto>;
  /** Runs until the current frame's own `ret`, tracking call/ret depth. */
  stepOut(ref: DebugThreadRef): Promise<RunOutcomeDto>;
  /** Runs until a breakpoint, fault, halt, or termination. */
  continueRun(ref: DebugThreadRef): Promise<RunOutcomeDto>;
  /** Runs until `target`, honoring every other breakpoint on the way. */
  runToCursor(ref: DebugThreadRef, target: bigint): Promise<RunOutcomeDto>;
  /** RIP followed by up to 16 executable return addresses found walking the stack. */
  getCallStack(ref: DebugThreadRef): Promise<readonly bigint[]>;
  /** The debugger's one write into CPU register state -- a `SetThreadContext`-style edit. */
  writeRegister(
    ref: DebugThreadRef,
    name: RegisterName,
    value: bigint,
  ): Promise<void>;
  addBreakpoint(ref: DebugThreadRef, address: bigint): Promise<void>;
  removeBreakpoint(ref: DebugThreadRef, address: bigint): Promise<void>;
  disassemble(
    ref: DebugThreadRef,
    address: bigint,
    count: number,
  ): Promise<readonly InstructionDto[]>;
  decode(
    ref: DebugThreadRef,
    address: bigint,
  ): Promise<InstructionDto | undefined>;
  onDidChangeThread(
    listener: (snapshot: ThreadSnapshotDto) => void,
  ): () => void;
}

/* -------------------------------------------------------------- memory */

export const MemoryChannel = {
  read: 'memory:read',
  write: 'memory:write',
  listMappings: 'memory:listMappings',
  findMapping: 'memory:findMapping',
} as const;

export interface MemoryApi {
  /**
   * Debugger reads are small (a hex view's worth), so the bytes are just
   * cloned. The engine hands back a fresh copy already, so switching to a
   * zero-copy transfer here would be safe -- it is simply not worth the
   * plumbing until something moves far more.
   */
  read(pid: number, address: bigint, length: number): Promise<Uint8Array>;
  write(pid: number, address: bigint, bytes: Uint8Array): Promise<void>;
  listMappings(pid: number): Promise<readonly MappingDto[]>;
  findMapping(pid: number, address: bigint): Promise<MappingDto | undefined>;
}

/* ---------------------------------------------------------------- scan */

export type ScanValueType =
  'i8' | 'i16' | 'i32' | 'i64' | 'f32' | 'f64' | 'bytes' | 'string';

export type ScanStringEncoding = 'ascii' | 'utf16';

/** Every variant is structured-clone safe, so values cross unchanged. */
export type ScanValue = bigint | number | string | Uint8Array;

export type FirstScanCompare = 'exact' | 'unknown';

export type NextScanCompare =
  | 'exact'
  | 'changed'
  | 'unchanged'
  | 'increased'
  | 'decreased'
  | 'bigger-than'
  | 'smaller-than';

export interface ScanRange {
  readonly start: bigint;
  /** Exclusive. */
  readonly end: bigint;
}

export interface FirstScanOptions {
  readonly type: ScanValueType;
  readonly compare?: FirstScanCompare;
  readonly value?: ScanValue;
  readonly alignment?: number;
  readonly encoding?: ScanStringEncoding;
  readonly mappingIds?: readonly string[];
  readonly range?: ScanRange;
}

export interface NextScanOptions {
  readonly compare: NextScanCompare;
  readonly value?: ScanValue;
}

export interface ScanResultDto {
  readonly address: bigint;
  readonly value: ScanValue;
  readonly previousValue: ScanValue;
}

/**
 * A page of surviving candidates plus the full count.
 *
 * The engine caps `results` itself and reports `truncated`, so a scan
 * that matches millions of addresses still crosses the boundary as a
 * bounded payload. That cap is why this channel needs no batching or
 * zero-copy transfer scheme of its own.
 */
export interface ScanReportDto {
  readonly type: ScanValueType;
  readonly valueSize: number;
  readonly total: number;
  readonly results: readonly ScanResultDto[];
  readonly truncated: boolean;
}

export const ScanChannel = {
  first: 'scan:first',
  next: 'scan:next',
  page: 'scan:page',
  reset: 'scan:reset',
  readValue: 'scan:readValue',
  writeValue: 'scan:writeValue',
  readTypedValue: 'scan:readTypedValue',
  writeTypedValue: 'scan:writeTypedValue',
  freeze: 'scan:freeze',
  unfreeze: 'scan:unfreeze',
  isFrozen: 'scan:isFrozen',
  frozenCount: 'scan:frozenCount',
} as const;

export interface ScanApi {
  /** Starts a fresh search, discarding any previous candidate set. */
  first(pid: number, options: FirstScanOptions): Promise<ScanReportDto>;
  /** Narrows the surviving candidates from the previous scan. */
  next(pid: number, options: NextScanOptions): Promise<ScanReportDto>;
  /** Re-reads the current candidates without narrowing them. */
  page(pid: number, offset?: number, limit?: number): Promise<ScanReportDto>;
  reset(pid: number): Promise<void>;
  /** Decodes with the scanner's *own* current type -- for reading a scan result row. */
  readValue(pid: number, address: bigint): Promise<ScanValue>;
  writeValue(pid: number, address: bigint, value: ScanValue): Promise<void>;
  /**
   * Decodes with an explicitly given type/encoding rather than the
   * scanner's current one -- a pinned watch row keeps reading at the
   * width it was added with even after the scanner itself moves on to
   * scanning a different type.
   */
  readTypedValue(
    pid: number,
    address: bigint,
    length: number,
    type: ScanValueType,
    encoding?: ScanStringEncoding,
  ): Promise<ScanValue>;
  /** Returns the exact bytes written, so a caller can hand them straight to `freeze`. */
  writeTypedValue(
    pid: number,
    address: bigint,
    type: ScanValueType,
    value: ScanValue,
    encoding?: ScanStringEncoding,
  ): Promise<Uint8Array>;
  /** Pins an address to `bytes`, rewritten back on every thread stop until unfrozen. */
  freeze(pid: number, address: bigint, bytes: Uint8Array): Promise<void>;
  unfreeze(pid: number, address: bigint): Promise<void>;
  isFrozen(pid: number, address: bigint): Promise<boolean>;
  frozenCount(pid: number): Promise<number>;
}

/* ------------------------------------------------------------------ fs */

/**
 * Restates the engine's `FileType` enum as a string union rather than
 * importing it, for the same reason every other DTO in this file does:
 * `simulate/files` is itself part of the simulate package, and
 * this file is reachable from the renderer.
 *
 * Paths are plain POSIX-style strings, not `ResourceUri` -- the renderer
 * has no reason to know that type exists. The main process is the only
 * place that turns a path back into a `ResourceUri` to hand to a
 * `FileSystemProvider`.
 */
export type FileKind = 'file' | 'directory' | 'symlink' | 'unknown';

export interface FileStatDto {
  readonly kind: FileKind;
  readonly ctime: number;
  readonly mtime: number;
  readonly size: number;
  readonly readonly: boolean;
}

export type DirectoryEntryDto = readonly [name: string, kind: FileKind];

export interface WriteFileOptions {
  readonly create?: boolean;
  readonly overwrite?: boolean;
}

export interface DeleteOptions {
  readonly recursive?: boolean;
}

export interface RenameOptions {
  readonly overwrite?: boolean;
}

export type FileChangeKind = 'added' | 'updated' | 'deleted';

export interface FileChangeDto {
  readonly kind: FileChangeKind;
  readonly path: string;
}

export const FsChannel = {
  stat: 'fs:stat',
  readDirectory: 'fs:readDirectory',
  readFile: 'fs:readFile',
  writeFile: 'fs:writeFile',
  createDirectory: 'fs:createDirectory',
  delete: 'fs:delete',
  rename: 'fs:rename',
  /** push: files changed under the currently bound workspace. */
  onDidChangeFile: 'fs:onDidChangeFile',
} as const;

export interface FsApi {
  stat(path: string): Promise<FileStatDto>;
  readDirectory(path: string): Promise<readonly DirectoryEntryDto[]>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(
    path: string,
    content: Uint8Array,
    options?: WriteFileOptions,
  ): Promise<void>;
  createDirectory(path: string): Promise<void>;
  delete(path: string, options?: DeleteOptions): Promise<void>;
  rename(
    source: string,
    target: string,
    options?: RenameOptions,
  ): Promise<void>;
  onDidChangeFile(
    listener: (changes: readonly FileChangeDto[]) => void,
  ): () => void;
}

/* --------------------------------------------------------------- workspace */

/**
 * Where the workspace root points, going forward. `empty` resets it back
 * to the default folder (`WIN32_WORKSPACE_PATH`). `simulate-path` re-roots
 * it at any existing directory already reachable in `machine.fileSystem`
 * -- picked by browsing the simulate tree itself (see `WorkspaceChannel.
 * browseSimulateTree`), not the host disk. `zip` carries a user-picked
 * archive's raw bytes; the main process extracts it into a fixed location
 * (`C:\Users\Serkan\Zips\<archive name>\...`, always overwriting a
 * same-named prior extraction) and re-roots there.
 *
 * Re-rooting is a pure channel-path-mapping change (see `workspace-paths.
 * ts`'s `root` parameter), never a copy -- but note the underlying
 * `machine.fileSystem` itself is session-only (see `workspace.ts`'s doc
 * comment): switching roots never loses anything *within this session*,
 * but nothing here survives a reload unless a VM snapshot was taken first.
 */
export type WorkspaceSource =
  | { readonly type: 'empty' }
  | { readonly type: 'simulate-path'; readonly path: string }
  | { readonly type: 'zip'; readonly name: string; readonly bytes: Uint8Array };

export interface WorkspaceInfoDto {
  readonly rootName: string;
  /** Absolute `Win32FileSystem` path the workspace root currently points at, e.g. `C:\Users\Serkan\Workspace`. */
  readonly rootPath: string;
  /** Human-readable provenance, e.g. `"oturum içi (yalnızca snapshot alınırsa kalıcı olur)"`, `"simulate: C:\Windows\System32"`, `"zip: archive.zip"`. */
  readonly sourceLabel: string;
}

export const WorkspaceChannel = {
  bind: 'workspace:bind',
  getInfo: 'workspace:getInfo',
  /** Lists a directory's immediate children anywhere in `machine.fileSystem`, by absolute path -- unlike `FsChannel`, never workspace-root-relative. Powers `SimulateFolderPicker`'s folder browser. */
  browseSimulateTree: 'workspace:browseSimulateTree',
  /** Absolute-path counterparts of `FsChannel`'s create/delete/rename, for managing the simulate tree from `SimulateFolderPicker` while browsing -- not tied to the current workspace root the way `FsChannel` is. Directory delete/rename are recursive (`Win32FileSystem.deleteDirectory`/`rename`). */
  createSimulateDirectory: 'workspace:createSimulateDirectory',
  deleteSimulateEntry: 'workspace:deleteSimulateEntry',
  renameSimulateEntry: 'workspace:renameSimulateEntry',
  /** push: the bound workspace changed (a new `bind()` call replaced it). */
  onDidChangeRoot: 'workspace:onDidChangeRoot',
} as const;

export interface WorkspaceApi {
  bind(source: WorkspaceSource): Promise<WorkspaceInfoDto>;
  getInfo(): Promise<WorkspaceInfoDto | undefined>;
  browseSimulateTree(path: string): Promise<readonly DirectoryEntryDto[]>;
  createSimulateDirectory(path: string): Promise<void>;
  deleteSimulateEntry(path: string): Promise<void>;
  renameSimulateEntry(source: string, target: string): Promise<void>;
  onDidChangeRoot(listener: (info: WorkspaceInfoDto) => void): () => void;
}

/* --------------------------------------------------------------- terminal */

/**
 * A `cmd.exe` session over `Win32CommandPrompt`. `execute()` on the
 * engine side is synchronous, but a `node <file>.js` child it launches
 * keeps running asynchronously afterwards (through the engine's own
 * Node host bridge) -- so output cannot be a return value, only a push.
 * `create` returns once the session exists; every byte the session ever
 * prints, including everything printed after `execute()` already
 * returned, arrives through `onData`.
 */
export interface TerminalSessionInfo {
  readonly id: string;
  /**
   * Everything `cmd.exe` printed before the caller had a chance to call
   * `onData` -- its startup banner and first prompt, drained and
   * returned synchronously as part of `create()`'s own reply rather than
   * pushed as a separate event. A separate push would race: it can only
   * be sent *before* the reply (see `terminal.ts`), which is *before*
   * the caller's own `create()` await even returns, so any `onData`
   * subscription added after `await create()` -- the natural place to
   * add one -- would already have missed it. Returning it inline has no
   * such race.
   */
  readonly initialOutput: string;
}

export interface TerminalDataEvent {
  readonly sessionId: string;
  readonly chunk: string;
}

export interface TerminalCloseEvent {
  readonly sessionId: string;
}

export const TerminalChannel = {
  create: 'terminal:create',
  sendLine: 'terminal:sendLine',
  dispose: 'terminal:dispose',
  /** push: an output chunk for a specific session. */
  onData: 'terminal:onData',
  /** push: a session's `cmd.exe` exited. */
  onClose: 'terminal:onClose',
} as const;

export interface TerminalCreateOptions {
  /**
   * Renders through `ConsoleScreenPresenter` (screen-buffer diff -> ANSI)
   * instead of the plain `drainHostText()` byte queue. Both deliver the
   * same wire shape (plain text chunks over `onData`, ANSI-included) --
   * only how main produces those chunks differs. Required for full
   * fidelity with anything that writes the console screen buffer
   * directly (`SetConsoleCursorPosition`, `FillConsoleOutputCharacterA`,
   * `SetConsoleTextAttribute` -- e.g. this repo's own `cls.exe`), which
   * `drainHostText()`'s `WriteFile`-only byte queue never sees at all.
   */
  readonly presenter?: boolean;
}

export interface TerminalApi {
  create(options?: TerminalCreateOptions): Promise<TerminalSessionInfo>;
  sendLine(sessionId: string, line: string): Promise<void>;
  dispose(sessionId: string): Promise<void>;
  onData(listener: (event: TerminalDataEvent) => void): () => void;
  onClose(listener: (event: TerminalCloseEvent) => void): () => void;
}

/* -------------------------------------------------------------- snapshot */

/**
 * A named, permanently-stored VM state checkpoint (QEMU-style `savevm`) --
 * a whole `Win64Machine.snapshot()` result (processes/threads/registers/
 * memory/kernel objects/scheduler, see that method's own doc comment for
 * exactly what it captures and excludes), never the filesystem. Manual
 * only: created from the "VM Snapshots" tab, never automatically.
 *
 * The renderer only ever sees this metadata, never the underlying
 * `Win64MachineSnapshot` blob -- same "DTO not live object" discipline as
 * every other channel here, just with the live object being a whole
 * machine instead of one process/thread.
 */
export interface SnapshotMetaDto {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  /**
   * Non-fatal caveats from `Win64Machine.getSnapshotWarnings()` at the
   * moment this snapshot was taken -- e.g. a background node.exe/FFI
   * operation in flight. Every snapshot of a live session normally carries
   * at least one (the shell's own `exoproc-ide.exe` process parks exactly
   * this way) -- routine information, not a failure.
   */
  readonly warnings: readonly string[];
}

export const SnapshotChannel = {
  list: 'snapshot:list',
  create: 'snapshot:create',
  restore: 'snapshot:restore',
  remove: 'snapshot:remove',
  /** push: the snapshot list changed (created/deleted). */
  onDidChangeList: 'snapshot:onDidChangeList',
} as const;

export interface SnapshotApi {
  list(): Promise<readonly SnapshotMetaDto[]>;
  create(name: string): Promise<SnapshotMetaDto>;
  restore(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  onDidChangeList(listener: () => void): () => void;
}
