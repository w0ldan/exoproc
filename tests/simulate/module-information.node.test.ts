import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Win64Machine } from '../../packages/simulate/dist/runtime/win64-machine.js';
import {
  FFIType,
  bindWin64Process,
  dlopen,
} from '../../packages/simulate/dist/runtime/bun-ffi.js';

describe('simulated PSAPI module metadata', () => {
  it('writes Win64 MODULEINFO for a loaded module', () => {
    const machine = new Win64Machine();
    const process = machine.createProcess(
      {
        image: 'module-info-test.exe',
        path: 'C:\\Users\\Serkan\\Workspace\\module-info-test.exe',
      },
      { stdio: machine.createNullStdio() },
    );
    const ntdll = process.modules.find(
      (module) => module.name.toLowerCase() === 'ntdll.dll',
    );
    assert.ok(ntdll);

    const restore = bindWin64Process(process);
    try {
      const kernel32 = dlopen('kernel32', {
        GetCurrentProcess: { args: [], returns: FFIType.u64 },
        GetModuleHandleA: { args: [FFIType.ptr], returns: FFIType.u64 },
        LoadLibraryW: { args: [FFIType.ptr], returns: FFIType.u64 },
        GetProcAddress: {
          args: [FFIType.u64, FFIType.ptr],
          returns: FFIType.u64,
        },
      });
      const psapi = dlopen('psapi', {
        GetModuleInformation: {
          args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32],
          returns: FFIType.bool,
        },
      });
      const processHandle = kernel32.symbols.GetCurrentProcess!();
      const moduleHandle = kernel32.symbols.GetModuleHandleA!(
        Buffer.from('ntdll.dll\0'),
      );
      const kernel32Handle = kernel32.symbols.GetModuleHandleA!(
        Buffer.from('kernel32.dll\0'),
      );
      const kernelbaseHandle = kernel32.symbols.GetModuleHandleA!(
        Buffer.from('kernelbase.dll\0'),
      );
      assert.equal(processHandle, 0xffffffffffffffffn);
      assert.equal(moduleHandle, ntdll.base);
      assert.equal(kernelbaseHandle, kernel32Handle);

      const externalModule = kernel32.symbols.LoadLibraryW!(
        Buffer.from('C:\\vendor\\capstone.dll\0', 'utf16le'),
      );
      const externalExportNames = [
        'cs_version',
        'cs_support',
        'cs_open',
        'cs_close',
        'cs_option',
        'cs_errno',
        'cs_strerror',
        'cs_disasm',
        'cs_free',
        'cs_reg_name',
        'cs_insn_name',
        'cs_group_name',
      ];
      const externalExports = externalExportNames.map((name) =>
        kernel32.symbols.GetProcAddress!(
          externalModule,
          Buffer.from(`${name}\0`),
        ),
      );
      assert.equal(typeof externalModule, 'bigint');
      assert.notEqual(externalModule, 0n);
      assert.equal(new Set(externalExports).size, externalExportNames.length);
      for (const address of externalExports) {
        assert.equal(typeof address, 'bigint');
        assert.notEqual(address, 0n);
      }
      assert.equal(
        kernel32.symbols.GetProcAddress!(
          externalModule,
          Buffer.from('cs_open\0'),
        ),
        externalExports[2],
      );
      assert.equal(process.invoke(externalExports[1] as bigint, [3]).value, 1n);

      const capstoneHandle = process.allocate(8);
      assert.equal(
        process.invoke(externalExports[2] as bigint, [3, 8, capstoneHandle])
          .value,
        0n,
      );
      const handleValue = process.memory.readU64(capstoneHandle);
      assert.notEqual(handleValue, 0n);
      assert.equal(
        process.invoke(externalExports[4] as bigint, [handleValue, 2, 3]).value,
        0n,
      );

      const machineCode = process.allocate(2);
      process.memory.write(machineCode, Uint8Array.from([0x90, 0xc3]));
      const instructionsPointer = process.allocate(8);
      const instructionCount = process.invoke(externalExports[7] as bigint, [
        handleValue,
        machineCode,
        2,
        0x140000000n,
        0,
        instructionsPointer,
      ]).value;
      assert.equal(instructionCount, 2n);
      const instructions = process.memory.readU64(instructionsPointer);
      assert.notEqual(instructions, 0n);
      assert.equal(process.memory.readU64(instructions + 8n), 0x140000000n);
      assert.equal(process.memory.readCString(instructions + 34n), 'nop');
      assert.notEqual(process.memory.readU64(instructions + 232n), 0n);
      assert.equal(
        process.memory.readCString(instructions + 240n + 34n),
        'ret',
      );
      process.invoke(externalExports[8] as bigint, [instructions, 2]);
      assert.equal(
        process.invoke(externalExports[3] as bigint, [capstoneHandle]).value,
        0n,
      );

      // `bun-xffi` currently declares these handles as `ptr`, whose wrapper
      // converts bigint handles to a JS number before entering bun:ffi.
      const pointerHandle = Number(processHandle);
      assert.equal(BigInt(pointerHandle), 0x10000000000000000n);

      const info = Buffer.alloc(24);
      const success = psapi.symbols.GetModuleInformation!(
        pointerHandle,
        Number(moduleHandle),
        info,
        info.byteLength,
      );

      assert.equal(
        success,
        true,
        `GetModuleInformation failed with lastError=${process.lastError}`,
      );
      assert.equal(info.readBigUInt64LE(0), ntdll.base);
      assert.equal(info.readUInt32LE(8), ntdll.size);
      assert.equal(info.readBigUInt64LE(16), ntdll.base);
    } finally {
      restore();
    }
  });
});
