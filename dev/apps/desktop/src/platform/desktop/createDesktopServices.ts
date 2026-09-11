import type { AppServices, VaultService } from "@upriv/shared";
import { mockServices } from "@/platform/mocks";
import { setMockVaultGroupHiddenLogger } from "@/platform/mocks/services/vaultGroupService";
import { desktopAppSettingsService } from "./services/appSettingsService";
import { desktopLogService } from "./services/logService";
import { desktopVaultRootService } from "./services/vaultRootService";

/**
 * Until `vault_list` RPC lands: seed mock rows in Vite/Electron **dev** so UI
 * work survives reload. Packaged builds stay empty (no fake rows on a real root).
 */
const desktopVaultService: VaultService = {
  ...mockServices.vault,
  async listVaults() {
    if (import.meta.env.DEV) {
      return mockServices.vault.listVaults();
    }
    return [];
  },
};

/**
 * Desktop adapters → upriv-daemon. Vault-root + app settings + logs are live.
 * Vault list + vault groups stay mock until `vault_list` lands — live group
 * RPCs reject mock/wizard vault ids (`vault_not_found`) because they are not on disk.
 */
export function createDesktopServices(): AppServices {
  setMockVaultGroupHiddenLogger(() => {
    void desktopLogService.recordVaultGroupHidden();
  });
  return {
    ...mockServices,
    vaultRoot: desktopVaultRootService,
    appSettings: desktopAppSettingsService,
    logs: desktopLogService,
    vault: desktopVaultService,
    // Do not wire `desktopVaultGroupService` until `vault_list` — live RPCs
    // reject mock/wizard vault ids (`vault_not_found`) because they are not on disk.
    vaultGroups: mockServices.vaultGroups,
  };
}
