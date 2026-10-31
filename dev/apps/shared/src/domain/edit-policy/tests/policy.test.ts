import { describe, expect, it } from "vitest";
import { vaultRowFixture } from "../../vault/tests/fixtures.shared";
import en from "../../../../locales/en.json";
import contract from "../edit-policy.json";
import {
  APP_CONFIG_EDIT_POLICY,
  VAULT_CONFIG_EDIT_LOCKED_I18N,
  VAULT_CONFIG_EDIT_POLICY,
  appConfigEditAllowed,
  configEditGateAllows,
  vaultConfigEditAllowed,
  vaultConfigEditLockedI18nKey,
  requireVaultConfigEditLockedI18nKey,
  type VaultConfigEditTarget,
} from "../policy";

describe("a leftover plaintext folder", () => {
  const row = vaultRowFixture({ session: "recovery", plainLeftover: true });

  it("locks what core refuses until the folder is removed", () => {
    for (const target of contract.plainLeftoverLocked) {
      expect(vaultConfigEditAllowed(target as VaultConfigEditTarget, row)).toBe(false);
    }
  });

  it("leaves everything else editable", () => {
    expect(vaultConfigEditAllowed("backup", row)).toBe(true);
    expect(vaultConfigEditAllowed("vault.note", row)).toBe(true);
  });

  it("does not lock a recovery with no leftover", () => {
    const plain = vaultRowFixture({ session: "recovery" });
    expect(vaultConfigEditAllowed("storage.mode", plain)).toBe(true);
    expect(vaultConfigEditAllowed("vault.display_name", plain)).toBe(true);
  });

  it("says what to do instead of asking to wait", () => {
    expect(requireVaultConfigEditLockedI18nKey("storage.mode", true)).toBe(
      contract.plainLeftoverLockedI18n,
    );
    expect(en).toHaveProperty([contract.plainLeftoverLockedI18n]);
    expect(requireVaultConfigEditLockedI18nKey("storage.mode")).toBe(
      contract.lockedI18n["storage.mode"],
    );
  });
});

describe("the plain-text folder choice", () => {
  it("changes while the vault is closed or in recovery", () => {
    expect(vaultConfigEditAllowed("storage.plain_files", vaultRowFixture())).toBe(true);
    const recovery = vaultRowFixture({ session: "recovery" });
    expect(vaultConfigEditAllowed("storage.plain_files", recovery)).toBe(true);
  });

  it("stays editable with a leftover folder, which holds no choice to protect", () => {
    const leftover = vaultRowFixture({ session: "recovery", plainLeftover: true });
    expect(vaultConfigEditAllowed("storage.plain_files", leftover)).toBe(true);
  });

  it("locks while the vault is open or closing", () => {
    const open = vaultRowFixture({ session: "open" });
    expect(vaultConfigEditAllowed("storage.plain_files", open)).toBe(false);
    const closing = vaultRowFixture({ session: "closing" });
    expect(vaultConfigEditAllowed("storage.plain_files", closing)).toBe(false);
  });
});

describe("edit-policy.json contract", () => {
  it("matches exported vault/app tables", () => {
    expect(VAULT_CONFIG_EDIT_POLICY).toEqual(contract.vault);
    expect(APP_CONFIG_EDIT_POLICY).toEqual(contract.app);
    expect([...contract.rustConfigSaveQuietTargets].sort()).toEqual(
      Object.entries(contract.vault)
        .filter(([, gate]) => gate === "vault_quiet")
        .map(([target]) => target)
        .sort(),
    );
  });

  it("has locked i18n for every UI-facing quiet/closed target", () => {
    for (const [target, key] of Object.entries(contract.lockedI18n)) {
      expect(key).toBeTruthy();
      expect(VAULT_CONFIG_EDIT_POLICY[target as keyof typeof VAULT_CONFIG_EDIT_POLICY]).not.toBe(
        "anytime",
      );
      expect(
        VAULT_CONFIG_EDIT_LOCKED_I18N[target as keyof typeof VAULT_CONFIG_EDIT_LOCKED_I18N],
      ).toBe(key);
    }
    // `vault.id` is not a settings form field — no lockedI18n. Identity uses `vault_rename`.
    expect(contract.rustConfigSaveQuietTargets).not.toContain("vault.id");
    expect(contract.rustConfigSaveQuietTargets).not.toContain("vault.display_name");
    expect(vaultConfigEditLockedI18nKey("vault.id")).toBeUndefined();
    expect(vaultConfigEditLockedI18nKey("action.change_password")).toBe(
      "vault.change_password.vault_open",
    );
    expect(vaultConfigEditLockedI18nKey("action.change_kdf")).toBe("vault.change_kdf.vault_open");
    expect(requireVaultConfigEditLockedI18nKey("storage.mode")).toBe(
      "modal.settings.field.storage.mode_locked",
    );
  });

  it("lockedI18n keys exist in en.json", () => {
    for (const key of Object.values(contract.lockedI18n)) {
      expect(en).toHaveProperty(key);
    }
  });
});

