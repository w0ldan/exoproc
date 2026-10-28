import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeScanValue,
  encodeScanValue,
  Win64Machine,
  Win64MemoryScanner,
  writeScanValue,
  type Win64Process,
} from '../../packages/simulate/dist/index.js';

/** A private, zero-filled rw region plus the mapping id that scopes scans to it. */
function createScanRegion(process: Win64Process, size = 0x1000) {
  const base = process.allocate(size, 'rw', 0n, 'scan target');
  const mapping = process.memory.findMapping(base);
  assert.ok(mapping);
  return { base, mappingIds: [mapping.id] };
}

function createScannerProcess(): {
  machine: Win64Machine;
  process: Win64Process;
} {
  const machine = new Win64Machine();
  const process = machine.createProcess({
    image: 'scanner-probe.exe',
    path: 'C:\\Users\\Serkan\\Workspace\\scanner-probe.exe',
  });
  return { machine, process };
}

describe('@exoproc/simulate memory scanner', () => {
  it('finds exact values and narrows over the full candidate set', () => {
    const { process } = createScannerProcess();
    const { base, mappingIds } = createScanRegion(process);
    const addresses = Array.from(
      { length: 10 },
      (_, index) => base + BigInt(index * 16),
    );
    for (const address of addresses) {
      writeScanValue(process, address, 'i32', 1000);
    }

    const scanner = new Win64MemoryScanner(process);
    const first = scanner.firstScan({
      type: 'i32',
      value: 1000,
      mappingIds,
    });
    assert.equal(first.total, 10);
    assert.equal(first.truncated, false);
    assert.deepEqual(
      first.results.map((result) => result.address),
      addresses,
    );
    assert.deepEqual(
      first.results.map((result) => result.value),
      addresses.map(() => 1000n),
    );

    // A capped page must not shrink what the next scan narrows over.
    const page = scanner.page(0, 3);
    assert.equal(page.results.length, 3);
    assert.equal(page.total, 10);
    assert.equal(page.truncated, true);

    for (const address of addresses.slice(0, 4)) {
      writeScanValue(process, address, 'i32', 2000);
    }
    const changed = scanner.nextScan({ compare: 'changed' });
    assert.equal(changed.total, 4);
    assert.deepEqual(
      changed.results.map((result) => result.address),
      addresses.slice(0, 4),
    );
    assert.deepEqual(
      changed.results.map((result) => result.previousValue),
      [1000n, 1000n, 1000n, 1000n],
    );
    assert.deepEqual(
      changed.results.map((result) => result.value),
      [2000n, 2000n, 2000n, 2000n],
    );

    writeScanValue(process, addresses[0]!, 'i32', 3000);
    writeScanValue(process, addresses[1]!, 'i32', 100);
    assert.deepEqual(
      scanner
        .nextScan({ compare: 'increased' })
        .results.map((result) => result.address),
      [addresses[0]],
    );

    // Re-scanning from scratch proves `increased` narrowed, not filtered a page.
    const rescan = scanner.firstScan({ type: 'i32', value: 2000, mappingIds });
    assert.equal(rescan.total, 2);
    assert.deepEqual(
      scanner
        .nextScan({ compare: 'unchanged' })
        .results.map((result) => result.address),
      [addresses[2], addresses[3]],
    );
    assert.deepEqual(
      scanner
        .nextScan({ compare: 'exact', value: 2000 })
        .results.map((result) => result.address),
      [addresses[2], addresses[3]],
    );

    writeScanValue(process, addresses[2]!, 'i32', 1);
    assert.deepEqual(
      scanner
        .nextScan({ compare: 'decreased' })
        .results.map((result) => result.address),
      [addresses[2]],
    );
    assert.equal(scanner.total, 1);

    scanner.reset();
    assert.equal(scanner.total, 0);
    assert.equal(scanner.page(0).results.length, 0);
  });

  it('snapshots everything for an unknown-value scan', () => {
    const { process } = createScannerProcess();
    const { base, mappingIds } = createScanRegion(process, 0x1000);

    const scanner = new Win64MemoryScanner(process);
    const first = scanner.firstScan({
      type: 'i32',
      compare: 'unknown',
      mappingIds,
    });
    assert.equal(first.total, 0x1000 / 4);
    assert.equal(first.truncated, false);

    writeScanValue(process, base + 0x40n, 'i32', 7);
    const changed = scanner.nextScan({ compare: 'changed' });
    assert.equal(changed.total, 1);
    assert.equal(changed.results[0]?.address, base + 0x40n);
    assert.equal(changed.results[0]?.previousValue, 0n);
    assert.equal(changed.results[0]?.value, 7n);

    assert.throws(
      () =>
        scanner.firstScan({ type: 'string', compare: 'unknown', mappingIds }),
      /fixed-width value type/,
    );
  });

  it('honors alignment, region limits and non-numeric value types', () => {
    const { process } = createScannerProcess();
    const { base, mappingIds } = createScanRegion(process);
    writeScanValue(process, base + 2n, 'i32', 4242);
    writeScanValue(process, base + 0x800n, 'string', 'EXOPROC');
    writeScanValue(process, base + 0x900n, 'bytes', Uint8Array.from([1, 2, 3]));

    const scanner = new Win64MemoryScanner(process);
    assert.equal(
      scanner.firstScan({ type: 'i32', value: 4242, mappingIds }).total,
      0,
    );
    const unaligned = scanner.firstScan({
      type: 'i32',
      value: 4242,
      alignment: 1,
      mappingIds,
    });
    assert.equal(unaligned.total, 1);
    assert.equal(unaligned.results[0]?.address, base + 2n);

    const text = scanner.firstScan({
      type: 'string',
      value: 'EXOPROC',
      mappingIds,
    });
    assert.equal(text.total, 1);
    assert.equal(text.results[0]?.address, base + 0x800n);
    assert.equal(text.results[0]?.value, 'EXOPROC');

    const bytes = scanner.firstScan({
      type: 'bytes',
      value: Uint8Array.from([1, 2, 3]),
      mappingIds,
    });
    assert.equal(bytes.total, 1);
    assert.equal(bytes.results[0]?.address, base + 0x900n);
    assert.throws(
      () => scanner.nextScan({ compare: 'increased' }),
      /needs a numeric scan type/,
    );

    // A range narrower than the mapping drops candidates outside it.
    const ranged = scanner.firstScan({
      type: 'string',
      value: 'EXOPROC',
      mappingIds,
      range: { start: base, end: base + 0x400n },
    });
    assert.equal(ranged.total, 0);
  });

  it('reads and writes typed values through the real address space', () => {
    const { process } = createScannerProcess();
    const { base, mappingIds } = createScanRegion(process);
    const scanner = new Win64MemoryScanner(process);
    scanner.firstScan({ type: 'i64', compare: 'unknown', mappingIds });

    const written = scanner.writeValue(base + 8n, -5);
    assert.deepEqual(written, encodeScanValue('i64', -5));
    assert.equal(process.memory.readU64(base + 8n), 0xfffffffffffffffbn);
    assert.equal(scanner.readValue(base + 8n), -5n);

    assert.equal(
      decodeScanValue('f64', encodeScanValue('f64', 1.5)) as number,
      1.5,
    );
    assert.deepEqual(
      encodeScanValue('string', 'AB', 'utf16'),
      Uint8Array.from([0x41, 0x00, 0x42, 0x00]),
    );
    assert.throws(() => encodeScanValue('i32', 'nope'), TypeError);
  });

  it('skips mappings the scanner is not allowed to read', () => {
    const { process } = createScannerProcess();
    const scanner = new Win64MemoryScanner(process);
    const executableOnly = process.memory.getMapping('image:.text');
    assert.ok(executableOnly);
    assert.equal(executableOnly.protection, 'rx');

    // 'rx' includes read access, so .text is scannable; the import table is
    // 'r' too. A write-protected-away mapping is what must never be read --
    // assert the scanner only ever touches mappings whose protection has 'r'.
    const scanned = scanner.firstScan({ type: 'i32', compare: 'unknown' });
    const readable = process.memory
      .getMappings()
      .filter((mapping) => mapping.protection.includes('r'));
    const expected = readable.reduce(
      (count, mapping) => count + Math.floor(mapping.size / 4),
      0,
    );
    assert.equal(scanned.total, expected);
    assert.equal(scanned.truncated, true);
  });
});

