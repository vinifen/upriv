import type {
  AppServices,
  AppSettingsConfig,
  AppSettingsLoadResult,
  AppSettingsSaveOptions,
  AppSettingsService,
  LogService,
  VaultRootService,
  VaultService,
} from "@upriv/shared";
import {
  createDefaultAppSettings,
  isRpcError,
  normalizeAppSettings,
  RpcError,
  SUPPORTED_LOCALES,
  type LocaleId,
} from "@upriv/shared";
import { createMobileMockServices } from "@/platform/mocks";
import {
  rpcAppSettingsGet,
  rpcAppSettingsParseToml,
  rpcAppSettingsSave,
  rpcAppSettingsSerializeToml,
  rpcLogDelete,
  rpcLogEvent,
  rpcLogGet,
  rpcLogList,
  rpcVaultRootDeactivateAlias,
  rpcVaultRootDefaultRootStatus,
  rpcVaultRootInspectPath,
  rpcVaultRootReadAlias,
  rpcVaultRootResolve,
  rpcVaultRootSetupDefaultRoot,
  rpcVaultRootSetupPath,
  rpcVaultRootSuggestedCustomPath,
} from "@/lib/rpc";
import { isAndroidSafUri, pickVaultRootFolder } from "./pickVaultRootFolder";
import {
  isSafTreeUri,
  safGetActiveUri,
  safInspectRoot,
  safPersist,
  safReadSettings,
  safSetActiveUri,
  safSetupRoot,
  safWriteSettings,
  toSafRpcError,
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
};

function rpcErrorForSafInspect(status: SafInspectStatus, safUri: string): RpcError {
  if (status === "unauthorized" || status === "unreadable") {
    return new RpcError("vault_root_alias_invalid", `SAF tree ${safUri} is ${status}`, {
      path: safUri,
    });
  }
  if (status === "incomplete") {
    return new RpcError("vault_root_incomplete", `SAF tree ${safUri} has an incomplete .upriv/`, {
      path: safUri,
    });
  }
  return new RpcError("vault_root_not_found", `SAF tree ${safUri} has no .upriv/`, { path: safUri });
}

/**
 * Kotlin `valid` only means non-empty UTF-8. Schema `valid` prefers Rust parse.
 * Missing RAM toml RPCs (stale `libupriv_ffi.so`) fall back to a marker-shape check.
 */
function looksLikeSettingsToml(toml: string): boolean {
  return /\[package\]/.test(toml) && /\blabel\s*=/.test(toml);
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
    // Stale `libupriv_ffi.so` (no RAM toml RPCs): Kotlin already saw a non-empty
    // marker. Do not fail Apply after a successful SAF create.
    if (isRpcError(error) && error.code === "unknown_method") {
      return looksLikeSettingsToml(toml) ? "valid" : "incomplete";
    }
    return "incomplete";
  }
}

async function parseSafTomlOrThrow(toml: string, safUri: string): Promise<AppSettingsConfig> {
  try {
    return await rpcAppSettingsParseToml(toml);
  } catch (error) {
    if (isRpcError(error) && error.code === "unknown_method" && looksLikeSettingsToml(toml)) {
      return normalizeAppSettings({
        ...createDefaultAppSettings(),
        app: { vault_root_mode: "custom_root", upriv_root_path: safUri },
      });
    }
    if (isRpcError(error) && error.code === "unknown_method") throw error;
    throw new RpcError(
      "vault_root_incomplete",
      `SAF settings.toml is not a valid marker at ${safUri}`,
      { path: safUri },
    );
  }
}

