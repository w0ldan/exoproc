import type { CpuStepResult, Win64Thread } from 'win32-simulate';
import {
  DebugChannel,
  type DebugThreadRef,
  type RegisterName,
  type RunOutcomeDto,
  type RunStopReason,
} from '../../common/channels';
import { ipc } from '../ipc';
import { requireProcess, requireThread } from './machine';
import {
  toInstructionDto,
  toStepResultDto,
  toThreadSnapshotDto,
} from './snapshot';

/**
 * Execution control for a single thread.
 *
 * The shape here is the load-bearing part of the boundary. Commands
 * (step, breakpoints) are requests; *state* is pushed. After anything
 * that can move the thread, this module publishes a whole
 * `ThreadSnapshotDto` on `onDidChangeThread`, and the renderer keeps
 * that snapshot in state and reads it synchronously while rendering.
 *
 * That is what lets consumers keep reading `registers.RIP` inline a
 * dozen times per render instead of awaiting a promise for each one --
 * the alternative would turn every debugger view inside out for no gain.
 *
 * `stepOver`/`stepOut`/`continueRun`/`runToCursor` run their entire
 * bounded loop in here rather than exposing a generic "run until X"
 * primitive: each one's stop condition is a closure over values specific
 * to that call (a call's own return address and the RSP it must unwind
 * back to, a call/ret depth counter, an ad-hoc breakpoint) that cannot
 * cross the IPC boundary. Running the loop where the condition can
 * actually be checked, and reporting back once, also avoids what the
 * alternative would be: the renderer driving `step()` one instruction at
 * a time over what can be tens of thousands of round trips.
 */

/** Matches the pre-shell UI's own trace panel cap (`format.ts`'s `TRACE_LIMIT`) -- a 50k-step Continue must not ship 50k instructions. */
const TRACE_LIMIT = 512;
/** Safety cap for Continue / Step Out / Run-to-cursor -- not a UX limit, just a runaway guard. */
const MAX_CONTINUE_STEPS = 50_000;

interface RunOptions {
  readonly maxSteps: number;
  readonly honorBreakpoints: boolean;
  /** Called after each executed step. Return true to stop the run. */
  readonly shouldStop?: (result: CpuStepResult) => boolean;
}

interface RunOutcome {
  readonly executed: number;
  readonly last?: CpuStepResult;
  readonly trace: readonly CpuStepResult['instruction'][];
  readonly stop: RunStopReason;
  readonly error?: unknown;
}

function runEngine(thread: Win64Thread, options: RunOptions): RunOutcome {
  const collected: CpuStepResult['instruction'][] = [];
  let executed = 0;
  let last: CpuStepResult | undefined;

  if (thread.state === 'terminated') {
    return { executed, trace: collected, stop: 'terminated' };
  }
  if (thread.state === 'waiting') {
    return { executed, trace: collected, stop: 'waiting' };
  }

  while (executed < options.maxSteps) {
    if (
      options.honorBreakpoints &&
      executed > 0 &&
      thread.cpu.breakpoints.has(thread.registers.RIP)
    ) {
      return { executed, last, trace: collected, stop: 'breakpoint' };
    }
    let result: CpuStepResult;
    try {
      result = thread.step();
    } catch (error) {
      return { executed, last, trace: collected, stop: 'error', error };
    }
    executed += 1;
    last = result;
    collected.push(result.instruction);
    if (collected.length > TRACE_LIMIT * 2) {
      collected.splice(0, collected.length - TRACE_LIMIT);
    }

    if (result.reason === 'breakpoint')
      return { executed, last, trace: collected, stop: 'int3' };
    if (result.reason === 'fault')
      return { executed, last, trace: collected, stop: 'fault' };
    if (result.reason === 'halted')
      return { executed, last, trace: collected, stop: 'halted' };
    if ((thread.state as string) === 'waiting')
      return { executed, last, trace: collected, stop: 'waiting' };
    if (options.shouldStop?.(result)) {
      return { executed, last, trace: collected, stop: 'target' };
    }
    if ((thread.state as string) === 'terminated') {
      return { executed, last, trace: collected, stop: 'terminated' };
    }
  }
  return { executed, last, trace: collected, stop: 'budget' };
}

function toOutcomeDto(outcome: RunOutcome): RunOutcomeDto {
  return {
    executed: outcome.executed,
    lastStep: outcome.last && toStepResultDto(outcome.last),
    trace: outcome.trace.slice(-TRACE_LIMIT).map(toInstructionDto),
    stop: outcome.stop,
    error:
      outcome.error !== undefined ? describeError(outcome.error) : undefined,
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.name && error.name !== 'Error'
      ? `${error.name}: ${error.message}`
      : error.message;
  }
  return String(error);
}

