import type { VaultSettingsConfig } from "@upriv/shared";
import { TAURI_COMMANDS, tauriInvoke } from "@/lib/tauri";
import { clearPendingVaultSettings } from "./pendingVaultSettings";
import { vaultSettingsToRawConfig } from "./mapVaultConfig";
import { resolveVaultRootPath } from "./vaultRoot";

export function createTauriCreateVaultService() {
  return {
    testImportArchivePassword(_password: string) {
      return false;
    },

    selectImportArchiveForProbe() {
      return { path: "", fileName: "" };
    },

    async createVault(settings: VaultSettingsConfig, password: string) {
      const vaultRoot = await resolveVaultRootPath();
      await tauriInvoke(TAURI_COMMANDS.VAULT_CREATE, {
        vaultRoot,
        config: vaultSettingsToRawConfig(settings),
        password,
      });
      clearPendingVaultSettings(settings.vault.id);
    },
  };
}
