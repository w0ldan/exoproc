import { WIN32_WORKSPACE_PATH, type Win32FileSystem } from './file-system.js';

export interface ExecutableResolution {
  readonly path: string;
  readonly command: string;
}

export class Win32Environment {
  private readonly values = new Map<string, { name: string; value: string }>();

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [name, value] of Object.entries(initial)) {
      this.set(name, value);
    }
  }

  public get(name: string): string | undefined {
    return this.values.get(name.toUpperCase())?.value;
  }

  public set(name: string, value: string): void {
    this.values.set(name.toUpperCase(), { name, value });
  }

  public delete(name: string): boolean {
    return this.values.delete(name.toUpperCase());
  }

  public entries(): ReadonlyArray<readonly [name: string, value: string]> {
    return [...this.values.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ name, value }) => [name, value] as const);
  }

  public clone(): Win32Environment {
    return new Win32Environment(Object.fromEntries(this.entries()));
  }

  public expand(value: string): string {
    return value.replace(
      /%([^%]+)%/g,
      (source, name: string) => this.get(name) ?? source,
    );
  }

  public resolveExecutable(
    fileSystem: Win32FileSystem,
    command: string,
    currentDirectory: string,
  ): ExecutableResolution | undefined {
    const requested = this.expand(command.trim().replace(/^"|"$/g, ''));
    if (!requested) return undefined;

    const containsPath =
      requested.includes('\\') ||
      requested.includes('/') ||
      /^[A-Za-z]:/.test(requested);
    const directories = containsPath
      ? ['']
      : [
          currentDirectory,
          ...(this.get('PATH') ?? '')
            .split(';')
            .map((entry) => this.expand(entry.trim()))
            .filter(Boolean),
        ];
    const hasExtension = /\.[^\\/]+$/.test(requested);
    const extensions = hasExtension
      ? ['']
      : (this.get('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
          .split(';')
          .map((entry) => entry.trim())
          .filter(Boolean);

    for (const directory of directories) {
      for (const extension of extensions) {
        const candidate = containsPath
          ? `${requested}${extension}`
          : `${directory.replace(/\\+$/g, '')}\\${requested}${extension}`;
        const entry = fileSystem.getEntry(candidate, currentDirectory);
        if (entry?.kind === 'file') {
          return {
            path: entry.path,
            command: requested,
          };
        }
      }
    }
    return undefined;
  }

  public toEnvironmentBlock(): string {
    return `${this.entries()
      .map(([name, value]) => `${name}=${value}`)
      .join('\0')}\0\0`;
  }
}

export function createDefaultWin32Environment(): Win32Environment {
  return new Win32Environment({
    ALLUSERSPROFILE: 'C:\\ProgramData',
    COMSPEC: 'C:\\Windows\\System32\\cmd.exe',
    HOMEDRIVE: 'C:',
    HOMEPATH: '\\Users\\Serkan',
    PATH: `C:\\Windows\\System32;C:\\Windows;${WIN32_WORKSPACE_PATH}`,
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    SYSTEMDRIVE: 'C:',
    SYSTEMROOT: 'C:\\Windows',
    TEMP: 'C:\\Users\\Serkan\\AppData\\Local\\Temp',
    TMP: 'C:\\Users\\Serkan\\AppData\\Local\\Temp',
    USERNAME: 'Serkan',
    USERPROFILE: 'C:\\Users\\Serkan',
    WINDIR: 'C:\\Windows',
  });
}
