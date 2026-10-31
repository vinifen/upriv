import { useEffect, useMemo, useState } from "react";
import {
  currentWorkspaceSystem,
  encryptedShortcutActive,
  resolveVaultMountPoint,
  resolvedWorkspaceParent,
  vaultWorkspace,
  shouldBumpVaultRootEpoch,
  vaultRootContentorPath,
  vaultRootGoneRpcError,
  vaultRootUprivOpenPath,
  vaultStoreDisplayPaths,
  type AppSettingsConfig,
  type VaultBackupEntry,
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

interface SlowVaultInfo {
  vaultId: string;
  /** `null` while the list is read. */
  backups: VaultBackupEntry[] | null;
  storeBytes: VaultRuntimeStats["storeBytes"];
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
  /** Backups and store size: slow on a big vault, so Info shows without them first. */
  const [slow, setSlow] = useState<SlowVaultInfo | null>(null);
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
      setSlow(null);
      setLoadError(false);
      setLoadFailure(null);
      return;
    }

    const current = vault;
    let cancelled = false;
    setLoadError(false);
    setLoadFailure(null);
    setSnapshot((prev) => (prev?.vault.id === current.id ? prev : null));
    setSlow((prev) =>
      prev?.vaultId === current.id
        ? prev
        : { vaultId: current.id, backups: null, storeBytes: "measuring" },
    );

    const fail = (error: unknown) => {
      if (cancelled) return;
      if (shouldBumpVaultRootEpoch(error)) {
        setSnapshot(null);
      }
      setLoadFailure(error);
      setLoadError(true);
    };
    const patchSlow = (patch: Partial<Omit<SlowVaultInfo, "vaultId">>) => {
      if (cancelled) return;
      setSlow((prev) => (prev?.vaultId === current.id ? { ...prev, ...patch } : prev));
    };
    void backupService.listBackups(current.id).then((backups) => patchSlow({ backups }), fail);
    void vaultService
      .storeOnDiskBytes(current.id)
      .catch(() => null)
      .then((storeBytes) => patchSlow({ storeBytes }));

    void (async () => {
      try {
        const [settings, root] = await Promise.all([
          vaultService.getSettings(current.id),
          vaultRootService.resolve({ vaultRootMode }),
        ]);
        if (cancelled) return;
        if (root.status !== "found") {
          throw vaultRootGoneRpcError();
        }

        const isOpen = current.session === "open";
        const passwordInSession = lifecycleService.hasPasswordInSession(current.id);
        const runtime = { ...UNAVAILABLE_RUNTIME_STATS, storeBytes: "measuring" as const };
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
          backups: null,
          runtime,
          passwordInSession,
          workspacePath,
          // Mount is live only while the list session is open — not during
          // opening/closing list badges (builder uses displayStatus too).
          workspacePathIsActive: isOpen && mountOn,
          workspaceSystem: system,
          storePath: storePaths.storePath,
          backupsPath: storePaths.backupsPath,
          storeOpenPath: vaultRootUprivOpenPath(vaultRootBase, `vaults/${current.id}/store`),
          backupsOpenPath: vaultRootUprivOpenPath(vaultRootBase, `vaults/${current.id}/backups`),
          locale,
        });
      } catch (error) {
        fail(error);
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

  const shown = useMemo(() => {
    if (!snapshot) return null;
    const landed = slow?.vaultId === snapshot.vault.id ? slow : null;
    return {
      ...snapshot,
      backups: landed ? landed.backups : null,
      runtime: { ...snapshot.runtime, storeBytes: landed ? landed.storeBytes : "measuring" },
    } satisfies VaultInfoSnapshot;
  }, [slow, snapshot]);

  return {
    snapshot: shown,
    loadError,
    loadFailure,
    retryLoad: () => setLoadAttempt((n) => n + 1),
  };
}