/**
 * SAF-aware settings adapter — falls back to the Rust `.upriv/settings.toml`
 * path when no SAF tree is active. When SAF is active, TOML round-trips
 * happen through the Kotlin DocumentFile bridge, with `upriv-core` still
 * owning the TOML → wire mapping via `app_settings_*_toml` RPCs.
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
      const safUri = safGetActiveUri();
      if (!safUri) return rustLoad();

      const status = await inspectSafWithSchema(safUri);
      if (status !== "valid") {
        throw rpcErrorForSafInspect(status, safUri);
      }
      const toml = safReadSettings(safUri);
      if (toml == null) {
        throw new RpcError("vault_root_not_found", `SAF tree ${safUri} has no settings.toml`, {
          path: safUri,
        });
      }
      const parsed = await parseSafTomlOrThrow(toml, safUri);
      return {
        settings: normalizeAppSettings({
          ...parsed,
          app: { vault_root_mode: "custom_root", upriv_root_path: safUri },
        }),
        onDisk: true,
        rootPath: safUri,
      };
    },

    async save(config: AppSettingsConfig, options?: AppSettingsSaveOptions): Promise<boolean> {
      const normalized = normalizeAppSettings(config);
      const treeUri = normalized.app.upriv_root_path.trim();
      const wantsSaf = normalized.app.vault_root_mode === "custom_root" && isSafTreeUri(treeUri);

      // SAF custom root — Rust `std::fs` rejects `content://` (not absolute).
      // Payload path is authoritative; keep the SharedPreferences alias in sync.
      if (wantsSaf) {
        try {
          safPersist(treeUri);
        } catch {
          /* Expo picker usually already persisted */
        }
        let status: ReturnType<typeof safInspectRoot>;
        try {
          status = safInspectRoot(treeUri);
        } catch (error) {
          throw toSafRpcError(error, treeUri);
        }
        if (status !== "valid" && status !== "incomplete") {
          throw new RpcError("vault_root_not_found", `SAF vault-root ${treeUri} is ${status}`);
        }
        const previous = safReadSettings(treeUri);
        const body = await rpcAppSettingsSerializeToml(normalized, previous);
        safWriteSettings(treeUri, body);
        safSetActiveUri(treeUri);
        return true;
      }

      // Leaving SAF (default_root or filesystem custom_root).
      if (safGetActiveUri()) {
        safSetActiveUri(null);
      }

      return rustSave(normalized, options);
    },
  };
}

/**
 * Coerce a raw bootstrap locale string to a supported [`LocaleId`].
 *
 * Rust rejects an empty/whitespace-only locale from `bootstrap.locale` with a
 * typed `invalid_request`; here we do the same shape check before writing the
 * SAF `.upriv/settings.toml` seed so the two paths behave the same. Unknown
 * locales fall back to `null` (keeps the built-in `"en"` default).
 */
function coerceLocale(candidate: string | null | undefined): LocaleId | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  return SUPPORTED_LOCALES.includes(trimmed as LocaleId) ? (trimmed as LocaleId) : null;
}

/**
 * SAF-aware VaultRootService — wraps the Rust vault_root_* RPCs and adds a
 * short-circuit for the Android `content://` custom root. Filesystem paths
 * still go through Rust unchanged (desktop behavior).
 */
