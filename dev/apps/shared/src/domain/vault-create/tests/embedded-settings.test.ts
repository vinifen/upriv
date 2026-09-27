import { describe, expect, it } from "vitest";
import { createEmptyCreateVaultDraft } from "../defaults";
import {
  applyEmbeddedVaultSettings,
  parseEmbeddedVaultSettings,
} from "../applyEmbeddedVaultSettings";
import type { VaultSettingsConfig } from "../../vault-settings";

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
    storage: { mode: "encrypted_dir" },
    mount: { workspace_path: "/data/vaults" },
    backup: { enabled: false, mode: "keep_all", keep_last: 3 },
    security: {
      mode: "always_prompt",
      secure_wipe_workspace: false,
      wipe_passes: 2,
      wipe_pattern: "zeros",
    },
    auto_close: {
      enabled: true,
      idle_minutes: 5,
      warn_before_seconds: 30,
      close_on_app_exit: true,
    },
    seven_zip: {
      encrypt_file_names: false,
      archive_mode: "compress_encrypt",
      compression_level: 5,
      solid: true,
      method: "lzma2",
    },
    policy: {
      allow_external_editors: true,
      disallow_copy_outside_mount: false,
      require_unmount_on_sleep: false,
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
    expect(next.security.wipe_passes).toBe(2);
    expect(next.seven_zip.solid).toBe(true);
    expect(next.kdf.unlock_preset).toBe("128mib");
    expect(next.groupMode).toBe("none");
  });

  it("keeps a backup mode the user already changed", () => {
    const snapshot = {
      ...createEmptyCreateVaultDraft([]),
      backup: { enabled: true, mode: "keep_all" as const, keep_last: 1 },
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

  it("uses the archive vault name and suffixes a taken name", () => {
    const draft = {
      ...createEmptyCreateVaultDraft([]),
      source: "import" as const,
      importKind: "file" as const,
      importFileName: "export.zip",
      importFilePath: "/tmp/export.zip",
      displayName: "export",
    };
    const next = applyEmbeddedVaultSettings(
      draft,
      { settings: settings(), unlockPreset: null },
      draft,
      ["Notes"],
    );
    expect(next.displayName).toBe("Notes 2");
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
