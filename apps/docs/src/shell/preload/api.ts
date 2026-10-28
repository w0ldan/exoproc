import {
  AppChannel,
  DebugChannel,
  FsChannel,
  MachineChannel,
  MemoryChannel,
  ScanChannel,
  SnapshotChannel,
  TerminalChannel,
  WorkspaceChannel,
  type AppApi,
  type AppPathName,
  type DebugApi,
  type DebugThreadRef,
  type DeleteOptions,
  type DirectoryEntryDto,
  type FileChangeDto,
  type FileStatDto,
  type FsApi,
  type InstructionDto,
  type MachineApi,
  type MappingDto,
  type MemoryApi,
  type ProcessSnapshotDto,
  type RenameOptions,
  type RunOutcomeDto,
  type ScanApi,
  type ScanReportDto,
  type ScanValue,
  type SnapshotApi,
  type SnapshotMetaDto,
  type StepResultDto,
  type TerminalApi,
  type TerminalCloseEvent,
  type TerminalDataEvent,
  type TerminalSessionInfo,
  type ThreadSnapshotDto,
  type WorkspaceApi,
  type WorkspaceInfoDto,
  type WorkspaceSource,
  type WriteFileOptions,
} from '../common/channels';
import type { ShellConnection } from '../renderer/ipc';

/**
 * The complete surface the renderer is allowed to see. Raw channel names
 * stop here: above this file nothing knows a channel exists, only that
 * `exoproc.debug.step(ref)` resolves.
 */
export interface ExoprocApi {
  readonly app: AppApi;
  readonly machine: MachineApi;
  readonly debug: DebugApi;
  readonly scan: ScanApi;
  readonly workspace: WorkspaceApi;
  readonly fs: FsApi;
  readonly terminal: TerminalApi;
  readonly memory: MemoryApi;
  readonly snapshot: SnapshotApi;
}