describe('@exoproc/simulate frozen values', () => {
  it('stomps guest writes back at every scheduler settlement point', () => {
    const machine = new Win64Machine();
    const process = machine.createRandomDebugProcess();
    const thread = process.getThreads()[0];
    assert.ok(thread);
    const workItem = thread.registers.RCX;

    machine.freezeAddress(
      process.pid,
      workItem + 8n,
      encodeScanValue('i64', 0x1234n),
    );
    assert.equal(machine.isAddressFrozen(process.pid, workItem + 8n), true);
    assert.deepEqual(machine.getFrozenAddresses(), [
      {
        pid: process.pid,
        address: workItem + 8n,
        bytes: encodeScanValue('i64', 0x1234n),
      },
    ]);

    machine.scheduler.enqueue(thread);
    machine.pumpScheduler();
    assert.equal(thread.state, 'terminated');
    // The worker thread really did write its own result there...
    assert.equal(thread.lastStep?.reason, 'halted');
    // ...and the freeze put 0x1234 back before the pump returned.
    assert.equal(process.memory.readU64(workItem + 8n), 0x1234n);

    process.memory.writeU64(workItem + 8n, 0n);
    assert.equal(machine.applyFrozenValues(), 1);
    assert.equal(process.memory.readU64(workItem + 8n), 0x1234n);

    assert.equal(machine.unfreezeAddress(process.pid, workItem + 8n), true);
    assert.equal(machine.unfreezeAddress(process.pid, workItem + 8n), false);
    process.memory.writeU64(workItem + 8n, 0n);
    assert.equal(machine.applyFrozenValues(), 0);
    assert.equal(process.memory.readU64(workItem + 8n), 0n);
  });

  it('drops frozen entries whose process does not exist', () => {
    const machine = new Win64Machine();
    machine.freezeAddress(999999, 0x1000n, Uint8Array.from([1]));
    assert.equal(machine.applyFrozenValues(), 0);
    assert.deepEqual(machine.getFrozenAddresses(), []);
    assert.throws(
      () => machine.freezeAddress(1, 0x1000n, new Uint8Array()),
      RangeError,
    );
  });

  it('keeps a frozen entry whose target is not writable', () => {
    const machine = new Win64Machine();
    const process = machine.createProcess({
      image: 'freeze-probe.exe',
      path: 'C:\\Users\\Serkan\\Workspace\\freeze-probe.exe',
    });
    machine.freezeAddress(
      process.pid,
      process.imageBase + 0x1000n,
      Uint8Array.from([0x90]),
    );
    assert.equal(machine.applyFrozenValues(), 0);
    assert.equal(machine.getFrozenAddresses().length, 1);
  });
});

