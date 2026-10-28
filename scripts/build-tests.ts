import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const TESTS_ROOT = path.join(REPOSITORY_ROOT, 'tests');
const PACKAGES_ROOT = path.join(REPOSITORY_ROOT, 'packages');
const OUTPUT_ROOT = path.join(TESTS_ROOT, 'dist');
const requestedScope = process.argv[2];
const SOURCE_ROOT = requestedScope
  ? path.resolve(TESTS_ROOT, requestedScope)
  : TESTS_ROOT;

if (
  SOURCE_ROOT !== TESTS_ROOT &&
  !SOURCE_ROOT.startsWith(`${TESTS_ROOT}${path.sep}`)
) {
  throw new Error(`Test scope must be inside ${TESTS_ROOT}`);
}

async function findTestEntrypoints(directory = SOURCE_ROOT): Promise<string[]> {
  const entries: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'dist') continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      entries.push(...(await findTestEntrypoints(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      entries.push(entryPath);
    }
  }
  return entries.sort();
}

function prepareTestSource(
  source: string,
  packageNames: ReadonlyMap<string, string>,
): string {
  return source
    .replace(
      /(['"])\.\.\/\.\.\/packages\/(.+?)\/src\/[^'"]+\1/g,
      (_specifier, quote: string, packageDirectory: string) => {
        const packageName = packageNames.get(packageDirectory);
        if (!packageName) {
          throw new Error(
            `No package name found for packages/${packageDirectory}`,
          );
        }
        return `${quote}${packageName}${quote}`;
      },
    )
    .replace(/(['"])\.\.\/\.\.\/packages\//g, '$1../../../packages/');
}

async function buildSimulationTest(
  entrypoint: string,
  packageNames: ReadonlyMap<string, string>,
): Promise<void> {
  const relativePath = path.relative(TESTS_ROOT, entrypoint);
  const outputPath = path.join(
    OUTPUT_ROOT,
    relativePath.replace(/\.ts$/, '.js'),
  );
  const source = prepareTestSource(
    await readFile(entrypoint, 'utf8'),
    packageNames,
  );
  const result = ts.transpileModule(source, {
    fileName: entrypoint,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      esModuleInterop: true,
      sourceMap: true,
      inlineSources: true,
    },
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.outputText);
  if (result.sourceMapText) {
    await writeFile(`${outputPath}.map`, result.sourceMapText);
  }
}

async function buildNodeTest(
  entrypoint: string,
  packageNames: ReadonlyMap<string, string>,
): Promise<void> {
  const relativePath = path.relative(TESTS_ROOT, entrypoint);
  const outputPath = path.join(
    OUTPUT_ROOT,
    relativePath.replace(/\.ts$/, '.mjs'),
  );
  const source = prepareTestSource(
    await readFile(entrypoint, 'utf8'),
    packageNames,
  );
  const result = ts.transpileModule(source, {
    fileName: entrypoint,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      esModuleInterop: true,
    },
  });

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, result.outputText);
}

async function loadPackageNames(): Promise<ReadonlyMap<string, string>> {
  const packageNames = new Map<string, string>();

  async function scanDir(dir: string, relPrefix = ''): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const subDir = path.join(dir, entry.name);
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      try {
        const manifest = JSON.parse(
          await readFile(path.join(subDir, 'package.json'), 'utf8'),
        ) as { name?: string };
        if (manifest.name) {
          packageNames.set(relPath, manifest.name);
          packageNames.set(entry.name, manifest.name);
        }
      } catch {
        // Not a package directory, scan subdirectories (e.g. packages/njava)
        await scanDir(subDir, relPath);
      }
    }
  }

  await scanDir(PACKAGES_ROOT);
  return packageNames;
}

async function main(): Promise<void> {
  const [entrypoints, packageNames] = await Promise.all([
    findTestEntrypoints(),
    loadPackageNames(),
  ]);
  if (entrypoints.length === 0) {
    throw new Error(`No test entrypoints found under ${TESTS_ROOT}`);
  }

  await rm(OUTPUT_ROOT, { recursive: true, force: true });
  await mkdir(OUTPUT_ROOT, { recursive: true });

  for (const entrypoint of entrypoints) {
    if (entrypoint.endsWith('.node.test.ts')) {
      await buildNodeTest(entrypoint, packageNames);
    } else {
      await buildSimulationTest(entrypoint, packageNames);
    }
  }

  await writeFile(
    path.join(OUTPUT_ROOT, 'package.json'),
    `${JSON.stringify({ type: 'module' }, null, 2)}\n`,
  );

  process.stdout.write(
    `${entrypoints.length} test file(s) from ${SOURCE_ROOT} transpiled into ${OUTPUT_ROOT}\n`,
  );
}

await main();
