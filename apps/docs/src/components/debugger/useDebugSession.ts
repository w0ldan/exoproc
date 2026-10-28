'use client';

import { useEffect, useState } from 'react';
import type {
  DebugThreadRef,
  InstructionDto,
  ProcessSnapshotDto,
  RegisterName,
  RunOutcomeDto,
  ThreadSnapshotDto,
  ThreadState,
} from '../../shell/common/channels';
import { getExoprocApi } from '../../shell/renderer/bootstrap';
import {
  FORWARD_WINDOW,
  HISTORY_WINDOW,
  REGISTER_ORDER,
  TRACE_LIMIT,
  byteHex,
  describeError,
  encodeLittleEndian,
  hex,
  operationOf,
  parseByteInput,
  parseIntegerInput,
  resolveSymbol,
} from './format';

export type DebugMessageTone = 'info' | 'success' | 'error';
export interface DebugMessage {
  text: string;
  tone: DebugMessageTone;
}

export interface MemoryRow {
  address: bigint;
  bytes: number[];
  ascii: string;
}

export interface RegisterRow {
  name: RegisterName;
  value: bigint;
  changed: boolean;
}

export interface CallStackFrame {
  address: bigint;
  label: string;
}

export type MemoryWriteWidth = 1 | 2 | 4 | 8;

export interface UseDebugSessionOptions {
  pid: number;
  tid: number;
  initialMemoryMappingId: string;
  initialMemoryAddress: string;
  initialMemoryLength: number;
}

const STATE_LABEL: Record<ThreadState, string> = {
  ready: 'READY',
  running: 'RUNNING',
  waiting: 'WAITING',
  stopped: 'STOPPED',
  terminated: 'TERMINATED',
  faulted: 'FAULTED',
};

const STATE_DOT: Record<ThreadState, string> = {
  ready: 'bg-sky-400',
  running: 'bg-emerald-400',
  waiting: 'bg-sky-400',
  stopped: 'bg-amber-500',
  terminated: 'bg-zinc-500',
  faulted: 'bg-red-500',
};

/**
 * DTO-backed replacement for the pre-shell hook of the same name.
 *
 * The one thing that does not change from the live-object version is the
 * shape of the returned object -- every downstream panel
 * (`panels.tsx`/`DisassemblyView.tsx`/`ScannerPanel.tsx`) was already
 * written against this hook's *return value*, never against a live
 * `Win64Process`/`Win64Thread` directly, so keeping the field names and
 * synchronous-looking reads identical means those files need no changes
 * at all.
 *
 * What *does* change is how those reads get their data: `thread.step()`
 * becomes `window.exoproc.debug.step(ref)`, an async round trip into the
 * worker. Two techniques make the rest of the hook look unchanged:
 * - Every read the UI does many times per render (`registers.RIP`,
 *   breakpoints, call stack, disassembly, memory) is pre-fetched into
 *   local state and kept in sync by re-fetching whenever `revision`
 *   changes -- exactly the same `revision`-as-dependency pattern the
 *   original hook used for its live `useMemo`s, just now driving an
 *   effect instead.
 * - Every *action* (`stepInto`, `writeRegister`, ...) becomes an async
 *   function. Every call site was already fire-and-forget (`onClick={() =>
 *   stepInto()}`), which a `void`-returning event handler type accepts
 *   regardless of what the callback itself returns -- so no call site
 *   needed to change, except the few that inspected a synchronous
 *   boolean return value (`writeRegister`, `writeMemoryByte`,
 *   `writeMemoryValue`, `gotoDisassembly`, `gotoMemory`); those now
 *   resolve a `Promise<boolean>` instead, and callers that cared were
 *   updated to `await` it.
 *
 * No manual `useCallback`/`useMemo` here -- React Compiler is enabled for
 * this app and memoizes every closure/derived value on its own; hand-written
 * dependency arrays only fight it (the compiler bails out entirely, with a
 * lint error, the moment a manual array doesn't exactly match what it infers
 * -- e.g. omitting a `setState` setter, which is exactly what happened the
 * first time this file was written this way).
 */
