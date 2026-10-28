import { expect, test, describe } from 'bun:test';
import {
  Kernel32Impl,
  resolveAddress,
  struct,
  RemoteMemoryAccessor,
  isInittableAccessor,
  type HostAccessor,
} from 'bun-xffi';
import { Thread } from 'bun-winapi';
import {
  IndirectNThreadHostAccessor,
  createAccessor,
  createAccessorWithoutInit,
  createAccessorOptions,
} from 'exoproc-accessors';
import { findNJava } from 'bun-njava';
import type { NThreadOptions } from 'bun-nthread';
import { getGlobalDummyProcess } from 'exoproc-dummy';

describe('createAccessorWithoutInit', () => {
  test('returns synchronously (not a Promise), without initializing', () => {
    const proc = getGlobalDummyProcess();
    const thread = Thread.getThreads(proc.pid)[0];
    if (!thread) throw new Error('No thread found in the spawned process');

    // idType: 'thread' explicitly -- see below for the default
    // (idType: 'processAllThreadIds').
    const memory = createAccessorWithoutInit(thread.tid, {
      idType: 'thread',
    });
    expect(memory).not.toBeInstanceOf(Promise);
    expect(memory).toBeInstanceOf(IndirectNThreadHostAccessor);
    memory.close();
  });

  test('idType: "processAllThreadIds" (the default) also returns synchronously, without racing yet', () => {
    const proc = getGlobalDummyProcess();
    // A genuine IndirectNThreadHostAccessor, same as every other idType --
    // NThreadRaceAccessor (its internal `NThread` stand-in) never surfaces
    // to callers, see its doc comment. Its own constructor builds every
    // candidate NThread synchronously; racing them is what init() defers.
    const memory = createAccessorWithoutInit(proc.pid);
    expect(memory).not.toBeInstanceOf(Promise);
    expect(memory).toBeInstanceOf(IndirectNThreadHostAccessor);
    memory.close();
  });

  test('idType: "processAllThreadIds" explicitly behaves the same as the default', () => {
    const proc = getGlobalDummyProcess();
    const memory = createAccessorWithoutInit(proc.pid, {
      idType: 'processAllThreadIds',
    });
    expect(memory).not.toBeInstanceOf(Promise);
    expect(memory).toBeInstanceOf(IndirectNThreadHostAccessor);
    memory.close();
  });

  test('idType: "processAllThreadIds" throws synchronously when the process has no threads', () => {
    const bogusPid = 999999;
    expect(() => createAccessorWithoutInit(bogusPid)).toThrow(
      /no threads to redirect/,
    );
  });
});

