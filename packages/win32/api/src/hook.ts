import {
  type AddressLike,
  resolveAddress,
  type IMemoryAccessor,
  type CMachineCode,
  type CFunction,
} from 'bun-xffi';

// ── Hook handle ───────────────────────────────────────────────────────────────

/**
 * Anything that identifies a target function to hook: a real {@link CFunction}
 * (or {@link CMachineCode}, which is one). Never a raw address -- the hook API
 * deals in typed function objects so it can read their signature (arg count)
 * and so callers can't accidentally point a hook at an arbitrary integer.
 */
export type HookTarget = CFunction;

/**
 * Anything that can be a detour destination: a {@link CFunction} already at an
 * address, or a {@link CMachineCode} (injected on demand if not already). Never a
 * raw address.
 */
export type HookDetour = CFunction | CMachineCode;

/**
 * A single function hook, modelled as an OOP handle.
 *
 * The handle is a thin ergonomic veneer over its {@link HookManager}: it
 * captures the manager and the {@link IMemoryAccessor} it operates through at
 * creation time, and its lifecycle methods just forward into the manager
 * (`hook.enable()` → `manager.enable(memory, hook, ...)`). The real
 * install/restore logic lives on the manager, where it has natural access to
 * process-level state (pid, thread scanning, poll/resume); the handle exists
 * so callers write `hook.enable()` instead of threading `memory` and the hook
 * back through the manager on every call.
 */
export abstract class Hook {
  /** Whether the hook is currently installed at `target`. */
  public enabled = false;

  protected constructor(
    // The manager that owns the real logic. Typed loosely (`<any>`) because a
    // `HookManager<ConcreteHook>` is not assignable to `HookManager<Hook>`
    // (the hook parameter is contravariant); the forwarders below only ever
    // pass `this`, so this stays sound in practice.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    protected readonly manager: HookManager<any>,
    /** The accessor this hook reads/writes the target process through. */
    public readonly memory: IMemoryAccessor,
    /** The hooked function itself (callable; its signature gives `argCount`). */
    public readonly target: HookTarget,
  ) {}

  /** Absolute address of the hooked function (`target`). */
  public get address(): bigint {
    return BigInt(resolveAddress(this.target));
  }

  /** Number of arguments the hooked function takes, from its signature. */
  public get argCount(): number {
    return (this.target as any)?.args?.length ?? 4;
  }

  /**
   * Install the hook. The base handle takes no detour -- patch-style hooks
   * (nhook) don't redirect anywhere. Detour-style hooks override this to accept
   * the function/machineCode to redirect to (see {@link DetourHook}).
   */
  public enable(): Promise<void> {
    return this.manager.enable(this.memory, this);
  }

  /** Uninstall the hook, restoring `target` to its original state. */
  public disable(): Promise<void> {
    return this.manager.disable(this.memory, this);
  }

  /**
   * Disable (if needed), release any resources the hook owns (e.g. a
   * trampoline buffer), and unregister from its manager.
   */
  public destroy(): Promise<void> {
    return this.manager.destroy(this.memory, this);
  }

  /** Enable if currently disabled, disable if currently enabled. */
  public async toggle(): Promise<void> {
    if (this.enabled) await this.disable();
    else await this.enable();
  }
}

/**
 * A hook that redirects execution to a detour (e.g. minhook's 5-byte
 * `jmp rel32`).
 */
export abstract class DetourHook extends Hook {
  /**
   * The function execution is currently redirected to -- the detour resolved
   * from the {@link HookDetour} last passed to `enable()`, kept as a
   * `CFunction` at its final (already-injected) address. Mutable and optional:
   * a detour can be swapped after creation (re-`enable()` with a different one)
   * and is unset before the first enable.
   */
  public detour?: CFunction;

  /**
   * Install/re-target the hook to `detour`. If `detour` is omitted, the last
   * one used (`this.detour`) is reinstalled -- so `toggle()`/`enableAll()` can
   * re-enable a disabled detour hook without remembering it; otherwise the new
   * detour becomes the remembered one. The manager throws if there was never a
   * detour to reuse.
   */
  public override enable(detour?: HookDetour): Promise<void> {
    if (!detour) detour = this.detour;
    else this.detour = detour;
    return this.manager.enable(this.memory, this, detour);
  }
}

