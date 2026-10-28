import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative } from 'node:path';
import { getDepsCacheDir, resolveOrDownloadDepSync } from 'exoproc-utils';
import { parseJavaVersion, type MappingPool } from 'exoproc-mappings';
import { parseJavaSource } from './parser.js';
import type { ObfuscationOptions } from './remapper.js';
import { obfuscateBytecode, obfuscateBytecodeSync } from './remapper.js';

export { parseJavaVersion };

export interface JavaCompileOptions {
  /**
   * Java source code string, JavaClassBuilder instance, or an object mapping relative file paths to source code.
   * Example: `public class MyHook implements Runnable { ... }` or `builder`
   */
  source: any | string | Record<string, string>;

  /**
   * Optional MappingPool for canonical type resolution and remapping.
   */
  pool?: MappingPool;

  /**
   * Optional manual class name (e.g. "Calculator"). When provided, avoids any regex searching in source code.
   */
  className?: string;

  /**
   * Optional manual package name (e.g. "org.exoproc.test").
   */
  packageName?: string;

  /**
   * Path or command to the `java` or `java.exe` binary.
   * Defaults to 'java' if available.
   */
  javaPath?: string;

  /**
   * Optional target directory where compiled `.class` files will be written.
   * If omitted, a temporary directory is used.
   */
  outputDir?: string;

  /**
   * Optional Java major version (e.g. 8, 17, 21).
   * If omitted, automatically probed using `${javaPath} -version`.
   */
  javaVersion?: number;

  /**
   * Classpath string (e.g. Minecraft jar and dependencies) or array of paths.
   */
  classPath?: string | string[];

  /**
   * Target Java bytecode version (e.g. "-1.8", "-17", "-21").
   * If omitted, automatically determined by javaVersion (< 17 defaults to "-1.8").
   */
  targetVersion?: string;

  /**
   * Optional source compliance level (e.g. "-1.8", "-17").
   */
  sourceVersion?: string;

  /**
   * Optional additional CLI arguments passed directly to ECJ.
   */
  additionalArgs?: string[];

  /**
   * Whether to strip debug symbols (LineNumberTable, LocalVariableTable, SourceFile)
   * using ECJ `-g:none`. Defaults to true when `obfuscate` is enabled.
   */
  stripDebug?: boolean;

  /**
   * Whether to obfuscate the compiled bytecode using tiny-remapper.
   * Can be boolean `true`, or an `ObfuscationOptions` object for detailed control.
   */
  obfuscate?: boolean | ObfuscationOptions;
}

export interface JavaCompileResult {
  /**
   * True if compilation succeeded with exit code 0.
   */
  success: boolean;

  /**
   * Absolute path to directory containing compiled `.class` files.
   */
  outputDir: string;

  /**
   * Synchronously reads all compiled `.class` files into a Map of FQCN -> Uint8Array bytecode.
   */
  readonly classes: Map<string, Uint8Array>;

  /**
   * Reads all compiled `.class` files from outputDir into a Map of FQCN -> Uint8Array.
   */
  readClasses: () => Promise<Map<string, Uint8Array>>;

  /**
   * Reads a single `.class` file's bytecode from outputDir.
   */
  readBytecode: (className?: string) => Promise<Uint8Array | undefined>;

  /**
   * The primary/main class name detected from the source code, if any.
   */
  mainClass?: string;

  /**
   * Array of error lines reported by ECJ on failure.
   */
  errors: string[];

  /**
   * Complete raw stdout/stderr output from the compiler.
   */
  output: string;

  /**
   * The Tiny v1 obfuscation mappings applied, if obfuscation was performed.
   */
  mappings?: string;
}

/**
 * Resolves the default java binary path from environment or system path.
 */
export function resolveDefaultJavaPath(): string {
  if (process.env.JAVA_HOME) {
    const bin = join(
      process.env.JAVA_HOME,
      'bin',
      process.platform === 'win32' ? 'java.exe' : 'java',
    );
    if (existsSync(bin)) return bin;
  }
  return 'java';
}

/**
 * Resolves the absolute path to the appropriate ECJ jar file based on the target Java version.
 */
