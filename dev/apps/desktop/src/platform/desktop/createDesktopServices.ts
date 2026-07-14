import type { AppServices, VaultService } from "@upriv/shared";
import { mockServices } from "@/platform/mocks";
import { desktopAppSettingsService } from "./services/appSettingsService";
import { desktopVaultRootService } from "./services/vaultRootService";

/**
 * Empty list until `vault_list` RPC lands — avoids showing mock rows against a
 * real on-disk root created by vault-root setup.
 *
 * Future work: implement `vault_list` in upriv-core + desktop adapter so cofres
 * under `.upriv/vaults/` appear after setup (not a vault-root path bug).
 */
const desktopVaultService: VaultService = {
  ...mockServices.vault,
  async listVaults() {
    return [];
  },
};

/**
 * Desktop adapters → upriv-daemon. Vault-root + app settings are live; other
 * services stay mock until their RPCs are ported.
 */
export function createDesktopServices(): AppServices {
  return {
    ...mockServices,
    vaultRoot: desktopVaultRootService,
    appSettings: desktopAppSettingsService,
    vault: desktopVaultService,
  };
}
