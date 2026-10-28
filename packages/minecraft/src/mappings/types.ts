/**
 * Canonical names for the 25 core Minecraft classes.
 */
export type MinecraftClassKey =
  | 'Main'
  | 'Minecraft'
  | 'EntityPlayerSP'
  | 'EntityPlayer'
  | 'EntityLivingBase'
  | 'Entity'
  | 'WorldClient'
  | 'World'
  | 'PlayerControllerMP'
  | 'GameSettings'
  | 'KeyBinding'
  | 'GuiScreen'
  | 'GuiButton'
  | 'GuiMainMenu'
  | 'GuiSelectWorld'
  | 'GuiCreateWorld'
  | 'GuiScreenServerList'
  | 'GuiScreenAddServer'
  | 'GuiMultiplayer'
  | 'GuiIngameMenu'
  | 'GuiOptions'
  | 'GuiConnecting'
  | 'GuiDisconnected'
  | 'GuiChat'
  | 'GuiInventory'
  | 'GuiContainer'
  | 'InventoryPlayer'
  | 'ItemStack'
  | 'Item'
  | 'Block'
  | 'IBlockState'
  | 'BlockPos'
  | 'Vec3'
  | 'AxisAlignedBB'
  | 'MovingObjectPosition'
  | 'Timer'
  | 'RenderManager'
  | 'EntityRenderer'
  | 'Session'
  | 'PlayerCapabilities'
  | 'NBTTagCompound'
  | 'MovementInput'
  | 'FoodStats';

/**
 * Mapping definition for a single class.
 */
export interface ClassMapping {
  /** The real/obfuscated class name (e.g. "net.minecraft.client.Minecraft" or "ave"). */
  realClassName: string;
  /** Field mappings: logical field name -> real/obfuscated field name. */
  fields: Record<string, string>;
  /** Method mappings: logical method name -> real/obfuscated method name. */
  methods: Record<string, string>;
}

/**
 * Complete collection of mappings for all supported Minecraft classes.
 */
export type MinecraftMappings = Record<MinecraftClassKey, ClassMapping>;

/**
 * Options for configuring class matching and resolution.
 */
export interface MatchOptions {
  /**
   * Arbitrary known seed classes mapping canonical class key or custom key to real class name.
   * Examples: { RealmsBridge: 'net.minecraft.realms.RealmsBridge' }, { Minecraft: 'ave' }, { EntityPlayerSP: 'bew' }, { World: 'adm' }.
   * The discovery graph starts from any provided seed(s) and bidirectionally resolves the rest of the game graph.
   */
  seeds?: Partial<Record<MinecraftClassKey | string, string>>;
  /** Explicit RealmsBridge anchor class name hint (e.g. "net.minecraft.realms.RealmsBridge" or custom path). */
  realmsBridgeClassName?: string;
  /** Alias for realmsBridgeClassName. */
  realmsClassName?: string;
  /** Explicit Main class name hint (e.g. "net.minecraft.client.main.Main" or "Start"). */
  mainClassName?: string;
  /** Explicit Minecraft class name hint (e.g. "net.minecraft.client.Minecraft" or "ave"). */
  minecraftClassName?: string;
  /** Explicit EntityPlayerSP class name hint (e.g. "net.minecraft.client.entity.EntityPlayerSP" or "bew"). */
  playerClassName?: string;
  /** Custom class overrides. */
  overrides?: Partial<Record<MinecraftClassKey, Partial<ClassMapping>>>;
  /**
   * Optional phase to execute:
   * - 'core': ultra-fast scan of Minecraft singleton, GuiScreen, GuiButton (~50ms, pre-world/menus).
   * - 'world': deep scan of player, capabilities, world, inventory, and combat/movement fields.
   * - 'all' (default): executes both phases sequentially.
   */
  phase?: 'core' | 'world' | 'all';
  /**
   * Optional MappingPool instance to extract pre-detected mappings from, bypassing live reflection scanning.
   */
  pool?: any;
}

/**
 * Type descriptor struct with obfuscation status and canonical resolution.
 */
