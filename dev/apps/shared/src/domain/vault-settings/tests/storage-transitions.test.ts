import { describe, expect, it } from "vitest";
import { patchCloseDefaultAction, patchStorageMode, transitionStorageModeClose } from "..";
import { vaultSettingsFixture } from "./fixtures";

describe("transitionStorageModeClose", () => {
  it("keeps close when mode unchanged", () => {
    expect(transitionStorageModeClose("encrypted_dir", "seal", "encrypted_dir", "close")).toEqual({
      close: "seal",
      encryptedClosePreference: "seal",
    });
  });

  it("forces seal when entering seal-only mode", () => {
    expect(
      transitionStorageModeClose("encrypted_dir", "close", "plain_only", "close"),
    ).toEqual({ close: "seal", encryptedClosePreference: "close" });
  });

  it("restores encrypted close preference when leaving seal-only mode", () => {
    expect(
      transitionStorageModeClose("plain_only", "seal", "store_only", "close"),
    ).toEqual({ close: "close", encryptedClosePreference: "close" });
  });

  it("preserves preference through seal-only detour from plain to ram", () => {
    expect(
      transitionStorageModeClose("plain", "seal", "ram_only", "close"),
    ).toEqual({ close: "seal", encryptedClosePreference: "close" });
  });
});

describe("patchStorageMode", () => {
  it("forces seal and preserves security when switching to plain_only", () => {
    const base = vaultSettingsFixture({ securityMode: "session_ram" });
    const { config } = patchStorageMode(base, "plain_only", "close");
    expect(config.close.default_action).toBe("seal");
    expect(config.security.mode).toBe("session_ram");
  });

  it("preserves disk security when switching to encrypted_dir", () => {
    const plain = vaultSettingsFixture({
      storageMode: "plain",
      securityMode: "disk_open_close",
      closeAction: "seal",
    });
    const { config } = patchStorageMode(plain, "encrypted_dir", "close");
    expect(config.security.mode).toBe("disk_open_close");
    expect(config.close.default_action).toBe("close");
  });

  it("keeps plain disk security when switching between plain modes", () => {
    const plain = vaultSettingsFixture({
      storageMode: "plain",
      securityMode: "disk_open_close",
      closeAction: "seal",
    });
    const { config } = patchStorageMode(plain, "plain_only", "close");
    expect(config.security.mode).toBe("disk_open_close");
    expect(config.close.default_action).toBe("seal");
  });
});

describe("patchCloseDefaultAction", () => {
  it("forces seal on seal-only storage even if close is requested", () => {
    const plain = vaultSettingsFixture({
      storageMode: "plain_only",
      closeAction: "seal",
    });
    const { config, encryptedClosePreference } = patchCloseDefaultAction(plain, "close", "close");
    expect(config.close.default_action).toBe("seal");
    expect(encryptedClosePreference).toBe("close");
  });

  it("updates preference on closed-cache modes", () => {
    const base = vaultSettingsFixture({ storageMode: "store_only", closeAction: "close" });
    const { config, encryptedClosePreference } = patchCloseDefaultAction(base, "seal", "close");
    expect(config.close.default_action).toBe("seal");
    expect(encryptedClosePreference).toBe("seal");
  });
});
