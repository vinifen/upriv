import type { LocaleId } from "@/i18n";
import type { VaultListSortDirection, VaultListSortMode } from "@/features/vault-list/vaultListSort";
import type { VaultListViewMode } from "@/features/vault-list/vaultListView";

export type UiTheme = "dark" | "light";
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export const APP_SETTINGS_SECTIONS = ["appearance", "logging", "behavior"] as const;

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
  };
  logging: {
    enabled: boolean;
    level: LogLevel;
    entries_per_file: number;
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
