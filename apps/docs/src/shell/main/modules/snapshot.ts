import type {
  CpuStepResult,
  DecodedInstruction,
  MemoryMapping,
  Win64Module,
  Win64Process,
  Win64Thread,
} from 'win32-simulate';
import type {
  InstructionDto,
  MappingDto,
  ModuleDto,
  ProcessSnapshotDto,
  RegisterName,
  StepResultDto,
  ThreadSnapshotDto,
} from '../../common/channels';

/**
 * Engine object -> DTO conversion, in one place.
 *
 * Every one of these functions exists to answer the same question: what
 * is safe and useful to hand across the boundary? Live class instances,
 * CoW page tables and whole mapping buffers stay behind; plain values
 * (`bigint` addresses, small `Uint8Array`s, string unions) come through
 * as they are, because structured clone handles them natively.
 *
 * These are deliberately pure -- no engine lookups, no side effects --
 * so the modules that push snapshots stay easy to reason about.
 */

export function toInstructionDto(
  instruction: DecodedInstruction,
): InstructionDto {
  // `structuredOperands` / `implicitRegs*` are Capstone decoding detail
  // that no consumer reads; leaving them out keeps step pushes small.
  return {
    address: instruction.address,
    size: instruction.size,
    bytes: instruction.bytes.slice(),
    mnemonic: instruction.mnemonic,
    operands: instruction.operands,
    branchTarget: instruction.branchTarget,
  };
}

export function toStepResultDto(step: CpuStepResult): StepResultDto {
  return {
    instruction: toInstructionDto(step.instruction),
    reason: step.reason,
    changedRegisters: [...step.changedRegisters] as RegisterName[],
    memoryWrite: step.memoryWrite && { ...step.memoryWrite },
    memoryRead: step.memoryRead && { ...step.memoryRead },
    error: step.error?.message,
  };
}

export function toMappingDto(mapping: MemoryMapping): MappingDto {
  // `data` and `cow` stay behind on purpose -- a mapping can be
  // megabytes, and content is fetched by explicit range instead.
  return {
    id: mapping.id,
    label: mapping.label,
    base: mapping.base,
    size: mapping.size,
    protection: mapping.protection,
  };
}

export function toThreadSnapshotDto(thread: Win64Thread): ThreadSnapshotDto {
  return {
    tid: thread.tid,
    state: thread.state,
    // `thread.registers` is the CPU's live register file; copying is what
    // makes the snapshot a snapshot rather than a window onto the engine.
    registers: { ...thread.registers },
    stackMappingId: thread.stackMappingId,
    lastStep: thread.lastStep && toStepResultDto(thread.lastStep),
    breakpoints: [...thread.cpu.breakpoints],
    suspendCount: thread.suspendCount,
  };
}

export function toModuleDto(module: Win64Module): ModuleDto {
  return {
    name: module.name,
    base: module.base,
    size: module.size,
    exports: [...module.exports],
  };
}

export function toProcessSnapshotDto(
  process: Win64Process,
): ProcessSnapshotDto {
  return {
    pid: process.pid,
    image: process.image,
    imageBase: process.imageBase,
    threads: process.getThreads().map(toThreadSnapshotDto),
    mappings: process.memory.getMappings().map(toMappingDto),
    modules: process.modules.map(toModuleDto),
  };
}
