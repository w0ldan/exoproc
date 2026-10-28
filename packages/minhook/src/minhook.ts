import * as Native from 'bun-winapi';
import { type HookTarget, type HookDetour } from 'bun-winapi';
import {
  NativePointer,
  MemoryProtection,
  resolveAddress,
  type IMemoryAccessor,
  type CMachineCode,
} from 'bun-xffi';
import { CapstoneX86, type Instruction } from 'bun-capstone';
import { buildTrampoline, JMP_PATCH_SIZE } from './trampoline.js';
import { HookNotEnabledError } from './errors.js';

/** Bytes of a `jmp qword ptr [rip+0]; <abs u64>` far-detour relay stub. */
const FAR_RELAY_SIZE = 14;

/**
 * A single MinHook-style trampoline/detour hook. This is a data handle -- its
 * `enable`/`disable`/`destroy` lifecycle is inherited from {@link Native.Hook}
 * and forwards into {@link MinHook}, which holds the real logic.
 */
export class MinHookInstance
  extends Native.DetourHook
  implements Native.PatchHook
{
  /**
   * "Call original" address: relocated stolen bytes + jmp back to the rest of
   * the target's unmodified body. The detour (caller-provided machineCode) is
   * expected to jump/call here directly -- there's no JS-side mediation of the
   * call the way nhook's callOriginal() needs, since a real JMP-installed hook
   * fires synchronously on the caller's own thread.
   */
  public readonly trampoline: NativePointer;
  /** Number of bytes at `target` overwritten by the 5-byte JMP (>= 5, `PatchHook`). */
  public readonly affectedLength: number;
  /** The target's original bytes over `affectedLength`, saved for disable/restore. */
  public readonly originalBytes: Buffer;
  /** Instructions relocated into the trampoline. */
  public readonly stolenInstructions: Instruction[];
  /**
   * Lazily-allocated near relay: a 14-byte `jmp qword ptr [rip+0]; <abs u64>`
   * stub used only when a detour is out of the 5-byte JMP's rel32 range. The
   * JMP then targets this (near) stub, which absolutely jumps to the far detour.
   */
  public relay?: NativePointer;

  constructor(
    manager: MinHook,
    memory: IMemoryAccessor,
    target: HookTarget,
    trampoline: NativePointer,
    affectedLength: number,
    originalBytes: Buffer,
    stolenInstructions: Instruction[],
  ) {
    super(manager, memory, target);
    this.trampoline = trampoline;
    this.affectedLength = affectedLength;
    this.originalBytes = originalBytes;
    this.stolenInstructions = stolenInstructions;
  }
}

/**
 * MinHook-style trampoline/detour hooking: install a real 5-byte relative JMP
 * at the target (found via `allocNear` to keep the trampoline in reach), vs.
 * nhook's allocation-free 2-byte `EB FE` park-and-simulate approach.
 *
 * `create()` builds the trampoline and hands back a {@link MinHookInstance}
 * handle; the caller drives it via `hook.enable(detour)` / `hook.disable()` /
 * `hook.destroy()`, which forward here.
 *
 * The detour is always caller-supplied machineCode (a `CMachineCode` already
 * injected into the target process via some accessor, or a raw address) --
 * this package never compiles or allocates it. That keeps the "how does the
 * detour talk back to JS" question entirely out of scope: write a detour that
 * just calls the trampoline and returns (a passthrough/no-op hook), one that
 * opens its own named pipe, one that pushes work through nthread, or anything
 * else -- MinHook only cares about its address.
 *
 * Two-phase setup avoids needing any protocol for the detour to discover the
 * trampoline's address at runtime: `create()` builds the trampoline first
 * (no detour needed yet), so its address is known when the caller compiles
 * their detour machineCode -- they can bake it in as a literal, the same way
 * addresses get patched into generated C source elsewhere in this codebase.
 *
 *   const hook = await minhook.create(memory, targetAddr);
 *   const detour = cmachinecode({ source: `
 *     return ((int(*)(int))0x${hook.trampoline.toBigInt().toString(16)})(arg0) + 1;
 *   `, ... });
 *   const detourAddr = await detour.machineCode(accessor);
 *   await hook.enable(detourAddr);
 */
export class MinHook extends Native.HookManager<MinHookInstance> {
  private readonly _capstone: CapstoneX86;

  constructor(pid: number = Native.currentProcess.pid) {
    super(pid);
    this._capstone = new CapstoneX86();
    this._capstone.onDetail();
  }

  /**
   * Builds the trampoline for `target` and returns a hook handle. Does not
   * install anything at `target` yet -- call `hook.enable(detour)` once you
   * have a detour (see class docs for why this is two-phase).
   */
  public async create(
    memory: IMemoryAccessor,
    target: HookTarget,
  ): Promise<MinHookInstance> {
    const targetAddr = BigInt(resolveAddress(target));
    if (this.hooks.has(targetAddr)) {
      throw new Error(`Hook already exists at 0x${targetAddr.toString(16)}`);
    }

    const tramp = await buildTrampoline(memory, this._capstone, targetAddr);

    const hook = new MinHookInstance(
      this,
      memory,
      target,
      new NativePointer(tramp.address),
      tramp.patchLength,
      tramp.originalBytes,
      tramp.stolenInstructions,
    );
    this.hooks.set(targetAddr, hook);
    return hook;
  }

