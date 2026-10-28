import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Win64Machine } from '../../packages/simulate/dist/runtime/win64-machine.js';
import { bindWin64Process } from '../../packages/simulate/dist/runtime/bun-ffi.js';
import { cc } from '../../packages/simulate/dist/worker/cc-shim.js';
import {
  writeFileSync,
  unlinkSync,
} from '../../packages/simulate/dist/worker/node-fs-shim.js';
import { tmpdir } from '../../packages/simulate/dist/worker/node-os-shim.js';

/**
 * Exercises the worker `cc()` implementation directly against a generated C
 * resolver module. The test covers extern lookup, unresolved-symbol errors,
 * local fallbacks, executable guest stubs, and synthetic module loading
 * without involving any consumer package.
 */

function buildSource(localTargets: ReadonlySet<string>): string {
  const fullSource: string[] = [
    `void* normalize_address(void* address) {
      return address;
    }`,
  ];
  const symbols: Record<string, string> = {
    GetCurrentProcessId: 'unsigned int',
    NotARealExport: 'void*',
  };
  for (const [name, retType] of Object.entries(symbols)) {
    if (localTargets.has(name)) {
      fullSource.push(`
${retType} ${name}() {
  return 0;
}
void* ${name}_ptr() { return (void*)${name}; }
`);
    } else {
      fullSource.push(`
extern ${retType} ${name}();
void* ${name}_ptr() { return normalize_address((void*)${name}); }
`);
    }
  }
  return fullSource.join('\n\n');
}

describe('worker cc() resolver modules', () => {
  it('loads callable resolvers and reports unresolved externs', () => {
    const machine = new Win64Machine();
    const process = machine.createProcess(
      {
        image: 'cc-shim-test.exe',
        path: 'C:\\Users\\Serkan\\Workspace\\cc-shim-test.exe',
      },
      { stdio: machine.createNullStdio() },
    );
    const restore = bindWin64Process(process);
    try {
      const tempDirectory = tmpdir();
      const sourcePath = `${tempDirectory}\\cc-shim-test-1.c`;
      writeFileSync(sourcePath, buildSource(new Set()));

      assert.throws(
        () =>
          cc({
            source: [sourcePath],
            symbols: {
              GetCurrentProcessId_ptr: { args: [], returns: 'ptr' },
              NotARealExport_ptr: { args: [], returns: 'ptr' },
            },
            library: ['kernel32'],
          }),
        /undefined symbol 'NotARealExport_ptr'/,
      );
      unlinkSync(sourcePath);

      const retrySourcePath = `${tempDirectory}\\cc-shim-test-2.c`;
      writeFileSync(retrySourcePath, buildSource(new Set(['NotARealExport'])));

      const library = cc({
        source: [retrySourcePath],
        symbols: {
          GetCurrentProcessId_ptr: { args: [], returns: 'ptr' },
          NotARealExport_ptr: { args: [], returns: 'ptr' },
        },
        library: ['kernel32'],
      });
      unlinkSync(retrySourcePath);

      const expectedAddress = process.resolveSymbol(
        'kernel32.dll',
        'GetCurrentProcessId',
      );
      assert.ok(expectedAddress !== undefined);
      assert.equal(
        library.symbols.GetCurrentProcessId_ptr!(),
        Number(expectedAddress),
      );
      assert.equal(library.symbols.NotARealExport_ptr!(), 0);

      // The loaded module's export is the *stub*'s own address (the tiny
      // `mov rax, <expectedAddress>; ret` this shim generated and loaded),
      // not `expectedAddress` itself -- that's the whole point of running
      // real guest code instead of returning a bare JS number.
      const loadedModules = process.modules.filter((module) =>
        module.name.startsWith('exoproc-cc-resolvers-'),
      );
      assert.equal(loadedModules.length, 1);
      const stubAddress = loadedModules[0]!.exports.get(
        'GetCurrentProcessId_ptr',
      );
      assert.ok(stubAddress !== undefined && stubAddress > 0n);
      assert.notEqual(stubAddress, expectedAddress);
    } finally {
      restore();
    }
  });

  it('uses C parameter names and dynamic pointer subscripts', () => {
    const machine = new Win64Machine();
    const process = machine.createProcess(
      {
        image: 'cc-params-test.exe',
        path: 'C:\\Users\\Serkan\\Workspace\\cc-params-test.exe',
      },
      { stdio: machine.createNullStdio() },
    );
    const restore = bindWin64Process(process);
    const sourcePath = `${tmpdir()}\\cc-params-test.c`;

    try {
      writeFileSync(
        sourcePath,
        `
          typedef struct {
            unsigned int index;
            unsigned int capacity;
            void* hwnds[1];
          } EnumCtx;

          int EnumWindowsProc(void* hwnd, void* lParam) {
            EnumCtx* ctx = (EnumCtx*)lParam;
            if (ctx->index >= ctx->capacity) return 0;
            void** hwnds = (void**)((char*)ctx + 8);
            hwnds[ctx->index] = hwnd;
            ctx->index++;
            return 1;
          }
        `,
      );
      const library = cc({
        source: [sourcePath],
        symbols: {
          EnumWindowsProc: { args: ['ptr', 'ptr'], returns: 'i32' },
          EnumWindowsProc_ptr: { args: [], returns: 'ptr' },
          EnumWindowsProc_len: { args: [], returns: 'i32' },
        },
      });

      const context = process.allocate(24);
      process.memory.writeU32(context, 0);
      process.memory.writeU32(context + 4n, 2);

      assert.equal(
        library.symbols.EnumWindowsProc!(0x1234, Number(context)),
        1,
      );
      assert.equal(process.memory.readU32(context), 1);
      assert.equal(process.memory.readU64(context + 8n), 0x1234n);

      assert.equal(
        library.symbols.EnumWindowsProc!(0x5678, Number(context)),
        1,
      );
      assert.equal(process.memory.readU32(context), 2);
      assert.equal(process.memory.readU64(context + 16n), 0x5678n);

      assert.equal(
        library.symbols.EnumWindowsProc!(0x9abc, Number(context)),
        0,
      );
      assert.equal(process.memory.readU32(context), 2);
    } finally {
      if (process.machine.fileSystem.getEntry(sourcePath))
        unlinkSync(sourcePath);
      restore();
    }
  });
});
