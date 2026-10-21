import type {
  AppServices,
  AppSettingsConfig,
  AppSettingsLoadResult,
  AppSettingsSaveOptions,
  AppSettingsService,
  LogService,
  VaultRootService,
} from "@upriv/shared";
import { isRpcError, isVaultRootUnreachableError, normalizeAppSettings } from "@upriv/shared";
import {
  rpcAppSettingsGet,
  rpcAppSettingsParseToml,
  rpcAppSettingsSave,
  rpcLogDelete,
  rpcLogEvent,
  rpcLogGet,
  rpcLogList,
  rpcVaultRootDefaultRootStatus,
  rpcVaultRootInspectPath,
  rpcVaultRootReadAlias,
  rpcVaultRootRememberCustom,
  rpcVaultRootResolve,
  rpcVaultRootSetupDefaultRoot,
  rpcVaultRootSetupPath,
  rpcVaultRootSuggestedCustomPath,
} from "@/lib/rpc";
import { nativeVaultGroupService } from "./vaultGroupService";
import { nativeVaultLifecycleService } from "./vaultLifecycleService";
import { nativeVaultService } from "./vaultService";
import { nativeVaultFileSystemService } from "./vaultFileSystemService";
import { nativeBackupService } from "./backupService";
import { nativeDataFolderService } from "./dataFolderService";
import { nativeJobService } from "./jobService";
import { nativeSafExportMount } from "./safExportMount";
import { nativeCreateVaultService } from "./createVaultService";
import { nativeVaultSecurityService } from "./vaultSecurityService";
import { isSafLogicalRoot, SAF_VAULT_ROOT } from "./androidVaultHome";
import { planSafSwitch, rememberedCustomFolderPath } from "./documentsGrant";
import { isAndroidSafUri, pickVaultRootFolder } from "./pickVaultRootFolder";
import {
  isSafTreeUri,
  mountSafRoot,
  safDocumentsInitialUri,
  safGetActiveUri,
  safInspectRoot,
  safPersist,
  safReadSettings,
  safRelease,
  safSetActiveUri,
  unmountSafRoot,
  type SafInspectStatus,
} from "./safVaultRoot";

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
 * Kotlin `valid` only means non-empty UTF-8; the Rust parse decides. A library
 * without that RPC (`unknown_method`) is thrown, not read as `incomplete`.
 */
async function inspectSafWithSchema(safUri: string): Promise<SafInspectStatus> {
  const status = safInspectRoot(safUri);
  if (status !== "valid") return status;
  const toml = safReadSettings(safUri);
  if (toml == null || !toml.trim()) return "incomplete";
  try {
    await rpcAppSettingsParseToml(toml);
    return "valid";
  } catch (error) {
    if (isRpcError(error) && error.code === "unknown_method") throw error;
    return "incomplete";
  }
}

/** Point the active grant at `next`, then release only the folder the plan names. */
function commitSafSwitch(previous: string | null, next: string): void {
  const plan = planSafSwitch(previous, next);
  if (next) safSetActiveUri(next);
  if (!plan.releaseUri) return;
  try {
    safRelease(plan.releaseUri);
  } catch {
    /* best-effort release */
  }
}

function clearActiveSafUri(): void {
  const previousUri = safGetActiveUri();
  unmountSafRoot();
  if (!previousUri) return;
  const plan = planSafSwitch(previousUri, "");
  safSetActiveUri(null);
  if (!plan.releaseUri) return;
  try {
    safRelease(plan.releaseUri);
  } catch {
    /* best-effort release */
  }
}

function mountActiveSafUri(): string | null {
  const uri = safGetActiveUri();
  if (!uri) return null;
  mountSafRoot(uri);
  return uri;
}

/**
 * Mount the active grant for a settings read. An unplugged drive leaves the
 * bridge unmounted, so Rust answers from `.upriv-root` (custom_root, not on disk)
 * and the pointer survives until the drive is back.
 */
