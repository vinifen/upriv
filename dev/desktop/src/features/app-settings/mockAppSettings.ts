import { LOG_ENTRIES_PER_FILE, LOG_KEEP_LAST_DEFAULT } from "@/constants/logging";
import type { AppSettingsConfig } from "./appSettingsTypes";

export const DEFAULT_APP_SETTINGS: AppSettingsConfig = {
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

/** Mock path used by “Choose folder” until Tauri folder picker is wired. */
export const MOCK_UPRIV_ROOT_PATH = "/home/user/Documents/Upriv";

export function getMockAppSettings(): AppSettingsConfig {
  return structuredClone(DEFAULT_APP_SETTINGS);
}
