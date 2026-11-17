import { useEffect, useState } from "react";
import {
  resolveVaultDisplayStatus,
  shouldBumpVaultRootEpoch,
  vaultRootGoneRpcError,
  vaultRootLogsDisplayPath,
  vaultRootUprivOpenPath,
} from "../domain";
import type { AppSettingsConfig, SystemInfoSnapshot, VaultGroup, VaultListItem } from "../domain";
import type { DeviceService, VaultRootService } from "../services";

export type SystemInfoAppVersion = SystemInfoSnapshot["app"];

export interface UseSystemInfoDataOptions {
  open: boolean;
  vaults: readonly VaultListItem[];
  groups: readonly VaultGroup[];
  settings: AppSettingsConfig;
  vaultRootService: VaultRootService;
  deviceService: DeviceService;
  getVersion: () => Promise<SystemInfoAppVersion> | SystemInfoAppVersion;
  /** Effective list show-hidden (persisted always-show or session). */
  showHiddenVaults?: boolean;
}

export function useSystemInfoData({
  open,
  vaults,
  groups,
  settings,
  vaultRootService,
  deviceService,
  getVersion,
  showHiddenVaults = false,
}: UseSystemInfoDataOptions) {
  const [snapshot, setSnapshot] = useState<SystemInfoSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadFailure, setLoadFailure] = useState<unknown>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const visibleVaults = vaults.filter((vault) => !vault.hidden);
  const vaultsTotal = visibleVaults.length;
  // List-session inventory: `open` only. Renderer `closing` means flush may
  // still be in flight in core, but Info "open" is the list badge, not a live
  // core probe — do not count closing as open.
  const vaultsOpen = visibleVaults.filter(
    (vault) => resolveVaultDisplayStatus(vault) === "open",
  ).length;
  const groupsTotal = groups.filter((group) => !group.hidden).length;
  const ui = settings.ui;
  const logging = settings.logging;
  const unlockedFolders = settings.unlocked_folders;
  const backups = settings.backups;
  const listsKey = JSON.stringify([unlockedFolders, backups]);
  const lastOpenedRaw = settings.app.last_opened_vault ?? "";
  const lastOpenedIsHidden = vaults.some(
    (vault) => vault.id === lastOpenedRaw && Boolean(vault.hidden),
  );
  const lastOpenedVault = lastOpenedIsHidden && !showHiddenVaults ? "" : lastOpenedRaw;

  // StrictMode remounts in development — `cancelled` drops the stale load.
  // Key on Info fields, not `vaults` / `groups` / `settings` object identity.
  useEffect(() => {
    if (!open) {
      setSnapshot(null);
      setLoadError(false);
      setLoadFailure(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setLoadFailure(null);

    void (async () => {
      try {
        const [versionInfo, device, root, dataFolders] = await Promise.all([
          Promise.resolve(getVersion()),
          deviceService.info(),
          vaultRootService.resolve(),
          vaultRootService.list(),
        ]);
        if (cancelled) return;
        if (root.status !== "found") {
          throw vaultRootGoneRpcError();
        }

        // The app home holds the data folder list; on a computer it is Default's folder.
        const appHome = dataFolders.defaultFolder ?? "—";
        setSnapshot({
          app: versionInfo,
          device,
          root,
          dataFolders,
          inventory: {
            vaultsTotal,
            vaultsOpen,
            groupsTotal,
          },
          ui,
          logging,
          unlockedFolders,
          backups,
          lastOpenedVault,
          paths: {
            appHome,
            logsDir: vaultRootLogsDisplayPath(root.rootPath),
            logsOpenPath: vaultRootUprivOpenPath(root.rootPath, "logs"),
          },
        });
      } catch (error) {
        if (cancelled) return;
        if (shouldBumpVaultRootEpoch(error)) {
          setSnapshot(null);
        }
        setLoadFailure(error);
        setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Snapshot stores `ui`/`logging` values. Object identity must not retrigger resolve.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scalar Info fields only
  }, [
    open,
    vaultsTotal,
    vaultsOpen,
    groupsTotal,
    lastOpenedVault,
    ui.locale,
    ui.theme,
    ui.vault_list_sort,
    ui.vault_list_sort_direction,
    ui.vault_list_view,
    ui.vault_list_search,
    ui.vault_list_show_create_button,
    ui.vault_list_show_search_button,
    ui.vault_list_show_sort_button,
    ui.vault_list_show_view_button,
    ui.vault_list_show_header_more_button,
    ui.vault_list_show_vault_more_button,
    ui.vault_list_show_vault_settings_button,
    ui.vault_list_show_group_settings_button,
    ui.vault_list_show_drag,
    ui.vault_list_allow_drag_into_group,
    ui.file_manager_dock_expanded,
    ui.lifecycle_close_modal_on_submit,
    ui.lifecycle_open_file_manager_on_open,
    ui.lifecycle_keep_open_on_wake,
    ui.lifecycle_confirm_close_now,
    ui.lifecycle_confirm_stop,
    ui.lifecycle_confirm_lock,
    ui.lifecycle_row_runs_button,
    ui.always_show_hidden_vaults,
    logging.enabled,
    logging.level,
    logging.entries_per_file,
    logging.keep_last_entries,
    listsKey,
    vaultRootService,
    deviceService,
    getVersion,
    loadAttempt,
  ]);

  return {
    snapshot,
    loading,
    loadError,
    loadFailure,
    retryLoad: () => setLoadAttempt((n) => n + 1),
  };
}
