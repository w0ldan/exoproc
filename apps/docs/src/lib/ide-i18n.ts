'use client';

import { usePathname } from 'next/navigation';
import { useI18n } from 'fumadocs-ui/contexts/i18n';
import { parseLocalizedPathname } from '@/lib/i18n';

export type IdeLocale = 'tr' | 'en';

export interface IdeTranslations {
  readonly activityBar: {
    readonly viewsAria: string;
    readonly home: string;
    readonly docs: string;
    readonly settings: string;
  };
  readonly views: {
    readonly explorer: string;
    readonly debugger: string;
    readonly snapshots: string;
  };
  readonly explorer: {
    readonly title: string;
    readonly newFile: string;
    readonly newFolder: string;
    readonly openFolder: string;
    readonly importZip: string;
    readonly importingZip: string;
    readonly refresh: string;
    readonly openingWorkspace: string;
    readonly backToCode: string;
    readonly backToCodeTooltip: string;
    readonly promptNewFileName: string;
    readonly fileCreateError: string;
    readonly promptNewFolderName: string;
    readonly folderCreateError: string;
    readonly zipImported: (name: string) => string;
    readonly zipImportError: string;
    readonly zipImportFailed: (name: string, message: string) => string;
    readonly unsavedChangesCloseConfirm: (name: string) => string;
    readonly deleteConfirm: (name: string, isDirectory: boolean) => string;
    readonly deleteItemAria: (name: string) => string;
    readonly loading: string;
    readonly folderUnreadable: string;
    readonly folderEmpty: string;
    readonly workspaceFilesAria: string;
    readonly fileNamePlaceholder: string;
    readonly newFileNameAria: string;
    readonly save: string;
    readonly saved: string;
    readonly unsavedChanges: string;
    readonly run: string;
    readonly runTooltip: string;
    readonly opening: string;
    readonly emptyState: string;
  };
  readonly folderPicker: {
    readonly title: string;
    readonly description: string;
    readonly desktop: string;
    readonly workspace: string;
    readonly newFolder: string;
    readonly newFolderAria: string;
    readonly folderNamePlaceholder: string;
    readonly folderNameAria: string;
    readonly loading: string;
    readonly emptyFolder: string;
    readonly rename: string;
    readonly renameAria: (name: string) => string;
    readonly renameInputAria: (name: string) => string;
    readonly deleteAria: (name: string) => string;
    readonly cancel: string;
    readonly selectFolder: (path: string) => string;
    readonly connecting: string;
    readonly readError: string;
    readonly bindError: string;
    readonly createError: string;
    readonly renameError: string;
  };
  readonly debugger: {
    readonly title: string;
    readonly createDemoAria: string;
    readonly launchDemo: string;
    readonly processes: string;
    readonly noProcesses: string;
    readonly threadLabel: (tid: number) => string;
  };
  readonly snapshots: {
    readonly title: string;
    readonly namePlaceholder: string;
    readonly nameAria: string;
    readonly takeSnapshot: string;
    readonly creating: string;
    readonly noSnapshots: string;
    readonly restore: string;
    readonly restoreAria: (name: string) => string;
    readonly delete: string;
    readonly deleteAria: (name: string) => string;
    readonly created: (name: string) => string;
    readonly createFailed: (name: string, message: string) => string;
    readonly restored: (name: string) => string;
    readonly restoreFailed: (name: string, message: string) => string;
    readonly deleted: (name: string) => string;
    readonly deleteFailed: (name: string, message: string) => string;
    readonly createErrorDefault: string;
    readonly restoreErrorDefault: string;
    readonly deleteErrorDefault: string;
  };
  readonly bottomPanel: {
    readonly terminal: string;
    readonly debugLogs: string;
    readonly output: string;
    readonly memory: string;
    readonly trace: string;
    readonly noLogs: string;
  };
  readonly commandPalette: {
    readonly placeholder: string;
    readonly searchAria: string;
    readonly noMatching: string;
    readonly viewShow: (viewTitle: string) => string;
  };
  readonly common: {
    readonly loading: string;
  };
}

