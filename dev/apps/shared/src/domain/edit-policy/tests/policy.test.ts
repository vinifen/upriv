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
  vaultConfigEditHold,
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
    expect(vaultConfigEditAllowed("unlocked_folder", plain)).toBe(true);
    expect(vaultConfigEditAllowed("vault.display_name", plain)).toBe(true);
  });

  it("says what to do instead of asking to wait", () => {
    expect(requireVaultConfigEditLockedI18nKey("unlocked_folder", vaultConfigEditHold(row))).toBe(
      contract.plainLeftoverLockedI18n,
    );
    expect(en).toHaveProperty([contract.plainLeftoverLockedI18n]);
    expect(requireVaultConfigEditLockedI18nKey("unlocked_folder")).toBe(
      contract.lockedI18n.unlocked_folder,
    );
  });
});

describe("a backup export of the vault's backups", () => {
  const row = vaultRowFixture({ id: "notes" });
  const exporting = { backupExportVaultIds: ["notes"] };

  it("locks the rename core refuses until the export ends", () => {
    for (const target of contract.backupExportLocked) {
      expect(vaultConfigEditAllowed(target as VaultConfigEditTarget, row, exporting)).toBe(false);
    }
    expect(vaultConfigEditAllowed("vault.display_name", row)).toBe(true);
  });

  it("leaves the folder, the changes, and the rest editable", () => {
    expect(vaultConfigEditAllowed("unlocked_folder", row, exporting)).toBe(true);
    expect(vaultConfigEditAllowed("action.change_password", row, exporting)).toBe(true);
    expect(vaultConfigEditAllowed("action.change_storage", row, exporting)).toBe(true);
  });

  it("names the export in the locked hint", () => {
    const hold = vaultConfigEditHold(row, exporting);
    expect(hold).toEqual({ plainLeftover: false, backupExport: true });
    expect(requireVaultConfigEditLockedI18nKey("vault.display_name", hold)).toBe(
      contract.backupExportLockedI18n,
    );
    expect(en).toHaveProperty([contract.backupExportLockedI18n]);
  });

  it("does not hold another vault", () => {
    const other = vaultRowFixture({ id: "journal" });
    expect(vaultConfigEditAllowed("vault.display_name", other, exporting)).toBe(true);
  });
});

describe("the Storage change", () => {
  it("runs on a closed vault only, like the password change", () => {
    expect(vaultConfigEditAllowed("action.change_storage", vaultRowFixture())).toBe(true);
    for (const session of ["open", "closing", "recovery"] as const) {
      expect(vaultConfigEditAllowed("action.change_storage", vaultRowFixture({ session }))).toBe(
        false,
      );
    }
    const leftover = vaultRowFixture({ session: "recovery", plainLeftover: true });
    expect(vaultConfigEditAllowed("action.change_storage", leftover)).toBe(false);
  });

  it("is no target of a settings save", () => {
    expect(Object.keys(contract.vault).some((target) => target.startsWith("storage"))).toBe(false);
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
    expect(vaultConfigEditLockedI18nKey("action.change_storage")).toBe(
      "vault.change_storage.vault_open",
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
    expect(appConfigEditAllowed("unlocked_folders", [closed])).toBe(true);
    expect(appConfigEditAllowed("unlocked_folders", [open])).toBe(false);
    expect(appConfigEditAllowed("unlocked_folders.other_devices", [open])).toBe(true);
  });

  it("root_idle waits for a data-folder export, with or without vaults", () => {
    const closed = vaultRowFixture({ id: "a" });
    const exporting = { dataFolderExporting: true };
    expect(appConfigEditAllowed("data_folder", [closed], exporting)).toBe(false);
    expect(appConfigEditAllowed("data_folder", [], exporting)).toBe(false);
  });
});

describe("vaultConfigEditAllowed", () => {
  it("allows note while open; blocks quiet edits, the changes, and delete", () => {
    const open = vaultRowFixture({ id: "notes", session: "open" });
    expect(vaultConfigEditAllowed("vault.note", open)).toBe(true);
    expect(vaultConfigEditAllowed("vault.display_name", open)).toBe(false);
    expect(vaultConfigEditAllowed("action.change_password", open)).toBe(false);
    expect(vaultConfigEditAllowed("action.finish_password_change", open)).toBe(false);
    expect(vaultConfigEditAllowed("action.delete", open)).toBe(false);
  });

  it("recovery allows quiet edits, rename, delete, and Finish, but not the changes", () => {
    const recovery = vaultRowFixture({ id: "notes", session: "recovery" });
    expect(vaultConfigEditAllowed("unlocked_folder", recovery)).toBe(true);
    expect(vaultConfigEditAllowed("vault.display_name", recovery)).toBe(true);
    expect(vaultConfigEditAllowed("action.delete", recovery)).toBe(true);
    expect(vaultConfigEditAllowed("action.finish_password_change", recovery)).toBe(true);
    expect(vaultConfigEditAllowed("action.change_kdf", recovery)).toBe(false);
    expect(vaultConfigEditAllowed("action.change_password", recovery)).toBe(false);
  });

  it("allows Finish and delete on a closed vault, and nothing once a delete began", () => {
    const closed = vaultRowFixture({ id: "notes" });
    expect(vaultConfigEditAllowed("action.finish_password_change", closed)).toBe(true);
    expect(vaultConfigEditAllowed("action.delete", closed)).toBe(true);
    const deleting = vaultRowFixture({ id: "notes", session: "deleting" });
    expect(vaultConfigEditAllowed("action.delete", deleting)).toBe(false);
    expect(vaultConfigEditAllowed("vault.display_name", deleting)).toBe(false);
    expect(vaultConfigEditAllowed("unlocked_folder", deleting)).toBe(false);
  });

  it("creating and queued block rename, not the quiet unlocked folder", () => {
    const closed = vaultRowFixture({ id: "notes" });
    expect(
      vaultConfigEditAllowed("vault.display_name", closed, { creatingVaultIds: ["notes"] }),
    ).toBe(false);
    expect(vaultConfigEditAllowed("unlocked_folder", closed, { creatingVaultIds: ["notes"] })).toBe(
      true,
    );
    expect(
      vaultConfigEditAllowed("vault.display_name", closed, { queuedVaultIds: ["notes"] }),
    ).toBe(false);
    expect(vaultConfigEditAllowed("unlocked_folder", closed, { queuedVaultIds: ["notes"] })).toBe(
      true,
    );
  });

  it("a queued close on an open session is not quiet", () => {
    const open = vaultRowFixture({ id: "notes", session: "open" });
    const pipeline = { queuedVaultIds: ["notes"], queuedOpenVaultIds: [] as string[] };
    expect(vaultConfigEditAllowed("unlocked_folder", open, pipeline)).toBe(false);
  });
});