export function useDebugSession({
  pid,
  tid,
  initialMemoryMappingId,
  initialMemoryAddress,
  initialMemoryLength,
}: UseDebugSessionOptions) {
  const api = getExoprocApi();
  const ref: DebugThreadRef = { pid, tid };

  const [revision, setRevision] = useState(0);
  const bump = () => setRevision((r) => r + 1);

  const [process, setProcess] = useState<ProcessSnapshotDto>();
  const [thread, setThread] = useState<ThreadSnapshotDto>();
  const [ready, setReady] = useState(false);

  const [message, setMessage] = useState<DebugMessage>({
    text: `Debugger TID ${tid} üzerine bağlanıyor...`,
    tone: 'info',
  });
  const [lastMemoryWrite, setLastMemoryWrite] = useState<{
    address: bigint;
    size: number;
  }>();
  const [trace, setTrace] = useState<InstructionDto[]>([]);
  /** When set, the disassembly is anchored to this address instead of following RIP. */
  const [anchor, setAnchor] = useState<bigint>();
  const [memoryMappingId, setMemoryMappingId] = useState(
    initialMemoryMappingId,
  );
  const [memoryBase, setMemoryBase] = useState(initialMemoryAddress);
  const [memoryLength, setMemoryLength] = useState(initialMemoryLength);

  const info = (text: string) => setMessage({ text, tone: 'info' });
  const success = (text: string) => setMessage({ text, tone: 'success' });
  const failure = (text: string) => setMessage({ text, tone: 'error' });

  /* ---------- attach / re-attach ----------
   * Re-pointing the same mounted debugger at another process/thread resets
   * local view state during render, same as the live-object version did --
   * only now the fresh snapshot itself has to be *fetched*, so that part
   * happens in an effect below. */
  const attachKey = `${pid}:${tid}`;
  const [attachedKey, setAttachedKey] = useState(attachKey);
  if (attachedKey !== attachKey) {
    setAttachedKey(attachKey);
    setLastMemoryWrite(undefined);
    setTrace([]);
    setAnchor(undefined);
    setMemoryMappingId(initialMemoryMappingId);
    setMemoryBase(initialMemoryAddress);
    setMemoryLength(initialMemoryLength);
    setReady(false);
    setProcess(undefined);
    setThread(undefined);
    setMessage({
      text: `Debugger TID ${tid} üzerine bağlanıyor...`,
      tone: 'info',
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const processSnapshot = await api.machine.getProcess(pid);
        if (cancelled) return;
        if (processSnapshot?.image === 'exoproc-ide.exe') {
          setMessage({
            text: 'exoproc-ide.exe IDE içinden debug edilemez.',
            tone: 'error',
          });
          setReady(false);
          return;
        }
        const threadSnapshot = await api.debug.getThread({ pid, tid });
        if (cancelled) return;
        setProcess(processSnapshot);
        setThread(threadSnapshot);
        setReady(true);
        if (threadSnapshot) {
          setMessage({
            text: `Debugger TID ${tid} üzerine bağlandı; RIP ${hex(threadSnapshot.registers.RIP)}.`,
            tone: 'info',
          });
        }
      } catch (error) {
        if (cancelled) return;
        setMessage({
          text: describeError(error),
          tone: 'error',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, pid, tid, attachKey]);

  /** Every push from the worker (after any step/run/breakpoint edit) replaces the thread snapshot. */
  useEffect(() => {
    return api.debug.onDidChangeThread((snapshot) => {
      if (snapshot.tid !== tid) return;
      setThread(snapshot);
      setRevision((r) => r + 1);
    });
  }, [api, tid]);

  /* ================================================================
   * Execution actions -- each one is a single round trip that runs its
   * entire bounded loop inside the worker (see shell/main/modules/debug.ts)
   * and reports back once.
   * ================================================================ */
  const commitOutcome = (outcome: RunOutcomeDto) => {
    if (outcome.trace.length > 0) {
      setTrace((previous) =>
        [...previous, ...outcome.trace].slice(-TRACE_LIMIT),
      );
    }
    if (outcome.executed > 0) {
      setLastMemoryWrite(outcome.lastStep?.memoryWrite);
      setAnchor(undefined);
    }
    bump();
  };

  const reportOutcome = (
    outcome: RunOutcomeDto,
    ripAfter: bigint,
    targetText: string,
  ) => {
    switch (outcome.stop) {
      case 'terminated':
        if (outcome.executed === 0) info('Thread zaten sonlanmış.');
        else
          info(`${outcome.executed} instruction yürütüldü; thread sonlandı.`);
        break;
      case 'error':
        failure(outcome.error ?? 'Bilinmeyen hata.');
        break;
      case 'fault':
        failure(outcome.lastStep?.error ?? 'CPU fault oluştu.');
        break;
      case 'halted':
        info(
          outcome.lastStep
            ? `${operationOf(outcome.lastStep.instruction)}: thread temiz biçimde sonlandı.`
            : 'Thread temiz biçimde sonlandı.',
        );
        break;
      case 'int3':
        info(
          outcome.lastStep
            ? `${operationOf(outcome.lastStep.instruction)}: INT3 breakpoint yakalandı.`
            : 'INT3 breakpoint yakalandı.',
        );
        break;
      case 'breakpoint':
        info(
          `${outcome.executed} instruction yürütüldü; breakpoint: ${hex(ripAfter)}${
            process ? ` (${resolveSymbol(process, ripAfter)})` : ''
          }.`,
        );
        break;
      case 'budget':
        failure(
          `Güvenlik sınırına ulaşıldı: ${outcome.executed} instruction yürütüldü, yürütme durduruldu.`,
        );
        break;
      case 'target':
        success(targetText);
        break;
      case 'waiting':
        info(
          `${outcome.executed > 0 ? `${outcome.executed} instruction yürütüldü; ` : ''}Thread girdi/olay bekliyor (WAITING: ${hex(ripAfter)}). Terminalden girdi geldiğinde devam edecektir.`,
        );
        break;
    }
  };

  /* ---------- debug actions ---------- */
  const stepInto = async () => {
    const step = await api.debug.step(ref);
    const snapshot = await api.debug.getThread(ref);
    if (snapshot) setThread(snapshot);
    if (step) {
      setTrace((previous) =>
        [...previous, step.instruction].slice(-TRACE_LIMIT),
      );
      setLastMemoryWrite(step.memoryWrite);
      setAnchor(undefined);
    }
    bump();
    if (!step) {
      info('Thread zaten sonlanmış.');
      return;
    }
    if (snapshot?.state === 'waiting') {
      info(
        `${operationOf(step.instruction)} yürütüldü; thread girdi/olay bekliyor (WAITING: ${hex(
          snapshot.registers.RIP,
        )}).`,
      );
    } else if (step.reason === 'fault')
      failure(step.error ?? 'CPU fault oluştu.');
    else if (step.reason === 'breakpoint')
      info(`${operationOf(step.instruction)}: INT3 breakpoint yakalandı.`);
    else if (step.reason === 'halted')
      info(`${operationOf(step.instruction)}: thread temiz biçimde sonlandı.`);
    else success(`${operationOf(step.instruction)} yürütüldü.`);
  };

  const stepOver = async () => {
    if (thread?.state === 'terminated') {
      info('Thread zaten sonlanmış.');
      return;
    }
    const outcome = await api.debug.stepOver(ref);
    const snapshot = await api.debug.getThread(ref);
    if (snapshot) setThread(snapshot);
    commitOutcome(outcome);
    reportOutcome(
      outcome,
      snapshot?.registers.RIP ?? 0n,
      `CALL üzerinden atlandı (${outcome.executed} instruction yürütüldü).`,
    );
  };

  const stepOut = async () => {
    if (thread?.state === 'terminated') {
      info('Thread zaten sonlanmış.');
      return;
    }
    const outcome = await api.debug.stepOut(ref);
    const snapshot = await api.debug.getThread(ref);
    if (snapshot) setThread(snapshot);
    commitOutcome(outcome);
    const rip = snapshot?.registers.RIP ?? 0n;
    reportOutcome(
      outcome,
      rip,
      `Fonksiyondan çıkıldı: ${hex(rip)}${process ? ` (${resolveSymbol(process, rip)})` : ''}, ${
        outcome.executed
      } instruction yürütüldü.`,
    );
  };

  const continueExecution = async () => {
    const outcome = await api.debug.continueRun(ref);
    const snapshot = await api.debug.getThread(ref);
    if (snapshot) setThread(snapshot);
    commitOutcome(outcome);
    reportOutcome(
      outcome,
      snapshot?.registers.RIP ?? 0n,
      `${outcome.executed} instruction yürütüldü.`,
    );
  };

  const runToCursor = async (target: bigint) => {
    if (thread?.state === 'terminated') {
      info('Thread zaten sonlanmış.');
      return;
    }
    const outcome = await api.debug.runToCursor(ref, target);
    const snapshot = await api.debug.getThread(ref);
    if (snapshot) setThread(snapshot);
    commitOutcome(outcome);
    if (outcome.stop === 'breakpoint' && snapshot?.registers.RIP === target) {
      success(
        `İmleç adresine ulaşıldı: ${hex(target)} (${outcome.executed} instruction yürütüldü).`,
      );
      return;
    }
    reportOutcome(
      outcome,
      snapshot?.registers.RIP ?? 0n,
      `İmleç adresine ulaşıldı: ${hex(target)}.`,
    );
  };

  const canRun = thread?.state !== 'terminated';

  /* ---------- breakpoints ---------- */
  const breakpoints = new Set(thread?.breakpoints ?? []);

  const toggleBreakpoint = async (address: bigint) => {
    if (breakpoints.has(address))
      await api.debug.removeBreakpoint(ref, address);
    else await api.debug.addBreakpoint(ref, address);
    const snapshot = await api.debug.getThread(ref);
    if (snapshot) setThread(snapshot);
    bump();
  };

  const removeBreakpoint = async (address: bigint) => {
    await api.debug.removeBreakpoint(ref, address);
    const snapshot = await api.debug.getThread(ref);
    if (snapshot) setThread(snapshot);
    bump();
  };

  const clearBreakpoints = async () => {
    await Promise.all(
      [...breakpoints].map((address) =>
        api.debug.removeBreakpoint(ref, address),
      ),
    );
    const snapshot = await api.debug.getThread(ref);
    if (snapshot) setThread(snapshot);
    bump();
    info('Tüm breakpointler kaldırıldı.');
  };

  /* ---------- disassembly ---------- */
  const [disassembly, setDisassembly] = useState<InstructionDto[]>([]);
  const [disassemblyError, setDisassemblyError] = useState<string>();

  useEffect(() => {
    if (!thread) return;
    let cancelled = false;
    const base = anchor ?? thread.registers.RIP;
    const history = anchor === undefined ? trace.slice(-HISTORY_WINDOW) : [];
    api.debug
      .disassemble({ pid, tid }, base, FORWARD_WINDOW)
      .then((forward) => {
        if (cancelled) return;
        setDisassembly([...history, ...forward]);
        setDisassemblyError(undefined);
      })
      .catch((cause) => {
        if (cancelled) return;
        setDisassembly(history);
        setDisassemblyError(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [api, pid, tid, thread, anchor, revision]);

  const lineToAddress = new Map<number, bigint>();
  const byAddress = new Map<string, InstructionDto>();
  const disassemblyLines: string[] = [];
  let ripLine: number | undefined;
  for (let index = 0; index < disassembly.length; index += 1) {
    const instruction = disassembly[index]!;
    disassemblyLines.push(
      `${instruction.mnemonic.padEnd(8)} ${instruction.operands}`,
    );
    lineToAddress.set(index + 1, instruction.address);
    byAddress.set(instruction.address.toString(), instruction);
    if (thread && instruction.address === thread.registers.RIP)
      ripLine = index + 1;
  }
  const monacoText = disassemblyLines.join('\n');

  const instructionAt = (address: bigint) => byAddress.get(address.toString());

  const gotoDisassembly = async (target: bigint | string): Promise<boolean> => {
    const address =
      typeof target === 'bigint' ? target : parseIntegerInput(target);
    if (address === undefined) {
      failure(
        `"${String(target)}" geçerli bir adres değil (0x… / 1F4h / ondalık bekleniyor).`,
      );
      return false;
    }
    const decoded = await api.debug.decode(ref, address);
    if (!decoded) {
      failure(`${hex(address)} disassemble edilemedi.`);
      return false;
    }
    setAnchor(address);
    bump();
    info(
      `Disassembly ${hex(address)}${process ? ` (${resolveSymbol(process, address)})` : ''} adresine taşındı.`,
    );
    return true;
  };

  const returnToRip = () => {
    setAnchor(undefined);
    bump();
    if (thread) info(`Disassembly RIP'e döndü: ${hex(thread.registers.RIP)}.`);
  };

  /* ---------- registers ---------- */
  const changedRegisters = new Set(thread?.lastStep?.changedRegisters ?? []);
  const registerRows: RegisterRow[] = REGISTER_ORDER.map((name) => ({
    name,
    value: thread?.registers[name] ?? 0n,
    changed: changedRegisters.has(name),
  }));

  const writeRegister = async (
    name: RegisterName,
    raw: string,
  ): Promise<boolean> => {
    const parsed = parseIntegerInput(raw);
    if (parsed === undefined) {
      failure(
        `"${raw}" geçerli bir 64-bit değer değil (0x… / 1F4h / ondalık bekleniyor).`,
      );
      return false;
    }
    const value = BigInt.asUintN(64, parsed);
    await api.debug.writeRegister(ref, name, value);
    const snapshot = await api.debug.getThread(ref);
    if (snapshot) setThread(snapshot);
    if (name === 'RIP') setAnchor(undefined);
    bump();
    success(`${name} = ${hex(value)} olarak yazıldı.`);
    return true;
  };

  /* ---------- call stack ----------
   * The "no thread/process yet" case is folded into the exposed value via a
   * ternary below rather than calling setState for it inside the effect --
   * that branch is a synchronous derivation, not a fetch, so it does not
   * belong in an effect body at all. */
  const [callStackState, setCallStackState] = useState<CallStackFrame[]>([]);
  const [callStackNote, setCallStackNote] = useState<string>();

  useEffect(() => {
    if (!thread || !process) return;
    let cancelled = false;
    api.debug
      .getCallStack({ pid, tid })
      .then((addresses) => {
        if (cancelled) return;
        setCallStackState(
          addresses.map((address) => ({
            address,
            label: resolveSymbol(process, address),
          })),
        );
        setCallStackNote(undefined);
      })
      .catch((cause) => {
        if (cancelled) return;
        setCallStackState([
          {
            address: thread.registers.RIP,
            label: resolveSymbol(process, thread.registers.RIP),
          },
        ]);
        setCallStackNote(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [api, pid, tid, thread, process, revision]);

  const callStack = thread && process ? callStackState : [];

  /* ---------- memory ---------- */
  const mappings = process?.mappings ?? [];
  const selectedMapping = mappings.find(
    (mapping) => mapping.id === memoryMappingId,
  );

  /* Sync-checkable failures (no mapping selected, bad address, address
   * outside the mapping) are computed inline, not via setState in an
   * effect -- only the actual async `memory.read` needs the effect. */
  let memorySyncError: string | undefined;
  let memoryStart: bigint | undefined;
  let memoryReadLength = 0;
  if (!selectedMapping) {
    memorySyncError =
      mappings.length === 0 ? undefined : 'Hiçbir mapping seçili değil.';
  } else {
    const parsedBase = parseIntegerInput(memoryBase);
    if (memoryBase.trim() && parsedBase === undefined) {
      memorySyncError = `"${memoryBase}" geçerli bir adres değil.`;
    } else {
      const start = parsedBase ?? selectedMapping.base;
      const mappingEnd = selectedMapping.base + BigInt(selectedMapping.size);
      if (start < selectedMapping.base || start >= mappingEnd) {
        memorySyncError = `${hex(start)} adresi "${selectedMapping.label}" mapping'i içinde değil (${hex(
          selectedMapping.base,
        )} – ${hex(mappingEnd)}).`;
      } else {
        memoryStart = start;
        memoryReadLength = Math.min(
          Math.max(16, Math.min(512, Number(memoryLength) || 128)),
          Number(mappingEnd - start),
        );
      }
    }
  }

  const [fetchedMemoryRows, setFetchedMemoryRows] = useState<MemoryRow[]>([]);
  const [fetchedMemoryError, setFetchedMemoryError] = useState<string>();

  useEffect(() => {
    if (memoryStart === undefined) return;
    let cancelled = false;
    const start = memoryStart;
    api.memory
      .read(pid, start, memoryReadLength)
      .then((bytes) => {
        if (cancelled) return;
        const rows = Array.from(
          { length: Math.ceil(bytes.length / 16) },
          (_, rowIndex) => {
            const offset = rowIndex * 16;
            const row = bytes.slice(offset, offset + 16);
            return {
              address: start + BigInt(offset),
              bytes: Array.from(row),
              ascii: Array.from(row, (byte) =>
                byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.',
              ).join(''),
            };
          },
        );
        setFetchedMemoryRows(rows);
        setFetchedMemoryError(undefined);
      })
      .catch((cause) => {
        if (cancelled) return;
        setFetchedMemoryRows([]);
        setFetchedMemoryError(describeError(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [api, pid, memoryStart, memoryReadLength, revision]);

  const memoryRows = memorySyncError !== undefined ? [] : fetchedMemoryRows;
  const memoryError = memorySyncError ?? fetchedMemoryError;

  const selectMapping = (id: string) => {
    setMemoryMappingId(id);
    const mapping = mappings.find((m) => m.id === id);
    if (mapping) setMemoryBase(hex(mapping.base));
  };

  const gotoMemory = async (raw: string | bigint): Promise<boolean> => {
    const address = typeof raw === 'bigint' ? raw : parseIntegerInput(raw);
    if (address === undefined) {
      failure(
        `"${String(raw)}" geçerli bir adres değil (0x… / 1F4h / ondalık bekleniyor).`,
      );
      return false;
    }
    const mapping = await api.memory.findMapping(pid, address);
    if (!mapping) {
      failure(`${hex(address)} hiçbir mapping içinde değil.`);
      return false;
    }
    setMemoryMappingId(mapping.id);
    setMemoryBase(hex(address));
    bump();
    info(
      `Memory ${hex(address)} · ${mapping.label} (${mapping.protection}) adresine taşındı.`,
    );
    return true;
  };

  const writeMemoryBytes = async (
    address: bigint,
    bytes: Uint8Array,
  ): Promise<boolean> => {
    try {
      await api.memory.write(pid, address, bytes);
    } catch (error) {
      failure(`${hex(address)} adresine yazılamadı — ${describeError(error)}`);
      bump();
      return false;
    }
    setLastMemoryWrite({ address, size: bytes.length });
    bump();
    success(
      `${hex(address)} adresine ${bytes.length} byte yazıldı: ${Array.from(bytes, byteHex).join(' ')}.`,
    );
    return true;
  };

  const writeMemoryByte = async (
    address: bigint,
    raw: string,
  ): Promise<boolean> => {
    const byte = parseByteInput(raw);
    if (byte === undefined) {
      failure(`"${raw}" geçerli bir byte değeri değil (00–FF bekleniyor).`);
      return false;
    }
    return writeMemoryBytes(address, Uint8Array.of(byte));
  };

  const writeMemoryValue = async (
    addressRaw: string,
    valueRaw: string,
    width: MemoryWriteWidth,
  ): Promise<boolean> => {
    const address = parseIntegerInput(addressRaw);
    if (address === undefined) {
      failure(
        `"${addressRaw}" geçerli bir adres değil (0x… / 1F4h / ondalık bekleniyor).`,
      );
      return false;
    }
    const value = parseIntegerInput(valueRaw);
    if (value === undefined) {
      failure(
        `"${valueRaw}" geçerli bir değer değil (0x… / 1F4h / ondalık bekleniyor).`,
      );
      return false;
    }
    const limit = 1n << BigInt(width * 8);
    if (value >= limit || value < -(limit >> 1n)) {
      failure(`${valueRaw} değeri ${width} byte'a sığmıyor.`);
      return false;
    }
    return writeMemoryBytes(address, encodeLittleEndian(value, width));
  };

  const isWrittenByte = (address: bigint) =>
    lastMemoryWrite !== undefined &&
    address >= lastMemoryWrite.address &&
    address < lastMemoryWrite.address + BigInt(lastMemoryWrite.size);

  /* ---------- trace ---------- */
  const clearTrace = () => {
    setTrace([]);
    info('Instruction geçmişi temizlendi.');
  };

  return {
    ready,
    pid,
    tid,
    process,
    revision,
    message,
    setMessage,

    canRun,
    stateLabel: thread ? STATE_LABEL[thread.state] : '…',
    stateDotClass: thread ? STATE_DOT[thread.state] : 'bg-zinc-500',
    suspendCount: thread?.suspendCount ?? 0,
    rip: hex(thread?.registers.RIP ?? 0n),

    stepInto,
    stepOver,
    stepOut,
    continueExecution,
    runToCursor,

    disassembly,
    disassemblyError,
    monacoText,
    ripLine,
    lineToAddress,
    instructionAt,
    anchor,
    gotoDisassembly,
    returnToRip,

    registerRows,
    writeRegister,

    callStack,
    callStackNote,

    breakpoints,
    toggleBreakpoint,
    removeBreakpoint,
    clearBreakpoints,

    trace,
    clearTrace,

    mappings,
    memoryMappingId,
    selectMapping,
    memoryBase,
    setMemoryBase,
    memoryLength,
    setMemoryLength,
    memoryRows,
    memoryError,
    gotoMemory,
    writeMemoryByte,
    writeMemoryValue,
    isWrittenByte,
  };
}

export type DebugSession = ReturnType<typeof useDebugSession>;
