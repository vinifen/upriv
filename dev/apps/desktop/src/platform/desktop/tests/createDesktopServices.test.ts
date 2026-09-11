import { describe, expect, it } from "vitest";
import { createDesktopServices } from "../createDesktopServices";
import { desktopVaultGroupService } from "../services/vaultGroupService";
import { mockServices } from "@/platform/mocks";

describe("createDesktopServices", () => {
  it("keeps vault groups on the mock until vault_list", () => {
    const services = createDesktopServices();
    expect(services.vaultGroups).toBe(mockServices.vaultGroups);
    expect(services.vaultGroups).not.toBe(desktopVaultGroupService);
  });

  it("uses live vault-root, settings, and logs adapters", () => {
    const services = createDesktopServices();
    expect(services.vaultRoot).not.toBe(mockServices.vaultRoot);
    expect(services.appSettings).not.toBe(mockServices.appSettings);
    expect(services.logs).not.toBe(mockServices.logs);
    expect(services.lifecycle).toBe(mockServices.lifecycle);
    expect(services.filesystem).toBe(mockServices.filesystem);
  });
});
