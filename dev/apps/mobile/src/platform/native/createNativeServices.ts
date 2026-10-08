import type {
  AppServices,
  AppSettingsConfig,
  AppSettingsLoadResult,
  AppSettingsSaveOptions,
  AppSettingsService,
  LogService,
  VaultRootService,
} from "@upriv/shared";
import {
  createUnavailableVaultSecurityService,
  isRpcError,
  normalizeAppSettings,
} from "@upriv/shared";
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
import { nativeCreateVaultService } from "./createVaultService";
import { isSafLogicalRoot, SAF_VAULT_ROOT } from "./androidVaultHome";
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
 * Kotlin `valid` only means non-empty UTF-8. Schema `valid` prefers Rust parse.
 * Stale `libupriv_ffi.so` (`unknown_method` on RAM toml RPCs): **dev only** —
 * require marker keys (`[package]`, `vaults_dir`, `[app]`). Release fails inspect.
 */
function staleFfiTomlFallbackAllowed(): boolean {
  return typeof __DEV__ !== "undefined" && Boolean(__DEV__);
}

function looksLikeUprivSettingsToml(toml: string): boolean {
  return /\[package\]/.test(toml) && /\bvaults_dir\s*=/.test(toml) && /\[app\]/.test(toml);
}

async function inspectSafWithSchema(safUri: string): Promise<SafInspectStatus> {
  const status = safInspectRoot(safUri);
  if (status !== "valid") return status;
  const toml = safReadSettings(safUri);
  if (toml == null || !toml.trim()) return "incomplete";
  try {
    await rpcAppSettingsParseToml(toml);
    return "valid";
  } catch (error) {
    if (isRpcError(error) && error.code === "unknown_method") {
      if (staleFfiTomlFallbackAllowed() && looksLikeUprivSettingsToml(toml)) {
        return "valid";
      }
      throw error;
    }
    return "incomplete";
  }
}

function clearActiveSafUri(): void {
  const previousUri = safGetActiveUri();
  unmountSafRoot();
  if (!previousUri) return;
  safSetActiveUri(null);
  if (isSafTreeUri(previousUri)) {
    try {
      safRelease(previousUri);
    } catch {
      /* best-effort release */
    }
  }
}

function mountActiveSafUri(): string | null {
  const uri = safGetActiveUri();
  if (!uri) return null;
  mountSafRoot(uri);
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
      const uri = mountActiveSafUri();
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
        if (previous && previous !== treeUri) {
          try {
            safRelease(previous);
          } catch {
            /* the new grant is the data folder */
          }
        }
        safSetActiveUri(treeUri);
        return wrote;
      }

      // Leaving a picked folder. Release only after Rust returns — a thrown
      // save must not drop persistable permission. Soft `wrote: false` is still a leave.
      const wrote = await rustSave(normalized, options);
      clearActiveSafUri();
      return wrote;
    },
  };
}

/**
 * Vault-root service. A picked `content://` folder is mounted, then Rust
 * creates and edits vaults there. Other paths go straight to Rust.
 */
function createNativeVaultRootService(): VaultRootService {
  return {
    async resolve(options) {
      const uri = mountActiveSafUri();
      const result = await rpcVaultRootResolve(options);
      if (uri && result.status === "found" && isSafLogicalRoot(result.rootPath)) {
        return { ...result, rootPath: uri };
      }
      if (uri) clearActiveSafUri();
      return result;
    },

    async setupDefaultRoot(options) {
      // Switching to default_root always clears the SAF pref so the two
      // sources of truth cannot disagree (Rust alias for FS, SAF pref for URIs).
      const result = await rpcVaultRootSetupDefaultRoot(options);
      clearActiveSafUri();
      return result;
    },

    async setupAtPath(path, options) {
      const trimmed = path.trim();
      if (!isSafTreeUri(trimmed)) {
        const result = await rpcVaultRootSetupPath(trimmed, options);
        clearActiveSafUri();
        return result;
      }
      const previous = safGetActiveUri();
      try {
        safPersist(trimmed);
        mountSafRoot(trimmed);
        const result = await rpcVaultRootSetupPath(SAF_VAULT_ROOT, {
          ...options,
          adoptPrivateRoot: true,
        });
        if (previous && previous !== trimmed) {
          try {
            safRelease(previous);
          } catch {
            /* the new grant is the data folder */
          }
        }
        safSetActiveUri(trimmed);
        return { ...result, rootPath: trimmed };
      } catch (error) {
        restoreSafMount(previous, trimmed);
        throw error;
      }
    },

    async readAlias() {
      const safUri = safGetActiveUri();
      if (safUri) {
        return { path: safUri, active: true };
      }
      return rpcVaultRootReadAlias();
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
 * backup write on that grant. Change-password / KDF rewrap is not implemented.
 * Expo Go never reaches this factory.
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
    createVault: nativeCreateVaultService,
    vaultSecurity: createUnavailableVaultSecurityService(),
  };
}

// Re-export the isAndroidSafUri helper alias so callers do not need to import
// two "is SAF" predicates (both are the same content:// scheme check).
export { isAndroidSafUri };
