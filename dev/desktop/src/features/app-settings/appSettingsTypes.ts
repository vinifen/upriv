import { LOG_ENTRIES_PER_FILE, normalizeLogKeepLastEntries } from "@/constants/logging";
import type { LocaleId } from "@/i18n";
import type {
  VaultListSortDirection,
  VaultListSortMode,
} from "@/features/vault-list/vaultListSort";
import type { VaultListViewMode } from "@/features/vault-list/vaultListView";

export type UiTheme = "dark" | "neutral" | "light";
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export const APP_SETTINGS_SECTIONS = [
  "appearance",
  "logging",
  "behavior",
  "hidden_vaults",
  "download_vaults",
] as const;

export type AppSettingsSectionId = (typeof APP_SETTINGS_SECTIONS)[number];

export interface AppSettingsConfig {
  ui: {
    locale: LocaleId;
    theme: UiTheme;
    /** Persisted when the user changes sort in the list toolbar (not edited in system settings). */
    vault_list_sort: VaultListSortMode;
    vault_list_sort_direction: VaultListSortDirection;
    /** Persisted when the user changes view in the list toolbar (not edited in system settings). */
    vault_list_view: VaultListViewMode;
    /** TOML: `[ui] always_show_hidden_vaults` */
    always_show_hidden_vaults: boolean;
    /** TOML: `[ui] file_manager_dock_expanded` — from minimized dock toggle, not settings UI */
    file_manager_dock_expanded: boolean;
  };
  logging: {
    enabled: boolean;
    level: LogLevel;
    /** Lines per rotated log file (fixed at 1000 in v1 UI). */
    entries_per_file: number;
    /**
     * Max log lines retained on disk; oldest files removed when exceeded.
     * `0` = no limit.
     */
    keep_last_entries: number;
  };
  app: {
    /** TOML: `[app] auto_detect_vault_root` */
    auto_detect_vault_root: boolean;
    /** Folder that contains `.upriv/` (Upriv root) — not a single vault. */
    upriv_root_path: string;
  };
}

export type AppSettingsPatch = {
  ui?: Partial<AppSettingsConfig["ui"]>;
  logging?: Partial<AppSettingsConfig["logging"]>;
  app?: Partial<AppSettingsConfig["app"]>;
};

export function appSettingsEqual(a: AppSettingsConfig, b: AppSettingsConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
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
