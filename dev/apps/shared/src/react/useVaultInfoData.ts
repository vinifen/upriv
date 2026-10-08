import { useEffect, useState } from "react";
import {
  currentWorkspaceSystem,
  encryptedShortcutActive,
  resolveVaultMountPoint,
  resolvedWorkspaceParent,
  vaultWorkspace,
  shouldBumpVaultRootEpoch,
  vaultRootContentorPath,
  vaultRootGoneRpcError,
  vaultStoreDisplayPaths,
  type AppSettingsConfig,
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
  /** App workspace table used to resolve this system's mount point. */
  workspace: AppSettingsConfig["workspace"];
  /**
   * Last-resort prefix when `vault_root_resolve` is not `found`
   * (pre-setup). Do not use this as the happy path.
   */
  fallbackVaultRootBase: string;
  /** React Native `Platform.OS`. Omit in Electron; that renderer has no Node `process`. */
  host?: string | null;
}

/** Core does not report these session counters — Info shows an em dash, not a guess. */
const UNAVAILABLE_RUNTIME_STATS: Omit<VaultRuntimeStats, "storeBytes"> = {
  openCount: null,
  lastOpenedAt: null,
  sessionRamBytes: null,
  logicalFileCount: null,
};

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
  workspace,
  fallbackVaultRootBase,
  host,
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
        const [settings, backups, root, storeBytes] = await Promise.all([
          vaultService.getSettings(current.id),
          backupService.listBackups(current.id),
          vaultRootService.resolve({ vaultRootMode }),
          vaultService.storeOnDiskBytes(current.id).catch(() => null),
        ]);
        if (cancelled) return;
        if (root.status !== "found") {
          throw vaultRootGoneRpcError();
        }

        const isOpen = current.session === "open";
        const passwordInSession = lifecycleService.hasPasswordInSession(current.id);
        const runtime = { ...UNAVAILABLE_RUNTIME_STATS, storeBytes };
        const vaultRootBase = vaultRootContentorPath(root, fallbackVaultRootBase);
        const storePaths = vaultStoreDisplayPaths(vaultRootBase, current.id);
        const system = currentWorkspaceSystem(host);
        const mount = settings?.mount ?? vaultWorkspace();
        const parent = resolvedWorkspaceParent(workspace, mount, system, vaultRootBase);
        const ownFolder = mount[system].path.trim() !== "";
        const workspacePath = resolveVaultMountPoint(parent, current.displayName, ownFolder);
        const mountOn = settings
          ? encryptedShortcutActive(workspace, settings.mount, system)
          : false;

        setSnapshot({
          vault: current,
          settings: settings ?? null,
          kdfPreset: current.unlockPreset ?? null,
          groupName,
          groupHidden,
          backups,
          runtime,
          passwordInSession,
          workspacePath,
          // Mount is live only while the list session is open — not during
          // opening/closing list badges (builder uses displayStatus too).
          workspacePathIsActive: isOpen && mountOn,
          workspaceSystem: system,
          storePath: storePaths.storePath,
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
    vault?.unlockPreset,
    groupName,
    groupHidden,
    locale,
    vaultService,
    backupService,
    lifecycleService,
    vaultRootService,
    vaultRootMode,
    workspace,
    fallbackVaultRootBase,
    host,
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
