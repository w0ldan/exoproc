import { Emitter, type Disposable } from '../common/event.js';
import {
  createFileSystemProviderError,
  FileSystemProviderCapabilities,
  FileSystemProviderErrorCode,
  FileType,
  type DirectoryEntry,
  type FileChange,
  type FileDeleteOptions,
  type FileOverwriteOptions,
  type FileStat,
  type FileSystemProvider,
  type FileWriteOptions,
  type ResolveFileOptions,
  type ResolvedFileStat,
} from './files.js';
import {
  joinResourcePath,
  resourceBasename,
  type ResourceUri,
} from './resource-uri.js';

interface ProviderRegistration {
  readonly provider: FileSystemProvider;
  readonly fileChangeSubscription: Disposable;
  readonly capabilitySubscription: Disposable;
}

/** Routes resource operations to providers by URI scheme. */
export class FileService implements Disposable {
  private readonly providers = new Map<string, ProviderRegistration>();
  private readonly fileChangeEmitter = new Emitter<readonly FileChange[]>();
  private readonly capabilityChangeEmitter = new Emitter<{
    readonly scheme: string;
  }>();

  public readonly onDidFilesChange = this.fileChangeEmitter.event;
  public readonly onDidChangeFileSystemProviderCapabilities =
    this.capabilityChangeEmitter.event;

  public registerProvider(
    scheme: string,
    provider: FileSystemProvider,
  ): Disposable {
    const normalizedScheme = scheme.toLowerCase();
    if (this.providers.has(normalizedScheme)) {
      throw new Error(
        `A filesystem provider is already registered for ${normalizedScheme}`,
      );
    }

    const registration: ProviderRegistration = {
      provider,
      fileChangeSubscription: provider.onDidChangeFile((changes) => {
        this.fileChangeEmitter.fire(changes);
      }),
      capabilitySubscription: provider.onDidChangeCapabilities(() => {
        this.capabilityChangeEmitter.fire({ scheme: normalizedScheme });
      }),
    };
    this.providers.set(normalizedScheme, registration);

    return {
      dispose: () => {
        if (this.providers.get(normalizedScheme) !== registration) return;
        this.providers.delete(normalizedScheme);
        registration.fileChangeSubscription.dispose();
        registration.capabilitySubscription.dispose();
      },
    };
  }

  public hasProvider(resource: ResourceUri): boolean {
    return this.providers.has(resource.scheme);
  }

  public hasCapability(
    resource: ResourceUri,
    capability: FileSystemProviderCapabilities,
  ): boolean {
    const provider = this.providers.get(resource.scheme)?.provider;
    return Boolean(provider && provider.capabilities & capability);
  }

  public async resolve(
    resource: ResourceUri,
    options: ResolveFileOptions = {},
  ): Promise<ResolvedFileStat> {
    const provider = this.getProvider(resource);
    const stat = await provider.stat(resource);
    let children: readonly ResolvedFileStat[] | undefined;

    if (options.resolveChildren && (stat.type & FileType.Directory) !== 0) {
      const entries = await provider.readDirectory(resource);
      children = await Promise.all(
        entries.map(async ([name, type]) => {
          const child = joinResourcePath(resource, name);
          let childStat: FileStat;
          try {
            childStat = await provider.stat(child);
          } catch {
            childStat = { type, ctime: 0, mtime: 0, size: 0 };
          }
          return this.toResolvedStat(child, childStat);
        }),
      );
    }

    return this.toResolvedStat(resource, stat, children);
  }

  public async stat(resource: ResourceUri): Promise<FileStat> {
    return this.getProvider(resource).stat(resource);
  }

  public async readDirectory(
    resource: ResourceUri,
  ): Promise<readonly DirectoryEntry[]> {
    return this.getProvider(resource).readDirectory(resource);
  }

  public async readFile(resource: ResourceUri): Promise<Uint8Array> {
    return this.getProvider(resource).readFile(resource);
  }

  public async writeFile(
    resource: ResourceUri,
    content: Uint8Array,
    options: FileWriteOptions,
  ): Promise<void> {
    const provider = this.getWritableProvider(resource);
    await provider.writeFile(resource, content, options);
  }

  public async createDirectory(resource: ResourceUri): Promise<void> {
    await this.getWritableProvider(resource).createDirectory(resource);
  }

  public async delete(
    resource: ResourceUri,
    options: FileDeleteOptions,
  ): Promise<void> {
    await this.getWritableProvider(resource).delete(resource, options);
  }

  public async rename(
    source: ResourceUri,
    target: ResourceUri,
    options: FileOverwriteOptions,
  ): Promise<void> {
    const sourceProvider = this.getWritableProvider(source);
    const targetProvider = this.getWritableProvider(target);
    if (sourceProvider !== targetProvider) {
      throw createFileSystemProviderError(
        'Renaming across filesystem providers is not supported',
        FileSystemProviderErrorCode.Unsupported,
      );
    }
    await sourceProvider.rename(source, target, options);
  }

  public dispose(): void {
    for (const registration of this.providers.values()) {
      registration.fileChangeSubscription.dispose();
      registration.capabilitySubscription.dispose();
    }
    this.providers.clear();
    this.fileChangeEmitter.dispose();
    this.capabilityChangeEmitter.dispose();
  }

  private getProvider(resource: ResourceUri): FileSystemProvider {
    const provider = this.providers.get(resource.scheme)?.provider;
    if (!provider) {
      throw createFileSystemProviderError(
        `No filesystem provider found for ${resource.scheme}`,
        FileSystemProviderErrorCode.Unavailable,
      );
    }
    return provider;
  }

  private getWritableProvider(resource: ResourceUri): FileSystemProvider {
    const provider = this.getProvider(resource);
    if (provider.capabilities & FileSystemProviderCapabilities.Readonly) {
      throw createFileSystemProviderError(
        `Filesystem provider for ${resource.scheme} is readonly`,
        FileSystemProviderErrorCode.Readonly,
      );
    }
    return provider;
  }

  private toResolvedStat(
    resource: ResourceUri,
    stat: FileStat,
    children?: readonly ResolvedFileStat[],
  ): ResolvedFileStat {
    return {
      ...stat,
      resource,
      name: resourceBasename(resource),
      isFile: (stat.type & FileType.File) !== 0,
      isDirectory: (stat.type & FileType.Directory) !== 0,
      children,
    };
  }
}