describe("configEditGateAllows", () => {
  it("vault_quiet allows closed, recovery, creating, and queued (not open/opening/closing)", () => {
    expect(configEditGateAllows("vault_quiet", { vaultStatus: "closed" })).toBe(true);
    expect(configEditGateAllows("vault_quiet", { vaultStatus: "recovery" })).toBe(true);
    expect(configEditGateAllows("vault_quiet", { vaultStatus: "creating" })).toBe(true);
    expect(configEditGateAllows("vault_quiet", { vaultStatus: "queued" })).toBe(true);
    expect(configEditGateAllows("vault_quiet", { vaultStatus: "open" })).toBe(false);
    expect(configEditGateAllows("vault_quiet", { vaultStatus: "opening" })).toBe(false);
    expect(configEditGateAllows("vault_quiet", { vaultStatus: "closing" })).toBe(false);
    expect(configEditGateAllows("vault_quiet", { vaultStatus: "exporting" })).toBe(false);
    expect(configEditGateAllows("vault_quiet", { vaultStatus: "changing_password" })).toBe(false);
    expect(configEditGateAllows("vault_quiet", { vaultStatus: "changing_kdf" })).toBe(false);
  });

  it("vault_closed allows only closed", () => {
    expect(configEditGateAllows("vault_closed", { vaultStatus: "closed" })).toBe(true);
    expect(configEditGateAllows("vault_closed", { vaultStatus: "recovery" })).toBe(false);
  });

  it("vault_closed_or_recovery allows closed and recovery only", () => {
    expect(configEditGateAllows("vault_closed_or_recovery", { vaultStatus: "closed" })).toBe(true);
    expect(configEditGateAllows("vault_closed_or_recovery", { vaultStatus: "recovery" })).toBe(
      true,
    );
    expect(configEditGateAllows("vault_closed_or_recovery", { vaultStatus: "creating" })).toBe(
      false,
    );
    expect(configEditGateAllows("vault_closed_or_recovery", { vaultStatus: "queued" })).toBe(false);
    expect(configEditGateAllows("vault_closed_or_recovery", { vaultStatus: "open" })).toBe(false);
    expect(configEditGateAllows("vault_closed_or_recovery", { vaultStatus: "opening" })).toBe(
      false,
    );
    expect(configEditGateAllows("vault_closed_or_recovery", { vaultStatus: "closing" })).toBe(
      false,
    );
  });

  it("root_idle / no_open_session match list helpers", () => {
    const closed = vaultRowFixture({ id: "a" });
    const open = vaultRowFixture({ id: "b", session: "open" });
    expect(appConfigEditAllowed("data_folder", [closed])).toBe(true);
    expect(appConfigEditAllowed("data_folder", [open])).toBe(false);
    expect(appConfigEditAllowed("workspace.path", [closed])).toBe(true);
    expect(appConfigEditAllowed("workspace.path", [open])).toBe(false);
  });

  it("root_idle waits for a data-folder export, with or without vaults", () => {
    const closed = vaultRowFixture({ id: "a" });
    const exporting = { dataFolderExporting: true };
    expect(appConfigEditAllowed("data_folder", [closed], exporting)).toBe(false);
    expect(appConfigEditAllowed("data_folder", [], exporting)).toBe(false);
  });
});

describe("vaultConfigEditAllowed", () => {
  it("allows note while open; blocks quiet and rewrap", () => {
    const open = vaultRowFixture({ id: "notes", session: "open" });
    expect(vaultConfigEditAllowed("vault.note", open)).toBe(true);
    expect(vaultConfigEditAllowed("vault.display_name", open)).toBe(false);
    expect(vaultConfigEditAllowed("action.change_password", open)).toBe(false);
  });

  it("recovery allows quiet edits and rename, but not rewrap", () => {
    const recovery = vaultRowFixture({ id: "notes", session: "recovery" });
    expect(vaultConfigEditAllowed("storage.mode", recovery)).toBe(true);
    expect(vaultConfigEditAllowed("vault.display_name", recovery)).toBe(true);
    expect(vaultConfigEditAllowed("action.change_kdf", recovery)).toBe(false);
  });

  it("creating and queued block rename, not quiet storage", () => {
    const closed = vaultRowFixture({ id: "notes" });
    expect(
      vaultConfigEditAllowed("vault.display_name", closed, { creatingVaultIds: ["notes"] }),
    ).toBe(false);
    expect(vaultConfigEditAllowed("storage.mode", closed, { creatingVaultIds: ["notes"] })).toBe(
      true,
    );
    expect(
      vaultConfigEditAllowed("vault.display_name", closed, { queuedVaultIds: ["notes"] }),
    ).toBe(false);
    expect(vaultConfigEditAllowed("storage.mode", closed, { queuedVaultIds: ["notes"] })).toBe(
      true,
    );
  });

  it("a queued close on an open session is not quiet", () => {
    const open = vaultRowFixture({ id: "notes", session: "open" });
    const pipeline = { queuedVaultIds: ["notes"], queuedOpenVaultIds: [] as string[] };
    expect(vaultConfigEditAllowed("storage.mode", open, pipeline)).toBe(false);
  });
});
