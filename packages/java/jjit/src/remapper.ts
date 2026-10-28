import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getDepsCacheDir, resolveOrDownloadDepSync } from 'exoproc-utils';
import {
  collectClassFilesSync,
  type JavaCompileResult,
  resolveDefaultJavaPath,
} from './compiler.js';
import { parseClassBytecode } from './class-parser.js';

export interface JavaRemapOptions {
  /**
   * Input to remap:
   * - A directory path containing .class files
   * - A .class or .jar file path
   * - A Map of binary class name to bytecode Uint8Array
   * - A single Uint8Array of class bytecode
   * - A JavaCompileResult returned from compileJava / compileJavaSync
   */
  input: string | Uint8Array | Map<string, Uint8Array> | JavaCompileResult;

  /**
   * Mappings source:
   * - Path to a .tiny, .tsrg, or mapping file
   * - A string in Tiny v1 format
   * - A JSON mapping object (e.g. mappings-1.8.9.json)
   * - A MappingPool instance
   */
  mappings?: string | Record<string, any> | any;

  /**
   * Path or command to the `java` binary.
   */
  javaPath?: string;

  /**
   * Classpath entries (directories or jars) providing referenced classes.
   */
  classPath?: string | string[];

  /**
   * Source namespace in mappings (defaults to 'named').
   */
  from?: string;

  /**
   * Target namespace in mappings (defaults to 'official').
   */
  to?: string;

  /**
   * Optional directory where remapped .class files will be written.
   * If omitted, a temporary directory is created.
   */
  outputDir?: string;

  /**
   * Path to the tiny-remapper fat jar. If omitted, automatically resolved from deps.
   */
  remapperJarPath?: string;

  /**
   * Additional arguments passed to Tiny-Remapper CLI.
   * Defaults to ['--ignoreConflicts', '--ignoreFieldDesc'].
   */
  additionalArgs?: string[];
}

export interface JavaRemapResult {
  success: boolean;
  outputDir: string;
  classes: Map<string, Uint8Array>;
  readClasses: () => Promise<Map<string, Uint8Array>>;
  readBytecode: (className?: string) => Promise<Uint8Array | undefined>;
  errors: string[];
  output: string;
  /**
   * The Tiny v1 mapping content used for remapping.
   */
  mappings?: string;
}

export interface ObfuscationOptions {
  /**
   * Path or command to the `java` binary.
   */
  javaPath?: string;

  /**
   * Classpath entries (directories or jars) providing referenced classes.
   */
  classPath?: string | string[];

  /**
   * Optional file path where obfuscation mappings should be written (.tiny or .txt).
   */
  exportMappingsPath?: string;

  /**
   * Method names to preserve/keep from being remapped.
   * Standard Java methods like <init>, <clinit>, equals, hashCode, toString, main, premain, agentmain, etc.
   * are kept by default.
   */
  keepMethods?: string[] | Set<string>;

  /**
   * Field names to preserve/keep from being remapped.
   */
  keepFields?: string[] | Set<string>;

  /**
   * Whether to obfuscate private fields. Defaults to true.
   */
  obfuscatePrivateFields?: boolean;

  /**
   * Whether to obfuscate private methods. Defaults to true.
   */
  obfuscatePrivateMethods?: boolean;

  /**
   * Whether to obfuscate package-private (default visibility) members. Defaults to false.
   */
  obfuscatePackagePrivate?: boolean;

  /**
   * Optional custom prefix for obfuscated identifiers (e.g. '' or 'm_').
   */
  prefix?: string;

  /**
   * Additional arguments passed to Tiny-Remapper.
   */
  additionalArgs?: string[];
}

export const DEFAULT_KEEP_METHODS = new Set<string>([
  '<init>',
  '<clinit>',
  'equals',
  'hashCode',
  'toString',
  'clone',
  'finalize',
  'compareTo',
  'main',
  'premain',
  'agentmain',
  'start',
  'stop',
  'shutdown',
  'getInstance',
  'handle',
  'run',
  'call',
  'close',
  'getPid',
  'isAttached',
  'getTargetName',
  'defineClass',
  'newInstance',
  'dispatchCallback',
  'completeCallback',
]);