  /**
   * Installs (or re-targets) the JMP at `hook.target` to point at `detour`.
   * The handle's `enable()` forwarder owns the "remember/reuse last detour"
   * logic and `hook.detour`; here `detour` is whatever it resolved to (throws
   * if there was never one). Swapping detours is just re-calling with a
   * different one -- the JMP is rewritten each time.
   */
  public async enable(
    memory: IMemoryAccessor,
    hook: MinHookInstance,
    detour?: HookDetour,
  ): Promise<void> {
    if (detour === undefined) {
      throw new HookNotEnabledError(hook.address);
    }
    const detourAddr = await this.resolveDetour(memory, detour);

    const targetAddr = hook.address;
    // The 5-byte JMP must reach its destination in rel32. If the detour is in
    // range, jump straight to it; otherwise route through a near relay stub
    // that absolutely (FF 25) jumps to the far detour.
    const jmpDest = await this.jmpDestination(
      memory,
      hook,
      targetAddr,
      detourAddr,
    );
    const jmpDisp = jmpDest - (targetAddr + BigInt(JMP_PATCH_SIZE));

    const patch = Buffer.alloc(hook.affectedLength, 0x90); // pad with NOP
    patch.writeUInt8(0xe9, 0);
    patch.writeInt32LE(Number(jmpDisp), 1);

    const oldProtect = await memory.protect(
      targetAddr,
      hook.affectedLength,
      MemoryProtection.EXECUTE_READWRITE,
    );
    await memory.write(targetAddr, patch);
    await memory.protect(targetAddr, hook.affectedLength, oldProtect);

    hook.enabled = true;
  }

  /**
   * Where the target's 5-byte JMP should point. If `detourAddr` is within
   * rel32 reach, that's the detour itself. Otherwise a near relay stub (built
   * on demand via {@link ensureRelay}, kept within reach by `allocNear`) is
   * (re)written to absolutely jump to the far detour, and the JMP targets it.
   */
  private async jmpDestination(
    memory: IMemoryAccessor,
    hook: MinHookInstance,
    targetAddr: bigint,
    detourAddr: bigint,
  ): Promise<bigint> {
    const directDisp = detourAddr - (targetAddr + BigInt(JMP_PATCH_SIZE));
    if (directDisp >= -0x80000000n && directDisp <= 0x7fffffffn) {
      return detourAddr;
    }

    const relayAddr = await this.ensureRelay(memory, hook, targetAddr);
    // jmp qword ptr [rip+0] ; <abs detour u64> -- an unconditional absolute jump.
    const stub = Buffer.alloc(FAR_RELAY_SIZE);
    stub.writeUInt8(0xff, 0);
    stub.writeUInt8(0x25, 1);
    stub.writeUInt32LE(0, 2);
    stub.writeBigUInt64LE(detourAddr, 6);
    const oldProtect = await memory.protect(
      relayAddr,
      FAR_RELAY_SIZE,
      MemoryProtection.EXECUTE_READWRITE,
    );
    await memory.write(relayAddr, stub);
    await memory.protect(relayAddr, FAR_RELAY_SIZE, oldProtect);
    return relayAddr;
  }

  /** Allocate (once) a near relay stub for `hook`, within the JMP's reach. */
  private async ensureRelay(
    memory: IMemoryAccessor,
    hook: MinHookInstance,
    targetAddr: bigint,
  ): Promise<bigint> {
    if (hook.relay) return hook.relay.toBigInt();
    const relay = await memory.allocNear(targetAddr, FAR_RELAY_SIZE, {
      protection: MemoryProtection.EXECUTE_READWRITE,
    });
    const relayAddr = BigInt(resolveAddress(relay));
    hook.relay = new NativePointer(relayAddr);
    return relayAddr;
  }

  /**
   * Resolve a {@link HookDetour} to an absolute address. A `CMachineCode` is
   * injected through the accessor (`memory.machineCode` handles the
   * already-injected case too); a plain `CFunction` is already at its address.
   */
  private async resolveDetour(
    memory: IMemoryAccessor,
    detour: HookDetour,
  ): Promise<bigint> {
    const sc = detour as Partial<CMachineCode>;
    if (
      typeof sc.shouldCloneForAccessor === 'function' &&
      typeof sc.machineCode === 'function' &&
      sc.shouldCloneForAccessor(memory)
    ) {
      return BigInt(await memory.machineCode(detour as CMachineCode));
    }
    return BigInt(resolveAddress(detour));
  }

  /** Restores the target's original bytes. The trampoline is left intact (see `destroy()`). */
  public async disable(
    memory: IMemoryAccessor,
    hook: MinHookInstance,
  ): Promise<void> {
    if (!hook.enabled) return;
    const targetAddr = hook.address;
    const oldProtect = await memory.protect(
      targetAddr,
      hook.affectedLength,
      MemoryProtection.EXECUTE_READWRITE,
    );
    await memory.write(targetAddr, hook.originalBytes);
    await memory.protect(targetAddr, hook.affectedLength, oldProtect);
    hook.enabled = false;
  }

  /** Disables (if needed), frees the trampoline, and unregisters the hook. */
  public async destroy(
    memory: IMemoryAccessor,
    hook: MinHookInstance,
  ): Promise<void> {
    if (!this.hooks.has(hook.address)) return;
    if (hook.enabled) await this.disable(memory, hook);
    await memory.free(hook.trampoline);
    if (hook.relay) await memory.free(hook.relay);
    this.forget(hook.address);
  }
}
