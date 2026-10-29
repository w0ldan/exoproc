import { describe, it, expect } from 'bun:test';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'bun';
import { createIpcServer } from 'exoproc-ipc';
import {
  jjit,
  writeJarSync,
  writeJarFromClassesSync,
  compileJavaSync,
} from 'exoproc-jjit';
import {
  AgentClient,
  getAgentJarSync,
  getAgentBytecodeSync,
  waitForAgentReady,
} from 'njava-agent';
import { getTestJavaPath } from './java-test-helpers.js';

describe('jjit: Centralized JAR Packaging & URLClassLoader Agent Loading', () => {
  const javaPath = getTestJavaPath(8);

  it('builds a valid JAR buffer from raw entries using jjit.buildJar', () => {
    const jarBuf = jjit.buildJar([
      { path: 'hello.txt', data: Buffer.from('Hello Exoproc', 'utf8') },
      { path: 'sub/dir/data.bin', data: new Uint8Array([1, 2, 3, 4]) },
    ]);

    expect(jarBuf).toBeDefined();
    expect(jarBuf.length).toBeGreaterThan(50);
    expect(jarBuf[0]).toBe(0x50);
    expect(jarBuf[1]).toBe(0x4b);
    expect(jarBuf[2]).toBe(0x03);
    expect(jarBuf[3]).toBe(0x04);
  });

  it('packages compiled bytecode classes directly into a JAR via jjit.buildJarFromClasses', () => {
    const compileRes = compileJavaSync({
      source: `
        package org.example.test;
        public class MathUtil {
            public static int add(int a, int b) {
                return a + b;
            }
        }
      `,
      javaPath,
      javaVersion: 8,
    });

    expect(compileRes.success).toBe(true);

    const jarBuf = jjit.buildJarFromClasses(compileRes.classes, {
      mainClass: 'org.example.test.MathUtil',
    });

    expect(jarBuf).toBeDefined();
    expect(jarBuf.length).toBeGreaterThan(200);

    const testJarPath = join(tmpdir(), `math-test-${Date.now()}.jar`);
    try {
      writeJarSync(testJarPath, [
        {
          path: 'META-INF/MANIFEST.MF',
          data: Buffer.from('Manifest-Version: 1.0\n\n'),
        },
        {
          path: 'org/example/test/MathUtil.class',
          data: compileRes.classes.get('org.example.test.MathUtil')!,
        },
      ]);
      expect(existsSync(testJarPath)).toBe(true);
    } finally {
      try {
        unlinkSync(testJarPath);
      } catch {}
    }
  });

  it('compiles agent JAR and dynamically launches it via URLClassLoader over Named Pipe', async () => {
    const agent = getAgentJarSync({ javaVersion: 8, javaPath, force: true });
    expect(existsSync(agent.jarPath)).toBe(true);

    const bootstrapSource = `
      package org.exoproc.test;
      import java.io.File;
      import java.lang.reflect.Method;
      import java.net.URL;
      import java.net.URLClassLoader;

      public class URLClassLoaderBootstrap {
          public static void main(String[] args) throws Exception {
              String jarPath = args[0];
              String pipePath = args[1];

              File jarFile = new File(jarPath);
              URL jarUrl = jarFile.toURI().toURL();
              ClassLoader parent = ClassLoader.getSystemClassLoader();
              URLClassLoader loader = new URLClassLoader(new URL[]{jarUrl}, parent);

              Class<?> agentClass = loader.loadClass("org.exoproc.njava.agent.NJavaAgent");
              Method startMethod = agentClass.getMethod("start", String.class);
              startMethod.invoke(null, pipePath);

              Thread.sleep(30000);
          }
      }
    `;

    const bootstrapCompile = compileJavaSync({
      source: bootstrapSource,
      javaPath,
      javaVersion: 8,
    });
    expect(bootstrapCompile.success).toBe(true);

    const bootstrapJar = join(tmpdir(), `bootstrap-${Date.now()}.jar`);
    writeJarFromClassesSync(bootstrapJar, bootstrapCompile.classes, {
      mainClass: 'org.exoproc.test.URLClassLoaderBootstrap',
    });

    const server = createIpcServer({
      name: `test_urlcl_${process.pid}_${Date.now()}`,
    });
    await server.listen();
    const client = new AgentClient({ server });

    const proc = spawn(
      [javaPath, '-jar', bootstrapJar, agent.jarPath, server.pipePath],
      {
        stdout: 'pipe',
        stderr: 'inherit',
      },
    );

    try {
      const ready = await waitForAgentReady(server, 15000);
      expect(ready).toBe(true);

      const status = await client.getStatus();
      expect(status.alive).toBe(true);
      expect(status.pipePath).toBe(server.pipePath);

      const classJson = await server.request('reflection/class', {
        name: 'java.lang.System',
      });
      expect(classJson.success).toBe(true);
      expect(classJson.name).toBe('java.lang.System');

      const evalJson = await client.eval(
        'java.lang.System.getProperty("java.version")',
      );
      expect(evalJson.success).toBe(true);
      expect(typeof evalJson.result).toBe('string');
      expect(evalJson.result!.length).toBeGreaterThan(0);
    } finally {
      proc.kill();
      await server.close();
      try {
        unlinkSync(bootstrapJar);
      } catch {}
    }
  }, 35000);

  it('injects single-class Exoproc in-memory (defineClass) over Named Pipe with ZERO disk JARs', async () => {
    const { bytecode, className } = getAgentBytecodeSync({
      javaVersion: 8,
      javaPath,
    });
    expect(className).toBe('org.exoproc.njava.agent.utils.Exoproc');
    expect(bytecode.length).toBeGreaterThan(15000);

    const tempBytecodeFile = join(
      tmpdir(),
      `exoproc-raw-bytecode-${Date.now()}.bin`,
    );
    writeFileSync(tempBytecodeFile, bytecode);

    const runnerSource = `
      package org.exoproc.test;
      import java.lang.reflect.Method;
      import java.nio.file.Files;
      import java.nio.file.Paths;

      public class InMemoryDefineClassRunner {
          public static void main(String[] args) throws Exception {
              String binPath = args[0];
              String pipePath = args[1];

              byte[] classBytes = Files.readAllBytes(Paths.get(binPath));

              ClassLoader cl = ClassLoader.getSystemClassLoader();
              Method defMethod = ClassLoader.class.getDeclaredMethod("defineClass", String.class, byte[].class, int.class, int.class);
              defMethod.setAccessible(true);
              Class<?> exoprocClass = (Class<?>) defMethod.invoke(cl, "org.exoproc.njava.agent.utils.Exoproc", classBytes, 0, classBytes.length);

              Method startMethod = exoprocClass.getMethod("start", String.class);
              startMethod.invoke(null, pipePath);

              Thread.sleep(30000);
          }
      }
    `;

    const runnerCompile = compileJavaSync({
      source: runnerSource,
      javaPath,
      javaVersion: 8,
    });
    expect(runnerCompile.success).toBe(true);

    const runnerJar = join(tmpdir(), `in-memory-runner-${Date.now()}.jar`);
    writeJarFromClassesSync(runnerJar, runnerCompile.classes, {
      mainClass: 'org.exoproc.test.InMemoryDefineClassRunner',
    });

    const server = createIpcServer({
      name: `test_memdef_${process.pid}_${Date.now()}`,
    });
    await server.listen();
    const client = new AgentClient({ server });

    const proc = spawn(
      [javaPath, '-jar', runnerJar, tempBytecodeFile, server.pipePath],
      {
        stdout: 'pipe',
        stderr: 'inherit',
      },
    );

    try {
      const ready = await waitForAgentReady(server, 15000);
      expect(ready).toBe(true);

      const status = await client.getStatus();
      expect(status.alive).toBe(true);
      expect(status.pipePath).toBe(server.pipePath);

      const evalJson = await client.eval('100 * 2 + 42');
      expect(evalJson.success).toBe(true);
      expect(evalJson.result).toBe('242');
    } finally {
      proc.kill();
      await server.close();
      try {
        unlinkSync(runnerJar);
      } catch {}
      try {
        unlinkSync(tempBytecodeFile);
      } catch {}
    }
  }, 35000);
});
