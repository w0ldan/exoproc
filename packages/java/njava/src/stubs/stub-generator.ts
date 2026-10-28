import type { JavaStubClassSchema } from './types.js';

export const KNOWN_CANONICAL_CLASSES: Record<string, string> = {
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
  AxisAlignedBB: 'net.minecraft.util.AxisAlignedBB',
  IChatComponent: 'net.minecraft.util.IChatComponent',
  ChatComponentText: 'net.minecraft.util.ChatComponentText',
  NBTTagCompound: 'net.minecraft.nbt.NBTTagCompound',
  InventoryPlayer: 'net.minecraft.entity.player.InventoryPlayer',
  PlayerCapabilities: 'net.minecraft.entity.player.PlayerCapabilities',
  FoodStats: 'net.minecraft.util.FoodStats',
  Container: 'net.minecraft.inventory.Container',
  GameProfile: 'com.mojang.authlib.GameProfile',
  WorldProvider: 'net.minecraft.world.WorldProvider',
  WorldSettings: 'net.minecraft.world.WorldSettings',
  GameType: 'net.minecraft.world.WorldSettings.GameType',
  EnumFacing: 'net.minecraft.util.EnumFacing',
  RegistryNamespaced: 'net.minecraft.util.RegistryNamespaced',
  RegistryNamespacedDefaultedByKey:
    'net.minecraft.util.RegistryNamespacedDefaultedByKey',
  MovementInput: 'net.minecraft.util.MovementInput',
  GuiTextField: 'net.minecraft.client.gui.GuiTextField',
  NetworkManager: 'net.minecraft.network.NetworkManager',
  Potion: 'net.minecraft.potion.Potion',
  ServerData: 'net.minecraft.client.multiplayer.ServerData',
  ServerList: 'net.minecraft.client.multiplayer.ServerList',
  ServerSelectionList: 'net.minecraft.client.gui.ServerSelectionList',
  Material: 'net.minecraft.block.material.Material',
  ListenableFuture: 'com.google.common.util.concurrent.ListenableFuture',
};

export const JAVA_PRIMITIVE_TYPES = new Set<string>([
  'int',
  'float',
  'double',
  'long',
  'boolean',
  'byte',
  'short',
  'char',
  'void',
]);

export const JAVA_STANDARD_CLASSES: Record<string, string> = {
  String: 'java.lang.String',
  Object: 'java.lang.Object',
  Runnable: 'java.lang.Runnable',
  Comparable: 'java.lang.Comparable',
  CharSequence: 'java.lang.CharSequence',
  StringBuilder: 'java.lang.StringBuilder',
  StringBuffer: 'java.lang.StringBuffer',
  Iterable: 'java.lang.Iterable',
  Throwable: 'java.lang.Throwable',
  Exception: 'java.lang.Exception',
  RuntimeException: 'java.lang.RuntimeException',
  Class: 'java.lang.Class',
  ClassLoader: 'java.lang.ClassLoader',
  Math: 'java.lang.Math',

  List: 'java.util.List',
  ArrayList: 'java.util.ArrayList',
  LinkedList: 'java.util.LinkedList',
  Map: 'java.util.Map',
  HashMap: 'java.util.HashMap',
  Set: 'java.util.Set',
  HashSet: 'java.util.HashSet',
  Collection: 'java.util.Collection',
  Iterator: 'java.util.Iterator',
  Queue: 'java.util.Queue',
  Deque: 'java.util.Deque',
  UUID: 'java.util.UUID',
  Random: 'java.util.Random',
  Date: 'java.util.Date',
  Calendar: 'java.util.Calendar',

  DateFormat: 'java.text.DateFormat',
  SimpleDateFormat: 'java.text.SimpleDateFormat',

  AtomicInteger: 'java.util.concurrent.atomic.AtomicInteger',
  AtomicBoolean: 'java.util.concurrent.atomic.AtomicBoolean',
  AtomicLong: 'java.util.concurrent.atomic.AtomicLong',
  AtomicReference: 'java.util.concurrent.atomic.AtomicReference',
  Future: 'java.util.concurrent.Future',
  Callable: 'java.util.concurrent.Callable',

  File: 'java.io.File',
  InputStream: 'java.io.InputStream',
  OutputStream: 'java.io.OutputStream',
  Reader: 'java.io.Reader',
  Writer: 'java.io.Writer',

  URI: 'java.net.URI',
  URL: 'java.net.URL',
  Socket: 'java.net.Socket',
  SocketAddress: 'java.net.SocketAddress',
  InetAddress: 'java.net.InetAddress',
  InetSocketAddress: 'java.net.InetSocketAddress',

  ByteBuffer: 'java.nio.ByteBuffer',
  IntBuffer: 'java.nio.IntBuffer',
  FloatBuffer: 'java.nio.FloatBuffer',
  DoubleBuffer: 'java.nio.DoubleBuffer',
  LongBuffer: 'java.nio.LongBuffer',
  ShortBuffer: 'java.nio.ShortBuffer',
  Buffer: 'java.nio.Buffer',
  Charset: 'java.nio.charset.Charset',

  Pattern: 'java.util.regex.Pattern',
  Matcher: 'java.util.regex.Matcher',

  BufferedImage: 'java.awt.image.BufferedImage',

  Method: 'java.lang.reflect.Method',
  Field: 'java.lang.reflect.Field',
  Constructor: 'java.lang.reflect.Constructor',
};

