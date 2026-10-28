import { describe, expect, test } from 'bun:test';
import { cmachinecode, createCFunction } from 'bun-xffi';
import { createAccessor } from 'exoproc-accessors';
import { MinHook } from 'bun-minhook';
import { getGlobalDummyProcess } from 'exoproc-dummy';

// Native.Thread.create() (raw CreateThread) on the current process has a
// CI-environment-specific bug: the entry point's argument arrives corrupted
// (see #5) even though CreateThread itself reports success -- it doesn't
// reproduce locally, only under GitHub Actions' virtualized runners. That
// doesn't happen when invoking through NThread's thread-hijacking backend
// instead (proven by minhook-indirect-nthread.test.ts), so this test spawns
// a real process and invokes through a hijacked thread there, exactly like
// that test, rather than creating a new local thread.
describe('MinHook end-to-end lifecycle (real compiled target + real compiled detour)', () => {
  const proc = getGlobalDummyProcess();

  test('create() builds a trampoline without touching the target; enable() installs the JMP and the detour actually runs', async () => {
    const memory = await createAccessor(proc.pid, {
      hostOptions: { timeoutMs: 20000 },
    });
    const minhook = new MinHook(proc.pid);

    try {
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

      // Sanity: calling the real function directly (no hook yet) works as expected.
      expect(Number(await memory.call(target, 10))).toBe(21);

      const hook = await minhook.create(memory, target);
      expect(hook.trampoline.toBigInt()).not.toBe(0n);
      expect(hook.affectedLength).toBeGreaterThanOrEqual(5);
      expect(hook.enabled).toBe(false);

      // create() must not have modified the target -- still runs unhooked.
      expect(Number(await memory.call(target, 11))).toBe(23);

      // The trampoline's address is known now, so a detour can bake it in as a
      // literal and call it directly -- no runtime discovery protocol needed.
      const trampolineAddr = hook.trampoline.toBigInt();
      const detourA = cmachinecode({
        returns: 'i32',
        args: ['i32'],
        source: `
          typedef int (*Original)(int);
          Original original = (Original)0x${trampolineAddr.toString(16)}ULL;
          return original(arg0) + 100;
        `,
      });
      await hook.enable(detourA);
      expect(hook.enabled).toBe(true);

      // Now a real thread naturally entering the target hits the JMP, runs the
      // detour, which calls the trampoline (relocated stolen bytes + jmp back
      // into the real, unmodified body) and adds 100.
      expect(Number(await memory.call(target, 10))).toBe(121); // (10*2+1) + 100

      // Re-enabling with the *same* detour address must be a no-op (idempotent).
      await hook.enable(detourA);
      expect(Number(await memory.call(target, 20))).toBe(141); // (20*2+1) + 100

      // Swapping to a *different* detour re-patches the JMP -- this is the
      // "modular, detour can be changed" behavior.
      const detourB = cmachinecode({
        returns: 'i32',
        args: ['i32'],
        source: `
          typedef int (*Original)(int);
          Original original = (Original)0x${trampolineAddr.toString(16)}ULL;
          return original(arg0) + 999;
        `,
      });
      await hook.enable(detourB);
      const detourBAddr = hook.detour!.toBigInt();
      expect(Number(await memory.call(target, 10))).toBe(1020); // (10*2+1) + 999

      // disable() restores the original bytes -- a fresh call runs unhooked again.
      await hook.disable();
      expect(hook.enabled).toBe(false);
      expect(Number(await memory.call(target, 10))).toBe(21);

      // Re-enabling with no detour argument reinstalls the last-used one
      // (detourB), matching HookManager.toggle()/enableAll() semantics.
      await hook.enable();
      expect(hook.detour?.toBigInt()).toBe(detourBAddr);
      expect(Number(await memory.call(target, 10))).toBe(1020);

      await hook.destroy();
      expect(minhook.has(target)).toBe(false);
      // destroy() disables too -- unhooked again, and the trampoline is freed.
      expect(Number(await memory.call(target, 10))).toBe(21);
    } finally {
      await memory.deinit();
    }
  }, 120000);
});
