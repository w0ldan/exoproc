import type { Win64Heap } from './heap.js';
import type { CoWMapping } from './physical-memory.js';

export type X64RegisterName =
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

export type X64GeneralRegister = Exclude<X64RegisterName, 'RIP' | 'RFLAGS'>;

export type MemoryProtection = 'r' | 'rw' | 'rx' | 'rwx';

export interface X64Registers extends Record<X64RegisterName, bigint> {}

export const STD_INPUT_HANDLE = -10;
export const STD_OUTPUT_HANDLE = -11;
export const STD_ERROR_HANDLE = -12;

export interface Win32StandardHandles {
  input: number;
  output: number;
  error: number;
}

export interface Win32MainArguments {
  readonly argc: bigint;
  readonly argv: bigint;
  readonly envp: bigint;
}

export interface MemoryMapping {
  id: string;
  label: string;
  base: bigint;
  size: number;
  protection: MemoryProtection;
  data: Uint8Array;
  /** When present, reads/writes route through this CoW-backed page table
   *  instead of accessing `data` directly.  `data` becomes a dummy buffer. */
  cow?: CoWMapping;
}

/**
 * Structured (as opposed to pre-formatted-string) operand info, mirroring
 * Capstone's `cs_x86_op`/`x86_op_type` shape closely enough that
 * `packages/simulate/src/bin/dll/capstone.ts`'s guest `cs_disasm` handler
 * can map it onto the real `cs_x86_op` wire struct field-for-field. `reg`/
 * `mem.base`/`mem.index` are `x86_reg` ids (from `bun-capstone-abi`).
 */
export type X64OperandKind = 'reg' | 'imm' | 'mem';

export interface X64DecodedMemoryOperand {
  base?: number;
  index?: number;
  scale: number;
  disp: bigint;
}

export interface X64Operand {
  kind: X64OperandKind;
  reg?: number;
  imm?: bigint;
  mem?: X64DecodedMemoryOperand;
}

export interface DecodedInstruction {
  address: bigint;
  size: number;
  bytes: Uint8Array;
  mnemonic: string;
  operands: string;
  branchTarget?: bigint;
  /** Explicit operands in encoding order (dst, src, ...), when decoded. */
  structuredOperands?: X64Operand[];
  /** `x86_reg` ids implicitly read/written beyond `structuredOperands`
   *  (e.g. `push`/`pop`/`call`/`ret` touching RSP). */
  implicitRegsRead?: number[];
  implicitRegsWrite?: number[];
}

export type CpuStopReason =
  'step' | 'breakpoint' | 'watchpoint' | 'halted' | 'fault';

export type X64WatchpointAccess = 'read' | 'write' | 'access';

/** A watched `[address, address + size)` data range. See `X64Cpu.watchpoints`. */
export interface X64Watchpoint {
  address: bigint;
  size: number;
  access: X64WatchpointAccess;
}

export interface X64WatchpointHit {
  watchpoint: X64Watchpoint;
  /** Which of the step's accesses actually overlapped the watched range. */
  access: 'read' | 'write';
  /** Address/size of the *access*, not of the watchpoint. */
  address: bigint;
  size: number;
}

export interface CpuStepResult {
  instruction: DecodedInstruction;
  reason: CpuStopReason;
  changedRegisters: X64RegisterName[];
  memoryWrite?: {
    address: bigint;
    size: number;
  };
  /** Data read performed by this step (instruction fetch is not a data read). */
  memoryRead?: {
    address: bigint;
    size: number;
  };
  watchpointHit?: X64WatchpointHit;
  error?: Error;
}

export type Win64ThreadState =
  'ready' | 'running' | 'waiting' | 'stopped' | 'terminated' | 'faulted';

export interface Win64Module {
  name: string;
  base: bigint;
  size: number;
  exports: ReadonlyMap<string, bigint>;
  iatBase: bigint;
  iatSize: number;
  imports: readonly Win64Import[];
}

export interface Win64Import {
  symbol: string;
  dllName: string;
  functionName: string;
  slotAddress: bigint;
  targetAddress: bigint;
}

export interface Win64SocketPacket {
  payload: Uint8Array;
  address: Uint8Array;
}

export interface Win32InputDevice {
  readonly hasInput: boolean;
  read(maxBytes: number): Uint8Array;
}

export interface Win32OutputDevice {
  write(bytes: Uint8Array): number;
}

export interface Win64FindEntry {
  name: string;
  directory: boolean;
  size: number;
}

export interface Win64FileObject {
  id: number;
  kind: 'file';
  path: string;
  position: number;
}

export interface Win64InputObject {
  id: number;
  kind: 'input';
  name: string;
  blocking: boolean;
  device: Win32InputDevice;
}

export interface Win64OutputObject {
  id: number;
  kind: 'output';
  name: string;
  device: Win32OutputDevice;
}

export interface Win64PipeObject {
  id: number;
  kind: 'pipe';
  bytes: number[];
}

export interface Win64ProcessObject {
  id: number;
  kind: 'process';
  targetPid: number;
}

export interface Win64ThreadObject {
  id: number;
  kind: 'thread';
  targetPid: number;
  targetTid: number;
}

export interface Win64SocketObject {
  id: number;
  kind: 'socket';
  socketFamily: number;
  socketType: number;
  socketProtocol: number;
  receiveQueue: Win64SocketPacket[];
}

export interface Win64FindObject {
  id: number;
  kind: 'find';
  position: number;
  findEntries: Win64FindEntry[];
}

export interface Win64SnapshotProcessEntry {
  pid: number;
  parentPid: number;
  threadsCount: number;
  name: string;
}

export interface Win64SnapshotThreadEntry {
  tid: number;
  ownerPid: number;
  basePriority: number;
}

export interface Win64SnapshotModuleEntry {
  base: bigint;
  size: number;
  name: string;
  path: string;
}

export interface Win64SnapshotObject {
  id: number;
  kind: 'snapshot';
  flags: number;
  pid: number;
  processPosition: number;
  processes: Win64SnapshotProcessEntry[];
  threadPosition: number;
  threads: Win64SnapshotThreadEntry[];
  modulePosition: number;
  modules: Win64SnapshotModuleEntry[];
}

export interface Win64HeapObject {
  id: number;
  kind: 'heap';
  heap: Win64Heap;
}

export interface Win64TokenObject {
  id: number;
  kind: 'token';
  owningPid: number;
  accessMask: number;
}

/**
 * Pending invocation of the simulated `node.exe` builtin (see
 * `runtime/node-host-bridge.ts`). The host bridge creates one of these
 * per call, parks the calling guest thread on the object, and signals
 * it once the host worker has produced a result. `Win64Machine.
 * isObjectSignaled` recognizes this kind so `WaitForSingleObject`-style
 * callers see a not-yet-signaled object until the bridge explicitly
 * signals it.
 */
export interface Win64NodeInvocationObject {
  id: number;
  kind: 'nodeInvocation';
  signaled: boolean;
}

export type Win64KernelObject =
  | Win64FileObject
  | Win64InputObject
  | Win64OutputObject
  | Win64PipeObject
  | Win64ProcessObject
  | Win64ThreadObject
  | Win64SocketObject
  | Win64FindObject
  | Win64SnapshotObject
  | Win64HeapObject
  | Win64TokenObject
  | Win64NodeInvocationObject;

export type Win64KernelObjectDefinition =
  Win64KernelObject extends infer TObject
    ? TObject extends Win64KernelObject
      ? Omit<TObject, 'id'>
      : never
    : never;

export interface Win64Handle {
  value: number;
  objectId: number;
  access: number;
  inheritable: boolean;
}
