import { describe, expect, it } from "vitest";
import {
  normalizeClosePolicyForStorage,
  normalizeVaultSettingsConfig,
  vaultSettingsSectionsForStorage,
} from "..";
import { vaultSettingsFixture } from "./fixtures";

describe("normalizeClosePolicyForStorage", () => {
  it.each(["plain", "plain_only", "ram_only"] as const)(
    "forces seal default on seal-only mode %s",
    (storageMode) => {
      const config = vaultSettingsFixture({ storageMode, closeAction: "close" });
      expect(normalizeClosePolicyForStorage(config).close.default_action).toBe("seal");
    },
  );

  it("leaves close default on closed-cache modes that can seal", () => {
    const config = vaultSettingsFixture({ storageMode: "store_only", closeAction: "close" });
    expect(normalizeClosePolicyForStorage(config).close.default_action).toBe("close");
  });

  it("forces close default on close-only storage", () => {
    for (const storageMode of ["upriv_only", "upriv_plain"] as const) {
      const config = vaultSettingsFixture({ storageMode, closeAction: "seal" });
      expect(normalizeClosePolicyForStorage(config).close.default_action).toBe("close");
    }
  });

  it("does not override explicit seal on plain modes", () => {
    const config = vaultSettingsFixture({ storageMode: "plain", closeAction: "seal" });
    expect(normalizeClosePolicyForStorage(config).close.default_action).toBe("seal");
  });
});

describe("normalizeVaultSettingsConfig", () => {
  it("applies close, security, and seven_zip normalization together", () => {
    const raw = vaultSettingsFixture({
      storageMode: "plain_only",
      closeAction: "close",
      securityMode: "session_ram",
      sevenZip: { archive_mode: "encrypt_only", compression_level: 9 },
    });
    const normalized = normalizeVaultSettingsConfig(raw);
    expect(normalized.close.default_action).toBe("seal");
    expect(normalized.security.mode).toBe("session_ram");
    expect(normalized.seven_zip.compression_level).toBe(0);
  });

  it("disables .7z backups on close-only storage", () => {
    const raw = vaultSettingsFixture({ storageMode: "upriv_plain", closeAction: "seal" });
    const normalized = normalizeVaultSettingsConfig(raw);
    expect(normalized.close.default_action).toBe("close");
    expect(normalized.backup.enabled).toBe(false);
  });
});

describe("vaultSettingsSectionsForStorage", () => {
  it("hides backup and seven_zip for close-only storage", () => {
    for (const mode of ["upriv_only", "upriv_plain"] as const) {
      expect(vaultSettingsSectionsForStorage(mode)).toEqual([
        "vault",
        "storage",
        "close",
        "security",
        "policy",
      ]);
    }
  });

  it("keeps backup and seven_zip when a portable archive exists", () => {
    expect(vaultSettingsSectionsForStorage("encrypted_dir")).toContain("backup");
    expect(vaultSettingsSectionsForStorage("encrypted_dir")).toContain("seven_zip");
  });
});
