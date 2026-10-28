import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Win32FileSystem } from '../../packages/simulate/src/runtime/file-system.js';

/**
 * `Win32FileSystem.deleteDirectory`/`rename` -- the "full file manager"
 * capabilities `SimulateFolderPicker.tsx` needs (create folder already
 * existed via `createDirectory`). Only exercises the standalone class, no
 * `Win64Machine`/real WinAPI FFI involved, so this runs on plain `bun test`
 * without Wine.
 */
describe('Win32FileSystem directory management', () => {
  it('deleteDirectory removes a directory and everything under it', () => {
    const fs = new Win32FileSystem();
    fs.createDirectory('C:\\Scratch\\Nested');
    fs.writeFile('C:\\Scratch\\a.txt', new TextEncoder().encode('a'));
    fs.writeFile('C:\\Scratch\\Nested\\b.txt', new TextEncoder().encode('b'));

    assert.equal(fs.deleteDirectory('C:\\Scratch'), true);
    assert.equal(fs.getEntry('C:\\Scratch'), undefined);
    assert.equal(fs.getEntry('C:\\Scratch\\a.txt'), undefined);
    assert.equal(fs.getEntry('C:\\Scratch\\Nested'), undefined);
    assert.equal(fs.getEntry('C:\\Scratch\\Nested\\b.txt'), undefined);

    // Missing / non-directory targets: false, not throw.
    assert.equal(fs.deleteDirectory('C:\\Scratch'), false);
    fs.writeFile('C:\\lonely.txt', new TextEncoder().encode('x'));
    assert.equal(fs.deleteDirectory('C:\\lonely.txt'), false);
  });

  it('rename moves a file, updating its path/name', () => {
    const fs = new Win32FileSystem();
    fs.writeFile(
      'C:\\Users\\Serkan\\Desktop\\a.txt',
      new TextEncoder().encode('hello'),
    );

    assert.equal(
      fs.rename(
        'C:\\Users\\Serkan\\Desktop\\a.txt',
        'C:\\Users\\Serkan\\Documents\\b.txt',
      ),
      true,
    );
    assert.equal(fs.getEntry('C:\\Users\\Serkan\\Desktop\\a.txt'), undefined);
    const moved = fs.getEntry('C:\\Users\\Serkan\\Documents\\b.txt');
    assert.ok(moved);
    assert.equal(moved.name, 'b.txt');
    assert.equal(moved.path, 'C:\\Users\\Serkan\\Documents\\b.txt');
    assert.equal(
      new TextDecoder().decode(
        fs.readFile('C:\\Users\\Serkan\\Documents\\b.txt'),
      ),
      'hello',
    );
  });

  it('rename moves a directory, recursively re-keying every descendant', () => {
    const fs = new Win32FileSystem();
    fs.createDirectory('C:\\Old\\Nested');
    fs.writeFile('C:\\Old\\a.txt', new TextEncoder().encode('a'));
    fs.writeFile('C:\\Old\\Nested\\b.txt', new TextEncoder().encode('b'));

    assert.equal(fs.rename('C:\\Old', 'C:\\Users\\Serkan\\New'), true);
    assert.equal(fs.getEntry('C:\\Old'), undefined);
    assert.ok(fs.isDirectory('C:\\Users\\Serkan\\New'));
    assert.ok(fs.isDirectory('C:\\Users\\Serkan\\New\\Nested'));
    assert.equal(
      new TextDecoder().decode(fs.readFile('C:\\Users\\Serkan\\New\\a.txt')),
      'a',
    );
    assert.equal(
      new TextDecoder().decode(
        fs.readFile('C:\\Users\\Serkan\\New\\Nested\\b.txt'),
      ),
      'b',
    );
  });

  it('rename refuses to silently overwrite an existing target', () => {
    const fs = new Win32FileSystem();
    fs.writeFile(
      'C:\\Users\\Serkan\\Desktop\\a.txt',
      new TextEncoder().encode('a'),
    );
    fs.writeFile(
      'C:\\Users\\Serkan\\Desktop\\b.txt',
      new TextEncoder().encode('b'),
    );

    assert.equal(
      fs.rename(
        'C:\\Users\\Serkan\\Desktop\\a.txt',
        'C:\\Users\\Serkan\\Desktop\\b.txt',
      ),
      false,
    );
    assert.equal(
      new TextDecoder().decode(
        fs.readFile('C:\\Users\\Serkan\\Desktop\\b.txt'),
      ),
      'b',
    );
  });

  it('rename throws when the target parent directory does not exist', () => {
    const fs = new Win32FileSystem();
    fs.writeFile(
      'C:\\Users\\Serkan\\Desktop\\a.txt',
      new TextEncoder().encode('a'),
    );
    assert.throws(() =>
      fs.rename('C:\\Users\\Serkan\\Desktop\\a.txt', 'C:\\NoSuchDir\\a.txt'),
    );
  });
});