/**
 * A hook that overwrites the target's opening bytes with a patch (e.g. nhook's
 * 2-byte `EB FE` inline hook), tracking what to restore on disable.
 *
 * An interface, not another abstract class extending `Hook` (unlike
 * `DetourHook`, which has real concrete behavior in its `enable()` override
 * and must stay a class): this tier adds no shared state or concrete
 * behavior of its own, just two fields. Being an interface lets a hook style
 * that is *both* a byte-patch and a detour redirect -- minhook's 5-byte JMP
 * overwrites the target's opening bytes (`PatchHook`'s concern) *and*
 * redirects to a caller-supplied detour (`DetourHook`'s concern) -- combine
 * both: `class MinHookInstance extends DetourHook implements PatchHook`.
 * Single class inheritance couldn't otherwise express that a hook is both.
 */
export interface PatchHook extends Hook {
  /** The original bytes at `target`, saved so they can be restored on disable. */
  readonly originalBytes: Buffer;
  /** Number of bytes at `target` overwritten by the patch (>= patch size). */
  readonly affectedLength: number;
}

// ── Hook Pool Result ──────────────────────────────────────────────────────────

/**
 * Represents a hook event/hit captured during polling.
 */
export interface HookPoolResult<T extends Hook = Hook> {
  /** Unique ID of the hook hit event. */
  readonly id: number;
  /** The thread ID that hit the hook. */
  readonly threadId: number;
  /** The hook definition that was triggered. */
  readonly hook: T;
  /** Array of arguments passed to the function when it was intercepted. */
  readonly args: bigint[];
  /** The memory accessor for interacting with the target thread's stack. */
  readonly memory: IMemoryAccessor;
}

// ── Hook Manager ──────────────────────────────────────────────────────────────

/**
 * Factory + registry + implementation for a hooking style. Creates hook
 * handles, tracks them by target address, and holds the real
 * enable/disable/destroy logic that the handles forward into (see
 * {@link Hook}).
 *
 * This is the universal contract every hook style shares. It intentionally has
 * no concept of polling for hits or resuming a thread -- that only makes sense
 * for hooking styles that park a thread and hand control back to JS later (see
 * {@link PollableHookManager}). A trampoline-based hook (e.g. minhook-style)
 * fires synchronously on the caller's own thread and never needs it.
 */
export abstract class HookManager<T extends Hook = Hook> {
  protected readonly hooks: Map<bigint, T> = new Map();

  protected constructor(public readonly pid: number) {}

  /**
   * Create, register, and return a hook handle for `target` (not yet enabled).
   * The arg count comes from the target function's signature (`hook.argCount`).
   */
  public abstract create(
    memory: IMemoryAccessor,
    target: HookTarget,
  ): Promise<T>;

  /**
   * Install `hook`. This is where the real logic lives; callers normally reach
   * it via the handle's `hook.enable(detour)` forwarder. `detour` is used by
   * detour-style hooks and ignored by patch-style ones.
   */
  public abstract enable(
    memory: IMemoryAccessor,
    hook: T,
    detour?: HookDetour,
  ): Promise<void>;

  /** Uninstall `hook`, restoring the target. Reached via `hook.disable()`. */
  public abstract disable(memory: IMemoryAccessor, hook: T): Promise<void>;

  /**
   * Disable (if needed), free the hook's resources, and unregister it.
   * Reached via `hook.destroy()`.
   */
  public abstract destroy(memory: IMemoryAccessor, hook: T): Promise<void>;

  /** Register an already-constructed hook handle. */
  public register(hook: T): void {
    this.hooks.set(hook.address, hook);
  }

  /**
   * Remove a hook from the registry. Called by a manager's `destroy()`
   * implementation; does not itself uninstall the hook.
   */
  public forget(target: HookTarget | bigint): void {
    this.hooks.delete(
      typeof target === 'bigint' ? target : BigInt(resolveAddress(target)),
    );
  }

  /** Look up a hook by its target function. */
  public get(target: HookTarget): T | undefined {
    return this.hooks.get(BigInt(resolveAddress(target)));
  }

  /** Check if a hook exists for the given target function. */
  public has(target: HookTarget): boolean {
    return this.hooks.has(BigInt(resolveAddress(target)));
  }

