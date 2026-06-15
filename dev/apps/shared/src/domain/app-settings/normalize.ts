import { LOG_ENTRIES_PER_FILE, LOG_KEEP_LAST_DEFAULT, normalizeLogKeepLastEntries } from "./logging";
import type { AppSettingsConfig } from "./types";

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
      auto_detect_vault_root: true,
      upriv_root_path: "",
    },
  };
}

/** Auto-detect and a fixed path are mutually exclusive. */
export function normalizeAppSettings(config: AppSettingsConfig): AppSettingsConfig {
  const logging = {
    ...config.logging,
    entries_per_file: config.logging.entries_per_file || LOG_ENTRIES_PER_FILE,
    keep_last_entries: normalizeLogKeepLastEntries(config.logging.keep_last_entries),
  };

  const normalized: AppSettingsConfig = { ...config, logging };

  if (!normalized.app.auto_detect_vault_root) return normalized;
  if (!normalized.app.upriv_root_path) return normalized;
  return {
    ...normalized,
    app: { ...normalized.app, upriv_root_path: "" },
  };
}
