import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type {
  ExportMappingsOptions,
  MappingsJson,
  MappingPool,
} from './types.js';
import { createPool } from './pool.js';

export function exportMappings(options: ExportMappingsOptions): MappingsJson {
  const {
    pool,
    formatVersion = '1.0.0',
    environment = {},
    metadata = {},
  } = options;

  const result: MappingsJson = {
    formatVersion,
    environment: {
      timestamp: new Date().toISOString(),
      ...environment,
    },
    classes: {},
    metadata,
  };

  const databases = pool.getDatabases();

  // Export all detected classes from pool
  for (const detected of pool.getAllDetected()) {
    let superclass = detected.superclass;

    // Enhance with database superclass if missing
    if (!superclass) {
      for (const db of databases) {
        const schema = db.getClass(detected.canonicalName);
        if (schema?.superclass) {
          superclass = schema.superclass;
          break;
        }
      }
    }

    result.classes[detected.canonicalName] = {
      obf: detected.realClassName,
      canonical: detected.canonicalName,
      simpleName: detected.simpleName,
      superclass,
      fields: { ...detected.fields },
      methods: { ...detected.methods },
    };
  }

  return result;
}

export function saveMappingsToFile(
  filePath: string,
  mappings: MappingsJson,
): void {
  writeFileSync(filePath, JSON.stringify(mappings, null, 2), 'utf-8');
}

export function loadMappings(
  source?: string | Record<string, any>,
  targetPool?: MappingPool,
): MappingPool {
  const pool = targetPool || createPool();

  if (!source) {
    if (typeof process !== 'undefined' && process.env) {
      if (process.env.MAPPINGS_JSON) {
        try {
          const parsed = JSON.parse(process.env.MAPPINGS_JSON);
          return pool.load(parsed);
        } catch {}
      }
      if (process.env.MAPPINGS_FILE && existsSync(process.env.MAPPINGS_FILE)) {
        try {
          const content = readFileSync(process.env.MAPPINGS_FILE, 'utf-8');
          const parsed = JSON.parse(content);
          return pool.load(parsed);
        } catch {}
      }
    }

    let repoRoot = process.cwd();
    try {
      let curr = repoRoot;
      for (let i = 0; i < 6; i++) {
        if (
          existsSync(`${curr}/bunfig.toml`) &&
          (existsSync(`${curr}/bun-wine`) ||
            existsSync(`${curr}/packages`) ||
            existsSync(`${curr}/package.json`))
        ) {
          repoRoot = curr;
          break;
        }
        const lastSlash = curr.lastIndexOf('/');
        if (lastSlash <= 0) break;
        curr = curr.substring(0, lastSlash);
      }
    } catch {}

    const defaultCandidates = [
      'packages/minecraft/src/mappings/mappings-1.8.9.json',
      'packages/minecraft/dist/mappings/mappings-1.8.9.json',
      'mappings.json',
      'mappings-1.8.9.json',
    ];

    for (const rel of defaultCandidates) {
      const candidatesToCheck = [rel, `${repoRoot}/${rel}`];
      for (const candidate of candidatesToCheck) {
        if (existsSync(candidate)) {
          try {
            const content = readFileSync(candidate, 'utf-8');
            const parsed = JSON.parse(content);
            return pool.load(parsed);
          } catch {}
        }
      }
    }

    return pool;
  }

  if (typeof source === 'object') {
    return pool.load(source);
  }

  if (typeof source === 'string') {
    const trimmed = source.trim();
    if (
      trimmed.startsWith('v1\t') ||
      trimmed.includes('\tCLASS\t') ||
      trimmed.includes('\tFIELD\t') ||
      trimmed.includes('\tMETHOD\t') ||
      trimmed.endsWith('.tiny')
    ) {
      return pool.loadTiny(trimmed);
    }
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        return pool.load(parsed);
      } catch {}
    }
    if (existsSync(trimmed)) {
      if (trimmed.endsWith('.tiny')) {
        return pool.loadTiny(trimmed);
      }
      try {
        const content = readFileSync(trimmed, 'utf-8');
        const parsed = JSON.parse(content);
        return pool.load(parsed);
      } catch {
        return pool.loadTiny(trimmed);
      }
    }
  }

  return pool;
}

export function loadMappingsFromFile(
  filePath: string,
  targetPool?: MappingPool,
): MappingPool {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(content);
  const pool = targetPool || createPool();
  return pool.load(parsed);
}
