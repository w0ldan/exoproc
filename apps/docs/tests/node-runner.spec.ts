import { WIN32_WORKSPACE_PATH } from 'win32-simulate';
import { toWindowsPath } from '../src/shell/main/fs/workspace-paths';
import { getMachine } from '../src/shell/main/modules/machine';
import {
  runNodeEval,
  runNodeScript,
} from '../src/shell/main/modules/node-runner';

/**
 * Exercises the real module graph resolver against `machine.fileSystem`
 * (the same `Win32FileSystem` `cmd.exe`/`node.exe`/Explorer all read as of
 * F9) -- relative imports, a workspace-package bare import resolved
 * through its `package.json` `main`, `node:fs`, circular-import detection,
 * and console capture, all through real `Blob` URLs and a real dynamic
 * `import()` (Bun implements both, same as a browser Worker would).
 *
 * `unbindFolder` detaches the auto-detected host bind `Win32FileSystem`'s
 * constructor sets up under Bun/Node (`bindWorkspace()` -> real project
 * root) -- this test needs an isolated in-memory tree, not the real repo.
 */

const machine = getMachine();
machine.fileSystem.unbindFolder(WIN32_WORKSPACE_PATH);

function write(path: string, text: string): void {
  const windowsPath = toWindowsPath(path, WIN32_WORKSPACE_PATH);
  const parent = windowsPath.slice(0, windowsPath.lastIndexOf('\\'));
  if (parent) machine.fileSystem.createDirectory(parent);
  machine.fileSystem.writeFile(windowsPath, new TextEncoder().encode(text));
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  got=${JSON.stringify(actual)} want=${JSON.stringify(expected)}`}`,
  );
}

// ------------------------------------------------------- relative imports
{
  write('/util.js', `export function greet(name) { return 'hi ' + name; }`);
  write(
    '/main.js',
    `import { greet } from './util.js';\nconsole.log(greet('world'));`,
  );

  const lines: string[] = [];
  const result = await runNodeScript('/main.js', (text) => lines.push(text));
  check('relative import exit code', result.exitCode, 0);
  check('relative import output', lines.join('').trim(), 'hi world');
}

// --------------------------------------------- workspace package import
{
  write(
    '/packages/greeter/package.json',
    JSON.stringify({ name: 'greeter', main: 'dist/index.js' }),
  );
  write(
    '/packages/greeter/dist/index.js',
    `export const shout = (s) => s.toUpperCase() + '!';`,
  );
  write(
    '/use-package.js',
    `import { shout } from 'greeter';\nconsole.log(shout('hello'));`,
  );

  const lines: string[] = [];
  const result = await runNodeScript('/use-package.js', (text) =>
    lines.push(text),
  );
  check('package import exit code', result.exitCode, 0);
  check('package import output', lines.join('').trim(), 'HELLO!');
}

// -------------------------------------------------------- nested relative
{
  write('/lib/deep/value.js', `export const value = 42;`);
  write(
    '/lib/consumer.js',
    `import { value } from './deep/value.js';\nconsole.log(value * 2);`,
  );
  const lines: string[] = [];
  const result = await runNodeScript('/lib/consumer.js', (text) =>
    lines.push(text),
  );
  check('nested relative exit code', result.exitCode, 0);
  check('nested relative output', lines.join('').trim(), '84');
}

// ------------------------------------------------------- missing module
{
  write(
    '/broken.js',
    `import { x } from './does-not-exist.js';\nconsole.log(x);`,
  );
  const lines: string[] = [];
  const result = await runNodeScript('/broken.js', (text) => lines.push(text));
  check('missing module exit code', result.exitCode, 1);
  check(
    'missing module reports error',
    lines.join('').includes('bulunamadı'),
    true,
  );
}

// ------------------------------------------------------- unsupported bare
{
  write('/uses-npm.js', `import path from 'node:path';\nconsole.log(path);`);
  const lines: string[] = [];
  const result = await runNodeScript('/uses-npm.js', (text) =>
    lines.push(text),
  );
  check('npm import exit code', result.exitCode, 1);
  check(
    'npm import reports error',
    lines.join('').includes('Modül çözümlenemedi'),
    true,
  );
}

// ------------------------------------------------------------- circular
{
  write('/a.js', `import './b.js';\nconsole.log('a');`);
  write('/b.js', `import './a.js';\nconsole.log('b');`);
  const lines: string[] = [];
  const result = await runNodeScript('/a.js', (text) => lines.push(text));
  check('circular import exit code', result.exitCode, 1);
  check(
    'circular import reports error',
    lines.join('').includes('Dairesel'),
    true,
  );
}

// ------------------------------------------------------- runtime error
{
  write('/throws.js', `throw new Error('boom');`);
  const lines: string[] = [];
  const result = await runNodeScript('/throws.js', (text) => lines.push(text));
  check('runtime error exit code', result.exitCode, 1);
  check(
    'runtime error message surfaces',
    lines.join('').includes('boom'),
    true,
  );
}

// -------------------------------------------------- console.error/warn
{
  write(
    '/multi-console.js',
    `console.log('a'); console.warn('b'); console.error('c');`,
  );
  const lines: string[] = [];
  const result = await runNodeScript('/multi-console.js', (text) =>
    lines.push(text),
  );
  check('multi console exit code', result.exitCode, 0);
  check('multi console captured all three', lines.join(''), 'a\r\nb\r\nc\r\n');
}

// ------------------------------------------------------- node:fs shim
{
  const lines: string[] = [];
  const result = await runNodeEval(
    `import fs from 'node:fs';\nfs.writeFileSync('/node-fs-check.txt', 'via node:fs');\nconsole.log(fs.readFileSync('/node-fs-check.txt', 'utf-8'));`,
    (text) => lines.push(text),
  );
  check('node:fs eval exit code', result.exitCode, 0);
  check('node:fs eval output', lines.join('').trim(), 'via node:fs');
  check(
    'node:fs write landed on machine.fileSystem',
    new TextDecoder().decode(
      machine.fileSystem.readFile(
        toWindowsPath('/node-fs-check.txt', WIN32_WORKSPACE_PATH),
      ),
    ),
    'via node:fs',
  );
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
