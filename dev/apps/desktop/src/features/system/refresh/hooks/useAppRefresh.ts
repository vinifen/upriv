import { useCallback, useRef, useState } from "react";
import type { VaultGroupListResult, VaultListItem } from "@upriv/shared";
import { useVaultGroupService, useVaultService } from "@/platform/services";
import { useAppSettingsContext } from "@/features/system/settings";
import { useRefreshState } from "./useRefreshState";

interface UseAppRefreshOptions {
  /** Apply a fresh vault list snapshot into list UI state. */
  applyVaultList: (rows: VaultListItem[], fetchStartedAt: number) => void;
  /** Apply the groups read by the same refresh. */
  applyGroups: (result: VaultGroupListResult) => void;
  /** A refresh that failed, once, with its first error. */
  onError?: (error: unknown) => void;
}

/**
 * Reload app settings, the vault list, and the groups together. One refresh
 * runs at a time, and the spinner turns until it settles. A refresh that
 * outlives a data folder change applies nothing and reports nothing: the new
 * folder loads on its own. File-manager tabs follow `vaults`.
 */
export function useAppRefresh({ applyVaultList, applyGroups, onError }: UseAppRefreshOptions) {
  const vaultService = useVaultService();
  const vaultGroupService = useVaultGroupService();
  const { reloadSettings, vaultRootEpoch } = useAppSettingsContext();
  const { isRefreshing: spinning, refresh: spin } = useRefreshState();
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const epochRef = useRef(vaultRootEpoch);
  epochRef.current = vaultRootEpoch;

  const refresh = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    spin();
    const fetchStartedAt = Date.now();
    const epochAtStart = epochRef.current;
    try {
      const [, rows, groups] = await Promise.all([
        reloadSettings(),
        vaultService.listVaults(),
        vaultGroupService.list(),
      ]);
      if (epochRef.current !== epochAtStart) return;
      applyVaultList(rows, fetchStartedAt);
      applyGroups(groups);
    } catch (error) {
      if (epochRef.current === epochAtStart) onError?.(error);
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [applyGroups, applyVaultList, onError, reloadSettings, spin, vaultGroupService, vaultService]);

  return { isRefreshing: running || spinning, refresh };
}
