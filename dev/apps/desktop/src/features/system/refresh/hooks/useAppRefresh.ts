import { useCallback } from "react";
import type { VaultListItem } from "@upriv/shared";
import { useVaultService } from "@/platform/services";
import { useAppSettingsContext } from "@/features/system/settings";
import { useFileManager } from "@/features/vaults/file-manager";
import { useRefreshState } from "./useRefreshState";

interface UseAppRefreshOptions {
  /** Apply a fresh vault list snapshot into list UI state. */
  applyVaultList: (rows: VaultListItem[]) => void;
  onError?: (error: unknown) => void;
}

/** Reload app settings, vault list, lifecycle sessions, and file-manager tabs from services. */
export function useAppRefresh({ applyVaultList, onError }: UseAppRefreshOptions) {
  const vaultService = useVaultService();
  const { reloadSettings } = useAppSettingsContext();
  const { syncWithVaultList } = useFileManager();
  const { isRefreshing, refresh: runRefreshAnimation } = useRefreshState();

  const refresh = useCallback(async () => {
    runRefreshAnimation();
    try {
      const [, vaultRows] = await Promise.all([reloadSettings(), vaultService.listVaults()]);
      applyVaultList(vaultRows);
      syncWithVaultList(vaultRows);
    } catch (error) {
      onError?.(error);
    }
  }, [
    applyVaultList,
    onError,
    reloadSettings,
    runRefreshAnimation,
    syncWithVaultList,
    vaultService,
  ]);

  return { isRefreshing, refresh };
}
