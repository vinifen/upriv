import type { AppSettingsConfig } from "@upriv/shared";
import { LOG_ENTRIES_PER_FILE, LOG_KEEP_LAST_DEFAULT } from "@upriv/shared";

export const DEFAULT_APP_SETTINGS: AppSettingsConfig = {
  ui: {
    locale: "en",
    theme: "dark",
    vault_list_sort: "order",
    vault_list_sort_direction: "asc",
    vault_list_view: "default",
    vault_list_search: "",
    vault_list_show_create_button: true,
    vault_list_show_search_button: true,
    vault_list_show_sort_button: true,
    vault_list_show_view_button: true,
    vault_list_show_header_more_button: true,
    vault_list_show_vault_more_button: true,
    vault_list_show_vault_settings_button: true,
    vault_list_show_group_settings_button: true,
    always_show_hidden_vaults: false,
    vault_list_show_drag: true,
    vault_list_allow_drag_into_group: true,
    file_manager_dock_expanded: false,
    lifecycle_close_modal_on_submit: false,
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
    last_opened_vault: "my-encrypted-notes",
  },
  workspace: {
    path: "",
  },
};

/** Mock absolute vault-root path (validates as absolute for workspace setup). */
export const MOCK_UPRIV_ROOT_PATH = "/mock/Documents/Upriv";

let mockRuntimeSettings = structuredClone(DEFAULT_APP_SETTINGS);

/** @internal Used by mockAppSettingsService and lifecycle mocks. */
export function getMockAppSettings(): AppSettingsConfig {
  return structuredClone(mockRuntimeSettings);
}

/** @internal Keep mock settings store in sync with mockAppSettingsService.save. */
export function replaceMockAppSettings(config: AppSettingsConfig): void {
  mockRuntimeSettings = structuredClone(config);
}
