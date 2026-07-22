import { LOG_ENTRIES_PER_FILE, LOG_KEEP_LAST_DEFAULT, normalizeLogKeepLastEntries } from "./logging";
import type { AppSettingsConfig, VaultRootMode } from "./types";

/** Normalize wire/UI vault-root mode (`"default_root"` | `"custom_root"` only). */
export function normalizeVaultRootMode(mode: unknown): VaultRootMode {
  if (mode === "custom_root" || mode === "default_root") return mode;
  // Unknown tokens (including removed legacy names) fail closed to default_root.
  return "default_root";
}

/** Cross-platform defaults before the first `AppSettingsService.load()`. */
export function createDefaultAppSettings(): AppSettingsConfig {
  return {
    ui: {
      locale: "en",
      theme: "dark",
      vault_list_sort: "order",
      vault_list_sort_direction: "asc",
      vault_list_view: "default",
      always_show_hidden_vaults: false,
      file_manager_dock_expanded: false,
    },
    logging: {
      enabled: true,
      level: "info",
      entries_per_file: LOG_ENTRIES_PER_FILE,
      keep_last_entries: LOG_KEEP_LAST_DEFAULT,
    },
    app: {
      vault_root_mode: "default_root",
      upriv_root_path: "",
    },
  };
}

/** Default-root mode and a custom path are mutually exclusive. */
export function normalizeAppSettings(config: AppSettingsConfig): AppSettingsConfig {
  const logging = {
    ...config.logging,
    entries_per_file: config.logging.entries_per_file || LOG_ENTRIES_PER_FILE,
    keep_last_entries: normalizeLogKeepLastEntries(config.logging.keep_last_entries),
  };

  const normalized: AppSettingsConfig = {
    ...config,
    logging,
    app: {
      ...config.app,
      vault_root_mode: normalizeVaultRootMode(config.app.vault_root_mode),
    },
  };

  if (normalized.app.vault_root_mode !== "default_root") return normalized;
  if (!normalized.app.upriv_root_path) return normalized;
  return {
    ...normalized,
    app: { ...normalized.app, upriv_root_path: "" },
  };
}
