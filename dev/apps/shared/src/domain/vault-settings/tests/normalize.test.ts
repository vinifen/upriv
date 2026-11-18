import { describe, expect, it } from "vitest";
import { normalizeVaultSettingsConfig, VAULT_SETTINGS_SECTIONS } from "..";
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

describe("VAULT_SETTINGS_SECTIONS", () => {
  it("lists the preference sections, with the storage value on a screen of its own", () => {
    expect(VAULT_SETTINGS_SECTIONS).toEqual(["vault", "unlocked_folder", "backup", "auto_close"]);
  });
});
