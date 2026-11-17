import type {
  AppServices,
  AppSettingsLoadResult,
  AppSettingsService,
  DataFolderStatus,
  LogService,
  VaultRootService,
} from "@upriv/shared";
import { isSafContentUri, newJobId, normalizeAppSettings } from "@upriv/shared";
import {
  rpcAppSettingsGet,
  rpcAppSettingsSave,
  rpcDataFolderApply,
  rpcDataFolderList,
  rpcDataFolderSearch,
  rpcDataFolderStatus,
  rpcLogDelete,
  rpcLogEvent,
  rpcLogGet,
  rpcLogList,
  rpcVaultRootResolve,
} from "@/lib/rpc";
import { nativeVaultGroupService } from "./vaultGroupService";
import { nativeVaultLifecycleService } from "./vaultLifecycleService";
import { nativeVaultService } from "./vaultService";
import { nativeVaultFileSystemService } from "./vaultFileSystemService";
import { nativeBackupService } from "./backupService";
import { nativeDataFolderService } from "./dataFolderService";
import { nativeDeviceService } from "./deviceService";
import { mountDeviceTrees } from "./deviceTrees";
import { nativeExportTrees } from "./exportTrees";
import { nativeFolderListService } from "./folderListService";
import { nativeJobService } from "./jobService";
import { nativeCreateVaultService } from "./createVaultService";
import { nativeVaultSecurityService } from "./vaultSecurityService";
import {
  mountDefaultDataFolder,
  mountDefaultForSearch,
  mountRowDataFolder,
  mountSelectedDataFolder,
  mountedDataFolder,
  phoneDeviceId,
  restoreDataFolder,
  selectedDataFolder,
  unmountDataFolder,
} from "./phoneDataFolder";
import { pickVaultRootFolder } from "./pickVaultRootFolder";
import { mountSafRoot, mountTree, safDocumentsGrant, safDocumentsInitialUri } from "./safVaultRoot";

const nativeLogService: LogService = {
  async listFiles() {
    return rpcLogList();
  },
  async deleteFiles(filenames) {
    if (filenames.length === 0) return;
    await rpcLogDelete(filenames);
  },
  async getFile(filename) {
    return rpcLogGet(filename);
  },
  async recordVaultHidden() {
    await rpcLogEvent("vault_hidden");
  },
  async recordVaultGroupHidden() {
    await rpcLogEvent("vault_group_hidden");
  },
  async recordImportCacheWipeFailed() {
    await rpcLogEvent("import_cache_wipe_failed");
  },
};

/**
 * Settings follow the data folder the list selects, mounted at the data
 * folder root before Rust reads them. A save that changed a list mounts the
 * trees of this phone's rows.
 */
const nativeAppSettingsService: AppSettingsService = {
  async load(): Promise<AppSettingsLoadResult> {
    await mountSelectedDataFolder();
    const result = await rpcAppSettingsGet();
    return {
      settings: normalizeAppSettings(result.settings),
      onDisk: result.onDisk,
      rootPath: result.rootPath,
    };
  },

  async save(config, lists) {
    const saved = await rpcAppSettingsSave(normalizeAppSettings(config), lists);
    await mountDeviceTrees();
    return saved;
  },
};

/** Default is not checked while a row is the data folder: the root serves that row. */
const DEFAULT_NOT_CHECKED: DataFolderStatus = { state: "ok", content: null, details: null };

/** Default with no Documents grant yet: confirming Documents makes the data folder there. */
const DEFAULT_TO_MAKE: DataFolderStatus = { state: "ok", content: "empty", details: null };

/**
 * The phone's data folder. Rust reaches the folder this device's list
 * selects at `/upriv-saf-root`: a row's picked tree, or Default's Documents
 * grant, mounted here before each call that reads it. Every other row's
 * tree is checked at its own root.
 */
function createNativeVaultRootService(): VaultRootService {
  /** The tree the data folder root serves, for a found data folder's path. */
  const shownRoot = (rootPath: string) => mountedDataFolder()?.tree ?? rootPath;

  return {
    async resolve(options) {
      await mountSelectedDataFolder();
      const result = await rpcVaultRootResolve(options);
      if (result.status === "found") await mountDeviceTrees();
      return result.status === "found" && result.source !== "explicit"
        ? { ...result, rootPath: shownRoot(result.rootPath) }
        : result;
    },

    list: (options) => rpcDataFolderList(options?.newList ?? false),

    async status(path) {
      if (path !== null) {
        if (isSafContentUri(path)) mountTree(path);
        return rpcDataFolderStatus(path);
      }
      if (mountedDataFolder()?.kind === "row") return DEFAULT_NOT_CHECKED;
      const grant = safDocumentsGrant();
      if (!grant) return DEFAULT_TO_MAKE;
      if (mountedDataFolder()?.tree !== grant) mountSafRoot(grant);
      return rpcDataFolderStatus(null);
    },

    async apply(request) {
      const view = await rpcDataFolderList(request.newList ?? false);
      const target = selectedDataFolder(view.groups, await phoneDeviceId(), request.changes);
      const previous = mountedDataFolder();
      if (target?.kind === "default") await mountDefaultDataFolder();
      else if (target) {
        try {
          mountRowDataFolder(target.tree);
        } catch {
          // Unmounted: core answers that this folder cannot hold a data folder now.
        }
      } else unmountDataFolder();
      try {
        // A data folder kept in the private app folder moves into the one chosen.
        const applied = await rpcDataFolderApply({ ...request, job: request.job ?? newJobId() });
        await mountDeviceTrees();
        return { ...applied, rootPath: shownRoot(applied.rootPath) };
      } catch (error) {
        restoreDataFolder(previous);
        throw error;
      }
    },

    async search(job) {
      // Each row is checked at its tree's root, Default at the data folder root.
      await mountDeviceTrees();
      mountDefaultForSearch();
      return rpcDataFolderSearch(job);
    },

    async suggestedCustomRootPath() {
      return safDocumentsInitialUri() ?? "";
    },

    async pickFolder(defaultPath) {
      return pickVaultRootFolder(defaultPath);
    },
  };
}

/**
 * Native adapters → in-process `upriv-ffi` (same split as desktop
 * `createDesktopServices`). The data folder the list selects is mounted at
 * `/upriv-saf-root`; every other picked folder (a row, an export's folder) is
 * reached at its tree's root. Expo Go never reaches this factory.
 */
export function createNativeServices(): AppServices {
  return {
    device: nativeDeviceService,
    vaultRoot: createNativeVaultRootService(),
    folderLists: nativeFolderListService,
    appSettings: nativeAppSettingsService,
    logs: nativeLogService,
    vault: nativeVaultService,
    lifecycle: nativeVaultLifecycleService,
    vaultGroups: nativeVaultGroupService,
    filesystem: nativeVaultFileSystemService,
    backups: nativeBackupService,
    dataFolder: nativeDataFolderService,
    exportFolderGrants: nativeExportTrees,
    jobs: nativeJobService,
    createVault: nativeCreateVaultService,
    vaultSecurity: nativeVaultSecurityService,
  };
}