export interface GeneratedStubFile {
  relativePath: string;
  source: string;
  fqcn: string;
  className: string;
  packageName?: string;
}

/**
 * Resolves a type identifier (which may be a short class name, primitive, array, etc.)
 * into its fully qualified Java type name.
 */
export function resolveJavaType(
  typeStr: string,
  classCatalog: Record<string, string>,
): string {
  if (!typeStr) return 'void';

  let dims = '';
  let baseType = typeStr.trim();
  while (baseType.endsWith('[]')) {
    dims += '[]';
    baseType = baseType.slice(0, -2).trim();
  }

  if (JAVA_PRIMITIVE_TYPES.has(baseType)) {
    return baseType + dims;
  }

  if (JAVA_STANDARD_CLASSES[baseType]) {
    return JAVA_STANDARD_CLASSES[baseType] + dims;
  }

  const mapped = classCatalog[baseType] ?? KNOWN_CANONICAL_CLASSES[baseType];
  if (mapped) {
    return mapped.replace(/\$/g, '.') + dims;
  }

  if (baseType.includes('.')) {
    return baseType + dims;
  }

  // Fallback: return as-is
  return baseType + dims;
}

/**
 * Produces a default return or initializer expression for a given Java type.
 */
export function getStubDefaultValue(typeStr: string): string {
  if (typeStr === 'void') return '';
  if (typeStr === 'boolean') return 'false';
  if (['int', 'byte', 'short', 'char'].includes(typeStr)) return '0';
  if (typeStr === 'long') return '0L';
  if (typeStr === 'float') return '0.0f';
  if (typeStr === 'double') return '0.0';
  return 'null';
}

/**
 * Generates Java source code for a class schema.
 */
