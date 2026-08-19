import type { AppServices, VaultService } from "@upriv/shared";
import { mockServices } from "@/platform/mocks";
import { desktopAppSettingsService } from "./services/appSettingsService";
import { desktopLogService } from "./services/logService";
import { desktopVaultRootService } from "./services/vaultRootService";

/**
 * Empty list until `vault_list` RPC lands — avoids showing mock rows against a
 * real on-disk root created by vault-root setup.
 *
 * Future work: implement `vault_list` in upriv-core + desktop adapter so vaults
 * under `.upriv/vaults/` appear after setup (not a vault-root path bug).
 */
const desktopVaultService: VaultService = {
  ...mockServices.vault,
  async listVaults() {
    return [];
  },
};

/**
 * Desktop adapters → upriv-daemon. Vault-root + app settings + logs are live.
 * Vault list + vault groups stay mock until `vault_list` lands — live group
 * RPCs reject mock/wizard vault ids (`vault_not_found`) because they are not on disk.
 */
export function createDesktopServices(): AppServices {
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