function publish(pid: number, tid: number): void {
  ipc.send(
    DebugChannel.onDidChangeThread,
    toThreadSnapshotDto(requireThread(pid, tid)),
  );
}

function assertDebuggable(pid: number): void {
  const proc = requireProcess(pid);
  if (proc.image === 'exoproc-ide.exe') {
    throw new Error(
      `Process "${proc.image}" (PID ${pid}) cannot be debugged from within IDE.`,
    );
  }
}

export function registerDebugHandlers(): void {
  ipc.handle(DebugChannel.getThread, (ref: DebugThreadRef) => {
    assertDebuggable(ref.pid);
    return toThreadSnapshotDto(requireThread(ref.pid, ref.tid));
  });

  ipc.handle(DebugChannel.step, (ref: DebugThreadRef, count?: number) => {
    assertDebuggable(ref.pid);
    const thread = requireThread(ref.pid, ref.tid);

    // Stepping N times inside the main process rather than making the
    // renderer issue N round trips: "run 100 instructions" is one
    // message, and the UI still only needs the final state.
    let last;
    for (let index = 0; index < (count ?? 1); index += 1) {
      if (
        thread.state === 'terminated' ||
        (thread.state as string) === 'waiting'
      )
        break;
      last = thread.step();
      // A breakpoint, fault or waiting state ends the batch -- continuing past one
      // would silently step over the very thing the user asked to see.
      if (last.reason !== 'step' || (thread.state as string) === 'waiting')
        break;
    }

    publish(ref.pid, ref.tid);
    return last && toThreadSnapshotDto(thread).lastStep;
  });

  ipc.handle(DebugChannel.stepOver, (ref: DebugThreadRef) => {
    assertDebuggable(ref.pid);
    const thread = requireThread(ref.pid, ref.tid);

    if (thread.state === 'terminated') {
      publish(ref.pid, ref.tid);
      return toOutcomeDto({ executed: 0, trace: [], stop: 'terminated' });
    }
    if (thread.state === 'waiting') {
      publish(ref.pid, ref.tid);
      return toOutcomeDto({ executed: 0, trace: [], stop: 'waiting' });
    }

    let current;
    try {
      current = thread.cpu.decode(thread.registers.RIP);
    } catch (error) {
      publish(ref.pid, ref.tid);
      return toOutcomeDto({ executed: 0, trace: [], stop: 'error', error });
    }

    if (current.mnemonic !== 'call') {
      const outcome = runEngine(thread, {
        maxSteps: 1,
        honorBreakpoints: false,
        shouldStop: () => true,
      });
      publish(ref.pid, ref.tid);
      return toOutcomeDto(outcome);
    }

    // The return address of *this* call, plus the RSP the frame must
    // unwind back to -- comparing both keeps direct recursion from
    // stopping the run at an inner activation reaching the same address.
    const returnAddress = current.address + BigInt(current.size);
    const rspBefore = thread.registers.RSP;
    const outcome = runEngine(thread, {
      maxSteps: MAX_CONTINUE_STEPS,
      honorBreakpoints: true,
      shouldStop: () =>
        thread.registers.RIP === returnAddress &&
        thread.registers.RSP >= rspBefore,
    });
    publish(ref.pid, ref.tid);
    return toOutcomeDto(outcome);
  });

  ipc.handle(DebugChannel.stepOut, (ref: DebugThreadRef) => {
    assertDebuggable(ref.pid);
    const thread = requireThread(ref.pid, ref.tid);
    if (thread.state === 'terminated') {
      publish(ref.pid, ref.tid);
      return toOutcomeDto({ executed: 0, trace: [], stop: 'terminated' });
    }
    if (thread.state === 'waiting') {
      publish(ref.pid, ref.tid);
      return toOutcomeDto({ executed: 0, trace: [], stop: 'waiting' });
    }

    // Depth is tracked from the instruction stream rather than by reading
    // a return address off the stack: at an arbitrary stop point RSP does
    // not point at the return address, so `[RSP]` would be a garbage
    // target. This CPU pushes the return address only in `call` and pops
    // it only in `ret`, so counting call/ret is exact for this interpreter.
    let depth = 0;
    const outcome = runEngine(thread, {
      maxSteps: MAX_CONTINUE_STEPS,
      honorBreakpoints: true,
      shouldStop: (result) => {
        const mnemonic = result.instruction.mnemonic;
        if (mnemonic === 'call') {
          depth += 1;
          return false;
        }
        if (mnemonic === 'ret') {
          if (depth === 0) return true;
          depth -= 1;
        }
        return false;
      },
    });
    publish(ref.pid, ref.tid);
    return toOutcomeDto(outcome);
  });

  ipc.handle(DebugChannel.continueRun, (ref: DebugThreadRef) => {
    assertDebuggable(ref.pid);
    const thread = requireThread(ref.pid, ref.tid);
    if (thread.state === 'waiting') {
      publish(ref.pid, ref.tid);
      return toOutcomeDto({ executed: 0, trace: [], stop: 'waiting' });
    }
    const outcome = runEngine(thread, {
      maxSteps: MAX_CONTINUE_STEPS,
      honorBreakpoints: true,
    });
    publish(ref.pid, ref.tid);
    return toOutcomeDto(outcome);
  });

  ipc.handle(
    DebugChannel.runToCursor,
    (ref: DebugThreadRef, target: bigint) => {
      assertDebuggable(ref.pid);
      const thread = requireThread(ref.pid, ref.tid);
      if (thread.state === 'terminated') {
        publish(ref.pid, ref.tid);
        return toOutcomeDto({ executed: 0, trace: [], stop: 'terminated' });
      }
      if (thread.state === 'waiting') {
        publish(ref.pid, ref.tid);
        return toOutcomeDto({ executed: 0, trace: [], stop: 'waiting' });
      }

      const hadBreakpoint = thread.cpu.hasBreakpoint(target);
      if (!hadBreakpoint) thread.cpu.addBreakpoint(target);
      const outcome = runEngine(thread, {
        maxSteps: MAX_CONTINUE_STEPS,
        honorBreakpoints: true,
      });
      if (!hadBreakpoint) thread.cpu.removeBreakpoint(target);
      publish(ref.pid, ref.tid);
      return toOutcomeDto(outcome);
    },
  );

  ipc.handle(DebugChannel.getCallStack, (ref: DebugThreadRef) => {
    assertDebuggable(ref.pid);
    const process = requireProcess(ref.pid);
    const thread = requireThread(ref.pid, ref.tid);
    const frames: bigint[] = [thread.registers.RIP];

    const stackMapping = process.memory.getMapping(thread.stackMappingId);
    if (!stackMapping) return frames;

    const mappings = process.memory.getMappings();
    const stackTop = stackMapping.base + BigInt(stackMapping.size);
    let address = thread.registers.RSP;
    let depth = 0;
    while (address + 8n <= stackTop && depth < 16) {
      let value: bigint;
      try {
        value = process.memory.readU64(address);
      } catch {
        break;
      }
      if (value !== 0n && value !== thread.registers.RIP) {
        const executable = mappings.find(
          (m) =>
            m.protection.includes('x') &&
            value >= m.base &&
            value < m.base + BigInt(m.size),
        );
        if (executable) frames.push(value);
      }
      address += 8n;
      depth += 1;
    }
    return frames;
  });

  ipc.handle(
    DebugChannel.writeRegister,
    (ref: DebugThreadRef, name: RegisterName, value: bigint) => {
      assertDebuggable(ref.pid);
      const thread = requireThread(ref.pid, ref.tid);
      if (name === 'RIP' && (thread.inSyscall || thread.state === 'waiting')) {
        thread.pendingRip = value;
      } else {
        thread.registers[name] = value;
      }
      publish(ref.pid, ref.tid);
    },
  );

  ipc.handle(
    DebugChannel.addBreakpoint,
    (ref: DebugThreadRef, address: bigint) => {
      assertDebuggable(ref.pid);
      requireThread(ref.pid, ref.tid).cpu.addBreakpoint(address);
      publish(ref.pid, ref.tid);
    },
  );

  ipc.handle(
    DebugChannel.removeBreakpoint,
    (ref: DebugThreadRef, address: bigint) => {
      assertDebuggable(ref.pid);
      requireThread(ref.pid, ref.tid).cpu.removeBreakpoint(address);
      publish(ref.pid, ref.tid);
    },
  );

  ipc.handle(
    DebugChannel.disassemble,
    (ref: DebugThreadRef, address: bigint, count: number) => {
      assertDebuggable(ref.pid);
      return requireThread(ref.pid, ref.tid)
        .cpu.disassemble(address, count)
        .map(toInstructionDto);
    },
  );

  ipc.handle(DebugChannel.decode, (ref: DebugThreadRef, address: bigint) => {
    assertDebuggable(ref.pid);
    // Decoding walks arbitrary bytes, so an unmapped or malformed
    // address is an ordinary outcome here, not an exceptional one.
    try {
      return toInstructionDto(
        requireThread(ref.pid, ref.tid).cpu.decode(address),
      );
    } catch {
      return undefined;
    }
  });
}
