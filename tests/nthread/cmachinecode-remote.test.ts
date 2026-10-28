import { expect, test, describe } from 'bun:test';
import { cmachinecode, CType, createCFunction } from 'bun-xffi';
import { createAccessor } from 'exoproc-accessors';
import { getGlobalDummyProcess } from 'exoproc-dummy';

// Moved from tests/xffi/cmachinecode.test.ts -- the injected shell itself calls
// VirtualAlloc/VirtualFree, which needs to run on an already-live thread rather
// than a freshly-created CreateRemoteThread thread (see the GHA thread-freshness
// bug in CLAUDE.md). Driven through IndirectNThreadHostAccessor (the same
// proven, correctly-wired class minhook-indirect-nthread.test.ts calls .call()
// on repeatedly) rather than hand-rolling a RedirectorHostAccessor here.
describe('nthread > cmachinecode remote execution', () => {
  test('should compile standard C code into standalone bytecode with automatic macro address patching and run it remotely', async () => {
    const shell = cmachinecode({
      source: `
        void* ptr = VirtualAlloc(0, 1024, 0x3000, 0x04);
        if (!ptr) return 0ULL;

        char* msg = (char*)ptr;
        msg[0] = 'V';
        msg[1] = 'i';
        msg[2] = 'r';
        msg[3] = 't';
        msg[4] = 'u';
        msg[5] = 'a';
        msg[6] = 'l';
        msg[7] = ' ';
        msg[8] = 'S';
        msg[9] = 'h';
        msg[10] = 'e';
        msg[11] = 'l';
        msg[12] = 'l';
        msg[13] = 'c';
        msg[14] = 'o';
        msg[15] = 'd';
        msg[16] = 'e';
        msg[17] = ' ';
        msg[18] = 'D';
        msg[19] = 'i';
        msg[20] = 'r';
        msg[21] = 'e';
        msg[22] = 'c';
        msg[23] = 't';
        msg[24] = ' ';
        msg[25] = 'A';
        msg[26] = 'd';
        msg[27] = 'd';
        msg[28] = 'r';
        msg[29] = 'e';
        msg[30] = 's';
        msg[31] = 's';
        msg[32] = ' ';
        msg[33] = 'P';
        msg[34] = 'a';
        msg[35] = 't';
        msg[36] = 'c';
        msg[37] = 'h';
        msg[38] = 'i';
        msg[39] = 'n';
        msg[40] = 'g';
        msg[41] = ' ';
        msg[42] = 'W';
        msg[43] = 'o';
        msg[44] = 'r';
        msg[45] = 'k';
        msg[46] = 's';
        msg[47] = '!';
        msg[48] = '\\0';

        VirtualFree(ptr, 0, 0x8000);

        return 48ULL;
      `,
      returns: CType.u64,
      args: [],
    });

    const tp = getGlobalDummyProcess();

    const accessor = await createAccessor(tp.pid, {
      hostOptions: { timeoutMs: 20000 },
    });

    try {
      const remoteAddr = await accessor.machineCode(shell);
      expect(Number(remoteAddr)).toBeGreaterThan(0);

      const remoteFunc = createCFunction(remoteAddr, [CType.u64, []]);
      const result = await accessor.call(remoteFunc);

      // The length of "Virtual MachineCode Direct Address Patching Works!" is 48
      expect(result).toBe(48n);
    } finally {
      await accessor.deinit();
    }
  }, 60000);
});