const trTranslations: IdeTranslations = {
  activityBar: {
    viewsAria: 'IDE görünümleri',
    home: 'Ana Sayfa',
    docs: 'Belgeler',
    settings: 'Ayarlar',
  },
  views: {
    explorer: 'Gezgin',
    debugger: 'Çalıştır ve Hata Ayıkla',
    snapshots: "VM Snapshot'ları",
  },
  explorer: {
    title: 'Gezgin',
    newFile: 'Yeni Dosya',
    newFolder: 'Yeni Klasör',
    openFolder: 'Klasör Aç',
    importZip: 'Zip İçe Aktar',
    importingZip: 'Zip içe aktarılıyor…',
    refresh: 'Yenile',
    openingWorkspace: 'Workspace açılıyor…',
    backToCode: 'Koda Dön',
    backToCodeTooltip: 'Hata ayıklayıcıdan ayrıl ve kod düzenleyiciye dön',
    promptNewFileName: 'Yeni dosya adı (örn: test.ts):',
    fileCreateError: 'Dosya oluşturulamadı.',
    promptNewFolderName: 'Yeni klasör adı:',
    folderCreateError: 'Klasör oluşturulamadı.',
    zipImported: (name) => `Zip içe aktarıldı: ${name}`,
    zipImportError: 'Zip içe aktarılamadı.',
    zipImportFailed: (name, message) =>
      `Zip içe aktarılamadı: ${name} — ${message}`,
    unsavedChangesCloseConfirm: (name) =>
      `"${name}" için kaydedilmemiş değişiklikler var. Yine de kapatılsın mı?`,
    deleteConfirm: (name, isDirectory) =>
      `"${name}" ${isDirectory ? 'klasörü ve içindeki her şey' : 'dosyası'} silinsin mi?`,
    deleteItemAria: (name) => `"${name}" öğesini sil`,
    loading: 'Yükleniyor…',
    folderUnreadable: 'Klasör okunamadı.',
    folderEmpty: 'Klasör boş.',
    workspaceFilesAria: 'Çalışma alanı dosyaları',
    fileNamePlaceholder: 'Dosya adı',
    newFileNameAria: 'Yeni dosya adı',
    save: 'Kaydet',
    saved: 'Kaydedildi',
    unsavedChanges: 'Kaydedilmemiş değişiklikler',
    run: 'Çalıştır',
    runTooltip: 'Dosyayı terminalde çalıştır (Node/TS)',
    opening: 'Açılıyor…',
    emptyState: "Düzenleyicide görüntülemek için Gezgin'den bir dosya seçin.",
  },
  folderPicker: {
    title: 'Klasör Seç',
    description:
      'Simulate ağacında gezip workspace root olarak bir klasör seç; gezerken klasör oluşturabilir, yeniden adlandırabilir ve silebilirsin.',
    desktop: 'Masaüstü',
    workspace: 'Workspace',
    newFolder: 'Yeni klasör',
    newFolderAria: 'Yeni klasör oluştur',
    folderNamePlaceholder: 'Klasör adı',
    folderNameAria: 'Yeni klasör adı',
    loading: 'Yükleniyor…',
    emptyFolder: 'Bu klasör boş.',
    rename: 'Yeniden adlandır',
    renameAria: (name) => `"${name}" öğesini yeniden adlandır`,
    renameInputAria: (name) => `"${name}" için yeni ad`,
    deleteAria: (name) => `"${name}" öğesini sil`,
    cancel: 'İptal',
    selectFolder: (path) => `"${path}" klasörünü seç`,
    connecting: 'Bağlanıyor…',
    readError: 'Dizin okunamadı.',
    bindError: 'Workspace bağlanamadı.',
    createError: 'Klasör oluşturulamadı.',
    renameError: 'Yeniden adlandırılamadı.',
  },
  debugger: {
    title: 'Çalıştır ve Hata Ayıkla',
    createDemoAria: 'Demo process oluştur',
    launchDemo: 'Demo process başlat',
    processes: 'İşlemler (Processes)',
    noProcesses:
      "Henüz process yok. Debugger'ı denemek için bir demo process başlatın.",
    threadLabel: (tid) => `Thread ${tid}`,
  },
  snapshots: {
    title: "VM Snapshot'ları",
    namePlaceholder: 'Snapshot adı',
    nameAria: 'Yeni snapshot adı',
    takeSnapshot: 'Snapshot Al',
    creating: 'Oluşturuluyor…',
    noSnapshots:
      'Henüz snapshot yok. Makinenin durumunu kaydetmek için yukarıdan bir isim girip "Snapshot Al"a tıklayın.',
    restore: 'Geri Yükle',
    restoreAria: (name) => `"${name}" snapshot'ını geri yükle`,
    delete: 'Sil',
    deleteAria: (name) => `"${name}" snapshot'ını sil`,
    created: (name) => `Snapshot oluşturuldu: ${name}`,
    createFailed: (name, message) =>
      `Snapshot oluşturulamadı: ${name} — ${message}`,
    restored: (name) => `Snapshot geri yüklendi: ${name}`,
    restoreFailed: (name, message) =>
      `Snapshot geri yüklenemedi: ${name} — ${message}`,
    deleted: (name) => `Snapshot silindi: ${name}`,
    deleteFailed: (name, message) =>
      `Snapshot silinemedi: ${name} — ${message}`,
    createErrorDefault: 'Snapshot oluşturulamadı.',
    restoreErrorDefault: 'Snapshot geri yüklenemedi.',
    deleteErrorDefault: 'Snapshot silinemedi.',
  },
  bottomPanel: {
    terminal: 'Terminal',
    debugLogs: 'Hata Ayıklama Günlükleri',
    output: 'Çıktı',
    memory: 'Bellek',
    trace: 'İzleme',
    noLogs: 'Henüz kayıt yok.',
  },
  commandPalette: {
    placeholder: 'Bir komut yazın',
    searchAria: 'Komut ara',
    noMatching: 'Eşleşen komut yok',
    viewShow: (viewTitle) => `Görünüm: ${viewTitle} Göster`,
  },
  common: {
    loading: 'IDE yükleniyor…',
  },
};

