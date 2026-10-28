import type {
  ReflectionBridge,
  ReflectedClass,
  ReflectedField,
} from 'bun-njava';
import type { MatchOptions } from './types.js';

export class MinecraftAnchorResolver {
  constructor(private readonly bridge: ReflectionBridge) {}

  private cleanTypeName(raw: string | null | undefined): string {
    if (!raw) return '';
    return raw.replace(/^(class|interface)\s+/, '').trim();
  }

  /**
   * Resolves root classes (Minecraft, RealmsBridge) from options and anchors.
   */
  public async findRoots(
    options: MatchOptions,
  ): Promise<{ Minecraft?: string; RealmsBridge?: string }> {
    try {
      const cls = await this.resolveMinecraftClass(options);
      return { Minecraft: cls.name };
    } catch {
      return {};
    }
  }

  /**
   * Resolves the Minecraft root class by inspecting non-obfuscated anchors (`RealmsBridge`, `Main`, etc.).
   */
  public async resolveMinecraftClass(
    options: MatchOptions,
  ): Promise<ReflectedClass> {
    const mcSeed =
      options.minecraftClassName ??
      options.seeds?.Minecraft ??
      options.seeds?.minecraft;
    if (mcSeed) {
      try {
        return await this.bridge.getClass(mcSeed);
      } catch {}
    }

    // 0. If playerClassName is provided, resolve Minecraft from EntityPlayerSP constructor (Param 0)
    if (options.playerClassName) {
      try {
        const playerCls = await this.bridge.getClass(options.playerClassName);
        const ctors = await playerCls.getDeclaredConstructors();
        for (const ctor of ctors) {
          if (ctor.paramTypes.length >= 2) {
            const mcType = this.cleanTypeName(ctor.paramTypes[0]!);
            if (!mcType.startsWith('java.')) {
              return await this.bridge.getClass(mcType);
            }
          }
        }
      } catch {}
    }

    // 1. Fast check common root class names before crawling complex anchor graph
    for (const name of ['ave', 'net.minecraft.client.Minecraft']) {
      try {
        const cls = await this.bridge.getClass(name);
        if (cls) return cls;
      } catch {}
    }

    // 1. Inspect RealmsBridge anchor (user supplied or default 'net.minecraft.realms.RealmsBridge')
    const realmsName =
      options.seeds?.RealmsBridge ??
      options.seeds?.realmsBridge ??
      options.realmsClassName ??
      options.realmsBridgeClassName ??
      'net.minecraft.realms.RealmsBridge';
    try {
      const rbCls = await this.bridge.getClass(realmsName);
      const rbFields = await rbCls.getDeclaredFields();
      for (const f of rbFields) {
        if (!f.isStatic && f.type) {
          const guiScreenName = this.cleanTypeName(f.type);
          if (
            !guiScreenName.startsWith('java.') &&
            !guiScreenName.startsWith('[')
          ) {
            try {
              const gsCls = await this.bridge.getClass(guiScreenName);
              const gsFields = await gsCls.getDeclaredFields();
              for (const gsf of gsFields) {
                if (!gsf.isStatic && gsf.type) {
                  const candName = this.cleanTypeName(gsf.type);
                  if (
                    !candName.startsWith('java.') &&
                    !candName.startsWith('[')
                  ) {
                    try {
                      const candCls = await this.bridge.getClass(candName);
                      const candFields = await candCls.getDeclaredFields();
                      const selfStatic = candFields.some(
                        (cf: ReflectedField) =>
                          cf.isStatic &&
                          (cf.type === candName ||
                            cf.type === `class ${candName}`),
                      );
                      if (selfStatic) {
                        return candCls;
                      }
                    } catch {}
                  }
                }
              }
            } catch {}
          }
        }
      }
    } catch {}

    // 2. Fallback to common root class names
    for (const name of ['ave', 'net.minecraft.client.Minecraft']) {
      try {
        return await this.bridge.getClass(name);
      } catch {}
    }

    throw new Error('Unable to resolve Minecraft root class from anchors');
  }
}
