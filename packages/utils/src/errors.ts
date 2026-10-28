/**
 * Base class for all Exoproc errors.
 * Supports metadata, better stack traces, and consistent naming.
 */
export class ExoprocError extends Error {
  public readonly data?: unknown;
  public readonly code?: string;

  constructor(
    message: string,
    options?: { data?: unknown; code?: string; cause?: Error },
  ) {
    super(message);
    this.name = this.constructor.name;
    this.data = options?.data;
    this.code = options?.code;

    if (options?.cause) {
      this.cause = options.cause;
    }

    // Workaround for https://github.com/microsoft/TypeScript/issues/13965
    Object.setPrototypeOf(this, new.target.prototype);

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      data: this.data,
      stack: this.stack,
    };
  }
}
