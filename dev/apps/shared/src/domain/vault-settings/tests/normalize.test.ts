import { describe, expect, it } from "vitest";
import { normalizeVaultSettingsConfig, vaultSettingsSectionsForStorage } from "..";
import { vaultSettingsFixture } from "./fixtures";

describe("normalizeVaultSettingsConfig", () => {
  it("normalizes seven_zip compression when encrypt-only", () => {
    const raw = vaultSettingsFixture({
      storageMode: "upriv_plain",
      sevenZip: { archive_mode: "encrypt_only", compression_level: 9 },
    });
    const normalized = normalizeVaultSettingsConfig(raw);
    expect(normalized.seven_zip.compression_level).toBe(0);
    expect(normalized.backup.enabled).toBe(true);
    expect(normalized.backup.skip_unchanged).toBe(true);
  });

  it("collapses extra spaces in the vault display name", () => {
    const raw = vaultSettingsFixture();
    raw.vault.display_name = "Demo    Vault";
    const normalized = normalizeVaultSettingsConfig(raw);
    expect(normalized.vault.display_name).toBe("Demo Vault");
  });
});

describe("vaultSettingsSectionsForStorage", () => {
  it("lists config.toml sections for both storage modes", () => {
    for (const mode of ["encrypted_dir", "upriv_plain"] as const) {
      expect(vaultSettingsSectionsForStorage(mode)).toEqual([
        "vault",
        "storage",
        "mount",
        "backup",
        "auto_close",
      ]);
    }
  });
});
