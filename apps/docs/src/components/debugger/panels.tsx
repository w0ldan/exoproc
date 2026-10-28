'use client';

import { useEffect, useRef, useState } from 'react';
import type { RegisterName } from '../../shell/common/channels';
import { CollapsiblePanel, GHOST_BUTTON_CLASS, INPUT_CLASS } from './chrome';
import { byteHex, hex, operationOf } from './format';
import type { DebugSession, MemoryWriteWidth } from './useDebugSession';

/* ================================================================
 * REGISTERS -- click a value to edit it, Enter writes to thread.registers
 * ================================================================ */
export function RegistersPanel({ session }: { session: DebugSession }) {
  const { registerRows, writeRegister, stateLabel } = session;
  const [editing, setEditing] = useState<RegisterName>();
  const [draft, setDraft] = useState('');
  /** Escape unmounts the input, which also fires blur -- don't let that commit. */
  const cancelledRef = useRef(false);

  const commit = async () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    if (!editing) return;
    if (await writeRegister(editing, draft)) setEditing(undefined);
  };

  const cancel = () => {
    cancelledRef.current = true;
    setEditing(undefined);
  };

  return (
    <CollapsiblePanel title="REGISTERS" badge={stateLabel}>
      <dl className="m-0">
        {registerRows.map((register) => {
          const isEditing = editing === register.name;
          return (
            <div
              key={register.name}
              className={`grid grid-cols-[55px_1fr] border-b border-[#2d2d2d] px-3 py-1 font-mono text-xs ${
                register.changed ? 'bg-amber-500/10' : ''
              } ${register.name === 'RIP' ? 'border-l-2 border-l-[#007acc]' : ''}`}
            >
              <dt className="font-semibold text-[#858585]">{register.name}</dt>
              <dd className="m-0 text-right">
                {isEditing ? (
                  <input
                    autoFocus
                    value={draft}
                    spellCheck={false}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={commit}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        commit();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        cancel();
                      }
                    }}
                    className={`${INPUT_CLASS} w-full text-right`}
                  />
                ) : (
                  <button
                    type="button"
                    title={`${register.name} değerini düzenle`}
                    onClick={() => {
                      setEditing(register.name);
                      setDraft(hex(register.value));
                    }}
                    className={`w-full cursor-pointer rounded px-1 text-right hover:bg-[#3c3c3c] ${
                      register.changed ? 'text-amber-400' : 'text-[#cccccc]'
                    }`}
                  >
                    <code>{hex(register.value)}</code>
                  </button>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="m-0 px-3 py-1.5 text-[0.65rem] leading-relaxed text-[#858585]">
        Değere tıklayıp yeni bir değer yazın (0x… / 1F4h / ondalık). Enter
        yazar, Esc iptal eder.
      </p>
    </CollapsiblePanel>
  );
}

/* ================================================================
 * CALL STACK
 * ================================================================ */
export function CallStackPanel({ session }: { session: DebugSession }) {
  const { callStack, callStackNote, gotoDisassembly } = session;
  return (
    <CollapsiblePanel title="CALL STACK" badge={`${callStack.length}`}>
      <div className="py-1">
        {callStack.map((frame, index) => (
          <button
            key={`${frame.address.toString()}:${index}`}
            type="button"
            onClick={() => gotoDisassembly(frame.address)}
            title={`${hex(frame.address)} adresine git`}
            className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left font-mono text-xs hover:bg-[#2d2d2d] ${
              index === 0 ? 'border-l-2 border-l-[#007acc] bg-[#007acc]/10' : ''
            }`}
          >
            {index === 0 && <span className="text-[#007acc]">&#9654;</span>}
            <code className="overflow-hidden text-ellipsis whitespace-nowrap text-[#cccccc]">
              {frame.label}
            </code>
          </button>
        ))}
        {callStackNote && (
          <p className="m-0 px-3 py-1.5 text-[0.65rem] leading-relaxed text-amber-400">
            {callStackNote}
          </p>
        )}
      </div>
    </CollapsiblePanel>
  );
}

/* ================================================================
 * BREAKPOINTS
 * ================================================================ */
export function BreakpointsPanel({ session }: { session: DebugSession }) {
  const { breakpoints, removeBreakpoint, clearBreakpoints, gotoDisassembly } =
    session;
  return (
    <CollapsiblePanel
      title="BREAKPOINTS"
      badge={`${breakpoints.size}`}
      action={
        <button
          type="button"
          disabled={breakpoints.size === 0}
          onClick={clearBreakpoints}
          className={GHOST_BUTTON_CLASS}
        >
          Tümünü kaldır
        </button>
      }
    >
      <div className="py-1">
        {breakpoints.size === 0 ? (
          <div className="px-3 py-2 text-xs text-[#858585]">
            Gutter&apos;a tıklayarak breakpoint ekleyin (veya satırda F9).
          </div>
        ) : (
          Array.from(breakpoints).map((address) => (
            <div
              key={address.toString()}
              className="flex items-center justify-between px-3 py-1 font-mono text-xs"
            >
              <button
                type="button"
                onClick={() => gotoDisassembly(address)}
                className="flex cursor-pointer items-center gap-2 text-left"
                title={`${hex(address)} adresine git`}
              >
                <span className="text-red-500">&#9679;</span>
                <code className="text-[#cccccc]">{hex(address)}</code>
              </button>
              <button
                type="button"
                onClick={() => removeBreakpoint(address)}
                className="cursor-pointer text-[#858585] hover:text-red-500"
                title="Breakpoint'i kaldır"
              >
                &#10005;
              </button>
            </div>
          ))
        )}
      </div>
    </CollapsiblePanel>
  );
}

/* ================================================================
 * TRACE -- executed instruction history, oldest first
 * ================================================================ */
export function TracePanel({ session }: { session: DebugSession }) {
  const { trace, clearTrace, gotoDisassembly } = session;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [trace.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[#2d2d2d] px-3 py-1.5">
        <span className="font-mono text-[0.65rem] text-[#858585]">
          Yürütülen instruction geçmişi — en yenisi altta, son {trace.length}{' '}
          kayıt tutuluyor.
        </span>
        <button
          type="button"
          disabled={trace.length === 0}
          onClick={clearTrace}
          className={`${GHOST_BUTTON_CLASS} ml-auto`}
        >
          Temizle
        </button>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto px-3 py-1.5 font-mono text-xs"
      >
        {trace.length === 0 ? (
          <div className="text-[#858585]">
            Henüz hiçbir instruction yürütülmedi. Step Into ile başlayın.
          </div>
        ) : (
          trace.map((instruction, index) => (
            <button
              key={`${index}:${instruction.address.toString()}`}
              type="button"
              onClick={() => gotoDisassembly(instruction.address)}
              title={`${hex(instruction.address)} adresine git`}
              className="grid w-full cursor-pointer grid-cols-[46px_158px_150px_minmax(0,1fr)] gap-3 whitespace-nowrap text-left hover:bg-[#2d2d2d]"
            >
              <code className="text-[#5a5a5a] tabular-nums">{index + 1}</code>
              <code className="text-[#858585]">{hex(instruction.address)}</code>
              <code className="text-[#6a9955]">
                {Array.from(instruction.bytes, byteHex).join(' ')}
              </code>
              <code className="overflow-hidden text-ellipsis text-[#cccccc]">
                {operationOf(instruction)}
              </code>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

/* ================================================================
 * MEMORY -- adjustable hex + ASCII view with in-place byte editing
 * ================================================================ */
const WIDTHS: readonly MemoryWriteWidth[] = [1, 2, 4, 8];

export function MemoryPanel({ session }: { session: DebugSession }) {
  const {
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
  } = session;

  const [editingByte, setEditingByte] = useState<bigint>();
  const [byteDraft, setByteDraft] = useState('');
  const [writeAddress, setWriteAddress] = useState('');
  const [writeValue, setWriteValue] = useState('');
  const [writeWidth, setWriteWidth] = useState<MemoryWriteWidth>(1);
  /** Escape unmounts the cell input, which also fires blur -- don't let that commit. */
  const cancelledRef = useRef(false);

  const commitByte = async () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    if (editingByte === undefined) return;
    if (await writeMemoryByte(editingByte, byteDraft))
      setEditingByte(undefined);
  };

  const cancelByte = () => {
    cancelledRef.current = true;
    setEditingByte(undefined);
  };

  /** An empty address box targets whatever the hex view is currently showing. */
  const effectiveWriteAddress = writeAddress.trim() || memoryBase;
  const submitWrite = () =>
    writeMemoryValue(effectiveWriteAddress, writeValue, writeWidth);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* View controls */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#2d2d2d] px-3 py-1.5">
        <label className="flex items-center gap-1.5">
          <span className="text-[0.65rem] font-semibold tracking-wide text-[#858585] uppercase">
            Mapping
          </span>
          <select
            value={memoryMappingId}
            onChange={(event) => selectMapping(event.target.value)}
            className="rounded border border-[#3c3c3c] bg-[#3c3c3c] px-1.5 py-1 text-xs text-[#cccccc]"
          >
            {mappings.map((mapping) => (
              <option key={mapping.id} value={mapping.id}>
                {mapping.label} · {mapping.protection}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <span className="text-[0.65rem] font-semibold tracking-wide text-[#858585] uppercase">
            Adres
          </span>
          <input
            value={memoryBase}
            spellCheck={false}
            onChange={(event) => setMemoryBase(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                gotoMemory(memoryBase);
              }
            }}
            className={`${INPUT_CLASS} w-44`}
          />
        </label>
        <button
          type="button"
          onClick={() => gotoMemory(memoryBase)}
          className={GHOST_BUTTON_CLASS}
          title="Adresi içeren mapping'i bulup görünümü oraya taşır"
        >
          Adrese git
        </button>
        <label className="flex items-center gap-1.5">
          <span className="text-[0.65rem] font-semibold tracking-wide text-[#858585] uppercase">
            Byte
          </span>
          <input
            type="number"
            min={16}
            max={512}
            step={16}
            value={memoryLength}
            onChange={(event) => setMemoryLength(Number(event.target.value))}
            className={`${INPUT_CLASS} w-16`}
          />
        </label>
        <span className="text-[0.65rem] text-[#858585]">
          Mapping, başlangıç adresi ve görünür byte sayısı ayarlanabilir.
        </span>
      </div>

      {/* Typed write box */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#2d2d2d] px-3 py-1.5">
        <span className="text-[0.65rem] font-semibold tracking-wide text-[#858585] uppercase">
          Yazma
        </span>
        <input
          value={writeAddress}
          spellCheck={false}
          placeholder={memoryBase || 'adres'}
          title="Boş bırakılırsa görüntülenen başlangıç adresine yazılır"
          onChange={(event) => setWriteAddress(event.target.value)}
          className={`${INPUT_CLASS} w-44`}
        />
        <input
          value={writeValue}
          spellCheck={false}
          placeholder="değer"
          onChange={(event) => setWriteValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submitWrite();
            }
          }}
          className={`${INPUT_CLASS} w-32`}
        />
        <select
          value={writeWidth}
          onChange={(event) =>
            setWriteWidth(Number(event.target.value) as MemoryWriteWidth)
          }
          className="rounded border border-[#3c3c3c] bg-[#3c3c3c] px-1.5 py-1 text-xs text-[#cccccc]"
        >
          {WIDTHS.map((width) => (
            <option key={width} value={width}>
              {width} byte
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={submitWrite}
          className={GHOST_BUTTON_CLASS}
        >
          Yaz
        </button>
        <span className="text-[0.65rem] text-[#858585]">
          Little-endian yazılır; yazılamayan bir mapping&apos;e deneme gerçek
          MemoryAccessFault üretir.
        </span>
      </div>

      {memoryError && (
        <div className="shrink-0 border-b border-[#2d2d2d] bg-red-950/40 px-3 py-1.5 font-mono text-[0.68rem] text-red-300">
          {memoryError}
        </div>
      )}

      {/* Hex dump */}
      <div className="min-h-0 flex-1 overflow-auto px-3 py-1.5 font-mono text-xs leading-relaxed">
        {memoryRows.map((row) => (
          <div
            key={row.address.toString()}
            className="grid grid-cols-[158px_minmax(390px,1fr)_140px] gap-3 whitespace-nowrap"
          >
            <code className="text-[#858585]">{hex(row.address)}</code>
            <span className="grid grid-cols-[repeat(16,1.55rem)]">
              {row.bytes.map((byte, index) => {
                const address = row.address + BigInt(index);
                if (editingByte === address) {
                  return (
                    <input
                      key={index}
                      autoFocus
                      maxLength={2}
                      value={byteDraft}
                      spellCheck={false}
                      onChange={(event) => setByteDraft(event.target.value)}
                      onBlur={commitByte}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitByte();
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          cancelByte();
                        }
                      }}
                      className="w-[1.5rem] rounded-sm border border-[#007acc] bg-[#3c3c3c] p-0 text-center font-mono text-xs text-[#cccccc] outline-none"
                    />
                  );
                }
                return (
                  <button
                    key={index}
                    type="button"
                    title={`${hex(address)} — düzenlemek için tıklayın`}
                    onClick={() => {
                      setEditingByte(address);
                      setByteDraft(byteHex(byte));
                    }}
                    className={`cursor-pointer rounded-sm text-left hover:bg-[#3c3c3c] ${
                      isWrittenByte(address)
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'text-[#cccccc]'
                    }`}
                  >
                    <code>{byteHex(byte)}</code>
                  </button>
                );
              })}
            </span>
            <code className="tracking-wide text-[#569cd6]">{row.ascii}</code>
          </div>
        ))}
        {memoryRows.length === 0 && !memoryError && (
          <div className="text-[#858585]">
            Seçilen adres bu mapping içinde değil.
          </div>
        )}
      </div>
    </div>
  );
}
