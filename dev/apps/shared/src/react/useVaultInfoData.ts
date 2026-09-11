import { useEffect, useState } from "react";
import {
  resolveVaultMountPoint,
  shouldBumpVaultRootEpoch,
  vaultRootContentorPath,
  vaultRootGoneRpcError,
  vaultStoreDisplayPaths,
  WORKSPACE_PATH_DEFAULT,
  type StorageMode,
  type VaultGroup,
  type VaultInfoSnapshot,
  type VaultListItem,
  type VaultRootMode,
  type VaultRuntimeStats,
} from "../domain";
import type {
  BackupService,
  VaultLifecycleService,
  VaultRootService,
  VaultService,
} from "../services";

export interface UseVaultInfoDataOptions {
  vault: VaultListItem | null;
  open: boolean;
  groups: readonly VaultGroup[];
  locale: string;
  vaultService: VaultService;
  backupService: BackupService;
  lifecycleService: VaultLifecycleService;
  vaultRootService: VaultRootService;
  vaultRootMode: VaultRootMode;
  /** App `[workspace].path` used to resolve the mount point. */
  workspaceGlobalPath: string;
  /**
   * Last-resort prefix when `vault_root_resolve` is not `found`
   * (mock / pre-setup). Do not use this as the happy path.
   */
  fallbackVaultRootBase: string;
  /**
   * Session/runtime counters for Info. Mock apps pass `getMockVaultRuntimeStats`
   * from `@upriv/shared/testing` — this hook does not import mock helpers.
   */
  getRuntimeStats: (
    vaultId: string,
    options: { isOpen: boolean; storageMode: StorageMode },
  ) => VaultRuntimeStats;
}

export function useVaultInfoData({
  vault,
  open,
  groups,
  locale,
  vaultService,
  backupService,
  lifecycleService,
  vaultRootService,
  vaultRootMode,
  workspaceGlobalPath,
  fallbackVaultRootBase,
  getRuntimeStats,
}: UseVaultInfoDataOptions) {
  const [snapshot, setSnapshot] = useState<VaultInfoSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadFailure, setLoadFailure] = useState<unknown>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const vaultId = vault?.id ?? null;
  const group =
    vaultId == null ? undefined : groups.find((entry) => entry.groupedVaults.includes(vaultId));
  const groupName = group?.displayName ?? null;
  const groupHidden = group?.hidden === true;

  // StrictMode remounts in development — `cancelled` drops the stale load.
  // Key the fetch on vault *fields* Info shows, not object identity (list refresh).
  useEffect(() => {
    if (!open || vault == null || vaultId == null) {
      setSnapshot(null);
      setLoadError(false);
      setLoadFailure(null);
      setLoading(false);
      return;
    }

    const current = vault;
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setLoadFailure(null);
    setSnapshot((prev) => (prev?.vault.id === current.id ? prev : null));

    void (async () => {
      try {
        const [settings, kdfPreset, backups, root] = await Promise.all([
          vaultService.getSettings(current.id),
          vaultService.getUnlockPreset(current.id),
          backupService.listBackups(current.id),
          vaultRootService.resolve({ vaultRootMode }),
        ]);
        if (cancelled) return;
        if (root.status !== "found") {
          throw vaultRootGoneRpcError();
        }

        const isOpen = current.session === "open";
        const passwordInSession = lifecycleService.hasPasswordInSession(current.id);
        const runtime = getRuntimeStats(current.id, {
          isOpen,
          storageMode: current.storageMode,
        });
        const vaultRootBase = vaultRootContentorPath(root, fallbackVaultRootBase);
        const storePaths = vaultStoreDisplayPaths(vaultRootBase, current.id);
        const mountPath = settings?.mount.workspace_path ?? WORKSPACE_PATH_DEFAULT;
        const workspacePath = resolveVaultMountPoint(
          workspaceGlobalPath,
          mountPath,
          current.displayName,
        );

        setSnapshot({
          vault: current,
          settings: settings ?? null,
          kdfPreset: kdfPreset ?? null,
          groupName,
          groupHidden,
          backups,
          runtime,
          passwordInSession,
          workspacePath,
          workspacePathIsActive: isOpen,
          contentsPath: storePaths.contentsPath,
          backupsPath: storePaths.backupsPath,
          locale,
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
  }, [
    open,
    vault,
    vaultId,
    vault?.session,
    vault?.storageMode,
    vault?.displayName,
    vault?.note,
    vault?.passwordHint,
    vault?.order,
    vault?.lastAccessedWhen,
    vault?.lastAccessedAt,
    vault?.hidden,
    groupName,
    groupHidden,
    locale,
    vaultService,
    backupService,
    lifecycleService,
    vaultRootService,
    vaultRootMode,
    workspaceGlobalPath,
    fallbackVaultRootBase,
    getRuntimeStats,
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