function mountActiveSafUriForLoad(): string | null {
  const uri = safGetActiveUri();
  if (!uri) return null;
  try {
    mountSafRoot(uri);
  } catch (error) {
    if (!isVaultRootUnreachableError(error)) throw error;
    unmountSafRoot();
  }
  return uri;
}

/** Put the bridge back on the folder that was active before a failed switch. */
function restoreSafMount(previous: string | null, attempted: string): void {
  if (previous && previous !== attempted) {
    try {
      mountSafRoot(previous);
    } catch {
      unmountSafRoot();
    }
    return;
  }
  if (!previous) unmountSafRoot();
}

function withLogicalRoot(config: AppSettingsConfig): AppSettingsConfig {
  return {
    ...config,
    app: { ...config.app, upriv_root_path: SAF_VAULT_ROOT },
  };
}

/**
 * Settings follow the active data folder. A picked `content://` tree is
 * mounted at the logical root before Rust reads or writes it.
 */
function createSafAwareAppSettingsService(): AppSettingsService {
  const rustLoad = async (): Promise<AppSettingsLoadResult> => {
    const result = await rpcAppSettingsGet();
    return {
      settings: normalizeAppSettings(result.settings),
      onDisk: result.onDisk,
      rootPath: result.rootPath,
    };
  };

  const rustSave = async (
    config: AppSettingsConfig,
    options?: AppSettingsSaveOptions,
  ): Promise<boolean> => {
    const { wrote } = await rpcAppSettingsSave(normalizeAppSettings(config), {
      syncAlias: options?.syncAlias,
    });
    return wrote;
  };

  return {
    async load(): Promise<AppSettingsLoadResult> {
      const uri = mountActiveSafUriForLoad();
      const loaded = await rustLoad();
      const pointed = loaded.settings.app.upriv_root_path.trim() || (loaded.rootPath ?? "").trim();
      if (uri && isSafLogicalRoot(pointed)) {
        return {
          ...loaded,
          rootPath: uri,
          settings: {
            ...loaded.settings,
            app: {
              ...loaded.settings.app,
              vault_root_mode: "custom_root",
              upriv_root_path: uri,
            },
          },
        };
      }
      if (uri) clearActiveSafUri();
      return loaded;
    },

    async save(config: AppSettingsConfig, options?: AppSettingsSaveOptions): Promise<boolean> {
      const normalized = normalizeAppSettings(config);
      const treeUri = normalized.app.upriv_root_path.trim();
      if (normalized.app.vault_root_mode === "custom_root" && isSafTreeUri(treeUri)) {
        const previous = safGetActiveUri();
        safPersist(treeUri);
        mountSafRoot(treeUri);
        let wrote: boolean;
        try {
          wrote = await rustSave(withLogicalRoot(normalized), options);
        } catch (error) {
          restoreSafMount(previous, treeUri);
          throw error;
        }
        if (!wrote) {
          restoreSafMount(previous, treeUri);
          return false;
        }
        const plan = planSafSwitch(previous, treeUri);
        if (plan.rememberCustomUri) {
          try {
            await rpcVaultRootRememberCustom(plan.rememberCustomUri);
          } catch (error) {
            // Settings are already on this tree. The next launch must mount it.
            // Keep the previous grant until `custom=` is written.
            safSetActiveUri(treeUri);
            throw error;
          }
        }
        commitSafSwitch(previous, treeUri);
        return wrote;
      }

      // Record the Custom folder before the save. If that write fails, settings
      // stay unchanged and this folder stays mounted. If the save fails after
      // it, `custom=` is already stored.
      const leaving = rememberedCustomFolderPath(safGetActiveUri() ?? "");
      if (leaving) await rpcVaultRootRememberCustom(leaving);
      const wrote = await rustSave(normalized, options);
      clearActiveSafUri();
      return wrote;
    },
  };
}

/**
 * Vault-root service. A picked `content://` folder is mounted, then Rust
 * creates and edits vaults there. Other paths go straight to Rust.
 *
 * Resolve only reads. It never releases the grant: an unplugged drive throws
 * `vault_root_unreachable`, and only choosing another data folder drops it.
 */
