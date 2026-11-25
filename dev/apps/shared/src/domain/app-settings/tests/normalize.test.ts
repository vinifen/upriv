import { describe, expect, it } from "vitest";
import {
  VAULT_LIST_SEARCH_MAX_LENGTH,
  createDefaultAppSettings,
  normalizeAppSettings,
  normalizeVaultListSearch,
} from "..";

describe("normalizeVaultListSearch", () => {
  it("strips controls, keeps spaces, and caps length", () => {
    expect(normalizeVaultListSearch("  notes  ")).toBe("  notes  ");
    expect(normalizeVaultListSearch("a\u0000b")).toBe("ab");
    expect(normalizeVaultListSearch(1)).toBe("");
    expect(normalizeVaultListSearch("x".repeat(200)).length).toBe(VAULT_LIST_SEARCH_MAX_LENGTH);
  });
});

describe("normalizeAppSettings", () => {
  it("reads the lists of every device and fills what the wire leaves out", () => {
    const id = "a".repeat(32);
    const wire = {
      ...createDefaultAppSettings(),
      unlocked_folders: {
        encrypted_vaults: true,
        devices: {
          [id]: {
            system: "linux",
            next_number: 2,
            rows: [{ number: 1, name: "", path: "/mnt/ssd" }],
          },
        },
      },
      backups: undefined,
    } as unknown as Parameters<typeof normalizeAppSettings>[0];
    const settings = normalizeAppSettings(wire);
    expect(settings.unlocked_folders.encrypted_vaults).toBe(true);
    // The app's unlocked folders select nothing unless the group says so.
    expect(settings.unlocked_folders.devices[id].selected).toBe("none");
    expect(settings.backups).toEqual({ devices: {} });
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

  it("asks twice for a row Stop and once for a row Open or Close unless set", () => {
    const settings = normalizeAppSettings(createDefaultAppSettings());
    expect(settings.ui.lifecycle_confirm_stop).toBe(true);
    expect(settings.ui.lifecycle_confirm_lock).toBe(false);
    const omitted = {
      ...settings,
      ui: {
        ...settings.ui,
        lifecycle_confirm_stop: undefined as unknown as boolean,
        lifecycle_confirm_lock: undefined as unknown as boolean,
      },
    };
    expect(normalizeAppSettings(omitted).ui.lifecycle_confirm_stop).toBe(true);
    expect(normalizeAppSettings(omitted).ui.lifecycle_confirm_lock).toBe(false);
    settings.ui.lifecycle_confirm_stop = false;
    settings.ui.lifecycle_confirm_lock = true;
    expect(normalizeAppSettings(settings).ui.lifecycle_confirm_stop).toBe(false);
    expect(normalizeAppSettings(settings).ui.lifecycle_confirm_lock).toBe(true);
  });

  it("defaults lifecycle_confirm_close_now to true", () => {
    const settings = createDefaultAppSettings();
    expect(settings.ui.lifecycle_confirm_close_now).toBe(true);
    const omitted = {
      ...settings,
      ui: { ...settings.ui, lifecycle_confirm_close_now: undefined as unknown as boolean },
    };
    expect(normalizeAppSettings(omitted).ui.lifecycle_confirm_close_now).toBe(true);
    settings.ui.lifecycle_confirm_close_now = false;
    expect(normalizeAppSettings(settings).ui.lifecycle_confirm_close_now).toBe(false);
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