describe('@exoproc/simulate host process control', () => {
  it('terminates a process and finalizes its exit bookkeeping', () => {
    const machine = new Win64Machine();
    const process = machine.createRandomDebugProcess();
    assert.ok(process.getThreads().length > 0);

    assert.equal(machine.terminateProcess(process.pid, 7), true);
    assert.equal(process.exitCode, 7);
    assert.equal(
      process.getThreads().every((thread) => thread.state === 'terminated'),
      true,
    );
    assert.equal(process.handles.size, 0);
    // Already exited, and an unknown pid.
    assert.equal(machine.terminateProcess(process.pid), false);
    assert.equal(machine.terminateProcess(999999), false);
    assert.ok(
      machine
        .getInternalEvents()
        .some((event) =>
          event.includes(`NtTerminateProcess PID ${process.pid}`),
        ),
    );
  });

  it('terminates another process through kernel32!TerminateProcess', () => {
    const machine = new Win64Machine();
    const target = machine.createRandomDebugProcess();
    const host = machine.createProcess({
      image: 'terminator.exe',
      path: 'C:\\Users\\Serkan\\Workspace\\terminator.exe',
    });
    const openProcess = host.resolveSymbol('kernel32.dll', 'OpenProcess');
    const terminateProcess = host.resolveSymbol(
      'kernel32.dll',
      'TerminateProcess',
    );
    assert.ok(openProcess);
    assert.ok(terminateProcess);

    const handle = host.invoke(openProcess, [
      0x1f0fff,
      false,
      target.pid,
    ]).value;
    assert.ok(handle >= 0x100n);
    assert.equal(host.invoke(terminateProcess, [handle, 3]).value, 1n);
    assert.equal(target.exitCode, 3);
    assert.equal(host.invoke(terminateProcess, [0, 0]).value, 0n);
    assert.equal(host.lastError, 6);
  });

  it('spawns an installed program from the host without a launcher process', () => {
    const machine = new Win64Machine();
    const spawned = machine.spawnProgram('C:\\Windows\\System32\\whoami.exe');
    assert.ok(spawned);
    assert.equal(spawned.process.image, 'whoami.exe');
    assert.equal(spawned.thread.suspendCount, 0);
    assert.equal(spawned.process.exitCode, undefined);

    machine.pumpScheduler();
    assert.equal(spawned.process.exitCode, 0);
    assert.match(spawned.process.console.screenText, /EXOPROC\\Serkan/);
    assert.equal(
      machine.spawnProgram('C:\\Users\\Serkan\\Workspace\\not-installed.exe'),
      undefined,
    );
  });

  it('leaves a CREATE_SUSPENDED spawn at its entry point', () => {
    const machine = new Win64Machine();
    const spawned = machine.spawnProgram(
      'C:\\Windows\\System32\\whoami.exe',
      [],
      { suspended: true },
    );
    assert.ok(spawned);
    assert.equal(spawned.thread.suspendCount, 1);

    machine.pumpScheduler();
    assert.equal(spawned.process.exitCode, undefined);
    assert.equal(spawned.thread.registers.RIP, spawned.thread.entryPoint);
    assert.equal(spawned.process.console.screenText, '');

    // A debugger single-steps it directly, bypassing the scheduler.
    spawned.thread.step();
    assert.notEqual(spawned.thread.registers.RIP, spawned.thread.entryPoint);
  });
});

