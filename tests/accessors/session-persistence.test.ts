import { expect, test, describe, afterAll } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  HostAccessor,
  AccessorSealedError,
  type HostAccessorSession,
} from 'bun-xffi';
import {
  createAccessorWithoutInit,
  createAccessor,
  createAccessorFromFile,
  IndirectNThreadHostAccessor,
} from 'exoproc-accessors';
import { getGlobalDummyProcess } from 'exoproc-dummy';

describe('HostAccessor Pipeline Blueprint and Hibernation', () => {
  const tempFiles: string[] = [];

  const getTempPath = (name: string) => {
    const p = join(
      tmpdir(),
      `test-session-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}.json`,
    );
    tempFiles.push(p);
    return p;
  };

  afterAll(() => {
    for (const f of tempFiles) {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch {}
    }
  });

  test('HostAccessor toJSON builds pipeline blueprint and metadata', () => {
    const proc = getGlobalDummyProcess();
    const accessor = createAccessorWithoutInit(proc.pid, {
      idType: 'processAllThreadIds',
      sharedMemory: false,
    });

    accessor.setSessionMetadata('gameName', 'Minecraft 1.8.9');
    accessor.setSessionMetadata('profileId', 'lunar-client');

    const meta = accessor.getSessionMetadata();
    expect(meta.gameName).toBe('Minecraft 1.8.9');
    expect(meta.profileId).toBe('lunar-client');

    const json = accessor.toJSON();
    expect(json.version).toBe(2);
    expect(json.processId).toBe(proc.pid);
    expect(json.accessorType).toBe('IndirectNThreadHostAccessor');
    expect(json.metadata?.gameName).toBe('Minecraft 1.8.9');
    expect(json.metadata?.profileId).toBe('lunar-client');
    expect(json.options?.idType).toBe('processAllThreadIds');
    expect(json.pipeline).toBeDefined();
    expect(Array.isArray(json.pipeline)).toBe(true);
    expect(json.pipeline!.length).toBeGreaterThan(0);
    expect(json.savedAt).toBeDefined();

    accessor.close();
  });

  test('save() hibernates stack, seals instance and throws on subsequent memory calls', async () => {
    const proc = getGlobalDummyProcess();
    const filePath = getTempPath('sealed-test');

    const accessor = await createAccessor(proc.pid);
    expect(accessor.isSealed).toBe(false);

    // Save & hibernate
    await accessor.save(filePath);
    expect(accessor.isSealed).toBe(true);

    // Verify subsequent ops throw AccessorSealedError
    expect(accessor.alloc(64)).rejects.toThrow(/sealed\/hibernated/);
    expect(() => accessor.allocSync(64)).toThrow(/sealed\/hibernated/);

    // Load from file via createAccessor(filePath)
    const restored = await createAccessor(filePath);
    expect(restored).toBeInstanceOf(IndirectNThreadHostAccessor);
    expect(restored.processId).toBe(proc.pid);

    // Verify session file was consumed (deleted) immediately upon load
    expect(existsSync(filePath)).toBe(false);

    // Verify restored accessor is functional
    const buf = Buffer.from('hibernated resume works!');
    const addr = await restored.alloc(64);
    await restored.write(addr, buf);
    const back = await restored.read(addr, buf.length);
    expect(back.toString()).toBe(buf.toString());
    await restored.free(addr);

    // Verify re-saving back to original session path without arguments
    await (restored as any).save();
    expect(existsSync(filePath)).toBe(true);
    expect((restored as any).isSealed).toBe(true);

    // Clean up
    try {
      unlinkSync(filePath);
    } catch {}
  }, 40000);

  test('HostAccessor.loadSession reads session file accurately', () => {
    const proc = getGlobalDummyProcess();
    const filePath = getTempPath('sync');

    const accessor = createAccessorWithoutInit(proc.pid, {
      idType: 'processAllThreadIds',
    });
    accessor.setSessionMetadata('customKey', 42);

    const writtenPath = accessor.saveToFileSync(filePath);
    expect(writtenPath).toBe(filePath);
    expect(existsSync(filePath)).toBe(true);

    const loaded = HostAccessor.loadSession(filePath);
    expect(loaded.version).toBe(2);
    expect(loaded.processId).toBe(proc.pid);
    expect(loaded.metadata?.customKey).toBe(42);
    expect(loaded.accessorType).toBe('IndirectNThreadHostAccessor');
    expect(loaded.pipeline).toBeDefined();

    accessor.close();
  });

  test('HostAccessor.registerRestorer allows custom restorers', async () => {
    let called = false;
    HostAccessor.registerRestorer('CustomMockAccessor', async (session) => {
      called = true;
      return {
        processId: session.processId,
        metadata: session.metadata,
      } as any;
    });

    const filePath = getTempPath('custom-mock');
    const mockSession: HostAccessorSession = {
      version: 2,
      savedAt: new Date().toISOString(),
      processId: 12345,
      accessorType: 'CustomMockAccessor',
      metadata: { mock: true },
    };

    writeFileSync(filePath, JSON.stringify(mockSession, null, 2), 'utf8');

    const restored = await HostAccessor.restoreFromFile(filePath);
    expect(called).toBe(true);
    expect(restored.processId).toBe(12345);
  });
});
