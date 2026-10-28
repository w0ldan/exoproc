import 'dotenv/config';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

// Handle BigInt serialization for Winston JSON format
if (!Object.prototype.hasOwnProperty.call(BigInt.prototype, 'toJSON')) {
  (BigInt.prototype as { toJSON?: () => string }).toJSON = function () {
    return this.toString();
  };
}

/**
 * Log configuration using @t3-oss/env-core
 */
const env = createEnv({
  server: {
    logLevel: z
      .preprocess(
        (val) => (typeof val === 'string' ? val.trim() : val),
        z.enum(['error', 'warn', 'info', 'debug']),
      )
      .default('info'),
    logDir: z
      .string()
      .default(
        path.join(os.homedir(), 'AppData', 'Roaming', 'Exoproc', 'logs'),
      ),
  },
  runtimeEnv: {
    logLevel: process.env.EXOPROC_LOG_LEVEL,
    logDir: process.env.EXOPROC_LOG_DIR,
  },
  emptyStringAsUndefined: true,
});

const { logDir, logLevel } = env;

/**
 * Ensure log directory exists at module load time.
 */
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

/**
 * Global main Winston instance.
 * Can be modified by setup.ts to add test-specific formats or transports.
 */
export const mainLogger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.ms' }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  transports: [
    new DailyRotateFile({
      dirname: logDir,
      filename: 'exoproc-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '5',
    }),
  ],
});

/**
 * Wrapper for hierarchical logging.
 */
export class Logger {
  constructor(protected category: string) {}

  /**
   * Create a sub-category logger.
   */
  add(subCat: string): Logger {
    return new Logger(subCat ? `${this.category}:${subCat}` : this.category);
  }

  fatal(msg: string, data?: unknown) {
    this.log('error', msg, data, { fatal: true });
  }
  error(msg: string, data?: unknown) {
    this.log('error', msg, data);
  }
  warn(msg: string, data?: unknown) {
    this.log('warn', msg, data);
  }
  info(msg: string, data?: unknown) {
    this.log('info', msg, data);
  }
  debug(msg: string, data?: unknown) {
    this.log('debug', msg, data);
  }
  trace(msg: string, data?: unknown) {
    this.log('debug', msg, data, { trace: true });
  }

  protected log(
    level: string,
    message: string,
    data?: unknown,
    extra?: Record<string, unknown>,
  ) {
    mainLogger.log({
      level,
      message,
      category: this.category,
      ...(data && typeof data === 'object' ? data : { data }),
      ...extra,
    });
  }
}