export function createApi(connection: ShellConnection): ExoprocApi {
  return {
    app: {
      getVersion: () => connection.invoke<string>(AppChannel.getVersion),
      getPath: (name: AppPathName) =>
        connection.invoke<string>(AppChannel.getPath, name),
    },

    machine: {
      listProcesses: () =>
        connection.invoke<readonly ProcessSnapshotDto[]>(
          MachineChannel.listProcesses,
        ),
      getProcess: (pid) =>
        connection.invoke<ProcessSnapshotDto | undefined>(
          MachineChannel.getProcess,
          pid,
        ),
      createDemoProcess: () =>
        connection.invoke<ProcessSnapshotDto>(MachineChannel.createDemoProcess),
      onDidChangeProcesses: (listener) =>
        connection.on(MachineChannel.onDidChangeProcesses, listener),
    },

    debug: {
      getThread: (ref: DebugThreadRef) =>
        connection.invoke<ThreadSnapshotDto | undefined>(
          DebugChannel.getThread,
          ref,
        ),
      step: (ref, count) =>
        connection.invoke<StepResultDto | undefined>(
          DebugChannel.step,
          ref,
          count,
        ),
      stepOver: (ref) =>
        connection.invoke<RunOutcomeDto>(DebugChannel.stepOver, ref),
      stepOut: (ref) =>
        connection.invoke<RunOutcomeDto>(DebugChannel.stepOut, ref),
      continueRun: (ref) =>
        connection.invoke<RunOutcomeDto>(DebugChannel.continueRun, ref),
      runToCursor: (ref, target) =>
        connection.invoke<RunOutcomeDto>(DebugChannel.runToCursor, ref, target),
      getCallStack: (ref) =>
        connection.invoke<readonly bigint[]>(DebugChannel.getCallStack, ref),
      writeRegister: (ref, name, value) =>
        connection.invoke<void>(DebugChannel.writeRegister, ref, name, value),
      addBreakpoint: (ref, address) =>
        connection.invoke<void>(DebugChannel.addBreakpoint, ref, address),
      removeBreakpoint: (ref, address) =>
        connection.invoke<void>(DebugChannel.removeBreakpoint, ref, address),
      disassemble: (ref, address, count) =>
        connection.invoke<readonly InstructionDto[]>(
          DebugChannel.disassemble,
          ref,
          address,
          count,
        ),
      decode: (ref, address) =>
        connection.invoke<InstructionDto | undefined>(
          DebugChannel.decode,
          ref,
          address,
        ),
      onDidChangeThread: (listener) =>
        connection.on(DebugChannel.onDidChangeThread, listener),
    },

    scan: {
      first: (pid, options) =>
        connection.invoke<ScanReportDto>(ScanChannel.first, pid, options),
      next: (pid, options) =>
        connection.invoke<ScanReportDto>(ScanChannel.next, pid, options),
      page: (pid, offset, limit) =>
        connection.invoke<ScanReportDto>(ScanChannel.page, pid, offset, limit),
      reset: (pid) => connection.invoke<void>(ScanChannel.reset, pid),
      readValue: (pid, address) =>
        connection.invoke<ScanValue>(ScanChannel.readValue, pid, address),
      writeValue: (pid, address, value) =>
        connection.invoke<void>(ScanChannel.writeValue, pid, address, value),
      readTypedValue: (pid, address, length, type, encoding) =>
        connection.invoke<ScanValue>(
          ScanChannel.readTypedValue,
          pid,
          address,
          length,
          type,
          encoding,
        ),
      writeTypedValue: (pid, address, type, value, encoding) =>
        connection.invoke<Uint8Array>(
          ScanChannel.writeTypedValue,
          pid,
          address,
          type,
          value,
          encoding,
        ),
      freeze: (pid, address, bytes) =>
        connection.invoke<void>(ScanChannel.freeze, pid, address, bytes),
      unfreeze: (pid, address) =>
        connection.invoke<void>(ScanChannel.unfreeze, pid, address),
      isFrozen: (pid, address) =>
        connection.invoke<boolean>(ScanChannel.isFrozen, pid, address),
      frozenCount: (pid) =>
        connection.invoke<number>(ScanChannel.frozenCount, pid),
    },

    workspace: {
      bind: (source: WorkspaceSource) =>
        connection.invoke<WorkspaceInfoDto>(WorkspaceChannel.bind, source),
      getInfo: () =>
        connection.invoke<WorkspaceInfoDto | undefined>(
          WorkspaceChannel.getInfo,
        ),
      browseSimulateTree: (path: string) =>
        connection.invoke<readonly DirectoryEntryDto[]>(
          WorkspaceChannel.browseSimulateTree,
          path,
        ),
      createSimulateDirectory: (path: string) =>
        connection.invoke<void>(WorkspaceChannel.createSimulateDirectory, path),
      deleteSimulateEntry: (path: string) =>
        connection.invoke<void>(WorkspaceChannel.deleteSimulateEntry, path),
      renameSimulateEntry: (source: string, target: string) =>
        connection.invoke<void>(
          WorkspaceChannel.renameSimulateEntry,
          source,
          target,
        ),
      onDidChangeRoot: (listener) =>
        connection.on(WorkspaceChannel.onDidChangeRoot, listener),
    },

    fs: {
      stat: (path: string) =>
        connection.invoke<FileStatDto>(FsChannel.stat, path),
      readDirectory: (path: string) =>
        connection.invoke<readonly DirectoryEntryDto[]>(
          FsChannel.readDirectory,
          path,
        ),
      readFile: (path: string) =>
        connection.invoke<Uint8Array>(FsChannel.readFile, path),
      writeFile: (
        path: string,
        content: Uint8Array,
        options?: WriteFileOptions,
      ) => connection.invoke<void>(FsChannel.writeFile, path, content, options),
      createDirectory: (path: string) =>
        connection.invoke<void>(FsChannel.createDirectory, path),
      delete: (path: string, options?: DeleteOptions) =>
        connection.invoke<void>(FsChannel.delete, path, options),
      rename: (source: string, target: string, options?: RenameOptions) =>
        connection.invoke<void>(FsChannel.rename, source, target, options),
      onDidChangeFile: (listener) =>
        connection.on<readonly FileChangeDto[]>(
          FsChannel.onDidChangeFile,
          listener,
        ),
    },

    terminal: {
      create: (options) =>
        connection.invoke<TerminalSessionInfo>(TerminalChannel.create, options),
      sendLine: (sessionId, line) =>
        connection.invoke<void>(TerminalChannel.sendLine, sessionId, line),
      dispose: (sessionId) =>
        connection.invoke<void>(TerminalChannel.dispose, sessionId),
      onData: (listener) =>
        connection.on<TerminalDataEvent>(TerminalChannel.onData, listener),
      onClose: (listener) =>
        connection.on<TerminalCloseEvent>(TerminalChannel.onClose, listener),
    },

    memory: {
      read: (pid, address, length) =>
        connection.invoke<Uint8Array>(MemoryChannel.read, pid, address, length),
      write: (pid, address, bytes) =>
        connection.invoke<void>(MemoryChannel.write, pid, address, bytes),
      listMappings: (pid) =>
        connection.invoke<readonly MappingDto[]>(
          MemoryChannel.listMappings,
          pid,
        ),
      findMapping: (pid, address) =>
        connection.invoke<MappingDto | undefined>(
          MemoryChannel.findMapping,
          pid,
          address,
        ),
    },

    snapshot: {
      list: () =>
        connection.invoke<readonly SnapshotMetaDto[]>(SnapshotChannel.list),
      create: (name) =>
        connection.invoke<SnapshotMetaDto>(SnapshotChannel.create, name),
      restore: (id) => connection.invoke<void>(SnapshotChannel.restore, id),
      remove: (id) => connection.invoke<void>(SnapshotChannel.remove, id),
      onDidChangeList: (listener) =>
        connection.on(SnapshotChannel.onDidChangeList, listener),
    },
  };
}
