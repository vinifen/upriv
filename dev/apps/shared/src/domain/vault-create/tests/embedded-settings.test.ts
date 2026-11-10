import { describe, expect, it } from "vitest";
import { createEmptyCreateVaultDraft } from "../defaults";
import {
  applyEmbeddedVaultSettings,
  applyImportVaultName,
  parseEmbeddedVaultSettings,
  revertEmbeddedVaultSettings,
} from "../applyEmbeddedVaultSettings";
import type { VaultSettingsConfig } from "../../vault-settings";
import { vaultWorkspace } from "../../workspace";
import { vaultBackupFolders } from "../../backups/folders";

function settings(patch: Partial<VaultSettingsConfig> = {}): VaultSettingsConfig {
  return {
    vault: {
      id: "notes",
      display_name: "Notes",
      order: 4,
      password_hint: "pet",
      note: "tax year",
      hidden: true,
    },
    storage: { mode: "encrypted_dir", plain_files: "whole" },
    mount: {
      ...vaultWorkspace(),
      custom_file_manager_folder: true,
      linux: { place: "unset", path: "/data/vaults" },
    },
    backup: {
      enabled: false,
      mode: "keep_all",
      keep_last: 3,
      skip_unchanged: false,
      ...vaultBackupFolders(),
    },
    security: {
      wipe_passes: 2,
      wipe_pattern: "zeros",
    },
    auto_close: {
      enabled: true,
      idle_minutes: 5,
      when_busy: "close",
    },
    file_manager: { confirm_delete: false },
    seven_zip: {
      encrypt_file_names: false,
      archive_mode: "compress_encrypt",
      compression_level: 5,
      solid: true,
    },
    ...patch,
  };
}

describe("applyEmbeddedVaultSettings", () => {
  it("fills the draft and keeps a display name the user already changed", () => {
    const draft = {
      ...createEmptyCreateVaultDraft([]),
      source: "import" as const,
      importFileName: "Notes.7z",
      importFilePath: "/tmp/Notes.7z",
      displayName: "Renamed",
      note: "",
    };
    const snapshot = {
      ...draft,
      displayName: "Notes",
      note: "",
      passwordHint: "",
    };
    const next = applyEmbeddedVaultSettings(
      draft,
      { settings: settings(), unlockPreset: "128mib" },
      snapshot,
    );
    expect(next.displayName).toBe("Renamed");
    expect(next.note).toBe("tax year");
    expect(next.passwordHint).toBe("pet");
    expect(next.hidden).toBe(true);
    expect(next.backup.mode).toBe("keep_all");
    expect(next.backup.skip_unchanged).toBe(false);
    expect(next.security.wipe_passes).toBe(2);
    expect(next.seven_zip.solid).toBe(true);
    expect(next.file_manager.confirm_delete).toBe(false);
    expect(next.kdf.unlock_preset).toBe("128mib");
    expect(next.groupMode).toBe("none");
    expect(next.storage.plain_files).toBe("whole");
  });

  it("keeps a backup mode the user already changed", () => {
    const snapshot = {
      ...createEmptyCreateVaultDraft([]),
      backup: {
        enabled: true,
        mode: "keep_all" as const,
        keep_last: 1,
        skip_unchanged: true,
        ...vaultBackupFolders(),
      },
    };
    const draft = {
      ...snapshot,
      source: "import" as const,
      importFileName: "Notes.zip",
      backup: { ...snapshot.backup, mode: "keep_last" as const },
    };
    const next = applyEmbeddedVaultSettings(
      draft,
      { settings: settings(), unlockPreset: "1gib" },
      snapshot,
    );
    expect(next.backup.mode).toBe("keep_last");
    expect(next.note).toBe("tax year");
    expect(next.archiveUnlockPreset).toBe("1gib");
  });

  it("remembers the backup folders a file carried, and lets go of them with its settings", () => {
    const snapshot = createEmptyCreateVaultDraft([]);
    const folder = { place: "custom" as const, path: "/mnt/usb" };
    const applied = applyEmbeddedVaultSettings(
      snapshot,
      {
        settings: settings({ backup: { ...settings().backup, linux: folder } }),
        unlockPreset: null,
      },
      snapshot,
    );
    expect(applied.carriedBackupFolders?.linux).toEqual(folder);
    expect(applied.backup.linux).toEqual(folder);

    const reverted = revertEmbeddedVaultSettings(applied, applied, snapshot);
    expect(reverted.carriedBackupFolders).toBeNull();
  });

  it("does not change KDF for a store zip", () => {
    const draft = {
      ...createEmptyCreateVaultDraft([]),
      source: "import" as const,
      importKind: "backup" as const,
      importFileName: "20260528120000",
      importFilePath: "vaults/notes/backups/20260528120000",
      displayName: "Notes backup",
      kdf: { unlock_preset: "256mib" as const },
    };
    const next = applyEmbeddedVaultSettings(
      draft,
      { settings: settings(), unlockPreset: "2gib" },
      draft,
    );
    expect(next.displayName).toBe("Notes backup");
    expect(next.kdf.unlock_preset).toBe("256mib");
    expect(next.archiveUnlockPreset).toBe("2gib");
  });

  it("leaves the name to the file's vault folder", () => {
    const draft = {
      ...createEmptyCreateVaultDraft([]),
      source: "import" as const,
      importKind: "file" as const,
      importFileName: "test-plain-text.zip",
      importFilePath: "/tmp/test-plain-text.zip",
      displayName: "test-plain-text",
    };
    const next = applyEmbeddedVaultSettings(
      draft,
      { settings: settings(), unlockPreset: null },
      draft,
    );
    expect(next.displayName).toBe("test-plain-text");
  });
});

describe("applyImportVaultName", () => {
  const draft = {
    ...createEmptyCreateVaultDraft([]),
    source: "import" as const,
    importKind: "file" as const,
    importFileName: "test-plain-text-2.zip",
    importFilePath: "/tmp/test-plain-text-2.zip",
    displayName: "test-plain-text-2",
  };

  it("names the vault after its folder, whatever the file is called", () => {
    expect(applyImportVaultName(draft, "test", draft, []).displayName).toBe("test");
  });

  it("suffixes a taken name", () => {
    expect(applyImportVaultName(draft, "Notes", draft, ["Notes"]).displayName).toBe("Notes 2");
  });

  it("keeps a name typed since the file was chosen", () => {
    const typed = { ...draft, displayName: "Mine" };
    expect(applyImportVaultName(typed, "test", draft, [])).toBe(typed);
  });

  it("leaves a vault made from a backup with its own name", () => {
    const backup = { ...draft, importKind: "backup" as const, displayName: "Notes backup" };
    expect(applyImportVaultName(backup, "Notes", backup, [])).toBe(backup);
  });
});

describe("parseEmbeddedVaultSettings", () => {
  it("reads a probe record and drops an unknown preset", () => {
    const parsed = parseEmbeddedVaultSettings({
      unlockPreset: "nope",
      settings: settings(),
    });
    expect(parsed?.unlockPreset).toBeNull();
    expect(parsed?.settings.vault.note).toBe("tax year");
  });

  it("ignores a record without settings", () => {
    expect(parseEmbeddedVaultSettings({ ok: true })).toBeNull();
  });
});
