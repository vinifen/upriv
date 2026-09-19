import { describe, expect, it } from "vitest";
import {
  VAULT_LIST_SEARCH_MAX_LENGTH,
  createDefaultAppSettings,
  normalizeAppSettings,
  normalizeVaultListSearch,
  normalizeVaultRootMode,
} from "..";

describe("normalizeVaultRootMode", () => {
  it("fails closed to default_root", () => {
    expect(normalizeVaultRootMode("custom_root")).toBe("custom_root");
    expect(normalizeVaultRootMode("default_root")).toBe("default_root");
    expect(normalizeVaultRootMode("portable")).toBe("default_root");
    expect(normalizeVaultRootMode(null)).toBe("default_root");
  });
});

describe("normalizeVaultListSearch", () => {
  it("strips controls, keeps spaces, and caps length", () => {
    expect(normalizeVaultListSearch("  notes  ")).toBe("  notes  ");
    expect(normalizeVaultListSearch("a\u0000b")).toBe("ab");
    expect(normalizeVaultListSearch(1)).toBe("");
    expect(normalizeVaultListSearch("x".repeat(200)).length).toBe(VAULT_LIST_SEARCH_MAX_LENGTH);
  });
});

describe("normalizeAppSettings", () => {
  it("clears a custom path when mode is default_root", () => {
    const settings = createDefaultAppSettings();
    settings.app.vault_root_mode = "default_root";
    settings.app.upriv_root_path = "/old/custom";
    expect(normalizeAppSettings(settings).app.upriv_root_path).toBe("");
  });

  it("keeps a custom path in custom_root mode", () => {
    const settings = createDefaultAppSettings();
    settings.app.vault_root_mode = "custom_root";
    settings.app.upriv_root_path = "/data/upriv";
    expect(normalizeAppSettings(settings).app.upriv_root_path).toBe("/data/upriv");
  });

  it("splits the legacy combined settings-button toggle", () => {
    const settings = createDefaultAppSettings();
    const legacy = settings as typeof settings & {
      ui: typeof settings.ui & {
        vault_list_show_vault_group_settings_button?: boolean;
      };
    };
    delete (legacy.ui as { vault_list_show_vault_settings_button?: boolean })
      .vault_list_show_vault_settings_button;
    delete (legacy.ui as { vault_list_show_group_settings_button?: boolean })
      .vault_list_show_group_settings_button;
    legacy.ui.vault_list_show_vault_group_settings_button = false;
    const normalized = normalizeAppSettings(legacy);
    expect(normalized.ui.vault_list_show_vault_settings_button).toBe(false);
    expect(normalized.ui.vault_list_show_group_settings_button).toBe(false);
  });

  it("explicit vault/group toggles win over the legacy combined flag", () => {
    const settings = createDefaultAppSettings();
    const legacy = settings as typeof settings & {
      ui: typeof settings.ui & {
        vault_list_show_vault_group_settings_button?: boolean;
      };
    };
    legacy.ui.vault_list_show_vault_settings_button = true;
    legacy.ui.vault_list_show_group_settings_button = false;
    legacy.ui.vault_list_show_vault_group_settings_button = false;
    const normalized = normalizeAppSettings(legacy);
    expect(normalized.ui.vault_list_show_vault_settings_button).toBe(true);
    expect(normalized.ui.vault_list_show_group_settings_button).toBe(false);
  });

  it("defaults lifecycle_close_modal_on_submit to false", () => {
    const settings = createDefaultAppSettings();
    expect(settings.ui.lifecycle_close_modal_on_submit).toBe(false);
    const omitted = {
      ...settings,
      ui: { ...settings.ui, lifecycle_close_modal_on_submit: undefined as unknown as boolean },
    };
    expect(normalizeAppSettings(omitted).ui.lifecycle_close_modal_on_submit).toBe(false);
    settings.ui.lifecycle_close_modal_on_submit = true;
    expect(normalizeAppSettings(settings).ui.lifecycle_close_modal_on_submit).toBe(true);
  });

  it("defaults lifecycle_open_file_manager_on_open to false", () => {
    const settings = createDefaultAppSettings();
    expect(settings.ui.lifecycle_open_file_manager_on_open).toBe(false);
    const omitted = {
      ...settings,
      ui: { ...settings.ui, lifecycle_open_file_manager_on_open: undefined as unknown as boolean },
    };
    expect(normalizeAppSettings(omitted).ui.lifecycle_open_file_manager_on_open).toBe(false);
    settings.ui.lifecycle_open_file_manager_on_open = true;
    expect(normalizeAppSettings(settings).ui.lifecycle_open_file_manager_on_open).toBe(true);
  });

  it("defaults file_manager_confirm_delete to true", () => {
    const settings = createDefaultAppSettings();
    expect(settings.ui.file_manager_confirm_delete).toBe(true);
    const omitted = {
      ...settings,
      ui: { ...settings.ui, file_manager_confirm_delete: undefined as unknown as boolean },
    };
    expect(normalizeAppSettings(omitted).ui.file_manager_confirm_delete).toBe(true);
    settings.ui.file_manager_confirm_delete = false;
    expect(normalizeAppSettings(settings).ui.file_manager_confirm_delete).toBe(false);
  });

  it("coerces file_manager_dock_expanded to boolean (default false)", () => {
    const settings = createDefaultAppSettings();
    expect(settings.ui.file_manager_dock_expanded).toBe(false);
    const omitted = {
      ...settings,
      ui: { ...settings.ui, file_manager_dock_expanded: undefined as unknown as boolean },
    };
    expect(normalizeAppSettings(omitted).ui.file_manager_dock_expanded).toBe(false);
    settings.ui.file_manager_dock_expanded = true;
    expect(normalizeAppSettings(settings).ui.file_manager_dock_expanded).toBe(true);
  });

  it("clamps file_manager_tree_split_percent to integer 15–65 (default 20)", () => {
    const settings = createDefaultAppSettings();
    expect(settings.ui.file_manager_tree_split_percent).toBe(20);
    const omitted = {
      ...settings,
      ui: { ...settings.ui, file_manager_tree_split_percent: undefined as unknown as number },
    };
    expect(normalizeAppSettings(omitted).ui.file_manager_tree_split_percent).toBe(20);
    settings.ui.file_manager_tree_split_percent = 99;
    expect(normalizeAppSettings(settings).ui.file_manager_tree_split_percent).toBe(65);
    settings.ui.file_manager_tree_split_percent = 5;
    expect(normalizeAppSettings(settings).ui.file_manager_tree_split_percent).toBe(15);
    settings.ui.file_manager_tree_split_percent = 33;
    expect(normalizeAppSettings(settings).ui.file_manager_tree_split_percent).toBe(33);
    settings.ui.file_manager_tree_split_percent = 33.7;
    expect(normalizeAppSettings(settings).ui.file_manager_tree_split_percent).toBe(34);
  });
});