describe('createAccessor', () => {
  test('is async and awaits init before resolving', () => {
    const proc = getGlobalDummyProcess();

    const result = createAccessor(proc.pid);
    expect(result).toBeInstanceOf(Promise);
    return result.then((memory) => memory.deinit());
  }, 30000);

  test('defaults to a process id and races all its threads', async () => {
    const proc = getGlobalDummyProcess();

    const memory = await createAccessor(proc.pid);
    expect(memory).toBeInstanceOf(IndirectNThreadHostAccessor);

    try {
      const remoteTid = await memory.call(Kernel32Impl.GetCurrentThreadId);
      expect(Thread.getThreads(proc.pid).some((t) => t.tid === remoteTid)).toBe(
        true,
      );

      const addr = await memory.alloc(64);
      expect(Number(resolveAddress(addr))).toBeGreaterThan(0);

      const data = Buffer.from('createAccessor default chain!');
      await memory.write(addr, data);
      const back = await memory.read(addr, data.byteLength);
      expect(back.toString()).toBe(data.toString());
      await memory.free(addr);
    } finally {
      await memory.deinit();
    }
  }, 30000);

  test('idType: "thread" names one specific thread directly', async () => {
    const proc = getGlobalDummyProcess();
    const thread = Thread.getThreads(proc.pid)[0];
    if (!thread) throw new Error('No thread found in the spawned process');

    const memory = await createAccessor(thread.tid, { idType: 'thread' });
    try {
      const remoteTid = await memory.call(Kernel32Impl.GetCurrentThreadId);
      expect(Number(remoteTid)).toBe(thread.tid);
    } finally {
      await memory.deinit();
    }
  }, 30000);

  test('idType: "process" auto-picks the process\'s first thread', async () => {
    const proc = getGlobalDummyProcess();
    const memory = await createAccessor(proc.pid, { idType: 'process' });
    try {
      const remoteTid = await memory.call(Kernel32Impl.GetCurrentThreadId);
      expect(Thread.getThreads(proc.pid).some((t) => t.tid === remoteTid)).toBe(
        true,
      );
    } finally {
      await memory.deinit();
    }
  }, 30000);

  test('idType: "processAllThreadIds" races every thread and returns whichever one initializes', async () => {
    const proc = getGlobalDummyProcess();
    const memory = await createAccessor(proc.pid, {
      idType: 'processAllThreadIds',
      hostOptions: { timeoutMs: 20000 },
    });
    try {
      // The winner is a real, already-initialized accessor on one of the
      // process's own threads -- same observable contract as idType: 'process'.
      const remoteTid = await memory.call(Kernel32Impl.GetCurrentThreadId);
      expect(Thread.getThreads(proc.pid).some((t) => t.tid === remoteTid)).toBe(
        true,
      );

      const addr = await memory.alloc(64);
      const data = Buffer.from('processAllThreadIds race winner!');
      await memory.write(addr, data);
      expect((await memory.read(addr, data.byteLength)).toString()).toBe(
        data.toString(),
      );
      await memory.free(addr);
    } finally {
      await memory.deinit();
    }
  }, 30000);

  test('idType: "processAllThreadIds" throws when the process has no threads', async () => {
    const bogusPid = 999999;
    await expect(
      createAccessor(bogusPid, { idType: 'processAllThreadIds' }),
    ).rejects.toThrow(/no threads to redirect/);
  });

  test('options.backend is returned directly, without touching id/idType', () => {
    const sentinel = {} as unknown as HostAccessor;

    // A bogus id would normally throw during resolution (see the two error
    // tests below) -- passing `backend` must skip that resolution entirely.
    // Sync createAccessorWithoutInit, since the sentinel isn't a real
    // inittable accessor -- no init to await here.
    const memory = createAccessorWithoutInit(0, { backend: sentinel });

    expect(memory).toBe(sentinel);
  });

  test('throws when no thread has the given id', () => {
    const bogusThreadId = 999999999;
    // createAccessorWithoutInit -- pure id-resolution failure, thrown
    // synchronously before any accessor is built. idType: 'thread' explicit
    // so the id is looked up as a thread id, not a pid.
    expect(() =>
      createAccessorWithoutInit(bogusThreadId, { idType: 'thread' }),
    ).toThrow(/no thread with id/);
  });

  test('throws when the given process has no threads to redirect', () => {
    // A pid that (almost certainly) does not correspond to a live process --
    // Thread.getThreads filters a Toolhelp32 snapshot by pid, so an unmatched
    // pid yields an empty array rather than an error.
    const bogusPid = 999999;
    expect(() =>
      createAccessorWithoutInit(bogusPid, { idType: 'process' }),
    ).toThrow(/no threads to redirect/);
  });

  test('sharedMemory: true backs plain allocations with NShm', async () => {
    const proc = getGlobalDummyProcess();
    const thread = Thread.getThreads(proc.pid)[0];
    if (!thread) throw new Error('No thread found in the spawned process');

    // sharedMemory: true splices NShm into the resolved accessor's own
    // backend chain and returns that same accessor (see
    // createAccessorWithoutInit's doc comment) -- `memory` here really is
    // the IndirectNThreadHostAccessor idType: 'thread' would have returned
    // on its own, so its own deinit()/call() work directly, no separate
    // handle needed just for cleanup.
    const memory = await createAccessor(thread.tid, {
      idType: 'thread',
      sharedMemory: true,
    });
    expect(memory).toBeInstanceOf(IndirectNThreadHostAccessor);

    const addr = await memory.alloc(4096);
    // Independent raw ReadProcessMemory check (not another NThread hijack of
    // the same already-hijacked thread) -- proves the write really landed in
    // the target's shared section, not just NShm's own local view.
    const raw = new RemoteMemoryAccessor(proc.pid);
    try {
      const marker = Buffer.from('createAccessor shared memory!\0');
      await memory.write(addr, marker);

      const seenInTarget = raw.readSync(addr, marker.byteLength);
      expect(seenInTarget.toString()).toBe(marker.toString());
    } finally {
      raw.close();
      await memory.call(Kernel32Impl.UnmapViewOfFile, addr);
      await memory.free(addr);
      await memory.deinit();
    }
  }, 30000);

  test('sharedMemory: true also works with the default idType (processAllThreadIds)', async () => {
    const proc = getGlobalDummyProcess();

    // No idType -- resolveBaseAccessor still returns a genuine
    // IndirectNThreadHostAccessor synchronously (NThreadRaceAccessor is
    // nested inside it, standing in for `.nthread` until init() resolves the
    // race -- see its doc comment), so the sharedMemory splice in
    // createAccessorWithoutInit lands on the *same* object whether racing is
    // involved or not, and nothing about init()/onInit() ever reassigns
    // `IndirectNThreadHostAccessor`'s own `backend` afterward to disturb it.
    const memory = await createAccessor(proc.pid, { sharedMemory: true });
    expect(memory).toBeInstanceOf(IndirectNThreadHostAccessor);

    const addr = await memory.alloc(4096);
    const raw = new RemoteMemoryAccessor(proc.pid);
    try {
      const marker = Buffer.from('processAllThreadIds shared memory!\0');
      await memory.write(addr, marker);

      const seenInTarget = raw.readSync(addr, marker.byteLength);
      expect(seenInTarget.toString()).toBe(marker.toString());
    } finally {
      raw.close();
      await memory.call(Kernel32Impl.UnmapViewOfFile, addr);
      await memory.free(addr);
      await memory.deinit();
    }
  }, 30000);
});

