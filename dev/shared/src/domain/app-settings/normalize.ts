import { LOG_ENTRIES_PER_FILE, normalizeLogKeepLastEntries } from "./logging";
import type { AppSettingsConfig } from "./types";

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