export interface TypeDescriptorInfo {
  /** Canonical/resolved type name (e.g. 'java.lang.Runnable', 'boolean', 'Minecraft', 'EntityPlayerSP') */
  typeName: string;
  /** Raw JVM type descriptor or class name (e.g. 'java.lang.Runnable', 'boolean', 'ave', 'bew') */
  realTypeName: string;
  /** Whether the type is an obfuscated Minecraft class */
  isObfuscated: boolean;
  /** Whether the type is an array */
  isArray?: boolean;
  /** Canonical key if mapped in the schema (e.g. 'Minecraft', 'GuiScreen') */
  canonicalKey?: MinecraftClassKey | string;
}

/**
 * Detected field struct returned when analyzing a class field.
 */
export interface DetectedFieldInfo {
  kind: 'field';
  /** Canonical/original field name in Minecraft schema (e.g. 'thePlayer', 'currentScreen') */
  originalName: string;
  /** Real runtime field name in the JVM (e.g. 'h', 'm') */
  realName: string;
  /** Whether the field name itself is obfuscated (e.g. 'h' is true, but un-obfuscated names are false) */
  isObfuscated: boolean;
  /** Field type descriptor with obfuscation details */
  type: TypeDescriptorInfo;
  /** Whether the field is static */
  isStatic: boolean;
  /** Declaring class real name or canonical name */
  declaringClass: string;
}

/**
 * Detected method struct returned when analyzing a class method.
 */
export interface DetectedMethodInfo {
  kind: 'method';
  /** Canonical/original method name in Minecraft schema (e.g. 'actionPerformed', 'toString') */
  originalName: string;
  /** Real runtime method name in the JVM (e.g. 'a', 'toString') */
  realName: string;
  /** Whether the method name is obfuscated (e.g. 'a' is true, 'toString' is false) */
  isObfuscated: boolean;
  /** Return type descriptor with obfuscation details */
  returnType: TypeDescriptorInfo;
  /** Parameter type descriptors with obfuscation details */
  paramTypes: TypeDescriptorInfo[];
  /** Whether the method is static */
  isStatic: boolean;
  /** Declaring class real name or canonical name */
  declaringClass: string;
}

/**
 * Detected class struct returned when analyzing a Minecraft or JVM class.
 */
export interface DetectedClassInfo {
  kind: 'class';
  /** Canonical/original class name in Minecraft schema (e.g. 'net.minecraft.client.gui.GuiMainMenu') */
  originalName: string;
  /** Canonical key if matched (e.g. 'GuiMainMenu', 'Minecraft') */
  canonicalKey?: MinecraftClassKey | string;
  /** Direct short class name / file name (e.g. 'GuiSelectWorld', 'GuiMainMenu') */
  simpleName: string;
  /** Full canonical MCP package name if known (e.g. 'net.minecraft.client.gui.GuiSelectWorld') */
  canonicalClassName?: string;
  /** Direct reference to canonical database schema definition if defined in database */
  schema?: any;
  /** Real runtime class name in the JVM (e.g. 'aya', 'ave') */
  realClassName: string;
  /** Whether the class is obfuscated */
  isObfuscated: boolean;
  /** Superclass information */
  superclass?: {
    originalName: string;
    realClassName: string;
    simpleName?: string;
    isObfuscated: boolean;
    canonicalKey?: MinecraftClassKey | string;
  };
  /** All detected fields mapped by originalName (and accessible by realName) */
  fields: Record<string, DetectedFieldInfo>;
  /** All detected methods mapped by originalName (and accessible by realName) */
  methods: Record<string, DetectedMethodInfo>;
  /** Constructor parameter list */
  constructors?: Array<{
    paramTypes: TypeDescriptorInfo[];
  }>;
}

/**
 * Options for detect() execution.
 */
export interface DetectOptions {
  /** Optional hint or context about the expected class or owner class */
  ownerClass?: string;
  /** Do not re-scan if already cached in pool */
  useCache?: boolean;
}
