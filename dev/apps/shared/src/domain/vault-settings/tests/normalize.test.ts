import { describe, expect, it } from "vitest";
import { normalizeVaultSettingsConfig, vaultSettingsSectionsForStorage } from "..";
import { vaultSettingsFixture } from "./fixtures";

describe("normalizeVaultSettingsConfig", () => {
  it("normalizes seven_zip compression when encrypt-only", () => {
    const raw = vaultSettingsFixture({
      storageMode: "upriv_plain",
      securityMode: "session_ram",
      sevenZip: { archive_mode: "encrypt_only", compression_level: 9 },
    });
    const normalized = normalizeVaultSettingsConfig(raw);
    expect(normalized.security.mode).toBe("session_ram");
    expect(normalized.seven_zip.compression_level).toBe(0);
    expect(normalized.backup.enabled).toBe(true);
  });
});

describe("vaultSettingsSectionsForStorage", () => {
  it("lists config.toml sections for both storage modes", () => {
    for (const mode of ["encrypted_dir", "upriv_plain"] as const) {
      expect(vaultSettingsSectionsForStorage(mode)).toEqual([
        "vault",
        "storage",
        "mount",
        "auto_close",
        "backup",
        "security",
        "policy",
      ]);
    }
  });
});
