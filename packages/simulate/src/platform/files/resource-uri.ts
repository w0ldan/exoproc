function normalizeResourcePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const segments: string[] = [];
  for (const segment of absolute.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}

export interface ResourceUriComponents {
  readonly scheme: string;
  readonly authority?: string;
  readonly path: string;
}

/** Platform-neutral resource identity used by services and UI models. */
export class ResourceUri {
  public readonly scheme: string;
  public readonly authority: string;
  public readonly path: string;

  private constructor(components: ResourceUriComponents) {
    this.scheme = components.scheme.toLowerCase();
    this.authority = components.authority ?? '';
    this.path = normalizeResourcePath(components.path);
  }

  public static from(components: ResourceUriComponents): ResourceUri {
    return new ResourceUri(components);
  }

  public static file(path: string): ResourceUri {
    const normalized = path.replace(/\\/g, '/');
    if (normalized.startsWith('//')) {
      const [authority = '', ...segments] = normalized.slice(2).split('/');
      return new ResourceUri({
        scheme: 'file',
        authority,
        path: `/${segments.join('/')}`,
      });
    }
    return new ResourceUri({ scheme: 'file', path: normalized });
  }

  public static parse(value: string): ResourceUri {
    const parsed = new URL(value);
    return new ResourceUri({
      scheme: parsed.protocol.slice(0, -1),
      authority: parsed.host,
      path: decodeURIComponent(parsed.pathname),
    });
  }

  public get fsPath(): string {
    const path = /^\/[A-Za-z]:/.test(this.path)
      ? this.path.slice(1)
      : this.path;
    const windowsPath = path.replace(/\//g, '\\');
    return this.authority ? `\\\\${this.authority}${windowsPath}` : windowsPath;
  }

  public with(changes: Partial<ResourceUriComponents>): ResourceUri {
    return new ResourceUri({
      scheme: changes.scheme ?? this.scheme,
      authority: changes.authority ?? this.authority,
      path: changes.path ?? this.path,
    });
  }

  public toString(): string {
    return `${this.scheme}://${this.authority}${encodeURI(this.path)}`;
  }
}

export function joinResourcePath(
  resource: ResourceUri,
  ...segments: readonly string[]
): ResourceUri {
  return resource.with({ path: `${resource.path}/${segments.join('/')}` });
}

export function resourceBasename(resource: ResourceUri): string {
  return resource.path.slice(resource.path.lastIndexOf('/') + 1);
}

export function resourceDirname(resource: ResourceUri): ResourceUri {
  const separator = resource.path.lastIndexOf('/');
  return resource.with({
    path: separator <= 0 ? '/' : resource.path.slice(0, separator),
  });
}