export function generateClassStub(
  shortName: string,
  schema: JavaStubClassSchema,
  classCatalog: Record<string, string>,
): GeneratedStubFile {
  const fqcn =
    schema.canonical ??
    schema.canonicalClassName ??
    (shortName.includes('.')
      ? shortName
      : (classCatalog[shortName] ?? `net.minecraft.${shortName}`));
  const parts = fqcn.split('.');
  const simpleName = parts.pop()!;
  const packageName = parts.join('.');
  const relativePath =
    parts.length > 0
      ? `${parts.join('/')}/${simpleName}.java`
      : `${simpleName}.java`;

  const isInterface =
    simpleName.startsWith('I') &&
    simpleName.length > 1 &&
    Boolean(simpleName[1] && simpleName[1] === simpleName[1].toUpperCase());
  const extendsClause =
    schema.superclass && schema.superclass !== 'Object'
      ? ` extends ${resolveJavaType(schema.superclass, classCatalog)}`
      : '';

  let body = '';

  if (!isInterface) {
    body += `    public ${simpleName}() {}\n\n`;
  }

  if (simpleName === 'MovingObjectPosition') {
    body += `    public static enum MovingObjectType { MISS, BLOCK, ENTITY; }\n\n`;
  }

  if (schema.fields) {
    for (const [fName, fInfo] of Object.entries(schema.fields)) {
      const rawType = typeof fInfo === 'string' ? fInfo : fInfo.type;
      const resType = resolveJavaType(rawType, classCatalog);
      if (isInterface) {
        body += `    public static final ${resType} ${fName} = ${getStubDefaultValue(resType)};\n`;
      } else {
        body += `    public ${resType} ${fName};\n`;
      }
    }
  }

  if (schema.methods) {
    for (const [mName, mInfo] of Object.entries(schema.methods)) {
      const isObj = typeof mInfo === 'object' && mInfo !== null;
      const rawRet = isObj
        ? (mInfo.returnType ?? 'void')
        : typeof mInfo === 'string'
          ? mInfo
          : 'void';
      const retType = resolveJavaType(rawRet, classCatalog);
      const rawParams =
        isObj && Array.isArray(mInfo.params) ? mInfo.params : [];
      const params = rawParams
        .map((p, idx) => `${resolveJavaType(p, classCatalog)} p${idx}`)
        .join(', ');
      const staticMod = isObj && mInfo.isStatic ? 'static ' : '';

      if (isInterface) {
        body += `    public ${retType} ${mName}(${params});\n`;
      } else {
        const retVal = getStubDefaultValue(retType);
        const retStmt = retVal ? `return ${retVal};` : '';
        body += `    public ${staticMod}${retType} ${mName}(${params}) { ${retStmt} }\n`;
      }
    }
  }

  const source = [
    `package ${packageName};`,
    '',
    '@SuppressWarnings({"rawtypes", "unchecked"})',
    `public ${isInterface ? 'interface' : 'class'} ${simpleName}${extendsClause} {`,
    body,
    '}',
    '',
  ].join('\n');

  return {
    relativePath,
    source,
    fqcn,
    className: simpleName,
    packageName,
  };
}

export const EXTERNAL_AUXILIARY_CLASSES: Record<string, string> = {
  ListenableFuture: 'com.google.common.util.concurrent.ListenableFuture',
  GameProfile: 'com.mojang.authlib.GameProfile',
};

/**
 * Generates auxiliary/external stubs required by Minecraft types (e.g. WorldSettings, ListenableFuture).
 */
export function generateAuxiliaryStubs(
  existingShortNames: Set<string>,
): GeneratedStubFile[] {
  const result: GeneratedStubFile[] = [];

  for (const [shortName, fqcn] of Object.entries(EXTERNAL_AUXILIARY_CLASSES)) {
    if (existingShortNames.has(shortName)) continue;

    const parts = fqcn.split('.');
    const simpleName = parts.pop()!;
    const packageName = parts.join('.');
    const relativePath = `${parts.join('/')}/${simpleName}.java`;

    let source = '';
    if (simpleName === 'ListenableFuture') {
      source = [
        `package ${packageName};`,
        '',
        '@SuppressWarnings({"rawtypes", "unchecked"})',
        `public interface ${simpleName}<V> extends java.util.concurrent.Future<V> {}`,
        '',
      ].join('\n');
    } else {
      source = [
        `package ${packageName};`,
        '',
        '@SuppressWarnings({"rawtypes", "unchecked"})',
        `public class ${simpleName} {`,
        `    public ${simpleName}() {}`,
        '}',
        '',
      ].join('\n');
    }

    result.push({
      relativePath,
      source,
      fqcn,
      className: simpleName,
      packageName,
    });
  }

  // WorldSettings with GameType enum
  if (!existingShortNames.has('WorldSettings')) {
    result.push({
      relativePath: 'net/minecraft/world/WorldSettings.java',
      source: [
        'package net.minecraft.world;',
        '',
        '@SuppressWarnings({"rawtypes", "unchecked"})',
        'public class WorldSettings {',
        '    public static enum GameType {',
        '        NOT_SET, SURVIVAL, CREATIVE, ADVENTURE, SPECTATOR;',
        '    }',
        '}',
        '',
      ].join('\n'),
      fqcn: 'net.minecraft.world.WorldSettings',
      className: 'WorldSettings',
      packageName: 'net.minecraft.world',
    });
  }

  return result;
}
