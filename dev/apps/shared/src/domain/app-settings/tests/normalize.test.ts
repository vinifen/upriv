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

  it("defaults lifecycle_keep_open_on_wake to false", () => {
    const settings = createDefaultAppSettings();
    expect(settings.ui.lifecycle_keep_open_on_wake).toBe(false);
    const omitted = {
      ...settings,
      ui: { ...settings.ui, lifecycle_keep_open_on_wake: undefined as unknown as boolean },
    };
    expect(normalizeAppSettings(omitted).ui.lifecycle_keep_open_on_wake).toBe(false);
    settings.ui.lifecycle_keep_open_on_wake = true;
    expect(normalizeAppSettings(settings).ui.lifecycle_keep_open_on_wake).toBe(true);
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
});