describe('@exoproc/simulate watchpoints', () => {
  it('reports the write that overlapped a watched range', () => {
    const machine = new Win64Machine();
    const process = machine.createRandomDebugProcess();
    const thread = process.getThreads()[0];
    assert.ok(thread);
    const workItem = thread.registers.RCX;

    const watchpoint = thread.cpu.addWatchpoint(workItem + 8n, 8);
    assert.equal(thread.cpu.hasWatchpoint(workItem + 8n), true);

    let hits = 0;
    let stopped = thread.lastStep;
    for (let steps = 0; steps < 32; steps += 1) {
      const result = thread.step();
      if (result.reason === 'watchpoint') {
        hits += 1;
        stopped = result;
        break;
      }
      if (result.reason === 'halted') break;
    }
    assert.equal(hits, 1);
    assert.equal(stopped?.watchpointHit?.access, 'write');
    assert.equal(stopped?.watchpointHit?.address, workItem + 8n);
    assert.equal(stopped?.watchpointHit?.size, 8);
    assert.equal(stopped?.watchpointHit?.watchpoint, watchpoint);
    assert.equal(stopped?.instruction.mnemonic, 'mov');
    assert.deepEqual(stopped?.memoryWrite, { address: workItem + 8n, size: 8 });

    assert.equal(thread.cpu.removeWatchpoint(workItem + 8n), true);
    assert.equal(thread.cpu.watchpoints.size, 0);
    assert.throws(() => thread.cpu.addWatchpoint(workItem, 0), RangeError);
  });

  it('reports operand reads for read watchpoints', () => {
    const machine = new Win64Machine();
    const process = machine.createRandomDebugProcess();
    const thread = process.getThreads()[0];
    assert.ok(thread);
    const workItem = thread.registers.RCX;
    thread.cpu.addWatchpoint(workItem, 8, 'read');

    let hit;
    for (let steps = 0; steps < 32; steps += 1) {
      const result = thread.step();
      if (result.reason === 'watchpoint') {
        hit = result;
        break;
      }
      if (result.reason === 'halted') break;
    }
    assert.equal(hit?.watchpointHit?.access, 'read');
    assert.equal(hit?.watchpointHit?.address, workItem);
    assert.equal(hit?.instruction.mnemonic, 'mov');
    assert.deepEqual(hit?.memoryRead, { address: workItem, size: 8 });
    // The stack pushes before it never triggered a data-read watchpoint.
    assert.equal(hit?.memoryWrite, undefined);
  });

  it('leaves stop reasons alone when nothing is watched', () => {
    const machine = new Win64Machine();
    const process = machine.createRandomDebugProcess();
    const thread = process.getThreads()[0];
    assert.ok(thread);

    let reason = '';
    while (reason !== 'breakpoint') {
      reason = thread.step().reason;
      assert.notEqual(reason, 'watchpoint');
    }
    assert.equal(thread.state, 'stopped');
  });
});
