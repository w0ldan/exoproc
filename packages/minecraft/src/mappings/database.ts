import type { MinecraftClassKey, MinecraftMappings } from './types.js';
import {
  JAVA_PRIMITIVES,
  isPrimitiveType,
  STANDARD_UNOBFUSCATED_METHODS,
  isObfuscatedClassName as njavaIsObfuscatedClass,
  isObfuscatedMethodName,
  isObfuscatedFieldName,
  type JavaClassSchema,
  type JavaDatabaseProvider,
} from 'exoproc-mappings';

export {
  JAVA_PRIMITIVES,
  isPrimitiveType,
  STANDARD_UNOBFUSCATED_METHODS,
  isObfuscatedMethodName,
  isObfuscatedFieldName,
};

export type { JavaClassSchema, JavaDatabaseProvider };

export function isObfuscatedClassName(className: string): boolean {
  if (!className || typeof className !== 'string') return false;
  const clean = className.replace(/^(class|interface)\s+/, '').trim();
  if (clean.startsWith('net.minecraft.')) return false;
  return njavaIsObfuscatedClass(clean);
}

export type MinecraftFieldType = string;

/**
 * Detailed canonical method signature specification.
 */
export interface CanonicalMethodSchema {
  params?: MinecraftFieldType[];
  returnType?: MinecraftFieldType | 'void';
}

/**
 * Canonical class specification for Minecraft core entities and systems.
 */
export interface CanonicalClassSchema {
  canonicalClassName: string;
  superclass?: MinecraftClassKey;
  fields?: Record<string, MinecraftFieldType>;
  methods?: Record<string, CanonicalMethodSchema>;
}

/**
 * Typed, declarative schema of all canonical Minecraft classes, typed fields, and typed methods.
 */
export const MINECRAFT_CANONICAL_SCHEMA: Record<
  MinecraftClassKey,
  CanonicalClassSchema
