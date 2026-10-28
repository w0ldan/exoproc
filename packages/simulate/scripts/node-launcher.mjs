import path from 'node:path';
import { pathToFileURL } from 'node:url';
import './register-node-bindings.mjs';
import { tsImport } from 'tsx/esm/api';

const [, , entrypoint, ...entryArgs] = process.argv;
if (!entrypoint) {
  throw new Error('Node launcher requires an entrypoint or --test');
}

if (entrypoint === '--test') {
  if (entryArgs.length === 0) {
    throw new Error('Node launcher --test requires at least one test file');
  }
  process.argv = [
    process.execPath,
    ...entryArgs.map((file) => path.resolve(file)),
  ];
  for (const testFile of entryArgs) {
    const absoluteTestFile = path.resolve(testFile);
    await tsImport(pathToFileURL(absoluteTestFile).href, import.meta.url);
  }
} else {
  const absoluteEntrypoint = path.resolve(entrypoint);
  process.argv = [process.execPath, absoluteEntrypoint, ...entryArgs];
  await tsImport(pathToFileURL(absoluteEntrypoint).href, import.meta.url);
}
