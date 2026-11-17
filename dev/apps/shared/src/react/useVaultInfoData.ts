import { useEffect, useMemo, useState } from "react";
import {
  shouldBumpVaultRootEpoch,
  vaultRootContentorPath,
  vaultRootGoneRpcError,
  vaultRootUprivOpenPath,
  vaultStoreDisplayPaths,
  type UnlockedFolderInfo,
  type VaultBackupSection,
  type VaultGroup,
  type VaultInfoSnapshot,
  type VaultListItem,
  type VaultRuntimeStats,
} from "../domain";
import type {
  BackupService,
  FolderListService,
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
  folderListService: FolderListService;
  /**
   * Last-resort prefix when `vault_root_resolve` is not `found`
   * (pre-setup). Do not use this as the happy path.
   */
  fallbackVaultRootBase: string;
}

/** Slow on a big vault or a sleeping drive, so Info shows without them first. */
interface SlowVaultInfo {
  vaultId: string;
  /** `null` while the list is read. */
  backupSections: VaultBackupSection[] | null;
  unlockedFolder: UnlockedFolderInfo | null;
  storeBytes: VaultRuntimeStats["storeBytes"];
  heldBytes: VaultRuntimeStats["heldBytes"];
  filesBytes: VaultRuntimeStats["filesBytes"];
}

/** Core does not report these session counters — Info shows an em dash, not a guess. */
const UNAVAILABLE_RUNTIME_STATS: Omit<
  VaultRuntimeStats,
  "storeBytes" | "heldBytes" | "filesBytes"
> = {
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
  folderListService,
  fallbackVaultRootBase,
}: UseVaultInfoDataOptions) {
  const [snapshot, setSnapshot] = useState<VaultInfoSnapshot | null>(null);
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
        : {
            vaultId: current.id,
            backupSections: null,
            unlockedFolder: null,
            storeBytes: "measuring",
            heldBytes: "measuring",
            filesBytes: "measuring",
          },
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
    void backupService
      .listBackups(current.id)
      .then((listing) => patchSlow({ backupSections: listing.sections }), fail);
    void folderListService
      .unlockedFolderInfo(current.id)
      .then((unlockedFolder) => patchSlow({ unlockedFolder }), fail);
    void vaultService
      .diskUsage(current.id)
      .catch(() => null)
      .then((usage) =>
        patchSlow({
          storeBytes: usage?.storeBytes ?? null,
          heldBytes: usage?.heldBytes ?? null,
          filesBytes: usage?.filesBytes ?? null,
        }),
      );

    void (async () => {
      try {
        const [settings, root] = await Promise.all([
          vaultService.getSettings(current.id),
          vaultRootService.resolve(),
        ]);
        if (cancelled) return;
        if (root.status !== "found") {
          throw vaultRootGoneRpcError();
        }

        const passwordInSession = lifecycleService.hasPasswordInSession(current.id);
        const runtime = {
          ...UNAVAILABLE_RUNTIME_STATS,
          storeBytes: "measuring" as const,
          heldBytes: "measuring" as const,
          filesBytes: "measuring" as const,
        };
        const vaultRootBase = vaultRootContentorPath(root, fallbackVaultRootBase);
        const storePaths = vaultStoreDisplayPaths(vaultRootBase, current.id);

        setSnapshot({
          vault: current,
          settings: settings ?? null,
          kdfPreset: current.unlockPreset ?? null,
          groupName,
          groupHidden,
          backupSections: null,
          runtime,
          passwordInSession,
          unlockedFolder: null,
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
    folderListService,
    fallbackVaultRootBase,
    loadAttempt,
  ]);

  const shown = useMemo(() => {
    if (!snapshot) return null;
    const landed = slow?.vaultId === snapshot.vault.id ? slow : null;
    return {
      ...snapshot,
      backupSections: landed ? landed.backupSections : null,
      unlockedFolder: landed ? landed.unlockedFolder : null,
      runtime: {
        ...snapshot.runtime,
        storeBytes: landed ? landed.storeBytes : "measuring",
        heldBytes: landed ? landed.heldBytes : "measuring",
        filesBytes: landed ? landed.filesBytes : "measuring",
      },
    } satisfies VaultInfoSnapshot;
  }, [slow, snapshot]);

  return {
    snapshot: shown,
    loadError,
    loadFailure,
    retryLoad: () => setLoadAttempt((n) => n + 1),
  };
}
