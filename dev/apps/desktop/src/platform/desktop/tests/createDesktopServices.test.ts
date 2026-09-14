import { describe, expect, it } from "vitest";
import { createDesktopServices } from "../createDesktopServices";
import { desktopVaultGroupService } from "../services/vaultGroupService";
import { desktopVaultLifecycleService } from "../services/vaultLifecycleService";
import { desktopVaultService } from "../services/vaultService";
import { mockServices } from "@/platform/mocks";

describe("createDesktopServices", () => {
  it("uses live vault, lifecycle, and group adapters", () => {
    const services = createDesktopServices();
    expect(services.vault).toBe(desktopVaultService);
    expect(services.lifecycle).toBe(desktopVaultLifecycleService);
    expect(services.vaultGroups).toBe(desktopVaultGroupService);
  });

  it("uses live vault-root, settings, and logs adapters", () => {
    const services = createDesktopServices();
    expect(services.vaultRoot).not.toBe(mockServices.vaultRoot);
    expect(services.appSettings).not.toBe(mockServices.appSettings);
    expect(services.logs).not.toBe(mockServices.logs);
    expect(services.filesystem).toBe(mockServices.filesystem);
    expect(services.vaultSecurity).not.toBe(mockServices.vaultSecurity);
  });
});
