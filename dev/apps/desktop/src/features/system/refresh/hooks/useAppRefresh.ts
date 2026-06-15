import { useCallback } from "react";
import type { VaultListItem } from "@upriv/shared";
import { useVaultLifecycleService, useVaultService } from "@/platform/services";
import { useAppSettingsContext } from "@/features/system/settings";
import { useFileManager } from "@/features/vaults/file-manager";
import { useRefreshState } from "./useRefreshState";

interface UseAppRefreshOptions {
  /** Apply a fresh vault list snapshot into list UI state. */
  applyVaultList: (rows: VaultListItem[]) => void;
}

/** Reload app settings, vault list, lifecycle sessions, and file-manager tabs from services. */
export function useAppRefresh({ applyVaultList }: UseAppRefreshOptions) {
  const vaultService = useVaultService();
  const lifecycleService = useVaultLifecycleService();
  const { reloadSettings } = useAppSettingsContext();
  const { syncWithVaultList } = useFileManager();
  const { isRefreshing, refresh: runRefreshAnimation } = useRefreshState();

  const refresh = useCallback(async () => {
    runRefreshAnimation();

    const [, vaultRows] = await Promise.all([reloadSettings(), vaultService.listVaults()]);

    applyVaultList(vaultRows);
    lifecycleService.seedInitialOpenVaultPasswords(
      vaultRows.filter((vault) => vault.session === "open").map((vault) => vault.id),
    );
    syncWithVaultList(vaultRows);
  }, [
    applyVaultList,
    lifecycleService,
    reloadSettings,
    runRefreshAnimation,
    syncWithVaultList,
    vaultService,
  ]);

  return { isRefreshing, refresh };
}
