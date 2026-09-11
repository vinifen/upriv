import { useEffect, useState } from "react";
import {
  resolveVaultDisplayStatus,
  shouldBumpVaultRootEpoch,
  vaultRootGoneRpcError,
  vaultRootLogsDisplayPath,
} from "../domain";
import type { AppSettingsConfig, SystemInfoSnapshot, VaultGroup, VaultListItem } from "../domain";
import type { VaultRootService } from "../services";

export type SystemInfoAppVersion = SystemInfoSnapshot["app"];

export interface UseSystemInfoDataOptions {
  open: boolean;
  vaults: readonly VaultListItem[];
  groups: readonly VaultGroup[];
  settings: AppSettingsConfig;
  vaultRootService: VaultRootService;
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
  const vaultsOpen = visibleVaults.filter(
    (vault) => resolveVaultDisplayStatus(vault) === "open",
  ).length;
  const groupsTotal = groups.filter((group) => !group.hidden).length;
  const ui = settings.ui;
  const logging = settings.logging;
  const workspacePath = settings.workspace.path;
  const vaultRootMode = settings.app.vault_root_mode;
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
        const [versionInfo, root, defaultStatus] = await Promise.all([
          Promise.resolve(getVersion()),
          vaultRootService.resolve({ vaultRootMode }),
          vaultRootService.defaultRootStatus(),
        ]);
        if (cancelled) return;
        if (root.status !== "found") {
          throw vaultRootGoneRpcError();
        }

        // App home = `.upriv-root` parent (default-root anchor). Vault-root
        // (found `rootPath`) may be a different folder in `custom_root`.
        const appHome = defaultStatus.defaultRootAnchor;
        const vaultRootBase =
          root.status === "found" && root.rootPath.trim()
            ? root.rootPath
            : defaultStatus.defaultRootAnchor;
        setSnapshot({
          app: versionInfo,
          root,
          rootMode: vaultRootMode,
          inventory: {
            vaultsTotal,
            vaultsOpen,
            groupsTotal,
          },
          ui,
          logging,
          workspace: { path: workspacePath },
          lastOpenedVault,
          paths: {
            appHome,
            logsDir: vaultRootLogsDisplayPath(vaultRootBase),
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
    vaultRootMode,
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
    ui.always_show_hidden_vaults,
    logging.enabled,
    logging.level,
    logging.entries_per_file,
    logging.keep_last_entries,
    workspacePath,
    vaultRootService,
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
