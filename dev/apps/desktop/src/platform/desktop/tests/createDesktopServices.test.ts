import { describe, expect, it } from "vitest";
import { VAULT_ERROR_CODES } from "@upriv/shared";
import { createDesktopServices } from "../createDesktopServices";
import { desktopAppSettingsService } from "../services/appSettingsService";
import { desktopBackupService } from "../services/backupService";
import { desktopCreateVaultService } from "../services/createVaultService";
import { desktopLogService } from "../services/logService";
import { desktopVaultFileSystemService } from "../services/vaultFileSystemService";
import { desktopVaultGroupService } from "../services/vaultGroupService";
import { desktopVaultLifecycleService } from "../services/vaultLifecycleService";
import { desktopVaultRootService } from "../services/vaultRootService";
import { desktopVaultService } from "../services/vaultService";

describe("createDesktopServices", () => {
  it("uses live daemon adapters for every service", async () => {
    const services = createDesktopServices();
    expect(services.vault).toBe(desktopVaultService);
    expect(services.lifecycle).toBe(desktopVaultLifecycleService);
    expect(services.vaultGroups).toBe(desktopVaultGroupService);
    expect(services.vaultRoot).toBe(desktopVaultRootService);
    expect(services.appSettings).toBe(desktopAppSettingsService);
    expect(services.logs).toBe(desktopLogService);
    expect(services.filesystem).toBe(desktopVaultFileSystemService);
    expect(services.backups).toBe(desktopBackupService);
    expect(services.createVault).toBe(desktopCreateVaultService);
    await expect(
      services.vaultSecurity.changePassword("notes", {
        currentPassword: "a",
        newPassword: "b",
      }),
    ).rejects.toMatchObject({ code: VAULT_ERROR_CODES.REWRAP_UNAVAILABLE });
  });
});
