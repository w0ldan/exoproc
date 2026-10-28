import type { AddressSpaceSnapshot } from './address-space.js';
import type { Win32FileSystemSnapshot } from './file-system.js';
import type { Win64HeapStateSnapshot } from './heap.js';
import type { PhysicalPageSnapshot } from './physical-memory.js';
import type { Win32ConsoleSnapshot } from './console.js';
import type { SchedulerSnapshot } from './scheduler.js';
import type { Win32ProcessSession, Win64FrozenValue } from './win64-machine.js';
import type {
  DecodedInstruction,
  Win32MainArguments,
  Win32StandardHandles,
  Win64Handle,
  Win64KernelObject,
  Win64Module,
  Win64ThreadState,
  X64RegisterName,
  X64Registers,
  X64Watchpoint,
} from './types.js';

/**
 * QEMU-style VM state snapshot for `Win64Machine` (see `Win64Machine.
 * snapshot()`/`Win64Machine.restore()`). Deliberately NOT JSON-string-safe
 * -- `bigint`/`Uint8Array`/`Map` are used directly, matching the transport
 * contract `shell/common/channels.ts` already documents for this codebase
 * (structuredClone-storable, e.g. IndexedDB, is the target, not JSON.
 * stringify). Consuming code (`apps/docs`) must never persist this to
 * plain JSON without a custom replacer.
 *
 * What this captures vs. what it deliberately never touches is documented
 * on `Win64Machine.snapshot()` itself -- see that doc comment for the full
 * "cold vs warm state" reasoning.
 */
export interface Win64MachineSnapshot {
  readonly formatVersion: 1;
  readonly createdAt: number;
  readonly physicalPages: readonly PhysicalPageSnapshot[];
  readonly fileSystem: Win32FileSystemSnapshot;
  readonly processes: readonly Win64ProcessSnapshot[];
  readonly kernelObjects: readonly Win64KernelObjectSnapshot[];
  readonly scheduler: SchedulerSnapshot;
  readonly screen: Win32ConsoleSnapshot;
  readonly nextPid: number;
  readonly nextTid: number;
  readonly nextHandle: number;
  readonly nextKernelObjectId: number;
  readonly events: readonly string[];
  readonly frozenValues: readonly (readonly [
    key: string,
    value: Win64FrozenValue,
  ])[];
}

export interface CpuStepResultSnapshot {
  readonly instruction: DecodedInstruction;
  readonly reason: 'step' | 'breakpoint' | 'watchpoint' | 'halted' | 'fault';
  readonly changedRegisters: readonly X64RegisterName[];
  readonly memoryWrite?: { readonly address: bigint; readonly size: number };
  readonly memoryRead?: { readonly address: bigint; readonly size: number };
  readonly watchpointHit?: {
    readonly watchpoint: X64Watchpoint;
    readonly access: 'read' | 'write';
    readonly address: bigint;
    readonly size: number;
  };
  /** `Error` objects don't round-trip through structuredClone reliably across every host -- flattened to name+message, reconstructed losslessly enough for a snapshot's purposes. */
  readonly error?: { readonly name: string; readonly message: string };
}

export interface Win64ThreadSnapshot {
  readonly tid: number;
  readonly name: string;
  readonly entryPoint: bigint;
  readonly stackMappingId: string;
  readonly state: Win64ThreadState;
  readonly suspendCount: number;
  readonly registers: X64Registers;
  readonly breakpoints: readonly bigint[];
  readonly watchpoints: readonly (readonly [
    address: bigint,
    watchpoint: X64Watchpoint,
  ])[];
  readonly lastStep?: CpuStepResultSnapshot;
}

export interface Win64ProcessSnapshot {
  readonly pid: number;
  readonly image: string;
  readonly path: string;
  readonly imageBase: bigint;
  readonly heapBase: bigint;
  readonly modules: readonly Win64Module[];
  readonly arguments: readonly string[];
  readonly mainArguments?: Win32MainArguments;
  readonly lastError: number;
  readonly lastChildExitCode: number;
  readonly exitCode?: number;
  readonly winsockStarted: boolean;
  readonly winsockLastError: number;
  readonly defaultHeapObjectId?: number;
  readonly allocationSequence: number;
  readonly invocationSequence: number;
  readonly standardHandles: Win32StandardHandles;
  readonly handles: readonly (readonly [value: number, handle: Win64Handle])[];
  readonly environment: readonly (readonly [name: string, value: string])[];
  readonly session: Win32ProcessSession;
  readonly console: Win32ConsoleSnapshot;
  readonly threads: readonly Win64ThreadSnapshot[];
  readonly memory: AddressSpaceSnapshot;
}

/** Identifies which built-in device backs an `input`/`output` kernel object, since the live device object itself (a class with methods) can't be serialized. Anything else (a host-injected device from `createInputCapability`/`createOutputCapability`) is `'unsupported'` -- see `Win64Machine.snapshot()`'s doc comment for this limitation. */
export type Win64DeviceRefSnapshot =
  | { readonly kind: 'console'; readonly owner: 'screen' }
  | {
      readonly kind: 'console';
      readonly owner: 'process';
      readonly pid: number;
    }
  | { readonly kind: 'capture'; readonly bytes: Uint8Array }
  | { readonly kind: 'null' }
  | { readonly kind: 'unsupported'; readonly className: string };

export interface Win64HeapObjectSnapshot extends Win64HeapStateSnapshot {
  readonly id: number;
  readonly kind: 'heap';
  readonly ownerPid: number;
  readonly capacity: number;
  readonly regionMappingId: string;
}

export interface Win64InputObjectSnapshot {
  readonly id: number;
  readonly kind: 'input';
  readonly name: string;
  readonly blocking: boolean;
  readonly device: Win64DeviceRefSnapshot;
}

export interface Win64OutputObjectSnapshot {
  readonly id: number;
  readonly kind: 'output';
  readonly name: string;
  readonly device: Win64DeviceRefSnapshot;
}

/** Every other kernel-object kind (file/pipe/process/thread/socket/find/snapshot/token/nodeInvocation) is already pure data and reused as-is. */
export type Win64KernelObjectSnapshot =
  | Exclude<Win64KernelObject, { kind: 'heap' | 'input' | 'output' }>
  | Win64HeapObjectSnapshot
  | Win64InputObjectSnapshot
  | Win64OutputObjectSnapshot;

/**
 * `snapshotThread`/`restoreThread` live in `win64-machine.ts` itself, next
 * to the `Win64Thread` class -- they construct/read a real `Win64Thread`,
 * which this file only ever references as a type (to avoid a runtime
 * circular import; `win64-machine.ts` already imports value-level from this
 * file for `Win64Machine.snapshot()`/`restore()`, mirroring the existing
 * type-only back-reference `scheduler.ts` has to `win64-machine.ts`).
 */