function createNativeVaultRootService(): VaultRootService {
  return {
    async resolve(options) {
      const uri = mountActiveSafUri();
      const result = await rpcVaultRootResolve(options);
      if (uri && result.status === "found" && isSafLogicalRoot(result.rootPath)) {
        return { ...result, rootPath: uri };
      }
      return result;
    },

    async setupDefaultRoot(options) {
      const leaving = rememberedCustomFolderPath(safGetActiveUri() ?? "");
      if (leaving) await rpcVaultRootRememberCustom(leaving);
      const result = await rpcVaultRootSetupDefaultRoot(options);
      clearActiveSafUri();
      return result;
    },

    async setupAtPath(path, options) {
      const trimmed = path.trim();
      if (!isSafTreeUri(trimmed)) {
        const leaving = rememberedCustomFolderPath(safGetActiveUri() ?? "");
        if (leaving) await rpcVaultRootRememberCustom(leaving);
        const result = await rpcVaultRootSetupPath(trimmed, options);
        clearActiveSafUri();
        return result;
      }
      const previous = safGetActiveUri();
      const plan = planSafSwitch(previous, trimmed);
      try {
        safPersist(trimmed);
        mountSafRoot(trimmed);
        const result = await rpcVaultRootSetupPath(SAF_VAULT_ROOT, {
          ...options,
          adoptPrivateRoot: true,
          ...(plan.rememberCustomUri ? { customUri: plan.rememberCustomUri } : {}),
        });
        commitSafSwitch(previous, trimmed);
        return { ...result, rootPath: trimmed };
      } catch (error) {
        restoreSafMount(previous, trimmed);
        throw error;
      }
    },

    async readAlias() {
      const file = await rpcVaultRootReadAlias();
      const saved = rememberedCustomFolderPath(file?.customPath ?? "");
      const live = safGetActiveUri();
      const liveCustom = rememberedCustomFolderPath(live ?? "");
      if (liveCustom) {
        return { path: liveCustom, active: true, customPath: liveCustom };
      }
      if (saved) {
        return { path: saved, active: false, customPath: saved };
      }
      if (live) return { path: live, active: true };
      return file;
    },

    async defaultRootStatus() {
      return rpcVaultRootDefaultRootStatus();
    },

    async inspectAtPath(path) {
      const trimmed = path.trim();
      if (isSafTreeUri(trimmed)) {
        const status = await inspectSafWithSchema(trimmed);
        return { status, path: trimmed };
      }
      return rpcVaultRootInspectPath(trimmed);
    },

    async suggestedCustomRootPath() {
      return safDocumentsInitialUri() ?? rpcVaultRootSuggestedCustomPath();
    },

    async pickFolder(defaultPath, _title) {
      return pickVaultRootFolder(defaultPath);
    },
  };
}

/**
 * Native adapters → in-process `upriv-ffi` (same split as desktop
 * `createDesktopServices`). A picked `content://` folder is mounted at
 * `/upriv-saf-root` before path RPCs, so create, open, edit, import, and
 * backup write on that grant. Export data folder mounts the folder picked for
 * its zip at `/upriv-saf-export`. Expo Go never reaches this factory.
 */
export function createNativeServices(): AppServices {
  return {
    vaultRoot: createNativeVaultRootService(),
    appSettings: createSafAwareAppSettingsService(),
    logs: nativeLogService,
    vault: nativeVaultService,
    lifecycle: nativeVaultLifecycleService,
    vaultGroups: nativeVaultGroupService,
    filesystem: nativeVaultFileSystemService,
    backups: nativeBackupService,
    dataFolder: nativeDataFolderService,
    exportFolderGrants: nativeSafExportMount,
    jobs: nativeJobService,
    createVault: nativeCreateVaultService,
    vaultSecurity: nativeVaultSecurityService,
  };
}

// Re-export the isAndroidSafUri helper alias so callers do not need to import
// two "is SAF" predicates (both are the same content:// scheme check).
export { isAndroidSafUri };
