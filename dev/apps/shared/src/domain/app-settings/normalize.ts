import { normalizeWorkspaceGlobalPath } from "../workspace";
import {
  LOG_ENTRIES_PER_FILE,
  LOG_KEEP_LAST_DEFAULT,
  normalizeLogKeepLastEntries,
  normalizeLogLevel,
} from "./logging";
import { DEFAULT_UI_THEME, type AppSettingsConfig, type VaultRootMode } from "./types";

/** Max characters for `[ui].vault_list_search` (matches vault display-name cap). */
export const VAULT_LIST_SEARCH_MAX_LENGTH = 128;

/** Debounce before writing the list search query to `settings.toml`. */
export const VAULT_LIST_SEARCH_PERSIST_MS = 400;

type LegacyUiSettings = AppSettingsConfig["ui"] & {
  /** Legacy combined toggle (vault + group). */
  vault_list_show_vault_group_settings_button?: boolean;
};

function readShowToggle(
  explicit: boolean | undefined,
  legacyCombined: boolean | undefined,
): boolean {
  if (explicit !== undefined) return explicit !== false;
  if (legacyCombined !== undefined) return legacyCombined !== false;
  return true;
}

function normalizeShowVaultSettings(ui: LegacyUiSettings): boolean {
  return readShowToggle(
    ui.vault_list_show_vault_settings_button,
    ui.vault_list_show_vault_group_settings_button,
  );
}

function normalizeShowGroupSettings(ui: LegacyUiSettings): boolean {
  return readShowToggle(
    ui.vault_list_show_group_settings_button,
    ui.vault_list_show_vault_group_settings_button,
  );
}

/** Strip controls, cap length; keep spaces so typing is not trimmed mid-edit. */
export function normalizeVaultListSearch(value: unknown): string {
  if (typeof value !== "string") return "";
  let out = "";
  for (let i = 0; i < value.length && out.length < VAULT_LIST_SEARCH_MAX_LENGTH; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) continue;
    out += value[i];
  }
  return out;
}

/** Normalize wire/UI vault-root mode (`"default_root"` | `"custom_root"` only). */
export function normalizeVaultRootMode(mode: unknown): VaultRootMode {
  if (mode === "custom_root" || mode === "default_root") return mode;
  // Unknown tokens fail closed to default_root.
  return "default_root";
}

/** Cross-platform defaults before the first `AppSettingsService.load()`. */
export function createDefaultAppSettings(): AppSettingsConfig {
  return {
    ui: {
      locale: "en",
      theme: DEFAULT_UI_THEME,
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
      last_opened_vault: "",
    },
    workspace: {
      path: "",
    },
  };
}

/** Default-root mode and a custom path are mutually exclusive. */
export function normalizeAppSettings(config: AppSettingsConfig): AppSettingsConfig {
  const logging = {
    ...config.logging,
    level: normalizeLogLevel(
      typeof config.logging.level === "string" ? config.logging.level : undefined,
    ),
    entries_per_file: config.logging.entries_per_file || LOG_ENTRIES_PER_FILE,
    keep_last_entries: normalizeLogKeepLastEntries(config.logging.keep_last_entries),
  };

  const legacyUi = config.ui as LegacyUiSettings;

  const normalized: AppSettingsConfig = {
    ...config,
    ui: {
      ...config.ui,
      vault_list_search: normalizeVaultListSearch(config.ui.vault_list_search),
      vault_list_show_create_button: config.ui.vault_list_show_create_button !== false,
      vault_list_show_search_button: config.ui.vault_list_show_search_button !== false,
      vault_list_show_sort_button: config.ui.vault_list_show_sort_button !== false,
      vault_list_show_view_button: config.ui.vault_list_show_view_button !== false,
      vault_list_show_header_more_button: config.ui.vault_list_show_header_more_button !== false,
      vault_list_show_vault_more_button: config.ui.vault_list_show_vault_more_button !== false,
      vault_list_show_vault_settings_button: normalizeShowVaultSettings(legacyUi),
      vault_list_show_group_settings_button: normalizeShowGroupSettings(legacyUi),
      vault_list_show_drag: config.ui.vault_list_show_drag !== false,
      vault_list_allow_drag_into_group: config.ui.vault_list_allow_drag_into_group !== false,
    },
    logging,
    app: {
      ...config.app,
      vault_root_mode: normalizeVaultRootMode(config.app.vault_root_mode),
      last_opened_vault:
        typeof config.app.last_opened_vault === "string" ? config.app.last_opened_vault.trim() : "",
    },
    workspace: {
      path: normalizeWorkspaceGlobalPath(config.workspace?.path),
    },
  };

  if (normalized.app.vault_root_mode !== "default_root") return normalized;
  if (!normalized.app.upriv_root_path) return normalized;
  return {
    ...normalized,
    app: { ...normalized.app, upriv_root_path: "" },
  };
}
