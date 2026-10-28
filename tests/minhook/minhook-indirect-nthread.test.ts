import { describe, expect, test } from 'bun:test';
import * as Native from 'bun-winapi';
import {
  cmachinecode,
  createCFunction,
  Kernel32Impl,
  RemoteCallableMemoryAccessor,
} from 'bun-xffi';
import { createAccessor } from 'exoproc-accessors';
import { MinHook } from 'bun-minhook';
import { getGlobalDummyProcess } from 'exoproc-dummy';

// Real end-to-end proof that MinHook works over an IndirectNThreadHostAccessor:
// hook a function injected into *another* process, then actually *invoke* it on
// the hijacked thread and observe the detour's effect. Getting the detour's
// value back (rather than the original) can't be faked -- it means the 5-byte
// JMP is genuinely installed in the target and executes.
//
// Two detours, as the simplest possible cases:
//   A) calls the trampoline and returns its result  -> proves the trampoline
//      (relocated stolen prologue + jmp back into the untouched body) works.
//   B) `return 1234;`                                -> proves a detour fully
//      overrides the function, and that detours hot-swap.
describe('MinHook over IndirectNThreadHostAccessor (cross-process, thread-hijack backend)', () => {
  const proc = getGlobalDummyProcess();

  test('hooks a function in another process and its detours run when invoked via the hijacked thread', async () => {
    const memory = await createAccessor(proc.pid, {
      hostOptions: { timeoutMs: 20000 },
    });
    const minhook = new MinHook(proc.pid);
    // Independent view: raw ReadProcessMemory, nothing in common with the
    // indirect chain -- confirms the JMP really lands in the target's memory.
    const verifier = new RemoteCallableMemoryAccessor(proc.pid);

    try {
      // Inject a real function (int -> int) into the target process. `machineCode()` being
      // the first op exercises its init guard (chain inits cleanly up front).
      const targetSc = cmachinecode({
        returns: 'i32',
        args: ['i32'],
        source: `return arg0 * 2 + 1;`,
      });
      const targetAddr = BigInt(await memory.machineCode(targetSc));
      // The hook API identifies the target by a CFunction, so wrap the remote
      // address in one (throwing local callable -- it's only ever called
      // remotely, via memory.call, which uses the address).
      const target = createCFunction(
        Number(targetAddr),
        ['i32', ['i32']],
        () => {
          throw new Error('remote target must not be called locally');
        },
      );

      // Baseline: invoke on the hijacked thread, unhooked. 10*2+1 = 21.
      expect(Number(await memory.call(target, 10))).toBe(21);

      // create(): read prologue + allocNear + write trampoline, all over the
      // hijacked thread. argCount is taken from target.args (= 1).
      const hook = await minhook.create(memory, target);
      expect(hook.affectedLength).toBeGreaterThanOrEqual(5);
      expect(hook.enabled).toBe(false);
      const trampolineAddr = hook.trampoline.toBigInt();

      // Detour A: pure passthrough -- calls the trampoline and returns its
      // result. So the hooked function still yields the original value, but the
      // path now goes target -> JMP -> detourA -> trampoline -> body -> return.
      const detourA = cmachinecode({
        returns: 'i32',
        args: ['i32'],
        source: `
          typedef int (*Original)(int);
          Original original = (Original)0x${trampolineAddr.toString(16)}ULL;
          return original(arg0);
        `,
      });
      await hook.enable(detourA);
      expect(hook.enabled).toBe(true);

      // Independent proof the JMP is really in the target's memory.
      const patched = await verifier.read(targetAddr, hook.affectedLength);
      expect(patched[0]).toBe(0xe9); // E9 = jmp rel32

      // Invoke: 21 again -- but only reachable *through the trampoline*, which
      // proves the relocated prologue + jmp-back executes correctly.
      expect(Number(await memory.call(target, 10))).toBe(21);

      // Detour B: fully overrides the function -- ignores args, returns 1234.
      const detourB = cmachinecode({
        returns: 'i32',
        args: ['i32'],
        source: `return 1234;`,
      });
      await hook.disable();
      await hook.enable(detourB);

      // Now the detour short-circuits the whole function: 1234 regardless of arg.
      expect(Number(await memory.call(target, 10))).toBe(1234);
      expect(Number(await memory.call(target, 999))).toBe(1234);

      // A detour can also be an existing CFunction -- no cmachinecode, no
      // injection at all. Point the target at kernel32's GetCurrentThreadId;
      // invoking the hooked target now runs GetCurrentThreadId on the hijacked
      // thread and returns its tid. (Proves HookDetour accepts a plain
      // CFunction, resolved by address with no CMachineCode handling.)
      await hook.enable(Kernel32Impl.GetCurrentThreadId);
      const detourTid = Number(await memory.call(target, 10));
      expect(
        Native.Thread.getThreads(proc.pid).some((t) => t.tid === detourTid),
      ).toBe(true);

      // disable() restores the original prologue -> unhooked behaviour returns.
      await hook.disable();
      const restored = await verifier.read(targetAddr, hook.affectedLength);
      expect(Buffer.compare(restored, hook.originalBytes)).toBe(0);
      expect(Number(await memory.call(target, 10))).toBe(21);

      // destroy() frees the trampoline and unregisters.
      await hook.destroy();
      expect(minhook.has(target)).toBe(false);
    } finally {
      await memory.deinit();
      verifier.close();
    }
  }, 120000);
});
