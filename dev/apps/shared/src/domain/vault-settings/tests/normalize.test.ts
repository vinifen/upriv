import { describe, expect, it } from "vitest";
import { normalizeClosePolicyForStorage, normalizeVaultSettingsConfig } from "..";
import { vaultSettingsFixture } from "./fixtures";

describe("normalizeClosePolicyForStorage", () => {
  it.each(["plain", "plain_only", "ram_only"] as const)(
    "forces seal default on seal-only mode %s",
    (storageMode) => {
      const config = vaultSettingsFixture({ storageMode, closeAction: "close" });
      expect(normalizeClosePolicyForStorage(config).close.default_action).toBe("seal");
    },
  );

  it("leaves close default on closed-cache modes", () => {
    const config = vaultSettingsFixture({ storageMode: "store_only", closeAction: "close" });
    expect(normalizeClosePolicyForStorage(config).close.default_action).toBe("close");
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
});
