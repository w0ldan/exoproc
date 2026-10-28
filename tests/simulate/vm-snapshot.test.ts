import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Win64Machine } from '../../packages/simulate/src/runtime/win64-machine.js';
import { CoWMapping } from '../../packages/simulate/src/runtime/physical-memory.js';

/**
 * `Win64Machine.snapshot()`/`Win64Machine.restore()` -- QEMU-style VM state
 * save/restore (see the plan doc's F10 section). These tests exercise only
 * the pure-JS simulation engine (no real WinAPI FFI / `bindWin64Process`),
 * so unlike `win64-machine.test.ts` they run fine on plain `bun test`
 * without Wine.
 */

function makeProcess(machine: Win64Machine, image = 'snapshot-test.exe') {
  return machine.createProcess(
    { image, path: `C:\\Users\\Serkan\\Workspace\\${image}` },
    { stdio: machine.createNullStdio() },
  );
}

describe('Win64Machine snapshot/restore', () => {
  it('round-trips a process, its thread, registers, breakpoints, and memory', () => {
    const machine = new Win64Machine({ enableNodeHostBridge: false });
    const process = makeProcess(machine);
    const thread = process.createThread('main', process.imageBase + 0x1000n);
    thread.registers.RAX = 0x1122334455667788n;
    thread.registers.RCX = 42n;
    thread.cpu.breakpoints.add(process.imageBase + 0x1000n);
    thread.cpu.watchpoints.set(process.imageBase + 0x2000n, {
      address: process.imageBase + 0x2000n,
      size: 8,
      access: 'write',
    });
    process.memory.write(process.heapBase, Uint8Array.from([1, 2, 3, 4]));
    process.lastError = 5;

    const snapshot = machine.snapshot();
    const restored = Win64Machine.restore(snapshot, {
      enableNodeHostBridge: false,
    });

    const restoredProcess = restored.getProcess(process.pid);
    assert.ok(restoredProcess);
    assert.equal(restoredProcess.image, process.image);
    assert.equal(restoredProcess.lastError, 5);
    assert.deepEqual(
      restoredProcess.memory.read(process.heapBase, 4),
      Uint8Array.from([1, 2, 3, 4]),
    );

    const restoredThread = restoredProcess.getThread(thread.tid);
    assert.ok(restoredThread);
    assert.equal(restoredThread.registers.RAX, 0x1122334455667788n);
    assert.equal(restoredThread.registers.RCX, 42n);
    assert.equal(restoredThread.state, thread.state);
    assert.deepEqual(
      [...restoredThread.cpu.breakpoints],
      [...thread.cpu.breakpoints],
    );
    assert.deepEqual(
      restoredThread.cpu.watchpoints.get(process.imageBase + 0x2000n),
      { address: process.imageBase + 0x2000n, size: 8, access: 'write' },
    );

    // Independent instances -- mutating the restored machine must never
    // reach back into the original.
    restoredThread.registers.RAX = 0n;
    assert.equal(thread.registers.RAX, 0x1122334455667788n);
  });

  it('preserves exact copy-on-write physical-page sharing across a restore -- the regression this feature exists for', () => {
    const machine = new Win64Machine({ enableNodeHostBridge: false });
    const processA = makeProcess(machine, 'shared-a.exe');
    const processB = makeProcess(machine, 'shared-b.exe');
    const pool = machine.physicalPagePool;

    const initial = new Uint8Array(0x1000);
    initial.set(Uint8Array.from([9, 9, 9, 9]));
    const mappingA = processA.memory.mapCoW(
      'shared-region',
      'shared region',
      0n,
      0x1000,
      'rw',
      pool,
      initial,
      true,
    );
    assert.ok(mappingA.cow);
    const clone = CoWMapping.cloneAsCoW(mappingA.cow, pool);
    const mappingB = processB.memory.mapWithCoW(
      'shared-region',
      'shared region',
      0n,
      0x1000,
      'rw',
      clone,
    );

    const originalPfn = mappingA.cow.pageTable[0]!.physicalPage.pfn;
    assert.equal(mappingB.cow!.pageTable[0]!.physicalPage.pfn, originalPfn);

    const snapshot = machine.snapshot();
    const restored = Win64Machine.restore(snapshot, {
      enableNodeHostBridge: false,
    });
    const restoredA = restored.getProcess(processA.pid)!;
    const restoredB = restored.getProcess(processB.pid)!;
    const restoredMappingA = restoredA.memory.getMapping('shared-region')!;
    const restoredMappingB = restoredB.memory.getMapping('shared-region')!;
    const baseA = restoredMappingA.base;
    const baseB = restoredMappingB.base;

    // (a) True object-identity sharing, not incidentally-equal copies.
    const restoredPage = restoredMappingA.cow!.pageTable[0]!.physicalPage;
    assert.equal(
      restoredMappingB.cow!.pageTable[0]!.physicalPage,
      restoredPage,
    );
    assert.equal(restoredPage.pfn, originalPfn);
    assert.deepEqual(
      restoredA.memory.read(baseA, 4),
      Uint8Array.from([9, 9, 9, 9]),
    );
    assert.deepEqual(
      restoredB.memory.read(baseB, 4),
      Uint8Array.from([9, 9, 9, 9]),
    );

    // (b) Writing through one restored mapping triggers a private copy
    // without disturbing the other process's page.
    restoredA.memory.write(baseA, Uint8Array.from([1, 2, 3, 4]));
    assert.deepEqual(
      restoredA.memory.read(baseA, 4),
      Uint8Array.from([1, 2, 3, 4]),
    );
    assert.deepEqual(
      restoredB.memory.read(baseB, 4),
      Uint8Array.from([9, 9, 9, 9]),
    );
    assert.notEqual(
      restoredMappingA.cow!.pageTable[0]!.physicalPage.pfn,
      restoredMappingB.cow!.pageTable[0]!.physicalPage.pfn,
    );

    // (c) Unmapping A must not free the page while B still references it
    // (the literal double-free/leak scenario this design guards against).
    const sharedPfn = restoredMappingB.cow!.pageTable[0]!.physicalPage.pfn;
    restoredA.memory.unmap('shared-region');
    assert.ok(
      restored.physicalPagePool.getPage(sharedPfn),
      'page must survive while B still references it',
    );
    restoredB.memory.unmap('shared-region');
    assert.equal(
      restored.physicalPagePool.getPage(sharedPfn),
      undefined,
      'page must be freed once the last reference is gone',
    );
  });

  it('re-links scheduler wait state to the restored thread graph', () => {
    const machine = new Win64Machine({ enableNodeHostBridge: false });
    const process = makeProcess(machine);
    const thread = process.createThread('waiter', process.imageBase + 0x1000n);
    const objectId = machine.createKernelObject({
      kind: 'nodeInvocation',
      signaled: false,
    });
    thread.state = 'waiting';
    machine.scheduler.blockOnObject(thread, objectId);

    const snapshot = machine.snapshot();
    const restored = Win64Machine.restore(snapshot, {
      enableNodeHostBridge: false,
    });
    const restoredThread = restored
      .getProcess(process.pid)!
      .getThread(thread.tid)!;

    assert.equal(restoredThread.state, 'waiting');
    assert.equal(
      restored.scheduler.findWaitedObjectId(restoredThread),
      objectId,
    );

    restored.scheduler.signalObject(objectId);
    assert.equal(
      restored.scheduler.findWaitedObjectId(restoredThread),
      undefined,
    );
  });

  it('round-trips a real heap allocation via the actual GetProcessHeap/HeapAlloc syscalls', () => {
    const machine = new Win64Machine({ enableNodeHostBridge: false });
    const process = makeProcess(machine);
    const thread = process.createThread('main', process.imageBase + 0x1000n);
    const kernel32 = machine.win32Catalog.dllByName.get('kernel32.dll')!;

    const heapHandle = machine.dispatchSyscall(
      process,
      thread,
      kernel32.functions['GetProcessHeap']!.syscallId,
      thread.registers,
    );
    thread.registers.RCX = heapHandle;
    thread.registers.RDX = 0n;
    thread.registers.R8 = 64n;
    const pointer = machine.dispatchSyscall(
      process,
      thread,
      kernel32.functions['HeapAlloc']!.syscallId,
      thread.registers,
    );
    assert.notEqual(pointer, 0n);
    process.memory.write(pointer, Uint8Array.from([7, 7, 7, 7]));

    const snapshot = machine.snapshot();
    const restored = Win64Machine.restore(snapshot, {
      enableNodeHostBridge: false,
    });
    const restoredProcess = restored.getProcess(process.pid)!;
    const restoredThread = restoredProcess.getThread(thread.tid)!;

    assert.deepEqual(
      restoredProcess.memory.read(pointer, 4),
      Uint8Array.from([7, 7, 7, 7]),
    );

    // Free through the restored heap -- proves `pageAllocator`/`pageDeallocator`
    // closures were correctly rebound to the restored process, not left
    // dangling against the discarded original.
    restoredThread.registers.RCX = heapHandle;
    restoredThread.registers.R8 = pointer;
    const freed = restored.dispatchSyscall(
      restoredProcess,
      restoredThread,
      kernel32.functions['HeapFree']!.syscallId,
      restoredThread.registers,
    );
    assert.equal(freed, 1n);
  });

  it('round-trips in-memory filesystem content, and only what existed at snapshot time', () => {
    // `C:\Users\Serkan\Documents` (unlike `WIN32_WORKSPACE_PATH`) is never
    // auto-bound to a real host directory by `Win32FileSystem`'s
    // constructor (`bindWorkspace()`), so these writes stay purely
    // in-memory even when this test runs under a real Bun/Node host that
    // *does* have a `node:fs`/`node:path` available -- using the
    // workspace path here would silently write real files onto disk.
    const machine = new Win64Machine({ enableNodeHostBridge: false });
    machine.fileSystem.writeTextFile(
      'C:\\Users\\Serkan\\Documents\\before.txt',
      'kept',
    );

    const snapshot = machine.snapshot();

    // Written after the snapshot -- must not leak into the restored machine,
    // and must survive on the still-live original (independent instances).
    machine.fileSystem.writeTextFile(
      'C:\\Users\\Serkan\\Documents\\after.txt',
      'not kept',
    );

    const restored = Win64Machine.restore(snapshot, {
      enableNodeHostBridge: false,
    });

    assert.deepEqual(
      restored.fileSystem.readFile('C:\\Users\\Serkan\\Documents\\before.txt'),
      new TextEncoder().encode('kept'),
    );
    assert.equal(
      restored.fileSystem.getEntry('C:\\Users\\Serkan\\Documents\\after.txt'),
      undefined,
    );
    assert.deepEqual(
      machine.fileSystem.readFile('C:\\Users\\Serkan\\Documents\\after.txt'),
      new TextEncoder().encode('not kept'),
    );

    // Mutating the restored filesystem must never reach back into the
    // original -- same independence guarantee as memory/registers.
    restored.fileSystem.deleteFile('C:\\Users\\Serkan\\Documents\\before.txt');
    assert.ok(
      machine.fileSystem.getEntry('C:\\Users\\Serkan\\Documents\\before.txt'),
    );
  });

  it('flags a live nodeInvocation wait and registered dynamic syscalls, never blocking', () => {
    const idle = new Win64Machine({ enableNodeHostBridge: false });
    assert.deepEqual(idle.getSnapshotWarnings(), []);

    const machine = new Win64Machine({ enableNodeHostBridge: false });
    const process = makeProcess(machine);
    const thread = process.createThread('waiter', process.imageBase + 0x1000n);
    const objectId = machine.createKernelObject({
      kind: 'nodeInvocation',
      signaled: false,
    });
    thread.state = 'waiting';
    machine.scheduler.blockOnObject(thread, objectId);

    const warnings = machine.getSnapshotWarnings();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /background node\.exe\/FFI operation/);

    machine.registerDynamicSyscall(() => 0n);
    const withDynamic = machine.getSnapshotWarnings();
    assert.equal(withDynamic.length, 2);
    assert.match(withDynamic[1]!, /dynamic syscall handler/);

    // Never throws / never refuses -- snapshot() still succeeds.
    assert.doesNotThrow(() => machine.snapshot());
  });
});