function createNativeVaultRootService(): VaultRootService {
  return {
    async resolve(options) {
      const safUri = safGetActiveUri();
      if (safUri) {
        const status = await inspectSafWithSchema(safUri);
        if (status === "valid") {
          return { status: "found", rootPath: safUri, source: "custom_root" };
        }
        throw rpcErrorForSafInspect(status, safUri);
      }
      return rpcVaultRootResolve(options);
    },

    async setupDefaultRoot(options) {
      // Switching to default_root always clears the SAF pref so the two
      // sources of truth cannot disagree (Rust alias for FS, SAF pref for URIs).
      const previousSaf = safGetActiveUri();
      const result = await rpcVaultRootSetupDefaultRoot(options);
      if (previousSaf) safSetActiveUri(null);
      return result;
    },

    async setupAtPath(path, options) {
      const trimmed = path.trim();
      if (!isSafTreeUri(trimmed)) {
        return rpcVaultRootSetupPath(trimmed, options);
      }
      // SAF branch — Rust vault_root_setup_path rejects content:// with
      // "invalid_request: path must be absolute", so we own this end-to-end.
      const locale = options?.bootstrap?.locale ?? null;
      // Persist is best-effort — Expo's picker usually already took the grant;
      // a second takePersistableUriPermission can throw on some OEMs.
      try {
        safPersist(trimmed);
      } catch (error) {
        let afterPersist: ReturnType<typeof safInspectRoot> | null = null;
        try {
          afterPersist = safInspectRoot(trimmed);
        } catch (inspectError) {
          throw toSafRpcError(inspectError, trimmed);
        }
        if (afterPersist === "unauthorized") {
          throw toSafRpcError(error, trimmed);
        }
      }

      const before = await inspectSafWithSchema(trimmed);
      if (before === "unauthorized") {
        throw new RpcError("saf_unauthorized", `SAF tree ${trimmed} is unauthorized`, {
          path: trimmed,
        });
      }
      if (before === "unreadable") {
        throw new RpcError("io_error", `SAF tree ${trimmed} is unreadable`, { path: trimmed });
      }
      // Selecting an already-valid root: activate only — do not rewrite settings.
      if (before === "valid") {
        try {
          await rpcVaultRootDeactivateAlias();
        } catch {
          /* SAF pointer is SharedPreferences; filesystem alias is optional. */
        }
        safSetActiveUri(trimmed);
        return { rootPath: trimmed, aliasPath: `saf://${trimmed}` };
      }
      if (before === "incomplete") {
        if (!options?.replaceIncomplete || !options.replacePolicy) {
          throw new RpcError(
            "vault_root_incomplete",
            `SAF tree ${trimmed} has an incomplete .upriv/ — choose replace policy`,
            { path: trimmed },
          );
        }
      }

      let seedToml: string | null = null;
      try {
        const seed = createDefaultAppSettings();
        const seedLocale = coerceLocale(locale);
        if (seedLocale) seed.ui.locale = seedLocale;
        seedToml = await rpcAppSettingsSerializeToml(seed);
      } catch {
        seedToml = null;
      }
      const replacePolicy =
        before === "incomplete" && options?.replacePolicy ? options.replacePolicy : null;
      try {
        safSetupRoot(trimmed, locale, seedToml, replacePolicy);
      } catch (error) {
        // Previous attempt may have written `.upriv/` that listing still hides.
        const existing = safInspectRoot(trimmed);
        if (existing !== "valid") {
          throw toSafRpcError(error, trimmed);
        }
      }

      // Trust a successful native write. A follow-up listing can miss hidden
      // `.upriv/` (Download / Music / DCIM) and must not undo a good setup.
      try {
        await rpcVaultRootDeactivateAlias();
      } catch {
        /* SAF pointer is SharedPreferences; filesystem alias is optional. */
      }
      safSetActiveUri(trimmed);
      return { rootPath: trimmed, aliasPath: `saf://${trimmed}` };
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
      return rpcVaultRootSuggestedCustomPath();
    },

    async pickFolder(defaultPath) {
      return pickVaultRootFolder(defaultPath);
    },
  };
}

/**
 * Native adapters → in-process `upriv-ffi` (same split as desktop
 * `createDesktopServices`): live vault-root / settings / logs; empty vault list
 * until `vault_list` lands. Create-wizard vaults live in React state only
 * (not seeded MOCK_VAULTS), same as desktop `addVault`.
 */
export function createNativeServices(): AppServices {
  const mocks = createMobileMockServices();
  const vault: VaultService = {
    ...mocks.vault,
    async listVaults() {
      // Empty until vault_list RPC — do not return seeded MOCK_VAULTS against a real root.
      return [];
    },
  };
  return {
    ...mocks,
    vaultRoot: createNativeVaultRootService(),
    appSettings: createSafAwareAppSettingsService(),
    logs: nativeLogService,
    vault,
    // Groups stay mock (empty by default) — live group RPCs need on-disk vault ids.
    vaultGroups: mocks.vaultGroups,
  };
}

// Re-export the isAndroidSafUri helper alias so callers do not need to import
// two "is SAF" predicates (both are the same content:// scheme check).
export { isAndroidSafUri };