describe('createAccessorOptions', () => {
  test('defaults to the gentle (level 1) preset, with shared memory off', () => {
    expect(createAccessorOptions()).toEqual(createAccessorOptions(1));
    expect(createAccessorOptions(1)).toEqual({
      hostOptions: { timeoutMs: 20000, pollIntervalMs: 2 },
      sharedMemory: false,
    });
  });

  test('level 2 is more aggressive (shorter timeout) and turns shared memory on', () => {
    const gentle = createAccessorOptions(1);
    const balanced = createAccessorOptions(2);

    // hostOptions is untyped (Record<string, unknown>) since it's forwarded
    // to whatever `host` class is in play -- cast back to the default
    // host's NThreadOptions shape to inspect it here.
    const balancedHostOptions = balanced.hostOptions as NThreadOptions;
    const gentleHostOptions = gentle.hostOptions as NThreadOptions;
    expect(balancedHostOptions.timeoutMs!).toBeLessThan(
      gentleHostOptions.timeoutMs!,
    );
    expect(gentle.sharedMemory).toBe(false);
    expect(balanced.sharedMemory).toBe(true);
  });

  test('the returned template drives a real createAccessor call', async () => {
    const proc = getGlobalDummyProcess();
    const options = createAccessorOptions(1);
    options.idType = 'process';

    const memory = await createAccessor(proc.pid, options);
    try {
      const remoteTid = await memory.call(Kernel32Impl.GetCurrentThreadId);
      expect(Thread.getThreads(proc.pid).some((t) => t.tid === remoteTid)).toBe(
        true,
      );
    } finally {
      if (isInittableAccessor(memory)) await memory.deinit();
    }
  }, 30000);
});

describe('createAccessor + SyncStruct (level 2 / sharedMemory: true)', () => {
  test('struct field reads/writes are synchronous (no await) and land cross-process', async () => {
    const proc = getGlobalDummyProcess();

    // createAccessor() itself is still async (it awaits init()/the thread
    // race up front) -- idType defaults to 'processAllThreadIds', which
    // races every thread of proc.pid and lands the hijack on whichever one
    // wins, no manual thread picked here. Everything after this point --
    // allocating the struct and reading/writing its fields -- is plain
    // synchronous code, no await anywhere below. sharedMemory: true (level
    // 2's preset) means Player.allocSync() below is backed by NShm: the
    // struct's backing memory is mapped into this process too, so every
    // field access after the initial allocation skips the remote round trip
    // entirely.
    const memory = await createAccessor(proc.pid, createAccessorOptions(2));
    expect(memory).toBeInstanceOf(IndirectNThreadHostAccessor);

    const Player = struct({ health: 'i32', mana: 'i32' });
    const player = Player.allocSync(memory);

    try {
      player.health = 100;
      player.mana = 50;
      expect(player.health).toBe(100);
      expect(player.mana).toBe(50);

      player.health -= 35;
      expect(player.health).toBe(65);

      // Independent raw ReadProcessMemory check (not another NThread hijack
      // of the same thread) -- proves the synchronous writes above really
      // landed in the target process's memory, not just a local mirror.
      const raw = new RemoteMemoryAccessor(proc.pid);
      try {
        expect(raw.readSync(player.address, 4).readInt32LE(0)).toBe(65);
        expect(raw.readSync(player.address, 4, 4).readInt32LE(0)).toBe(50);
      } finally {
        raw.close();
      }
    } finally {
      await memory.call(Kernel32Impl.UnmapViewOfFile, player.address);
      await memory.free(player.address);
      await memory.deinit();
    }
  }, 30000);

  test('njava: auto (default) detects absence of jvm.dll and skips attach', async () => {
    const proc = getGlobalDummyProcess();
    const memory = await createAccessor(proc.pid);
    try {
      expect(findNJava(memory)).toBeUndefined();
    } finally {
      await memory.deinit();
    }
  }, 30000);

  test('njava: false explicitly skips njava attach', async () => {
    const proc = getGlobalDummyProcess();
    const memory = await createAccessor(proc.pid, { njava: false });
    try {
      expect(findNJava(memory)).toBeUndefined();
    } finally {
      await memory.deinit();
    }
  }, 30000);

  test('njava: true forces attach and throws when jvm.dll is missing', async () => {
    const proc = getGlobalDummyProcess();
    expect(createAccessor(proc.pid, { njava: true })).rejects.toThrow(
      /jvm\.dll/,
    );
  }, 30000);
});