> = {
  Main: {
    canonicalClassName: 'net.minecraft.client.main.Main',
    methods: {
      main: { params: ['String[]'], returnType: 'void' },
    },
  },
  Minecraft: {
    canonicalClassName: 'net.minecraft.client.Minecraft',
    fields: {
      theMinecraft: 'Minecraft',
      thePlayer: 'EntityPlayerSP',
      theWorld: 'WorldClient',
      gameSettings: 'GameSettings',
      playerController: 'PlayerControllerMP',
      currentScreen: 'GuiScreen',
      entityRenderer: 'EntityRenderer',
      renderManager: 'RenderManager',
      objectMouseOver: 'MovingObjectPosition',
      timer: 'Timer',
      session: 'Session',
      inGameHasFocus: 'boolean',
    },
    methods: {
      getMinecraft: { params: [], returnType: 'Minecraft' },
      runTick: { params: [], returnType: 'void' },
      clickMouse: { params: [], returnType: 'void' },
      rightClickMouse: { params: [], returnType: 'void' },
      displayGuiScreen: { params: ['GuiScreen'], returnType: 'void' },
      setIngameFocus: { params: [], returnType: 'void' },
      setIngameNotInFocus: { params: [], returnType: 'void' },
      shutdown: { params: [], returnType: 'void' },
    },
  },
  EntityPlayerSP: {
    canonicalClassName: 'net.minecraft.client.entity.EntityPlayerSP',
    superclass: 'EntityPlayer',
    fields: {
      movementInput: 'MovementInput',
      sendQueue: 'NetHandlerPlayClient',
    },
    methods: {
      sendChatMessage: { params: ['String'], returnType: 'void' },
      swingItem: { params: [], returnType: 'void' },
      respawnPlayer: { params: [], returnType: 'void' },
      closeScreen: { params: [], returnType: 'void' },
    },
  },
  EntityPlayer: {
    canonicalClassName: 'net.minecraft.entity.player.EntityPlayer',
    superclass: 'EntityLivingBase',
    fields: {
      inventory: 'InventoryPlayer',
      inventoryContainer: 'Container',
      openContainer: 'Container',
      capabilities: 'PlayerCapabilities',
      foodStats: 'FoodStats',
      experienceLevel: 'int',
      experienceTotal: 'int',
      experience: 'float',
    },
    methods: {
      getGameProfile: { params: [], returnType: 'GameProfile' },
      isBlocking: { params: [], returnType: 'boolean' },
      getItemInUse: { params: [], returnType: 'ItemStack' },
      getItemInUseDuration: { params: [], returnType: 'int' },
    },
  },
  EntityLivingBase: {
    canonicalClassName: 'net.minecraft.entity.EntityLivingBase',
    superclass: 'Entity',
    fields: {
      renderYawOffset: 'float',
      rotationYawHead: 'float',
      prevRotationYawHead: 'float',
      jumpMovementFactor: 'float',
      hurtTime: 'int',
      maxHurtTime: 'int',
      attackedAtYaw: 'float',
      deathTime: 'int',
      moveStrafing: 'float',
      moveForward: 'float',
      isJumping: 'boolean',
    },
    methods: {
      getHealth: { params: [], returnType: 'float' },
      setHealth: { params: ['float'], returnType: 'void' },
      getMaxHealth: { params: [], returnType: 'float' },
      getHeldItem: { params: [], returnType: 'ItemStack' },
      getEquipmentInSlot: { params: ['int'], returnType: 'ItemStack' },
      isPotionActive: { params: ['Potion'], returnType: 'boolean' },
      getActivePotionEffects: { params: [], returnType: 'Collection' },
      swingItem: { params: [], returnType: 'void' },
    },
  },
  Entity: {
    canonicalClassName: 'net.minecraft.entity.Entity',
    fields: {
      entityId: 'int',
      posX: 'double',
      posY: 'double',
      posZ: 'double',
      motionX: 'double',
      motionY: 'double',
      motionZ: 'double',
      rotationYaw: 'float',
      rotationPitch: 'float',
      prevRotationYaw: 'float',
      prevRotationPitch: 'float',
      boundingBox: 'AxisAlignedBB',
      onGround: 'boolean',
      isCollidedHorizontally: 'boolean',
      isCollidedVertically: 'boolean',
      isCollided: 'boolean',
      velocityChanged: 'boolean',
      isDead: 'boolean',
      width: 'float',
      height: 'float',
      ticksExisted: 'int',
      stepHeight: 'float',
      noClip: 'boolean',
      entityCollisionReduction: 'float',
      worldObj: 'World',
      lastTickPosX: 'double',
      lastTickPosY: 'double',
      lastTickPosZ: 'double',
    },
    methods: {
      getEntityId: { params: [], returnType: 'int' },
      getName: { params: [], returnType: 'String' },
      getUniqueID: { params: [], returnType: 'UUID' },
      isSneaking: { params: [], returnType: 'boolean' },
      setSneaking: { params: ['boolean'], returnType: 'void' },
      isSprinting: { params: [], returnType: 'boolean' },
      setSprinting: { params: ['boolean'], returnType: 'void' },
      isInWater: { params: [], returnType: 'boolean' },
      isBurning: { params: [], returnType: 'boolean' },
      isRiding: { params: [], returnType: 'boolean' },
      getDistanceToEntity: { params: ['Entity'], returnType: 'float' },
      getDistanceSqToEntity: { params: ['Entity'], returnType: 'double' },
      setPosition: {
        params: ['double', 'double', 'double'],
        returnType: 'void',
      },
      setPositionAndRotation: {
        params: ['double', 'double', 'double', 'float', 'float'],
        returnType: 'void',
      },
    },
  },
  WorldClient: {
    canonicalClassName: 'net.minecraft.client.multiplayer.WorldClient',
    superclass: 'World',
    fields: {
      sendQueue: 'NetHandlerPlayClient',
    },
    methods: {
      sendQuittingDisconnectingPacket: { params: [], returnType: 'void' },
    },
  },
  World: {
    canonicalClassName: 'net.minecraft.world.World',
    fields: {
      loadedEntityList: 'List',
      playerEntities: 'List',
      loadedTileEntityList: 'List',
    },
    methods: {
      getBlockState: { params: ['BlockPos'], returnType: 'IBlockState' },
      getEntitiesWithinAABBExcludingEntity: {
        params: ['Entity', 'AxisAlignedBB'],
        returnType: 'List',
      },
      rayTraceBlocks: {
        params: ['Vec3', 'Vec3'],
        returnType: 'MovingObjectPosition',
      },
      spawnEntityInWorld: { params: ['Entity'], returnType: 'boolean' },
    },
  },
  PlayerControllerMP: {
    canonicalClassName: 'net.minecraft.client.multiplayer.PlayerControllerMP',
    fields: {
      curBlockDamageMP: 'float',
      blockHitDelay: 'int',
      isHittingBlock: 'boolean',
      currentGameType: 'GameType',
    },
    methods: {
      clickBlock: { params: ['BlockPos', 'EnumFacing'], returnType: 'boolean' },
      onPlayerDamageBlock: {
        params: ['BlockPos', 'EnumFacing'],
        returnType: 'boolean',
      },
      resetBlockRemoving: { params: [], returnType: 'void' },
      sendUseItem: {
        params: ['EntityPlayer', 'World', 'ItemStack'],
        returnType: 'boolean',
      },
      onPlayerRightClick: {
        params: [
          'EntityPlayerSP',
          'WorldClient',
          'ItemStack',
          'BlockPos',
          'EnumFacing',
          'Vec3',
        ],
        returnType: 'boolean',
      },
      interactWithEntitySendPacket: {
        params: ['EntityPlayer', 'Entity'],
        returnType: 'boolean',
      },
      attackEntity: { params: ['EntityPlayer', 'Entity'], returnType: 'void' },
      windowClick: {
        params: ['int', 'int', 'int', 'int', 'EntityPlayer'],
        returnType: 'ItemStack',
      },
    },
  },
  GameSettings: {
    canonicalClassName: 'net.minecraft.client.settings.GameSettings',
    fields: {
      keyBindForward: 'KeyBinding',
      keyBindLeft: 'KeyBinding',
      keyBindBack: 'KeyBinding',
      keyBindRight: 'KeyBinding',
      keyBindJump: 'KeyBinding',
      keyBindSneak: 'KeyBinding',
      keyBindSprint: 'KeyBinding',
      keyBindAttack: 'KeyBinding',
      keyBindUseItem: 'KeyBinding',
      keyBindDrop: 'KeyBinding',
      keyBindInventory: 'KeyBinding',
      keyBindChat: 'KeyBinding',
      keyBindings: 'KeyBinding[]',
      mouseSensitivity: 'float',
      invertMouse: 'boolean',
      fovSetting: 'float',
      gammaSetting: 'float',
      renderDistanceChunks: 'int',
      limitFramerate: 'int',
      fancyGraphics: 'boolean',
      viewBobbing: 'boolean',
      fullScreen: 'boolean',
    },
    methods: {},
  },
  KeyBinding: {
    canonicalClassName: 'net.minecraft.client.settings.KeyBinding',
    fields: {
      keyDescription: 'String',
      keyCode: 'int',
      pressed: 'boolean',
      pressTime: 'int',
    },
    methods: {
      setKeyBindState: { params: ['int', 'boolean'], returnType: 'void' },
      onTick: { params: ['int'], returnType: 'void' },
      unPressAllKeys: { params: [], returnType: 'void' },
      isKeyDown: { params: [], returnType: 'boolean' },
      isPressed: { params: [], returnType: 'boolean' },
      getKeyCode: { params: [], returnType: 'int' },
    },
  },
  GuiScreen: {
    canonicalClassName: 'net.minecraft.client.gui.GuiScreen',
    fields: {
      mc: 'Minecraft',
      buttonList: 'List',
      width: 'int',
      height: 'int',
      allowUserInput: 'boolean',
    },
    methods: {
      drawScreen: { params: ['int', 'int', 'float'], returnType: 'void' },
      keyTyped: { params: ['char', 'int'], returnType: 'void' },
      mouseClicked: { params: ['int', 'int', 'int'], returnType: 'void' },
      mouseReleased: { params: ['int', 'int', 'int'], returnType: 'void' },
      actionPerformed: { params: ['GuiButton'], returnType: 'void' },
      initGui: { params: [], returnType: 'void' },
      updateScreen: { params: [], returnType: 'void' },
      onGuiClosed: { params: [], returnType: 'void' },
      doesGuiPauseGame: { params: [], returnType: 'boolean' },
    },
  },
  GuiButton: {
    canonicalClassName: 'net.minecraft.client.gui.GuiButton',
    fields: {
      id: 'int',
      xPosition: 'int',
      yPosition: 'int',
      width: 'int',
      height: 'int',
      displayString: 'String',
      enabled: 'boolean',
      visible: 'boolean',
    },
  },
  GuiMainMenu: {
    canonicalClassName: 'net.minecraft.client.gui.GuiMainMenu',
    superclass: 'GuiScreen',
    fields: {
      field_175373_f: 'AtomicInteger',
      splashText: 'String',
      panoramaTimer: 'int',
      updateCounter: 'float',
      buttonResetDemo: 'GuiButton',
    },
    methods: {
      initGui: { params: [], returnType: 'void' },
      actionPerformed: { params: ['GuiButton'], returnType: 'void' },
      drawScreen: { params: ['int', 'int', 'float'], returnType: 'void' },
      mouseClicked: { params: ['int', 'int', 'int'], returnType: 'void' },
    },
  },
  GuiSelectWorld: {
    canonicalClassName: 'net.minecraft.client.gui.GuiSelectWorld',
    superclass: 'GuiScreen',
    fields: {
      parentScreen: 'GuiScreen',
      screenTitle: 'String',
      selectedIndex: 'int',
      field_146633_h: 'DateFormat',
      deleteButton: 'GuiButton',
      selectButton: 'GuiButton',
      renameButton: 'GuiButton',
      recreateButton: 'GuiButton',
    },
    methods: {
      initGui: { params: [], returnType: 'void' },
      actionPerformed: { params: ['GuiButton'], returnType: 'void' },
    },
  },
  GuiCreateWorld: {
    canonicalClassName: 'net.minecraft.client.gui.GuiCreateWorld',
    superclass: 'GuiScreen',
    fields: {
      parentScreen: 'GuiScreen',
      worldNameField: 'GuiTextField',
      worldSeedField: 'GuiTextField',
      saveDirName: 'String',
      gameMode: 'String',
      generateStructuresEnabled: 'boolean',
      allowCheats: 'boolean',
      allowCheatsWasSetByUser: 'boolean',
      bonusChestEnabled: 'boolean',
      hardCoreMode: 'boolean',
      alreadyGenerated: 'boolean',
      inMoreWorldOptionsDisplay: 'boolean',
      btnGameMode: 'GuiButton',
      btnMoreOptions: 'GuiButton',
    },
    methods: {
      initGui: { params: [], returnType: 'void' },
      actionPerformed: { params: ['GuiButton'], returnType: 'void' },
    },
  },
  GuiScreenServerList: {
    canonicalClassName: 'net.minecraft.client.gui.GuiScreenServerList',
    superclass: 'GuiScreen',
    fields: {
      field_146303_a: 'GuiScreen',
      field_146301_f: 'ServerData',
      field_146302_g: 'GuiTextField',
    },
    methods: {
      initGui: { params: [], returnType: 'void' },
      actionPerformed: { params: ['GuiButton'], returnType: 'void' },
    },
  },
  GuiScreenAddServer: {
    canonicalClassName: 'net.minecraft.client.gui.GuiScreenAddServer',
    superclass: 'GuiScreen',
    fields: {
      parentScreen: 'GuiScreen',
      serverData: 'ServerData',
      serverIPField: 'GuiTextField',
      serverNameField: 'GuiTextField',
    },
    methods: {
      initGui: { params: [], returnType: 'void' },
      actionPerformed: { params: ['GuiButton'], returnType: 'void' },
    },
  },
  GuiMultiplayer: {
    canonicalClassName: 'net.minecraft.client.gui.GuiMultiplayer',
    superclass: 'GuiScreen',
    fields: {
      parentScreen: 'GuiScreen',
      serverListSelector: 'ServerSelectionList',
      savedServerList: 'ServerList',
      btnEditServer: 'GuiButton',
      btnSelectServer: 'GuiButton',
      btnDeleteServer: 'GuiButton',
    },
    methods: {
      initGui: { params: [], returnType: 'void' },
      actionPerformed: { params: ['GuiButton'], returnType: 'void' },
    },
  },
  GuiIngameMenu: {
    canonicalClassName: 'net.minecraft.client.gui.GuiIngameMenu',
    superclass: 'GuiScreen',
    fields: {
      field_146445_a: 'int',
      field_146444_f: 'int',
    },
    methods: {
      initGui: { params: [], returnType: 'void' },
      actionPerformed: { params: ['GuiButton'], returnType: 'void' },
    },
  },
  GuiOptions: {
    canonicalClassName: 'net.minecraft.client.gui.GuiOptions',
    superclass: 'GuiScreen',
    fields: {
      field_146441_g: 'GuiScreen',
      game_settings_2: 'GameSettings',
      screenTitle: 'String',
    },
    methods: {
      initGui: { params: [], returnType: 'void' },
      actionPerformed: { params: ['GuiButton'], returnType: 'void' },
    },
  },
  GuiConnecting: {
    canonicalClassName: 'net.minecraft.client.multiplayer.GuiConnecting',
    superclass: 'GuiScreen',
    fields: {
      previousGuiScreen: 'GuiScreen',
      networkManager: 'NetworkManager',
      cancel: 'boolean',
    },
    methods: {
      initGui: { params: [], returnType: 'void' },
      actionPerformed: { params: ['GuiButton'], returnType: 'void' },
    },
  },
  GuiDisconnected: {
    canonicalClassName: 'net.minecraft.client.gui.GuiDisconnected',
    superclass: 'GuiScreen',
    fields: {
      parentScreen: 'GuiScreen',
      reason: 'String',
      multilineMessage: 'List',
    },
    methods: {
      initGui: { params: [], returnType: 'void' },
      actionPerformed: { params: ['GuiButton'], returnType: 'void' },
    },
  },
  GuiChat: {
    canonicalClassName: 'net.minecraft.client.gui.GuiChat',
    superclass: 'GuiScreen',
    fields: {
      defaultInputFieldText: 'String',
    },
    methods: {
      initGui: { params: [], returnType: 'void' },
      keyTyped: { params: ['char', 'int'], returnType: 'void' },
    },
  },
  GuiContainer: {
    canonicalClassName: 'net.minecraft.client.gui.inventory.GuiContainer',
    superclass: 'GuiScreen',
    fields: {
      inventorySlots: 'Container',
      guiLeft: 'int',
      guiTop: 'int',
      xSize: 'int',
      ySize: 'int',
    },
    methods: {
      initGui: { params: [], returnType: 'void' },
      drawScreen: { params: ['int', 'int', 'float'], returnType: 'void' },
    },
  },
  GuiInventory: {
    canonicalClassName: 'net.minecraft.client.gui.inventory.GuiInventory',
    superclass: 'GuiContainer',
    fields: {
      oldMouseX: 'float',
      oldMouseY: 'float',
    },
    methods: {
      initGui: { params: [], returnType: 'void' },
      drawScreen: { params: ['int', 'int', 'float'], returnType: 'void' },
    },
  },
  InventoryPlayer: {
    canonicalClassName: 'net.minecraft.entity.player.InventoryPlayer',
    fields: {
      mainInventory: 'ItemStack[]',
      armorInventory: 'ItemStack[]',
      currentItem: 'int',
    },
    methods: {
      getCurrentItem: { params: [], returnType: 'ItemStack' },
      getFirstEmptyStack: { params: [], returnType: 'int' },
      addItemStackToInventory: { params: ['ItemStack'], returnType: 'boolean' },
      getStackInSlot: { params: ['int'], returnType: 'ItemStack' },
      armorItemInSlot: { params: ['int'], returnType: 'ItemStack' },
      dropAllItems: { params: [], returnType: 'void' },
    },
  },
  ItemStack: {
    canonicalClassName: 'net.minecraft.item.ItemStack',
    fields: {
      stackSize: 'int',
      animationsToGo: 'int',
      item: 'Item',
      stackTagCompound: 'NBTTagCompound',
      itemDamage: 'int',
    },
    methods: {
      getItem: { params: [], returnType: 'Item' },
      getMaxStackSize: { params: [], returnType: 'int' },
      isItemStackDamageable: { params: [], returnType: 'boolean' },
      getItemDamage: { params: [], returnType: 'int' },
      setItemDamage: { params: ['int'], returnType: 'void' },
      getMaxDamage: { params: [], returnType: 'int' },
      getDisplayName: { params: [], returnType: 'String' },
      hasTagCompound: { params: [], returnType: 'boolean' },
      getTagCompound: { params: [], returnType: 'NBTTagCompound' },
      isItemEnchanted: { params: [], returnType: 'boolean' },
    },
  },
  Item: {
    canonicalClassName: 'net.minecraft.item.Item',
    fields: {
      itemRegistry: 'RegistryNamespaced',
    },
    methods: {
      getItemById: { params: ['int'], returnType: 'Item' },
      getIdFromItem: { params: ['Item'], returnType: 'int' },
      getItemFromBlock: { params: ['Block'], returnType: 'Item' },
      getUnlocalizedName: { params: [], returnType: 'String' },
      getMaxItemUseDuration: { params: ['ItemStack'], returnType: 'int' },
    },
  },
  Block: {
    canonicalClassName: 'net.minecraft.block.Block',
    fields: {
      blockRegistry: 'RegistryNamespacedDefaultedByKey',
      material: 'Material',
    },
    methods: {
      getBlockById: { params: ['int'], returnType: 'Block' },
      getIdFromBlock: { params: ['Block'], returnType: 'int' },
      getBlockFromName: { params: ['String'], returnType: 'Block' },
      getBlockFromItem: { params: ['Item'], returnType: 'Block' },
      getLocalizedName: { params: [], returnType: 'String' },
    },
  },
  IBlockState: {
    canonicalClassName: 'net.minecraft.block.state.IBlockState',
    fields: {},
    methods: {
      getBlock: { params: [], returnType: 'Block' },
    },
  },
  BlockPos: {
    canonicalClassName: 'net.minecraft.util.BlockPos',
    fields: {
      x: 'int',
      y: 'int',
      z: 'int',
    },
    methods: {
      getX: { params: [], returnType: 'int' },
      getY: { params: [], returnType: 'int' },
      getZ: { params: [], returnType: 'int' },
      add: { params: ['int', 'int', 'int'], returnType: 'BlockPos' },
      up: { params: [], returnType: 'BlockPos' },
      down: { params: [], returnType: 'BlockPos' },
      fromLong: { params: ['long'], returnType: 'BlockPos' },
      toLong: { params: [], returnType: 'long' },
    },
  },
  Vec3: {
    canonicalClassName: 'net.minecraft.util.Vec3',
    fields: {
      xCoord: 'double',
      yCoord: 'double',
      zCoord: 'double',
    },
    methods: {
      addVector: { params: ['double', 'double', 'double'], returnType: 'Vec3' },
      distanceTo: { params: ['Vec3'], returnType: 'double' },
      squareDistanceTo: { params: ['Vec3'], returnType: 'double' },
      lengthVector: { params: [], returnType: 'double' },
      normalize: { params: [], returnType: 'Vec3' },
      dotProduct: { params: ['Vec3'], returnType: 'double' },
    },
  },
  AxisAlignedBB: {
    canonicalClassName: 'net.minecraft.util.AxisAlignedBB',
    fields: {
      minX: 'double',
      minY: 'double',
      minZ: 'double',
      maxX: 'double',
      maxY: 'double',
      maxZ: 'double',
    },
    methods: {
      addCoord: {
        params: ['double', 'double', 'double'],
        returnType: 'AxisAlignedBB',
      },
      expand: {
        params: ['double', 'double', 'double'],
        returnType: 'AxisAlignedBB',
      },
      contract: {
        params: ['double', 'double', 'double'],
        returnType: 'AxisAlignedBB',
      },
      offset: {
        params: ['double', 'double', 'double'],
        returnType: 'AxisAlignedBB',
      },
      intersectsWith: { params: ['AxisAlignedBB'], returnType: 'boolean' },
      isVecInside: { params: ['Vec3'], returnType: 'boolean' },
    },
  },
  MovingObjectPosition: {
    canonicalClassName: 'net.minecraft.util.MovingObjectPosition',
    fields: {
      typeOfHit: 'MovingObjectType',
      sideHit: 'EnumFacing',
      hitVec: 'Vec3',
      entityHit: 'Entity',
      blockPos: 'BlockPos',
    },
    methods: {
      getBlockPos: { params: [], returnType: 'BlockPos' },
    },
  },
  Timer: {
    canonicalClassName: 'net.minecraft.util.Timer',
    fields: {
      timerSpeed: 'float',
      elapsedPartialTicks: 'float',
      elapsedTicks: 'int',
      renderPartialTicks: 'float',
    },
    methods: {
      updateTimer: { params: [], returnType: 'void' },
    },
  },
  RenderManager: {
    canonicalClassName: 'net.minecraft.client.renderer.entity.RenderManager',
    fields: {
      renderPosX: 'double',
      renderPosY: 'double',
      renderPosZ: 'double',
      viewerPosX: 'double',
      viewerPosY: 'double',
      viewerPosZ: 'double',
      playerViewX: 'float',
      playerViewY: 'float',
    },
    methods: {},
  },
  EntityRenderer: {
    canonicalClassName: 'net.minecraft.client.renderer.EntityRenderer',
    fields: {
      mc: 'Minecraft',
      farPlaneDistance: 'float',
      pointedEntity: 'Entity',
    },
    methods: {
      getMouseOver: { params: ['float'], returnType: 'void' },
      orientCamera: { params: ['float'], returnType: 'void' },
      setupCameraTransform: { params: ['float', 'int'], returnType: 'void' },
    },
  },
  Session: {
    canonicalClassName: 'net.minecraft.util.Session',
    fields: {
      username: 'String',
      playerID: 'String',
      token: 'String',
    },
    methods: {
      getUsername: { params: [], returnType: 'String' },
      getPlayerID: { params: [], returnType: 'String' },
      getToken: { params: [], returnType: 'String' },
      getSessionID: { params: [], returnType: 'String' },
    },
  },
  PlayerCapabilities: {
    canonicalClassName: 'net.minecraft.entity.player.PlayerCapabilities',
    fields: {
      disableDamage: 'boolean',
      isFlying: 'boolean',
      allowFlying: 'boolean',
      isCreativeMode: 'boolean',
      allowEdit: 'boolean',
      flySpeed: 'float',
      walkSpeed: 'float',
    },
    methods: {
      getFlySpeed: { params: [], returnType: 'float' },
      setFlySpeed: { params: ['float'], returnType: 'void' },
      getWalkSpeed: { params: [], returnType: 'float' },
      setPlayerWalkSpeed: { params: ['float'], returnType: 'void' },
      writeCapabilitiesToNBT: {
        params: ['NBTTagCompound'],
        returnType: 'void',
      },
      readCapabilitiesFromNBT: {
        params: ['NBTTagCompound'],
        returnType: 'void',
      },
    },
  },
  NBTTagCompound: {
    canonicalClassName: 'net.minecraft.nbt.NBTTagCompound',
    fields: {
      tagMap: 'Map',
    },
    methods: {
      setTag: { params: ['String', 'Object'], returnType: 'void' },
      setByte: { params: ['String', 'byte'], returnType: 'void' },
      setShort: { params: ['String', 'short'], returnType: 'void' },
      setInteger: { params: ['String', 'int'], returnType: 'void' },
      setLong: { params: ['String', 'long'], returnType: 'void' },
      setFloat: { params: ['String', 'float'], returnType: 'void' },
      setDouble: { params: ['String', 'double'], returnType: 'void' },
      setString: { params: ['String', 'String'], returnType: 'void' },
      setByteArray: { params: ['String', 'byte[]'], returnType: 'void' },
      setIntArray: { params: ['String', 'int[]'], returnType: 'void' },
      setBoolean: { params: ['String', 'boolean'], returnType: 'void' },
      getTag: { params: ['String'], returnType: 'Object' },
      getByte: { params: ['String'], returnType: 'byte' },
      getShort: { params: ['String'], returnType: 'short' },
      getInteger: { params: ['String'], returnType: 'int' },
      getLong: { params: ['String'], returnType: 'long' },
      getFloat: { params: ['String'], returnType: 'float' },
      getDouble: { params: ['String'], returnType: 'double' },
      getString: { params: ['String'], returnType: 'String' },
      getByteArray: { params: ['String'], returnType: 'byte[]' },
      getIntArray: { params: ['String'], returnType: 'int[]' },
      getCompoundTag: { params: ['String'], returnType: 'NBTTagCompound' },
      getTagList: { params: ['String', 'int'], returnType: 'Object' },
      getBoolean: { params: ['String'], returnType: 'boolean' },
      hasKey: { params: ['String'], returnType: 'boolean' },
      removeTag: { params: ['String'], returnType: 'void' },
    },
  },
  MovementInput: {
    canonicalClassName: 'net.minecraft.util.MovementInput',
    fields: {
      moveStrafe: 'float',
      moveForward: 'float',
      jump: 'boolean',
      sneak: 'boolean',
    },
    methods: {
      updatePlayerMoveState: { params: [], returnType: 'void' },
    },
  },
  FoodStats: {
    canonicalClassName: 'net.minecraft.util.FoodStats',
    fields: {
      foodLevel: 'int',
      foodSaturationLevel: 'float',
      foodExhaustionLevel: 'float',
      foodTimer: 'int',
      prevFoodLevel: 'int',
    },
    methods: {
      addStats: { params: ['int', 'float'], returnType: 'void' },
      onUpdate: { params: ['EntityPlayer'], returnType: 'void' },
      readNBT: { params: ['NBTTagCompound'], returnType: 'void' },
      writeNBT: { params: ['NBTTagCompound'], returnType: 'void' },
      getFoodLevel: { params: [], returnType: 'int' },
      needFood: { params: [], returnType: 'boolean' },
      addExhaustion: { params: ['float'], returnType: 'void' },
      getSaturationLevel: { params: [], returnType: 'float' },
      setFoodLevel: { params: ['int'], returnType: 'void' },
      setFoodSaturationLevel: { params: ['float'], returnType: 'void' },
    },
  },
};

/**
 * Automatically builds MCP (identity) mappings from the declarative canonical schema.
 */
export function createMcpMappings(): MinecraftMappings {
  const result: Partial<MinecraftMappings> = {};
  for (const [k, schema] of Object.entries(MINECRAFT_CANONICAL_SCHEMA)) {
    const key = k as MinecraftClassKey;
    const fields: Record<string, string> = {};
    for (const f of Object.keys(schema.fields ?? {})) {
      fields[f] = f;
    }
    const methods: Record<string, string> = {};
    if (schema.methods) {
      if (Array.isArray(schema.methods)) {
        for (const m of schema.methods) {
          methods[m] = m;
        }
      } else {
        for (const m of Object.keys(schema.methods)) {
          methods[m] = m;
        }
      }
    }
    result[key] = {
      realClassName: schema.canonicalClassName,
      fields,
      methods,
    };
  }
  return result as MinecraftMappings;
}

export const MCP_1_8_9_MAPPINGS: MinecraftMappings = createMcpMappings();