export function resolveEcjJarPath(javaMajorVersion: number): string {
  const jarName = javaMajorVersion < 17 ? 'ecj-3.26.0.jar' : 'ecj-3.46.100.jar';
  const baseDir =
    import.meta.dirname || (import.meta as any).dir || process.cwd();

  // Check persistent central cache (~/.cache/exoproc/deps/jarName)
  try {
    const cached = join(getDepsCacheDir(), jarName);
    if (existsSync(cached)) {
      return resolve(cached);
    }
  } catch {}

  const candidateDirs = [
    // 1. Relative to baseDir (packages/jjit/src or packages/jjit/dist)
    join(baseDir, '..', 'deps'),
    join(baseDir, '..', 'dist'),
    join(baseDir, 'deps'),
    join(baseDir, 'dist'),
    baseDir,
    // 2. Relative to monorepo root / packages / cwd
    join(process.cwd(), 'packages', 'java', 'njava', 'deps'),
    join(process.cwd(), 'packages', 'java', 'njava', 'dist'),
    join(process.cwd(), 'packages', 'java', 'jjit', 'deps'),
    join(process.cwd(), 'packages', 'java', 'jjit', 'dist'),
    join(process.cwd(), 'packages', 'jjit', 'deps'),
    join(process.cwd(), 'packages', 'njava', 'deps'),
    join(process.cwd(), 'deps'),
    join(process.cwd(), 'vendor'),
  ];

  for (const dir of candidateDirs) {
    const candidate = join(dir, jarName);
    if (existsSync(candidate)) {
      return resolve(candidate);
    }
  }

  // Auto-download and cache on-demand on first use!
  try {
    const dep =
      javaMajorVersion < 17
        ? {
            name: 'ECJ 3.26.0 (Java 8)',
            version: '3.26.0',
            url: 'https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/3.26.0/ecj-3.26.0.jar',
            target: `deps/${jarName}`,
            sha1: '4837be609a3368a0f7e7cf0dc1bdbc7fe94993de',
          }
        : {
            name: 'ECJ 3.46.100 (Java 17+)',
            version: '3.46.100',
            url: 'https://repo1.maven.org/maven2/org/eclipse/jdt/ecj/3.46.100/ecj-3.46.100.jar',
            target: `deps/${jarName}`,
            sha1: 'a06c482cdb8601a94328aae668c7236e3818fbe9',
          };
    return resolveOrDownloadDepSync(dep);
  } catch {}

  throw new Error(
    `Could not locate ${jarName} in jjit deps. Ensure 'packages/jjit/deps/${jarName}' exists.`,
  );
}

/**
 * Probes the java binary version by running `${javaPath} -version`.
 */
export async function detectJavaVersion(
  javaPath: string = resolveDefaultJavaPath(),
): Promise<number> {
  try {
    const proc = Bun.spawn([javaPath, '-version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stderrText = await new Response(proc.stderr).text();
    const stdoutText = await new Response(proc.stdout).text();
    await proc.exited;

    const fullOutput = `${stdoutText}\n${stderrText}`;
    return parseJavaVersion(fullOutput);
  } catch {
    return 8;
  }
}

/**
 * Synchronously probes java version.
 */
export function detectJavaVersionSync(
  javaPath: string = resolveDefaultJavaPath(),
): number {
  try {
    const proc = Bun.spawnSync([javaPath, '-version']);
    const stdoutText = proc.stdout ? proc.stdout.toString() : '';
    const stderrText = proc.stderr ? proc.stderr.toString() : '';
    return parseJavaVersion(`${stdoutText}\n${stderrText}`);
  } catch {
    return 8;
  }
}

/**
 * Extracts the primary class and package name from a Java source code string.
 */
export function extractClassInfo(
  source: string,
  pool?: MappingPool,
): { className: string; packageName?: string; fqcn: string } {
  try {
    const builder = parseJavaSource(source, pool);
    return {
      className: builder.name,
      packageName: builder.packageName,
      fqcn: builder.fqcn,
    };
  } catch {
    const pkgMatch = source.match(/package\s+([a-zA-Z0-9_.]+)\s*;/);
    const packageName =
      pkgMatch && pkgMatch[1] ? pkgMatch[1].trim() : undefined;

    // Search for public class/interface/enum/record first
    const publicClassMatch = source.match(
      /public\s+(?:final\s+|abstract\s+)?(?:class|interface|enum|record)\s+([a-zA-Z0-9_]+)/,
    );
    let className =
      publicClassMatch && publicClassMatch[1] ? publicClassMatch[1].trim() : '';

    if (!className) {
      // Fallback to any class/interface/enum/record
      const anyClassMatch = source.match(
        /(?:class|interface|enum|record)\s+([a-zA-Z0-9_]+)/,
      );
      className =
        anyClassMatch && anyClassMatch[1]
          ? anyClassMatch[1].trim()
          : 'GeneratedClass';
    }

    const fqcn = packageName ? `${packageName}.${className}` : className;
    return { className, packageName, fqcn };
  }
}

/**
 * Synchronously or recursively collects all `.class` files in a directory and maps them to their FQCN.
 */
export function collectClassFilesSync(
  dir: string,
  baseDir: string,
  classesMap: Map<string, Uint8Array>,
): void {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      collectClassFilesSync(fullPath, baseDir, classesMap);
    } else if (stat.isFile() && entry.endsWith('.class')) {
      const rel = relative(baseDir, fullPath);
      const fqcn = rel.replace(/\.class$/, '').replace(/[\\/]/g, '.');
      const bytes = readFileSync(fullPath);
      classesMap.set(fqcn, new Uint8Array(bytes));
    }
  }
}

