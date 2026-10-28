import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Win32FileSystem } from '../../packages/simulate/dist/runtime/file-system.js';

/**
 * Proves `Win32FileSystem.bindFolder`/`unbindFolder`: a simulated path
 * prefix transparently redirects to a real host directory (read, write,
 * directory listing, delete), and unbinding restores the simulator's own
 * in-memory view of that prefix.
 */
describe('Win32FileSystem folder binds', () => {
  it('reads a real host file through a bound simulated path', () => {
    const hostDir = mkdtempSync(path.join(tmpdir(), 'exoproc-sim-bind-'));
    try {
      writeFileSync(
        path.join(hostDir, 'hello.txt'),
        'hello from the real host\n',
      );

      const fileSystem = new Win32FileSystem();
      fileSystem.bindFolder('C:\\HostBind', hostDir);

      const bytes = fileSystem.readFile('C:\\HostBind\\hello.txt');
      assert.equal(
        new TextDecoder().decode(bytes),
        'hello from the real host\n',
      );

      const entry = fileSystem.getEntry('C:\\HostBind\\hello.txt');
      assert.ok(entry);
      assert.equal(entry?.kind, 'file');
      assert.equal(entry?.data.length, 'hello from the real host\n'.length);
    } finally {
      rmSync(hostDir, { recursive: true, force: true });
    }
  });

  it('resolves bound host paths case-insensitively like Windows', () => {
    const hostDir = mkdtempSync(path.join(tmpdir(), 'exoproc-sim-bind-'));
    try {
      const realPath = path.join(hostDir, 'hello.exe');
      writeFileSync(realPath, 'binary');

      const fileSystem = new Win32FileSystem();
      fileSystem.bindFolder('C:\\HostBind', hostDir);

      assert.equal(
        new TextDecoder().decode(
          fileSystem.readFile('C:\\HOSTBIND\\HELLO.EXE'),
        ),
        'binary',
      );
      assert.equal(
        fileSystem.resolveHostPath('C:\\HostBind\\HELLO.EXE'),
        realPath,
      );
    } finally {
      rmSync(hostDir, { recursive: true, force: true });
    }
  });

  it('writes through a bound simulated path onto the real host file', () => {
    const hostDir = mkdtempSync(path.join(tmpdir(), 'exoproc-sim-bind-'));
    try {
      const fileSystem = new Win32FileSystem();
      fileSystem.bindFolder('C:\\HostBind', hostDir);

      fileSystem.writeFile(
        'C:\\HostBind\\written.txt',
        new TextEncoder().encode('written from the simulation\n'),
      );

      const realBytes = readFileSync(path.join(hostDir, 'written.txt'), 'utf8');
      assert.equal(realBytes, 'written from the simulation\n');

      // writeFileAt (append-style partial write) also passes through.
      fileSystem.writeFileAt(
        'C:\\HostBind\\written.txt',
        realBytes.length,
        new TextEncoder().encode('more\n'),
      );
      assert.equal(
        readFileSync(path.join(hostDir, 'written.txt'), 'utf8'),
        'written from the simulation\nmore\n',
      );
    } finally {
      rmSync(hostDir, { recursive: true, force: true });
    }
  });

  it('lists a bound directory using real host directory entries', () => {
    const hostDir = mkdtempSync(path.join(tmpdir(), 'exoproc-sim-bind-'));
    try {
      writeFileSync(path.join(hostDir, 'a.txt'), 'aaa');
      writeFileSync(path.join(hostDir, 'b.txt'), 'bb');

      const fileSystem = new Win32FileSystem();
      fileSystem.bindFolder('C:\\HostBind', hostDir);

      const entries = fileSystem.readDirectory('C:\\HostBind');
      assert.equal(entries.length, 2);
      assert.deepEqual(entries.map((entry) => entry.name).sort(), [
        'a.txt',
        'b.txt',
      ]);
    } finally {
      rmSync(hostDir, { recursive: true, force: true });
    }
  });

  it('deletes a real host file through the bound path', () => {
    const hostDir = mkdtempSync(path.join(tmpdir(), 'exoproc-sim-bind-'));
    try {
      const targetFile = path.join(hostDir, 'delete-me.txt');
      writeFileSync(targetFile, 'temporary');

      const fileSystem = new Win32FileSystem();
      fileSystem.bindFolder('C:\\HostBind', hostDir);

      assert.equal(fileSystem.deleteFile('C:\\HostBind\\delete-me.txt'), true);
      assert.equal(
        fileSystem.getEntry('C:\\HostBind\\delete-me.txt'),
        undefined,
      );
    } finally {
      rmSync(hostDir, { recursive: true, force: true });
    }
  });

  it('recursively deletes a bound directory through the real host', () => {
    const hostDir = mkdtempSync(path.join(tmpdir(), 'exoproc-sim-bind-'));
    try {
      mkdirSync(path.join(hostDir, 'nested'), { recursive: true });
      writeFileSync(path.join(hostDir, 'nested', 'child.txt'), 'child');

      const fileSystem = new Win32FileSystem();
      fileSystem.bindFolder('C:\\HostBind', hostDir);

      assert.equal(fileSystem.deleteDirectory('C:\\HostBind\\nested'), true);
      assert.equal(existsSync(path.join(hostDir, 'nested')), false);
      assert.equal(fileSystem.getEntry('C:\\HostBind\\nested'), undefined);
    } finally {
      rmSync(hostDir, { recursive: true, force: true });
    }
  });

  it('recursively renames a bound directory through the real host', () => {
    const hostDir = mkdtempSync(path.join(tmpdir(), 'exoproc-sim-bind-'));
    try {
      mkdirSync(path.join(hostDir, 'old'), { recursive: true });
      writeFileSync(path.join(hostDir, 'old', 'child.txt'), 'child contents');

      const fileSystem = new Win32FileSystem();
      fileSystem.bindFolder('C:\\HostBind', hostDir);

      assert.equal(
        fileSystem.rename('C:\\HostBind\\old', 'C:\\HostBind\\renamed'),
        true,
      );
      assert.equal(existsSync(path.join(hostDir, 'old')), false);
      assert.equal(
        readFileSync(path.join(hostDir, 'renamed', 'child.txt'), 'utf8'),
        'child contents',
      );
    } finally {
      rmSync(hostDir, { recursive: true, force: true });
    }
  });

  it('falls back to the in-memory store once unbound', () => {
    const hostDir = mkdtempSync(path.join(tmpdir(), 'exoproc-sim-bind-'));
    try {
      writeFileSync(path.join(hostDir, 'real.txt'), 'real host contents');

      const fileSystem = new Win32FileSystem();
      fileSystem.bindFolder('C:\\HostBind', hostDir);
      assert.ok(fileSystem.getEntry('C:\\HostBind\\real.txt'));

      fileSystem.unbindFolder('C:\\HostBind');
      // No in-memory entry ever existed at this path -- unbound now means
      // it goes back to being simulator-owned, not a passthrough.
      assert.equal(fileSystem.getEntry('C:\\HostBind\\real.txt'), undefined);
    } finally {
      rmSync(hostDir, { recursive: true, force: true });
    }
  });
});
