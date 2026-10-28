import { expect, test, describe } from 'bun:test';
import { CType, cjitopen } from '../../packages/xffi/src/index.js';

// The "run it remotely" cmachinecode case (injecting a shell that itself
// calls VirtualAlloc/VirtualFree) moved to tests/nthread/cmachinecode-remote.test.ts --
// executing real WinAPI calls requires a stable, already-running thread (see
// the GHA thread-freshness bug in CLAUDE.md); a fresh RemoteCallableMemoryAccessor
// call is not reliable for that under Wine.
describe('xffi > cmachinecode Builder & Compiler', () => {
  test('should compile standard C code into standalone bytecode with automatic macro address patching and run it locally', async () => {
    const targetLib = cjitopen({
      get_big_secret: {
        args: [CType.i64],
        returns: CType.i64,
        source: `
          unsigned long long secret = 0xAAABBBCCCDDDULL;
          return secret + arg0;
        `,
      },
    });

    const targetFunc = targetLib.symbols.get_big_secret;

    // Locally compiled machineCode is directly callable -- no accessor/remote
    // call needed, this is the same process.
    const param = 0x111222333444n;
    const result = targetFunc(param);
    const expected = 0xaaabbbcccdddn + param;

    expect(result).toBe(expected);

    targetLib.close();
  });
});