/**
 * Recursively collects all `.class` files in a directory and maps them to their FQCN.
 */
export async function collectClassFiles(
  dir: string,
  baseDir: string,
  classesMap: Map<string, Uint8Array>,
): Promise<void> {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      await collectClassFiles(fullPath, baseDir, classesMap);
    } else if (stat.isFile() && entry.endsWith('.class')) {
      const rel = relative(baseDir, fullPath);
      const fqcn = rel.replace(/\.class$/, '').replace(/[\\/]/g, '.');
      const bytes = await readFile(fullPath);
      classesMap.set(fqcn, new Uint8Array(bytes));
    }
  }
}

/**
 * Compiles Java source code to `.class` bytecode in a target directory using ECJ.
 */
export async function compileJava(
  options: JavaCompileOptions,
): Promise<JavaCompileResult> {
  if (!options.javaPath || typeof options.javaPath !== 'string') {
    throw new Error(
      'javaPath is required for compileJava. njava does not discover Java paths automatically.',
    );
  }
  const javaPath = options.javaPath;
  const hostVersion = await detectJavaVersion(javaPath);
  const javaVersion = options.javaVersion ?? hostVersion;
  const ecjJarPath = resolveEcjJarPath(
    hostVersion < 17 ? hostVersion : javaVersion,
  );
  let targetVersion =
    options.targetVersion ?? (javaVersion < 17 ? '-1.8' : `-${javaVersion}`);
  if (hostVersion < 17 && ecjJarPath.includes('ecj-3.26')) {
    const num = parseInt(targetVersion.replace(/^-/, ''), 10);
    if (!isNaN(num) && num > 15) {
      targetVersion = '-15';
    }
  }

  // Create temporary directory for source input files
  const tempDir = await mkdtemp(join(tmpdir(), 'jjit-ecj-src-'));
  const outDir = options.outputDir
    ? resolve(options.outputDir)
    : await mkdtemp(join(tmpdir(), 'jjit-classes-'));
  mkdirSync(outDir, { recursive: true });

  const filesToCompile: string[] = [];
  let mainClass: string | undefined;

  try {
    if (
      options.source &&
      typeof options.source === 'object' &&
      typeof options.source.toSource === 'function' &&
      options.source.name
    ) {
      // 1. Direct JavaClassBuilder! Zero regex needed.
      const className = options.className ?? options.source.name;
      const packageName = options.packageName ?? options.source.packageName;
      mainClass =
        options.source.fqcn ??
        (packageName ? `${packageName}.${className}` : className);
      const code = options.source.toSource();

      let fileDir = tempDir;
      if (packageName) {
        fileDir = join(tempDir, ...packageName.split('.'));
        mkdirSync(fileDir, { recursive: true });
      }
      const sourceFilePath = join(fileDir, `${className}.java`);
      writeFileSync(sourceFilePath, code, 'utf8');
      filesToCompile.push(sourceFilePath);
    } else if (typeof options.source === 'string') {
      // 2. String source with optional manual className/packageName (zero regex when provided)
      let className = options.className;
      let packageName = options.packageName;
      let code = options.source;
      if (!className) {
        const info = extractClassInfo(options.source, options.pool);
        className = info.className;
        packageName = packageName ?? info.packageName;
        mainClass = info.fqcn;
        if (options.pool) {
          try {
            const parsed = parseJavaSource(options.source, options.pool);
            code = parsed.toSource();
          } catch {}
        }
      } else {
        mainClass = packageName ? `${packageName}.${className}` : className;
      }

      let fileDir = tempDir;
      if (packageName) {
        fileDir = join(tempDir, ...packageName.split('.'));
        mkdirSync(fileDir, { recursive: true });
      }
      const sourceFilePath = join(fileDir, `${className}.java`);
      writeFileSync(sourceFilePath, code, 'utf8');
      filesToCompile.push(sourceFilePath);
    } else {
      for (const [relPath, content] of Object.entries(options.source)) {
        const filePath = join(tempDir, relPath);
        const parentDir = join(filePath, '..');
        mkdirSync(parentDir, { recursive: true });
        writeFileSync(filePath, content as string, 'utf8');
        filesToCompile.push(filePath);

        if (!mainClass) {
          const { fqcn } = extractClassInfo(content as string, options.pool);
          mainClass = fqcn;
        }
      }
    }

    const args = [
      javaPath,
      '-jar',
      ecjJarPath,
      targetVersion,
      '-encoding',
      'UTF-8',
      '-d',
      outDir,
    ];

    let srcVer = options.sourceVersion
      ? options.sourceVersion.replace(/^-/, '')
      : undefined;
    if (srcVer && hostVersion < 17 && ecjJarPath.includes('ecj-3.26')) {
      const num = parseInt(srcVer, 10);
      if (!isNaN(num) && num > 15) {
        srcVer = '15';
      }
    }
    if (srcVer) {
      args.push('-source', srcVer);
    }

    if (options.classPath) {
      const isWinTarget =
        process.platform === 'win32' ||
        javaPath.toLowerCase().endsWith('.exe') ||
        javaPath.includes('\\');
      const sep = isWinTarget ? ';' : ':';
      const cpString = Array.isArray(options.classPath)
        ? options.classPath.join(sep)
        : options.classPath;
      if (cpString.length > 0) {
        args.push('-cp', cpString);
      }
    }

    if (options.additionalArgs && options.additionalArgs.length > 0) {
      args.push(...options.additionalArgs);
    }

    const shouldStripDebug = options.stripDebug ?? Boolean(options.obfuscate);
    if (shouldStripDebug) {
      if (!args.includes('-g:none')) {
        args.push('-g:none');
      }
      if (!args.includes('-nowarn')) {
        args.push('-nowarn');
      }
    }

    args.push(...filesToCompile);

    const proc = Bun.spawn(args, {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdoutText = await new Response(proc.stdout).text();
    const stderrText = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const fullOutput = `${stdoutText}\n${stderrText}`.trim();

    const errors: string[] = [];
    if (exitCode !== 0) {
      for (const line of stderrText.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          errors.push(trimmed);
        }
      }
    }

    let cachedClasses: Map<string, Uint8Array> | undefined;
    let appliedMappings: string | undefined;

    if (exitCode === 0 && options.obfuscate) {
      const obfOpts =
        typeof options.obfuscate === 'object' ? options.obfuscate : {};
      const remapRes = await obfuscateBytecode(outDir, {
        ...obfOpts,
        javaPath,
        classPath: options.classPath,
      });
      appliedMappings = remapRes.mappings;
      if (remapRes.success && remapRes.classes.size > 0) {
        cachedClasses = remapRes.classes;
        for (const [fqcn, bytes] of remapRes.classes.entries()) {
          const p = join(outDir, ...fqcn.split('.')) + '.class';
          mkdirSync(join(p, '..'), { recursive: true });
          writeFileSync(p, bytes);
        }
      }
    }

    return {
      success: exitCode === 0,
      outputDir: outDir,
      mainClass,
      errors,
      output: fullOutput,
      mappings: appliedMappings,
      readClasses: async () => {
        const map = new Map<string, Uint8Array>();
        if (exitCode === 0 && existsSync(outDir)) {
          await collectClassFiles(outDir, outDir, map);
        }
        return map;
      },
      readBytecode: async (className?: string) => {
        const targetName = className ?? mainClass;
        if (!targetName) return undefined;
        const classPath = join(outDir, ...targetName.split('.')) + '.class';
        if (!existsSync(classPath)) return undefined;
        const bytes = await readFile(classPath);
        return new Uint8Array(bytes);
      },
      get classes() {
        if (!cachedClasses) {
          cachedClasses = new Map<string, Uint8Array>();
          if (exitCode === 0 && existsSync(outDir)) {
            collectClassFilesSync(outDir, outDir, cachedClasses);
          }
        }
        return cachedClasses;
      },
    };
  } finally {
    rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Synchronous version of compileJava.
 */
export function compileJavaSync(
  options: JavaCompileOptions,
): JavaCompileResult {
  if (!options.javaPath || typeof options.javaPath !== 'string') {
    throw new Error(
      'javaPath is required for compileJavaSync. njava does not discover Java paths automatically.',
    );
  }
  const javaPath = options.javaPath;
  const hostVersion = detectJavaVersionSync(javaPath);
  const javaVersion = options.javaVersion ?? hostVersion;
  const ecjJarPath = resolveEcjJarPath(
    hostVersion < 17 ? hostVersion : javaVersion,
  );
  let targetVersion =
    options.targetVersion ?? (javaVersion < 17 ? '-1.8' : `-${javaVersion}`);
  if (hostVersion < 17 && ecjJarPath.includes('ecj-3.26')) {
    const num = parseInt(targetVersion.replace(/^-/, ''), 10);
    if (!isNaN(num) && num > 15) {
      targetVersion = '-15';
    }
  }

  const tempDir = join(
    tmpdir(),
    `jjit-ecj-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tempDir, { recursive: true });

  const outDir = options.outputDir
    ? resolve(options.outputDir)
    : join(
        tmpdir(),
        `jjit-classes-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      );
  mkdirSync(outDir, { recursive: true });

  const filesToCompile: string[] = [];
  let mainClass: string | undefined;

  try {
    if (
      options.source &&
      typeof options.source === 'object' &&
      typeof options.source.toSource === 'function' &&
      options.source.name
    ) {
      // 1. Direct JavaClassBuilder! Zero regex needed.
      const className = options.className ?? options.source.name;
      const packageName = options.packageName ?? options.source.packageName;
      mainClass =
        options.source.fqcn ??
        (packageName ? `${packageName}.${className}` : className);
      const code = options.source.toSource();

      let fileDir = tempDir;
      if (packageName) {
        fileDir = join(tempDir, ...packageName.split('.'));
        mkdirSync(fileDir, { recursive: true });
      }
      const sourceFilePath = join(fileDir, `${className}.java`);
      writeFileSync(sourceFilePath, code, 'utf8');
      filesToCompile.push(sourceFilePath);
    } else if (typeof options.source === 'string') {
      // 2. String source with optional manual className/packageName (zero regex when provided)
      let className = options.className;
      let packageName = options.packageName;
      let code = options.source;
      if (!className) {
        const info = extractClassInfo(options.source, options.pool);
        className = info.className;
        packageName = packageName ?? info.packageName;
        mainClass = info.fqcn;
        if (options.pool) {
          try {
            const parsed = parseJavaSource(options.source, options.pool);
            code = parsed.toSource();
          } catch {}
        }
      } else {
        mainClass = packageName ? `${packageName}.${className}` : className;
      }

      let fileDir = tempDir;
      if (packageName) {
        fileDir = join(tempDir, ...packageName.split('.'));
        mkdirSync(fileDir, { recursive: true });
      }
      const sourceFilePath = join(fileDir, `${className}.java`);
      writeFileSync(sourceFilePath, code, 'utf8');
      filesToCompile.push(sourceFilePath);
    } else {
      for (const [relPath, content] of Object.entries(options.source)) {
        const filePath = join(tempDir, relPath);
        const parentDir = join(filePath, '..');
        mkdirSync(parentDir, { recursive: true });
        writeFileSync(filePath, content as string, 'utf8');
        filesToCompile.push(filePath);

        if (!mainClass) {
          const { fqcn } = extractClassInfo(content as string, options.pool);
          mainClass = fqcn;
        }
      }
    }

    const args = [
      javaPath,
      '-jar',
      ecjJarPath,
      targetVersion,
      '-encoding',
      'UTF-8',
      '-d',
      outDir,
    ];

    let srcVer = options.sourceVersion
      ? options.sourceVersion.replace(/^-/, '')
      : undefined;
    if (srcVer && hostVersion < 17 && ecjJarPath.includes('ecj-3.26')) {
      const num = parseInt(srcVer, 10);
      if (!isNaN(num) && num > 15) {
        srcVer = '15';
      }
    }
    if (srcVer) {
      args.push('-source', srcVer);
    }

    if (options.classPath) {
      const isWinTarget =
        process.platform === 'win32' ||
        javaPath.toLowerCase().endsWith('.exe') ||
        javaPath.includes('\\');
      const sep = isWinTarget ? ';' : ':';
      const cpString = Array.isArray(options.classPath)
        ? options.classPath.join(sep)
        : options.classPath;
      if (cpString.length > 0) {
        args.push('-cp', cpString);
      }
    }

    if (options.additionalArgs && options.additionalArgs.length > 0) {
      args.push(...options.additionalArgs);
    }

    const shouldStripDebug = options.stripDebug ?? Boolean(options.obfuscate);
    if (shouldStripDebug) {
      if (!args.includes('-g:none')) {
        args.push('-g:none');
      }
      if (!args.includes('-nowarn')) {
        args.push('-nowarn');
      }
    }

    args.push(...filesToCompile);

    const proc = Bun.spawnSync(args);
    const stdoutText = proc.stdout ? proc.stdout.toString() : '';
    const stderrText = proc.stderr ? proc.stderr.toString() : '';
    const exitCode = proc.exitCode;
    const fullOutput = `${stdoutText}\n${stderrText}`.trim();

    const errors: string[] = [];
    if (exitCode !== 0) {
      for (const line of stderrText.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0) {
          errors.push(trimmed);
        }
      }
    }

    let cachedClasses: Map<string, Uint8Array> | undefined;
    let appliedMappings: string | undefined;

    if (exitCode === 0 && options.obfuscate) {
      const obfOpts =
        typeof options.obfuscate === 'object' ? options.obfuscate : {};
      const remapRes = obfuscateBytecodeSync(outDir, {
        ...obfOpts,
        javaPath,
        classPath: options.classPath,
      });
      appliedMappings = remapRes.mappings;
      if (remapRes.success && remapRes.classes.size > 0) {
        cachedClasses = remapRes.classes;
        for (const [fqcn, bytes] of remapRes.classes.entries()) {
          const p = join(outDir, ...fqcn.split('.')) + '.class';
          mkdirSync(join(p, '..'), { recursive: true });
          writeFileSync(p, bytes);
        }
      }
    }

    return {
      success: exitCode === 0,
      outputDir: outDir,
      mainClass,
      errors,
      output: fullOutput,
      mappings: appliedMappings,
      readClasses: async () => {
        const map = new Map<string, Uint8Array>();
        if (exitCode === 0 && existsSync(outDir)) {
          await collectClassFiles(outDir, outDir, map);
        }
        return map;
      },
      readBytecode: async (className?: string) => {
        const targetName = className ?? mainClass;
        if (!targetName) return undefined;
        const classPath = join(outDir, ...targetName.split('.')) + '.class';
        if (!existsSync(classPath)) return undefined;
        const bytes = await readFile(classPath);
        return new Uint8Array(bytes);
      },
      get classes() {
        if (!cachedClasses) {
          cachedClasses = new Map<string, Uint8Array>();
          if (exitCode === 0 && existsSync(outDir)) {
            collectClassFilesSync(outDir, outDir, cachedClasses);
          }
        }
        return cachedClasses;
      },
    };
  } finally {
    rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
