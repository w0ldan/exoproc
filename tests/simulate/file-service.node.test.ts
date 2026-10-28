import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Win32FileSystem } from '../../packages/simulate/dist/runtime/file-system.js';
import {
  FileChangeType,
  FileService,
  FileSystemProviderError,
  FileSystemProviderErrorCode,
  FileType,
  ResourceUri,
  Win32FileSystemProvider,
  joinResourcePath,
} from '../../packages/simulate/dist/platform/files/index.js';

describe('platform file services', () => {
  it('represents Windows paths as portable file resources', () => {
    const resource = ResourceUri.file(
      'C:\\Users\\Serkan\\Workspace\\src\\index.ts',
    );

    assert.equal(resource.scheme, 'file');
    assert.equal(resource.path, '/C:/Users/Serkan/Workspace/src/index.ts');
    assert.equal(
      resource.fsPath,
      'C:\\Users\\Serkan\\Workspace\\src\\index.ts',
    );
    assert.equal(
      resource.toString(),
      'file:///C:/Users/Serkan/Workspace/src/index.ts',
    );
    assert.equal(
      ResourceUri.parse(resource.toString()).fsPath,
      resource.fsPath,
    );
  });

  it('routes lazy directory and file operations through the registered provider', async () => {
    const win32 = new Win32FileSystem();
    win32.createDirectory('C:\\Project');

    const provider = new Win32FileSystemProvider(win32);
    const files = new FileService();
    files.registerProvider('file', provider);

    const root = ResourceUri.file('C:\\Project');
    const sourceDirectory = joinResourcePath(root, 'src');
    const sourceFile = joinResourcePath(sourceDirectory, 'index.ts');

    await files.createDirectory(sourceDirectory);
    await files.writeFile(
      sourceFile,
      new TextEncoder().encode('export const answer = 42;\n'),
      { create: true, overwrite: false },
    );

    const unresolved = await files.resolve(root);
    assert.equal(unresolved.isDirectory, true);
    assert.equal(unresolved.children, undefined);

    const resolvedRoot = await files.resolve(root, { resolveChildren: true });
    assert.deepEqual(
      resolvedRoot.children?.map((child) => [child.name, child.type]),
      [['src', FileType.Directory]],
    );

    const resolvedSource = await files.resolve(sourceDirectory, {
      resolveChildren: true,
    });
    assert.deepEqual(
      resolvedSource.children?.map((child) => [child.name, child.type]),
      [['index.ts', FileType.File]],
    );

    assert.equal(
      new TextDecoder().decode(await files.readFile(sourceFile)),
      'export const answer = 42;\n',
    );
  });

  it('forwards provider changes and supports scheme-scoped replacement', async () => {
    const win32 = new Win32FileSystem();
    win32.createDirectory('C:\\Project');

    const provider = new Win32FileSystemProvider(win32);
    const files = new FileService();
    const changes: FileChangeType[] = [];
    const changeSubscription = files.onDidFilesChange((events) => {
      changes.push(...events.map((event) => event.type));
    });
    const registration = files.registerProvider('sim', provider);

    const root = ResourceUri.from({ scheme: 'sim', path: '/C:/Project' });
    const target = joinResourcePath(root, 'notes.txt');

    await files.writeFile(target, new TextEncoder().encode('one'), {
      create: true,
      overwrite: false,
    });
    await files.writeFile(target, new TextEncoder().encode('two'), {
      create: false,
      overwrite: true,
    });
    await files.delete(target, { recursive: false, useTrash: false });

    assert.deepEqual(changes, [
      FileChangeType.Added,
      FileChangeType.Updated,
      FileChangeType.Deleted,
    ]);

    registration.dispose();
    await assert.rejects(
      () => files.readFile(target),
      (error: unknown) =>
        error instanceof FileSystemProviderError &&
        error.code === FileSystemProviderErrorCode.Unavailable,
    );

    changeSubscription.dispose();
    provider.dispose();
    files.dispose();
  });
});
