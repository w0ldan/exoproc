/**
 * Exoproc - TypeScript JavaClass Bridge.
 * Can be accessed in scripts via:
 *   var Exoproc = Java.type('Exoproc');
 *   var pid = Exoproc.getPid();
 *
 * Emulates the Java class org.exoproc.njava.agent.utils.Exoproc
 * by directly handling host/daemon lifecycle and metadata queries in TypeScript.
 */
export class Exoproc {
  public static readonly canonicalName =
    'org.exoproc.njava.agent.utils.Exoproc';
  public static readonly simpleName = 'Exoproc';

  private static _context: {
    pid?: number | null;
    targetName?: string | null;
    attached?: boolean;
    shutdownHandler?: () => void | Promise<void>;
  } = {};

  public static setContext(ctx: Partial<typeof Exoproc._context>): void {
    Exoproc._context = { ...Exoproc._context, ...ctx };
  }

  public static getContext(): typeof Exoproc._context {
    return Exoproc._context;
  }

  public static getPid(): number {
    return Exoproc._context.pid ?? process.pid;
  }

  public static getTargetName(): string {
    return Exoproc._context.targetName ?? 'Process';
  }

  public static isAttached(): boolean {
    return Exoproc._context.attached ?? true;
  }

  public static shutdown(): void {
    if (Exoproc._context.shutdownHandler) {
      Exoproc._context.shutdownHandler();
    } else {
      setTimeout(() => process.exit(0), 100);
    }
  }
}