  /** Enable all managed hooks. */
  public async enableAll(): Promise<void> {
    for (const hook of this.hooks.values())
      await this.enable(hook.memory, hook);
  }

  /** Disable all managed hooks (without destroying). */
  public async disableAll(): Promise<void> {
    for (const hook of this.hooks.values())
      await this.disable(hook.memory, hook);
  }

  /** Destroy all managed hooks and clear the registry. */
  public async destroyAll(): Promise<void> {
    // destroy() calls forget(), mutating the map -- iterate over a snapshot.
    for (const hook of Array.from(this.hooks.values()))
      await this.destroy(hook.memory, hook);
    this.hooks.clear();
  }

  /** Iterate over all managed hooks. */
  [Symbol.iterator](): IterableIterator<T> {
    return this.hooks.values();
  }

  /**
   * Runs the hook loop: repeatedly waits for a hit and hands it to `onHit`.
   * Only meaningful for hooking styles that park a thread and need polling
   * (see {@link PollableHookManager}, which overrides this with the real
   * implementation) -- a trampoline-based hook (e.g. minhook-style) fires
   * synchronously on the caller's own thread and has nothing to serve.
   * Present here (rather than only on `PollableHookManager`) so callers
   * holding a plain `HookManager<T>` can still call `.serve()` and get a
   * clear runtime error instead of it silently being absent.
   */
  public serve(
    _onHit: (hit: HookPoolResult<T>) => Promise<void> | void,
    _intervalMs: number = DEFAULT_SERVE_INTERVAL_MS,
  ): Promise<never> {
    throw new Error(
      `${this.constructor.name} does not support serve() -- it isn't a PollableHookManager (no poll()/resume() to drive).`,
    );
  }
}

/** Default poll interval for `HookManager.serve()`/`PollableHookManager.serve()`. */
export const DEFAULT_SERVE_INTERVAL_MS = 20;

/**
 * A HookManager for hooking styles that park a hit thread and require JS to
 * explicitly resume it later (e.g. nhook's thread redirection 2-byte patch).
 */
export abstract class PollableHookManager<
  T extends Hook = Hook,
  R extends HookPoolResult<T> = HookPoolResult<T>,
> extends HookManager<T> {
  /** Performs a single pass over all threads to check for hook hits. */
  public abstract poll(): Promise<R[]>;

  /** Resumes a thread after a hook hit. */
  public abstract resume(result: R, returnValue?: bigint): Promise<void>;

  /**
   * Drives the poll loop for you: calls `poll()` every `intervalMs` and
   * awaits `onHit` for each hit it finds. `onHit` is responsible for calling
   * `resume()` itself (same as driving `poll()`/`resume()` by hand), since
   * only it knows whether a hit needs a custom `returnValue`. Runs until
   * `onHit` or `poll()` throws (e.g. `nhook`'s `ProcessExitedError` once the
   * target process exits) -- that error propagates out of the returned
   * promise, there's no built-in stop condition yet.
   */
  public override async serve(
    onHit: (hit: R) => Promise<void> | void,
    intervalMs: number = DEFAULT_SERVE_INTERVAL_MS,
  ): Promise<never> {
    for (;;) {
      const hits = await this.poll();
      for (const hit of hits) {
        await onHit(hit);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

/**
 * A `PollableHookManager` that also supports argument inspection and calling
 * the original function. Unlike `HookManager`/`PollableHookManager`, this
 * tier adds no shared state or concrete behavior of its own -- it's a pure
 * capability marker -- so it's an interface, not another abstract class:
 * a concrete manager `extends PollableHookManager<T> implements
 * InterceptHookManager<T>` instead of extending a third class in the chain.
 */
export interface InterceptHookManager<
  T extends Hook = Hook,
  R extends HookPoolResult<T> = HookPoolResult<T>,
> extends PollableHookManager<T, R> {
  /**
   * Calls the original function, bypassing the hook. `args` are call argument
   * *values* (not function references).
   */
  callOriginal(result: R, ...args: AddressLike[]): Promise<bigint>;

  /** Reads original function arguments from a captured context. */
  getOriginalArgs(result: R, count?: number): Promise<bigint[]>;
}
