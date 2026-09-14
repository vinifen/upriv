import { useCallback } from "react";
import type { VaultListItem } from "@upriv/shared";
import { useVaultService } from "@/platform/services";
import { useAppSettingsContext } from "@/features/system/settings";
import { useRefreshState } from "./useRefreshState";

interface UseAppRefreshOptions {
  /** Apply a fresh vault list snapshot into list UI state. */
  applyVaultList: (rows: VaultListItem[], fetchStartedAt: number) => void;
  onError?: (error: unknown) => void;
}

/** Reload app settings and vault list from services. File-manager tabs follow `vaults`. */
export function useAppRefresh({ applyVaultList, onError }: UseAppRefreshOptions) {
  const vaultService = useVaultService();
  const { reloadSettings } = useAppSettingsContext();
  const { isRefreshing, refresh: runRefreshAnimation } = useRefreshState();

  const refresh = useCallback(async () => {
    runRefreshAnimation();
    const fetchStartedAt = Date.now();
    try {
      const [, vaultRows] = await Promise.all([reloadSettings(), vaultService.listVaults()]);
      applyVaultList(vaultRows, fetchStartedAt);
    } catch (error) {
      onError?.(error);
    }
  }, [applyVaultList, onError, reloadSettings, runRefreshAnimation, vaultService]);

  return { isRefreshing, refresh };
}