const enTranslations: IdeTranslations = {
  activityBar: {
    viewsAria: 'IDE views',
    home: 'Home',
    docs: 'Docs',
    settings: 'Settings',
  },
  views: {
    explorer: 'Explorer',
    debugger: 'Run and Debug',
    snapshots: 'VM Snapshots',
  },
  explorer: {
    title: 'Explorer',
    newFile: 'New File',
    newFolder: 'New Folder',
    openFolder: 'Open Folder',
    importZip: 'Import Zip',
    importingZip: 'Importing zip…',
    refresh: 'Refresh',
    openingWorkspace: 'Opening workspace…',
    backToCode: 'Back to Code',
    backToCodeTooltip: 'Leave debugger and return to code editor',
    promptNewFileName: 'New file name (e.g. test.ts):',
    fileCreateError: 'Failed to create file.',
    promptNewFolderName: 'New folder name:',
    folderCreateError: 'Failed to create folder.',
    zipImported: (name) => `Zip imported: ${name}`,
    zipImportError: 'Failed to import zip.',
    zipImportFailed: (name, message) =>
      `Failed to import zip: ${name} — ${message}`,
    unsavedChangesCloseConfirm: (name) =>
      `There are unsaved changes for "${name}". Close anyway?`,
    deleteConfirm: (name, isDirectory) =>
      `Delete "${name}" ${isDirectory ? 'folder and everything inside it' : 'file'}?`,
    deleteItemAria: (name) => `Delete "${name}"`,
    loading: 'Loading…',
    folderUnreadable: 'Could not read folder.',
    folderEmpty: 'Folder is empty.',
    workspaceFilesAria: 'Workspace files',
    fileNamePlaceholder: 'File name',
    newFileNameAria: 'New file name',
    save: 'Save',
    saved: 'Saved',
    unsavedChanges: 'Unsaved changes',
    run: 'Run',
    runTooltip: 'Run file in terminal (Node/TS)',
    opening: 'Opening…',
    emptyState: 'Select a file from Explorer to view in the editor.',
  },
  folderPicker: {
    title: 'Select Folder',
    description:
      'Browse the simulated tree and select a folder as workspace root; you can create, rename, and delete folders while browsing.',
    desktop: 'Desktop',
    workspace: 'Workspace',
    newFolder: 'New folder',
    newFolderAria: 'Create new folder',
    folderNamePlaceholder: 'Folder name',
    folderNameAria: 'New folder name',
    loading: 'Loading…',
    emptyFolder: 'This folder is empty.',
    rename: 'Rename',
    renameAria: (name) => `Rename "${name}"`,
    renameInputAria: (name) => `New name for "${name}"`,
    deleteAria: (name) => `Delete "${name}"`,
    cancel: 'Cancel',
    selectFolder: (path) => `Select "${path}" folder`,
    connecting: 'Connecting…',
    readError: 'Could not read directory.',
    bindError: 'Failed to bind workspace.',
    createError: 'Failed to create folder.',
    renameError: 'Failed to rename.',
  },
  debugger: {
    title: 'Run and Debug',
    createDemoAria: 'Create demo process',
    launchDemo: 'Launch demo process',
    processes: 'Processes',
    noProcesses: 'No processes yet. Launch a demo process to try the debugger.',
    threadLabel: (tid) => `Thread ${tid}`,
  },
  snapshots: {
    title: 'VM Snapshots',
    namePlaceholder: 'Snapshot name',
    nameAria: 'New snapshot name',
    takeSnapshot: 'Take Snapshot',
    creating: 'Creating…',
    noSnapshots:
      'No snapshots yet. Enter a name above and click "Take Snapshot" to save the machine state.',
    restore: 'Restore',
    restoreAria: (name) => `Restore snapshot "${name}"`,
    delete: 'Delete',
    deleteAria: (name) => `Delete snapshot "${name}"`,
    created: (name) => `Snapshot created: ${name}`,
    createFailed: (name, message) =>
      `Failed to create snapshot: ${name} — ${message}`,
    restored: (name) => `Snapshot restored: ${name}`,
    restoreFailed: (name, message) =>
      `Failed to restore snapshot: ${name} — ${message}`,
    deleted: (name) => `Snapshot deleted: ${name}`,
    deleteFailed: (name, message) =>
      `Failed to delete snapshot: ${name} — ${message}`,
    createErrorDefault: 'Failed to create snapshot.',
    restoreErrorDefault: 'Failed to restore snapshot.',
    deleteErrorDefault: 'Failed to delete snapshot.',
  },
  bottomPanel: {
    terminal: 'Terminal',
    debugLogs: 'Debug Logs',
    output: 'Output',
    memory: 'Memory',
    trace: 'Trace',
    noLogs: 'No logs yet.',
  },
  commandPalette: {
    placeholder: 'Type a command',
    searchAria: 'Search commands',
    noMatching: 'No matching commands',
    viewShow: (viewTitle) => `View: Show ${viewTitle}`,
  },
  common: {
    loading: 'Loading IDE…',
  },
};

export function normalizeLocale(raw?: string | null): IdeLocale {
  return raw === 'en' ? 'en' : 'tr';
}

export function getIdeTranslations(lang?: string | null): IdeTranslations {
  return normalizeLocale(lang) === 'en' ? enTranslations : trTranslations;
}

export function useIdeLanguage(): IdeLocale {
  let ctxLocale: string | undefined;
  try {
    const i18nCtx = useI18n();
    ctxLocale = i18nCtx?.locale;
  } catch {
    // ignore if outside provider
  }
  const pathname = usePathname() ?? '';
  if (ctxLocale) return normalizeLocale(ctxLocale);
  return normalizeLocale(parseLocalizedPathname(pathname).lang);
}

export function useIdeTranslation(explicitLang?: string): {
  lang: IdeLocale;
  t: IdeTranslations;
} {
  const detectedLang = useIdeLanguage();
  const lang = normalizeLocale(explicitLang ?? detectedLang);
  return { lang, t: getIdeTranslations(lang) };
}