export const DEFAULT_KEEP_FIELDS = new Set<string>(['serialVersionUID']);

/**
 * Converts a 0-based integer to an alphabetic identifier (a, b, ..., z, aa, ab, ...).
 */
export function toAlphaIdentifier(index: number): string {
  let result = '';
  let n = index;
  do {
    const rem = n % 26;
    result = String.fromCharCode(97 + rem) + result;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return result;
}

const PRIMITIVE_DESCRIPTORS: Record<string, string> = {
  int: 'I',
  float: 'F',
  double: 'D',
  long: 'J',
  boolean: 'Z',
  byte: 'B',
  short: 'S',
  char: 'C',
  void: 'V',
};

const STANDARD_TYPE_DESCRIPTORS: Record<string, string> = {
  String: 'java/lang/String',
  Object: 'java/lang/Object',
  Runnable: 'java/lang/Runnable',
  Comparable: 'java/lang/Comparable',
  List: 'java/util/List',
  Map: 'java/util/Map',
  Set: 'java/util/Set',
  UUID: 'java/util/UUID',
};

export const STANDARD_CANONICAL_CLASSES: Record<string, string> = {
  Minecraft: 'net.minecraft.client.Minecraft',
  EntityPlayerSP: 'net.minecraft.client.entity.EntityPlayerSP',
  EntityPlayer: 'net.minecraft.entity.player.EntityPlayer',
  EntityLivingBase: 'net.minecraft.entity.EntityLivingBase',
  Entity: 'net.minecraft.entity.Entity',
  World: 'net.minecraft.world.World',
  WorldClient: 'net.minecraft.client.multiplayer.WorldClient',
  GameSettings: 'net.minecraft.client.settings.GameSettings',
  PlayerControllerMP: 'net.minecraft.client.multiplayer.PlayerControllerMP',
  GuiScreen: 'net.minecraft.client.gui.GuiScreen',
  GuiButton: 'net.minecraft.client.gui.GuiButton',
  FontRenderer: 'net.minecraft.client.gui.FontRenderer',
  RenderGlobal: 'net.minecraft.client.renderer.RenderGlobal',
  RenderItem: 'net.minecraft.client.renderer.entity.RenderItem',
  EntityRenderer: 'net.minecraft.client.renderer.EntityRenderer',
  RenderManager: 'net.minecraft.client.renderer.entity.RenderManager',
  NetHandlerPlayClient: 'net.minecraft.client.network.NetHandlerPlayClient',
  MovingObjectPosition: 'net.minecraft.util.MovingObjectPosition',
  MovingObjectType: 'net.minecraft.util.MovingObjectPosition.MovingObjectType',
  Timer: 'net.minecraft.util.Timer',
  Session: 'net.minecraft.util.Session',
  ItemStack: 'net.minecraft.item.ItemStack',
  Item: 'net.minecraft.item.Item',
  Block: 'net.minecraft.block.Block',
  BlockPos: 'net.minecraft.util.BlockPos',
  Vec3: 'net.minecraft.util.Vec3',
  Vec3i: 'net.minecraft.util.Vec3i',
};

/**
 * Resolves the absolute path to the tiny-remapper fat jar.
 */
export function resolveTinyRemapperJarPath(): string {
  const jarName = 'tiny-remapper-0.14.1-fat.jar';

  // 1. Check persistent central cache (~/.cache/exoproc/deps/jarName)
  try {
    const cached = join(getDepsCacheDir(), jarName);
    if (existsSync(cached)) {
      return resolve(cached);
    }
  } catch {}

  const baseDir =
    import.meta.dirname || (import.meta as any).dir || process.cwd();
  const candidateDirs = [
    join(baseDir, '..', 'deps'),
    join(baseDir, '..', 'dist'),
    join(baseDir, 'deps'),
    join(baseDir, 'dist'),
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
    return resolveOrDownloadDepSync({
      name: 'Tiny-Remapper 0.14.1 (Fat)',
      version: '0.14.1',
      url: 'https://maven.fabricmc.net/net/fabricmc/tiny-remapper/0.14.1/tiny-remapper-0.14.1-fat.jar',
      target: `deps/${jarName}`,
      sha1: '0cae38cf0446be5f17f8cb58df8fdfac56aabcbd',
    });
  } catch {}

  throw new Error(
    `Could not locate ${jarName} in jjit deps. Ensure 'packages/jjit/deps/${jarName}' exists.`,
  );
}

/**
 * Converts a Java type string into a JVM bytecode descriptor.
 */
export function typeToBytecodeDescriptor(
  typeStr: string,
  classCatalog: Record<string, string> = {},
): string {
  if (!typeStr) return 'V';

  let dims = '';
  let baseType = typeStr.trim();
  while (baseType.endsWith('[]')) {
    dims += '[';
    baseType = baseType.slice(0, -2).trim();
  }

  const prim = PRIMITIVE_DESCRIPTORS[baseType];
  if (prim) {
    return `${dims}${prim}`;
  }

  const std = STANDARD_TYPE_DESCRIPTORS[baseType];
  if (std) {
    return `${dims}L${std};`;
  }

  if (baseType.includes('.')) {
    return `${dims}L${baseType.replace(/\./g, '/')};`;
  }

  if (baseType.includes('/')) {
    return `${dims}L${baseType};`;
  }

  const resolvedCanonical =
    classCatalog[baseType] || STANDARD_CANONICAL_CLASSES[baseType];
  if (resolvedCanonical) {
    return `${dims}L${resolvedCanonical.replace(/\./g, '/')};`;
  }

  return `${dims}L${baseType};`;
}

/**
 * Serializes mapping structures into standard Tiny v1 format.
 */
export function exportToTinyV1(
  mappings: Record<string, any> | any,
  from = 'named',
  to = 'official',
): string {
  const lines: string[] = [`v1\t${from}\t${to}`];

  // MappingPool export
  if (mappings && typeof mappings.getAllDetected === 'function') {
    const seenFrom = new Set<string>();
    const seenTo = new Set<string>();
    for (const detected of mappings.getAllDetected()) {
      if (
        !detected.canonicalName ||
        !detected.realClassName ||
        detected.canonicalName === detected.realClassName
      )
        continue;
      const fromCls = detected.canonicalName.replace(/\./g, '/');
      const toCls = detected.realClassName.replace(/\./g, '/');
      if (seenFrom.has(fromCls) || seenTo.has(toCls)) continue;
      seenFrom.add(fromCls);
      seenTo.add(toCls);
      lines.push(`CLASS\t${fromCls}\t${toCls}`);

      if (detected.fields) {
        for (const [deobfF, obfF] of Object.entries(detected.fields)) {
          if (obfF && obfF !== deobfF) {
            lines.push(
              `FIELD\t${fromCls}\tLjava/lang/Object;\t${deobfF}\t${obfF}`,
            );
          }
        }
      }
      if (detected.methods) {
        for (const [deobfM, obfM] of Object.entries(detected.methods)) {
          if (obfM && obfM !== deobfM) {
            lines.push(`METHOD\t${fromCls}\t()V\t${deobfM}\t${obfM}`);
          }
        }
      }
    }
    return lines.join('\n') + '\n';
  }

  // JavaMappingRegistry export
  if (
    mappings &&
    (typeof mappings.getDatabase === 'function' ||
      mappings.classMappings instanceof Map)
  ) {
    const db =
      typeof mappings.getDatabase === 'function'
        ? mappings.getDatabase()
        : (mappings.database ?? {});
    const classMappings: Map<string, any> = mappings.classMappings ?? new Map();
    const seen = new Set<string>();
    const seenFrom = new Set<string>();
    const seenTo = new Set<string>();

    for (const mapping of classMappings.values()) {
      if (!mapping || !mapping.obfName || mapping.obfName === mapping.deobfName)
        continue;
      const shortName = mapping.deobfName.split('.').pop()!;
      const classSchema = db?.[shortName] ?? db?.[mapping.deobfName] ?? {};
      const canonical =
        classSchema.canonicalClassName ??
        (mapping.deobfName.includes('.') ? mapping.deobfName : shortName);
      const fromCls = canonical.replace(/\./g, '/');
      const toCls = mapping.obfName.replace(/\./g, '/');
      if (seen.has(canonical) || seenFrom.has(fromCls) || seenTo.has(toCls))
        continue;
      seen.add(canonical);
      seenFrom.add(fromCls);
      seenTo.add(toCls);

      lines.push(`CLASS\t${fromCls}\t${toCls}`);

      if (mapping.deobfToObfFields instanceof Map) {
        for (const [deobfF, obfF] of mapping.deobfToObfFields.entries()) {
          if (obfF && obfF !== deobfF && classSchema.fields?.[deobfF]) {
            const rawType = classSchema.fields[deobfF];
            const fType =
              typeof rawType === 'string'
                ? rawType
                : (rawType?.type ?? 'Object');
            const desc = typeToBytecodeDescriptor(fType);
            lines.push(`FIELD\t${fromCls}\t${desc}\t${deobfF}\t${obfF}`);
          }
        }
      }

      if (mapping.deobfToObfMethods instanceof Map) {
        for (const [deobfM, obfM] of mapping.deobfToObfMethods.entries()) {
          if (obfM && obfM !== deobfM && classSchema.methods?.[deobfM]) {
            const rawM = classSchema.methods[deobfM];
            let desc = '()V';
            if (rawM && typeof rawM === 'object') {
              const params = (rawM.params ?? [])
                .map((p: string) => typeToBytecodeDescriptor(p))
                .join('');
              const ret = typeToBytecodeDescriptor(rawM.returnType ?? 'void');
              desc = `(${params})${ret}`;
            }
            lines.push(`METHOD\t${fromCls}\t${desc}\t${deobfM}\t${obfM}`);
          }
        }
      }
    }

    return lines.join('\n') + '\n';
  }

  // Generic JSON mappings export
  const classMap: Record<string, any> = mappings.classes ?? mappings;
  const classCatalog: Record<string, string> = {
    ...STANDARD_CANONICAL_CLASSES,
  };

  for (const [k, v] of Object.entries(classMap)) {
    if (v?.canonical && v.canonical.includes('.')) {
      classCatalog[k] = v.canonical;
      const simple = v.canonical.split('.').pop()!;
      classCatalog[simple] = v.canonical;
    } else if (k.includes('.')) {
      classCatalog[k] = k;
      const simple = k.split('.').pop()!;
      classCatalog[simple] = k;
    }
  }

  // Sort entries: FQCNs (containing '.') first so they take precedence over short names
  const entries = Object.entries(classMap).sort(([k1, v1], [k2, v2]) => {
    const isFqcn1 =
      k1.includes('.') || Boolean(v1?.canonical && v1.canonical.includes('.'));
    const isFqcn2 =
      k2.includes('.') || Boolean(v2?.canonical && v2.canonical.includes('.'));
    if (isFqcn1 && !isFqcn2) return -1;
    if (!isFqcn1 && isFqcn2) return 1;
    return 0;
  });

  const seenFrom = new Set<string>();
  const seenTo = new Set<string>();

  for (const [className, info] of entries) {
    const canonicalName =
      info.canonical && info.canonical.includes('.')
        ? info.canonical
        : classCatalog[className] ||
          (info.canonical && classCatalog[info.canonical]) ||
          (className.includes('.') ? className : (info.canonical ?? className));

    const obfName = info.obf ?? info.realClassName;
    if (!obfName || obfName === canonicalName) continue;

    const fromCls = canonicalName.replace(/\./g, '/');
    const toCls = obfName.replace(/\./g, '/');

    // Tiny Remapper requires unique 1:1 class mappings
    if (seenFrom.has(fromCls) || seenTo.has(toCls)) continue;
    seenFrom.add(fromCls);
    seenTo.add(toCls);

    lines.push(`CLASS\t${fromCls}\t${toCls}`);

    if (info.fields && typeof info.fields === 'object') {
      const seenF = new Set<string>();
      for (const [fName, fValRaw] of Object.entries(info.fields)) {
        const fVal: any = fValRaw;
        const obfF =
          typeof fVal === 'string' ? fVal : (fVal?.obf ?? fVal?.realName);
        const fType =
          typeof fVal === 'object' && fVal?.type ? fVal.type : 'Object';
        if (obfF && obfF !== fName && !seenF.has(fName)) {
          seenF.add(fName);
          const desc = typeToBytecodeDescriptor(fType, classCatalog);
          lines.push(`FIELD\t${fromCls}\t${desc}\t${fName}\t${obfF}`);
        }
      }
    }

    if (info.methods && typeof info.methods === 'object') {
      const seenM = new Set<string>();
      for (const [mName, mValRaw] of Object.entries(info.methods)) {
        const mVal: any = mValRaw;
        const obfM =
          typeof mVal === 'string' ? mVal : (mVal?.obf ?? mVal?.realName);
        if (obfM && obfM !== mName) {
          let desc = '()V';
          if (typeof mVal === 'object' && (mVal?.params || mVal?.returnType)) {
            const params = (mVal.params ?? [])
              .map((p: string) => typeToBytecodeDescriptor(p, classCatalog))
              .join('');
            const ret = typeToBytecodeDescriptor(
              mVal.returnType ?? 'void',
              classCatalog,
            );
            desc = `(${params})${ret}`;
          }
          const mKey = `${mName}${desc}`;
          if (!seenM.has(mKey)) {
            seenM.add(mKey);
            lines.push(`METHOD\t${fromCls}\t${desc}\t${mName}\t${obfM}`);
          }
        }
      }
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Remaps compiled Java bytecode using Tiny-Remapper.
 */
export async function remapJava(
  options: JavaRemapOptions,
): Promise<JavaRemapResult> {
  const javaPath = options.javaPath ?? resolveDefaultJavaPath();
  const remapperJar = options.remapperJarPath ?? resolveTinyRemapperJarPath();
  const from = options.from ?? 'named';
  const to = options.to ?? 'official';

  const tempDir = join(
    tmpdir(),
    `jjit-remap-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tempDir, { recursive: true });

  let inputDir = join(tempDir, 'input');
  mkdirSync(inputDir, { recursive: true });

  const outDir = options.outputDir
    ? resolve(options.outputDir)
    : join(tempDir, 'output');
  mkdirSync(outDir, { recursive: true });

  try {
    // 1. Prepare input class files
    if (typeof options.input === 'string') {
      if (existsSync(options.input)) {
        const st = statSync(options.input);
        if (st.isDirectory()) {
          inputDir = options.input;
        } else {
          const dest = join(inputDir, options.input.split(/[/\\]/).pop()!);
          copyFileSync(options.input, dest);
        }
      }
    } else if (options.input instanceof Map) {
      for (const [fqcn, bytes] of options.input.entries()) {
        const p = join(inputDir, ...fqcn.split('.')) + '.class';
        mkdirSync(join(p, '..'), { recursive: true });
        writeFileSync(p, bytes);
      }
    } else if (options.input instanceof Uint8Array) {
      const p = join(inputDir, 'RemapTarget.class');
      writeFileSync(p, options.input);
    } else if (
      'classes' in options.input &&
      options.input.classes instanceof Map
    ) {
      for (const [fqcn, bytes] of options.input.classes.entries()) {
        const p = join(inputDir, ...fqcn.split('.')) + '.class';
        mkdirSync(join(p, '..'), { recursive: true });
        writeFileSync(p, bytes);
      }
    }

    // 2. Prepare mapping file
    let mappingFile: string;
    let tinyContent = '';
    if (typeof options.mappings === 'string' && existsSync(options.mappings)) {
      mappingFile = options.mappings;
      try {
        tinyContent = readFileSync(options.mappings, 'utf8');
      } catch {}
    } else {
      tinyContent =
        typeof options.mappings === 'string'
          ? options.mappings
          : exportToTinyV1(options.mappings ?? {}, from, to);
      mappingFile = join(tempDir, 'mappings.tiny');
      writeFileSync(mappingFile, tinyContent, 'utf8');
    }

    const args = [
      javaPath,
      '-jar',
      remapperJar,
      inputDir,
      outDir,
      mappingFile,
      from,
      to,
    ];

    if (options.classPath) {
      const sep =
        process.platform === 'win32' || javaPath.includes('\\') ? ';' : ':';
      const cpEntries = Array.isArray(options.classPath)
        ? options.classPath.flatMap((p) => p.split(sep))
        : options.classPath.split(sep);
      for (const cp of cpEntries) {
        if (cp.trim()) args.push(cp.trim());
      }
    }

    args.push('--ignoreConflicts');

    if (options.additionalArgs) {
      args.push(...options.additionalArgs);
    }

    const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const code = await proc.exited;

    const classes = new Map<string, Uint8Array>();
    if (code === 0 && existsSync(outDir)) {
      collectClassFilesSync(outDir, outDir, classes);
    }

    return {
      success: code === 0,
      outputDir: outDir,
      classes,
      mappings: tinyContent || undefined,
      readClasses: async () => classes,
      readBytecode: async (className?: string) => {
        if (!className) return classes.values().next().value;
        return classes.get(className);
      },
      errors: stderr ? stderr.split('\n').filter(Boolean) : [],
      output: `${stdout}\n${stderr}`.trim(),
    };
  } finally {
    if (!options.outputDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * Synchronous version of remapJava using spawnSync.
 */
export function remapJavaSync(options: JavaRemapOptions): JavaRemapResult {
  const javaPath = options.javaPath ?? resolveDefaultJavaPath();
  const remapperJar = options.remapperJarPath ?? resolveTinyRemapperJarPath();
  const from = options.from ?? 'named';
  const to = options.to ?? 'official';

  const tempDir = join(
    tmpdir(),
    `jjit-remap-sync-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tempDir, { recursive: true });

  let inputDir = join(tempDir, 'input');
  mkdirSync(inputDir, { recursive: true });

  const outDir = options.outputDir
    ? resolve(options.outputDir)
    : join(tempDir, 'output');
  mkdirSync(outDir, { recursive: true });

  try {
    if (typeof options.input === 'string') {
      if (existsSync(options.input)) {
        const st = statSync(options.input);
        if (st.isDirectory()) {
          inputDir = options.input;
        } else {
          const dest = join(inputDir, options.input.split(/[/\\]/).pop()!);
          copyFileSync(options.input, dest);
        }
      }
    } else if (options.input instanceof Map) {
      for (const [fqcn, bytes] of options.input.entries()) {
        const p = join(inputDir, ...fqcn.split('.')) + '.class';
        mkdirSync(join(p, '..'), { recursive: true });
        writeFileSync(p, bytes);
      }
    } else if (options.input instanceof Uint8Array) {
      const p = join(inputDir, 'RemapTarget.class');
      writeFileSync(p, options.input);
    } else if (
      'classes' in options.input &&
      options.input.classes instanceof Map
    ) {
      for (const [fqcn, bytes] of options.input.classes.entries()) {
        const p = join(inputDir, ...fqcn.split('.')) + '.class';
        mkdirSync(join(p, '..'), { recursive: true });
        writeFileSync(p, bytes);
      }
    }

    let mappingFile: string;
    let tinyContent = '';
    if (typeof options.mappings === 'string' && existsSync(options.mappings)) {
      mappingFile = options.mappings;
      try {
        tinyContent = readFileSync(options.mappings, 'utf8');
      } catch {}
    } else {
      tinyContent =
        typeof options.mappings === 'string'
          ? options.mappings
          : exportToTinyV1(options.mappings ?? {}, from, to);
      mappingFile = join(tempDir, 'mappings.tiny');
      writeFileSync(mappingFile, tinyContent, 'utf8');
    }

    const args = ['-jar', remapperJar, inputDir, outDir, mappingFile, from, to];

    if (options.classPath) {
      const sep =
        process.platform === 'win32' || javaPath.includes('\\') ? ';' : ':';
      const cpEntries = Array.isArray(options.classPath)
        ? options.classPath.flatMap((p) => p.split(sep))
        : options.classPath.split(sep);
      for (const cp of cpEntries) {
        if (cp.trim()) args.push(cp.trim());
      }
    }

    args.push('--ignoreConflicts');

    if (options.additionalArgs) {
      args.push(...options.additionalArgs);
    }

    const result = spawnSync(javaPath, args, {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    const code = result.status ?? (result.error ? 1 : 0);
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';

    const classes = new Map<string, Uint8Array>();
    if (code === 0 && existsSync(outDir)) {
      collectClassFilesSync(outDir, outDir, classes);
    }

    return {
      success: code === 0,
      outputDir: outDir,
      classes,
      mappings: tinyContent || undefined,
      readClasses: async () => classes,
      readBytecode: async (className?: string) => {
        if (!className) return classes.values().next().value;
        return classes.get(className);
      },
      errors: stderr ? stderr.split('\n').filter(Boolean) : [],
      output: `${stdout}\n${stderr}`.trim(),
    };
  } finally {
    if (!options.outputDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function extractBytecodeList(input: any): Uint8Array[] {
  if (!input) return [];
  if (input instanceof Uint8Array || Buffer.isBuffer(input)) {
    return [input];
  }
  if (input instanceof Map) {
    return Array.from(input.values());
  }
  if (typeof input === 'object') {
    if ('classes' in input && input.classes instanceof Map) {
      return Array.from(input.classes.values());
    }
    const vals = Object.values(input);
    const byteArrays = vals.filter(
      (v): v is Uint8Array => v instanceof Uint8Array || Buffer.isBuffer(v),
    );
    if (byteArrays.length > 0) return byteArrays;
  }
  if (typeof input === 'string' && existsSync(input)) {
    const stat = statSync(input);
    if (stat.isDirectory()) {
      const map = new Map<string, Uint8Array>();
      collectClassFilesSync(input, input, map);
      return Array.from(map.values());
    } else if (input.endsWith('.class')) {
      return [readFileSync(input)];
    }
  }
  return [];
}

/**
 * Generates Tiny v1 obfuscation mappings for Java classes by parsing their binary bytecode
 * and remapping private/internal fields and methods to compact alphabetic identifiers.
 * Public and protected methods/fields and standard keep methods are preserved intact.
 */
export function generateObfuscationMappings(
  input:
    | string
    | Uint8Array
    | Map<string, Uint8Array>
    | JavaCompileResult
    | Record<string, Uint8Array>,
  options: ObfuscationOptions = {},
): string {
  const bytecodes = extractBytecodeList(input);
  const keepMethods = new Set<string>([
    ...DEFAULT_KEEP_METHODS,
    ...(options.keepMethods
      ? Array.isArray(options.keepMethods)
        ? options.keepMethods
        : Array.from(options.keepMethods)
      : []),
  ]);
  const keepFields = new Set<string>([
    ...DEFAULT_KEEP_FIELDS,
    ...(options.keepFields
      ? Array.isArray(options.keepFields)
        ? options.keepFields
        : Array.from(options.keepFields)
      : []),
  ]);

  const obfPrivateFields = options.obfuscatePrivateFields ?? true;
  const obfPrivateMethods = options.obfuscatePrivateMethods ?? true;
  const obfPackagePrivate = options.obfuscatePackagePrivate ?? false;
  const prefix = options.prefix ?? '';

  const lines: string[] = ['v1\tnamed\tobf'];

  for (const bytes of bytecodes) {
    try {
      const parsed = parseClassBytecode(bytes);
      const className = parsed.thisClassName;
      if (!className) continue;

      let fieldIdx = 0;
      let methodIdx = 0;

      if (obfPrivateFields) {
        for (const f of parsed.fields) {
          if (f.isPublic || f.isProtected) continue;
          if (f.name.startsWith('$') || f.name.startsWith('this$')) continue;
          if (keepFields.has(f.name)) continue;
          if (!f.isPrivate && !obfPackagePrivate) continue;

          const newName = `${prefix}${toAlphaIdentifier(fieldIdx++)}`;
          lines.push(`FIELD\t${className}\t${f.desc}\t${f.name}\t${newName}`);
        }
      }

      if (obfPrivateMethods) {
        for (const m of parsed.methods) {
          if (m.name.startsWith('<')) continue;
          if (m.name.startsWith('access$')) continue;
          if (m.isPublic || m.isProtected) continue;
          if (keepMethods.has(m.name)) continue;
          if (!m.isPrivate && !obfPackagePrivate) continue;

          const newName = `${prefix}${toAlphaIdentifier(methodIdx++)}`;
          lines.push(`METHOD\t${className}\t${m.desc}\t${m.name}\t${newName}`);
        }
      }
    } catch {
      // Gracefully continue on unparseable input
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Formats Tiny v1 mappings into a clean, human-readable text document.
 */
export function formatMappingsHumanReadable(tinyContent: string): string {
  const lines = tinyContent.split('\n');
  const classSections = new Map<
    string,
    { fields: string[]; methods: string[] }
  >();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('v1')) continue;
    const parts = line.split('\t');
    const type = parts[0];

    if (type === 'CLASS' && parts[1]) {
      const from = parts[1];
      if (!classSections.has(from)) {
        classSections.set(from, { fields: [], methods: [] });
      }
    } else if (type === 'FIELD' && parts[1] && parts[3] && parts[4]) {
      const cls = parts[1];
      const desc = parts[2] || '';
      const from = parts[3];
      const to = parts[4];
      if (!classSections.has(cls)) {
        classSections.set(cls, { fields: [], methods: [] });
      }
      classSections.get(cls)!.fields.push(`  ${from} (${desc}) -> ${to}`);
    } else if (type === 'METHOD' && parts[1] && parts[3] && parts[4]) {
      const cls = parts[1];
      const desc = parts[2] || '()V';
      const from = parts[3];
      const to = parts[4];
      if (!classSections.has(cls)) {
        classSections.set(cls, { fields: [], methods: [] });
      }
      classSections.get(cls)!.methods.push(`  ${from}${desc} -> ${to}`);
    }
  }

  const out: string[] = ['=== Obfuscation Mapping Table ===\n'];
  for (const [cls, members] of classSections.entries()) {
    out.push(`Class: ${cls.replace(/\//g, '.')}`);
    if (members.fields.length > 0) {
      out.push(`\nFields (${members.fields.length}):`);
      out.push(...members.fields);
    }
    if (members.methods.length > 0) {
      out.push(`\nMethods (${members.methods.length}):`);
      out.push(...members.methods);
    }
    out.push('\n');
  }

  return out.join('\n').trim() + '\n';
}

/**
 * Obfuscates and shrinks compiled Java bytecode synchronously using tiny-remapper.
 * Renames private/internal fields and methods while preserving public API and entrypoints.
 */
export function obfuscateBytecodeSync(
  input: string | Uint8Array | Map<string, Uint8Array> | JavaCompileResult,
  options: ObfuscationOptions = {},
): JavaRemapResult {
  const mappings = generateObfuscationMappings(input, options);

  if (options.exportMappingsPath) {
    const parentDir = resolve(options.exportMappingsPath, '..');
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    const content = options.exportMappingsPath.endsWith('.txt')
      ? formatMappingsHumanReadable(mappings)
      : mappings;
    writeFileSync(options.exportMappingsPath, content, 'utf8');
  }

  const result = remapJavaSync({
    input,
    mappings,
    javaPath: options.javaPath,
    classPath: options.classPath,
    from: 'named',
    to: 'obf',
    additionalArgs: options.additionalArgs,
  });
  result.mappings = mappings;
  return result;
}

/**
 * Obfuscates and shrinks compiled Java bytecode asynchronously using tiny-remapper.
 * Renames private/internal fields and methods while preserving public API and entrypoints.
 */
export async function obfuscateBytecode(
  input: string | Uint8Array | Map<string, Uint8Array> | JavaCompileResult,
  options: ObfuscationOptions = {},
): Promise<JavaRemapResult> {
  const mappings = generateObfuscationMappings(input, options);

  if (options.exportMappingsPath) {
    const parentDir = resolve(options.exportMappingsPath, '..');
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    const content = options.exportMappingsPath.endsWith('.txt')
      ? formatMappingsHumanReadable(mappings)
      : mappings;
    writeFileSync(options.exportMappingsPath, content, 'utf8');
  }

  const result = await remapJava({
    input,
    mappings,
    javaPath: options.javaPath,
    classPath: options.classPath,
    from: 'named',
    to: 'obf',
    additionalArgs: options.additionalArgs,
  });
  result.mappings = mappings;
  return result;
}
