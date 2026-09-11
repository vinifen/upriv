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
    const settings = getMockVaultSettings("upriv-plain-demo");
    expect(settings.storage.mode).toBe("upriv_plain");
    expect(settings.vault.display_name).toBe("Upriv Plain Demo");
    expect(settings.vault.id).toBe("upriv-plain-demo");
  });

  it("uses defaults for unknown vault ids", () => {
    const settings = getMockVaultSettings("brand-new-vault");
    expect(settings.storage.mode).toBe("encrypted_dir");
    expect(settings.vault.display_name).toBe("brand-new-vault");
    expect(settings.vault.id).toBe("brand-new-vault");
  });

  it("prefers runtime registration over static mocks", () => {
    const config = getMockVaultSettings("upriv-plain-demo");
    const runtime: VaultSettingsConfig = {
      ...config,
      vault: { ...config.vault, id: "runtime-test-vault", display_name: "Runtime" },
      storage: { mode: "upriv_plain" },
    };
    registerMockVaultSettings(runtime);

    expect(getMockVaultSettings("runtime-test-vault").storage.mode).toBe("upriv_plain");
    expect(getMockVaultSettings("runtime-test-vault").vault.display_name).toBe("Runtime");

    unregisterMockVaultSettings("runtime-test-vault");
    expect(getMockVaultSettings("runtime-test-vault").storage.mode).toBe("encrypted_dir");
  });
});
