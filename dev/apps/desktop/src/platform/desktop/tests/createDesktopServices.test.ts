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
});
