import { beforeEach, describe, expect, it } from "vitest";
import type { VaultSettingsConfig } from "@upriv/shared";
import {
  getMockVaultSettings,
  registerMockVaultSettings,
  unregisterMockVaultSettings,
} from "../vaultSettings";

describe("getMockVaultSettings", () => {
  beforeEach(() => {
    unregisterMockVaultSettings("runtime-test-vault");
  });

  it("merges static overrides for known vaults", () => {
    const settings = getMockVaultSettings("store-only-demo");
    expect(settings.storage.mode).toBe("store_only");
    expect(settings.vault.display_name).toBe("Store Only Demo");
    expect(settings.vault.id).toBe("store-only-demo");
  });

  it("uses defaults for unknown vault ids", () => {
    const settings = getMockVaultSettings("brand-new-vault");
    expect(settings.storage.mode).toBe("encrypted_dir");
    expect(settings.vault.display_name).toBe("brand-new-vault");
    expect(settings.vault.store_dir).toBe("store");
  });

  it("prefers runtime registration over static mocks", () => {
    const config = getMockVaultSettings("store-only-demo");
    const runtime: VaultSettingsConfig = {
      ...config,
      vault: { ...config.vault, id: "runtime-test-vault", display_name: "Runtime" },
      storage: { mode: "ram_only" },
    };
    registerMockVaultSettings(runtime);

    expect(getMockVaultSettings("runtime-test-vault").storage.mode).toBe("ram_only");
    expect(getMockVaultSettings("runtime-test-vault").vault.display_name).toBe("Runtime");

    unregisterMockVaultSettings("runtime-test-vault");
    expect(getMockVaultSettings("runtime-test-vault").storage.mode).toBe("encrypted_dir");
  });
});
