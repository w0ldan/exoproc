import { DummyProcess } from 'exoproc-dummy';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileJavaSync } from '../../packages/java/njava/src/compiler.js';
import { getTestJavaPath } from './java-test-helpers.js';

// `bun-wine` puts the Java 8 JRE's bin dir on PATH (see CLAUDE.md's "just
// JVM access, Java 8 only" scope for the njava package), so `java.exe`
// resolves by bare name -- no hardcoded absolute path needed here.
const JAVA_EXE = 'java.exe';

// This whole test process already runs as a Windows/Wine process (bun-wine),
// so `import.meta.dir` is already a `Z:\`-prefixed Windows path -- the
// fixtures dir (holding Idle.class, which loops on Thread.sleep(200) forever)
// is directly reachable as a classpath entry with no extra drive-mapping needed.
const FIXTURES_DIR = `${import.meta.dir.replace(/\//g, '\\')}\\fixtures`;

/**
 * Ensures `Idle.class` is compiled on-the-fly from `Idle.java` using njava's compileJavaSync.
 * Does not require Idle.class to be committed to version control.
 */
function ensureIdleClassCompiled(): void {
  const fixturesDir = join(import.meta.dir, 'fixtures');
  const idleClass = join(fixturesDir, 'Idle.class');
  if (existsSync(idleClass)) return;

  const idleJava = join(fixturesDir, 'Idle.java');
  const javaPath = getTestJavaPath(8);
  const source = readFileSync(idleJava, 'utf8');

  const result = compileJavaSync({
    source,
    javaPath,
    javaVersion: 8,
    outputDir: fixturesDir,
  });

  if (!result.success) {
    throw new Error(`Failed to compile Idle.java fixture:\n${result.output}`);
  }
}

/**
 * Spawns `java.exe -cp <fixtures> Idle` as a {@link DummyProcess} -- a real,
 * long-lived Java 8 process whose main thread cycles back to user mode every
 * ~200ms (required for `nthread`'s `SetThreadContext` hijack to land at all).
 */
export function spawnJavaDummyProcess(): DummyProcess {
  ensureIdleClassCompiled();
  return new DummyProcess({
    executable: JAVA_EXE,
    args: ['-cp', FIXTURES_DIR, 'Idle'],
  });
}
