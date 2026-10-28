import { describe, it, expect } from 'bun:test';
import {
  getAgentSources,
  getAgentBytecodeSync,
  getAgentBytecode,
  getAgentJarSync,
  getAgentJar,
  loadAgentMappings,
} from 'njava-agent';
import { createPool } from '../../packages/java/mappings/src/index.js';
import { existsSync } from 'node:fs';
import { getTestJavaPath } from './java-test-helpers.js';

describe('njava: Dynamic Java Agent Builder', () => {
  it('loads agent Java source files', () => {
    const sources = getAgentSources();
    expect(sources).toBeDefined();
    const fileNames = Object.keys(sources);
    expect(fileNames.length).toBeGreaterThanOrEqual(2);
    expect(fileNames).toContain('org/exoproc/njava/agent/utils/Exoproc.java');
    expect(fileNames).toContain('org/exoproc/njava/agent/NJavaAgent.java');
  });

  it('compiles single-class Exoproc bytecode in memory without disk JAR', async () => {
    const javaPath = getTestJavaPath(8);
    const syncRes = getAgentBytecodeSync({ javaVersion: 8, javaPath });
    expect(syncRes).toBeDefined();
    expect(syncRes.className).toBe('org.exoproc.njava.agent.utils.Exoproc');
    expect(syncRes.bytecode.length).toBeGreaterThan(20000);
    expect(syncRes.javaVersion).toBe(8);

    const asyncRes = await getAgentBytecode({ javaVersion: 8, javaPath });
    expect(asyncRes.className).toBe('org.exoproc.njava.agent.utils.Exoproc');
    expect(asyncRes.bytecode.length).toBe(syncRes.bytecode.length);
  });

  it('compiles dynamically for Java 8 and creates a valid JAR', () => {
    const javaPath = getTestJavaPath(8);
    const result = getAgentJarSync({ javaVersion: 8, javaPath, force: true });
    expect(result).toBeDefined();
    expect(existsSync(result.jarPath)).toBe(true);
    expect(result.javaVersion).toBe(8);
    expect(result.classesCount).toBeGreaterThanOrEqual(1);
    expect(result.jarBuffer.length).toBeGreaterThan(10000);
    expect(result.cached).toBe(false);

    // Fast cache retrieval
    const cached = getAgentJarSync({ javaVersion: 8, javaPath });
    expect(cached.cached).toBe(true);
    expect(cached.jarPath).toBe(result.jarPath);
  }, 30000);

  it('compiles dynamically for modern Java 17 and 21 bytecode targets', async () => {
    const javaPath17 = getTestJavaPath(17);
    const res17 = await getAgentJar({
      javaVersion: 17,
      javaPath: javaPath17,
      force: true,
    });
    expect(res17.javaVersion).toBe(17);
    expect(res17.classesCount).toBeGreaterThanOrEqual(1);
    expect(existsSync(res17.jarPath)).toBe(true);

    const javaPath21 = getTestJavaPath(21);
    const res21 = await getAgentJar({
      javaVersion: 21,
      javaPath: javaPath21,
      force: true,
    });
    expect(res21.javaVersion).toBe(21);
    expect(res21.classesCount).toBeGreaterThanOrEqual(1);
    expect(existsSync(res21.jarPath)).toBe(true);
  }, 30000);

  it('compiles obfuscated and shrunken Exoproc agent bytecode and JAR', () => {
    const javaPath = getTestJavaPath(8);
    const normal = getAgentBytecodeSync({ javaVersion: 8, javaPath });
    const obfuscated = getAgentBytecodeSync({
      javaVersion: 8,
      javaPath,
      obfuscate: true,
    });

    expect(obfuscated.className).toBe('org.exoproc.njava.agent.utils.Exoproc');
    expect(obfuscated.bytecode.length).toBeLessThan(normal.bytecode.length);
    expect(obfuscated.mappings).toBeDefined();
    expect(obfuscated.mappings).toContain(
      'org/exoproc/njava/agent/utils/Exoproc',
    );
    expect(obfuscated.mappings).toContain('instance\ta');

    // 1. Direct loadMappings from the built instance into pool
    const pool = createPool();
    expect(typeof obfuscated.loadMappings).toBe('function');
    obfuscated.loadMappings!(pool);
    expect(pool.resolveField('Exoproc', 'instance')).toBe('a');
    expect(pool.getCanonicalField('Exoproc', 'a')).toBe('instance');

    // 2. loadAgentMappings passing the build result directly (no re-compilation)
    const pool2 = createPool();
    loadAgentMappings(pool2, obfuscated);
    expect(pool2.resolveField('Exoproc', 'instance')).toBe('a');

    // 3. JAR compilation produces .tiny cache next to JAR and reads it on cache hit
    const jarRes = getAgentJarSync({
      javaVersion: 8,
      javaPath,
      obfuscate: true,
      force: true,
    });
    expect(jarRes.jarPath.endsWith('-obf.jar')).toBe(true);
    expect(existsSync(jarRes.jarPath)).toBe(true);
    expect(jarRes.jarBuffer.length).toBeLessThan(
      getAgentJarSync({ javaVersion: 8, javaPath }).jarBuffer.length,
    );
    expect(jarRes.mappings).toBeDefined();

    const tinyFile = jarRes.jarPath.replace(/\.jar$/, '.tiny');
    expect(existsSync(tinyFile)).toBe(true);

    // Cache hit: must return cached mappings without force
    const cachedJarRes = getAgentJarSync({
      javaVersion: 8,
      javaPath,
      obfuscate: true,
      force: false,
    });
    expect(cachedJarRes.cached).toBe(true);
    expect(cachedJarRes.mappings).toBeDefined();
    expect(cachedJarRes.mappings).toBe(jarRes.mappings);
  }, 45000);

  it('dumps agent JAR and class via dumpAgent', async () => {
    const { dumpAgent } = await import('njava-agent');
    const dumpJar = await dumpAgent({
      path: '/tmp/test_dump_srv.jar',
      javaVersion: 8,
    });
    expect(dumpJar.success).toBe(true);
    expect(dumpJar.type).toBe('jar');
    expect(existsSync(dumpJar.path)).toBe(true);
    expect(dumpJar.size).toBeGreaterThan(10000);

    const dumpClass = await dumpAgent({
      path: '/tmp/test_dump_srv.class',
      format: 'class',
      javaVersion: 8,
    });
    expect(dumpClass.success).toBe(true);
    expect(dumpClass.type).toBe('class');
    expect(existsSync(dumpClass.path)).toBe(true);
    expect(dumpClass.size).toBeGreaterThan(15000);
    expect(dumpClass.className).toBe('org.exoproc.njava.agent.utils.Exoproc');
  }, 30000);
});
