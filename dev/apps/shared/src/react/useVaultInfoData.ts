import { useEffect, useMemo, useState } from "react";
import {
  shouldBumpVaultRootEpoch,
  vaultRootContentorPath,
  vaultRootGoneRpcError,
  vaultRootUprivOpenPath,
  vaultStoreDisplayPaths,
  type OsNames,
  type UnlockedFolderInfo,
  type VaultBackupSection,
  type VaultGroup,
  type VaultInfoPaths,
  type VaultInfoSnapshot,
  type VaultKeyStatus,
  type VaultListItem,
  type VaultRuntimeStats,
  type VaultSettingsConfig,
} from "../domain";
import type {
  BackupService,
  FolderListService,
  VaultLifecycleService,
  VaultRootService,
  VaultSecurityService,
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
  securityService: VaultSecurityService;
  /** The OS names the backup folders' devices are named by (`useOsNames`). */
  osNames: OsNames;
  /**
   * Last-resort prefix when `vault_root_resolve` is not `found`
   * (pre-setup). Do not use this as the happy path.
   */
  fallbackVaultRootBase: string;
}

/** What core answers for one vault, each part on its own as it lands. */
interface ReadParts {
  vaultId: string;
  settings: VaultSettingsConfig | null | "reading";
  paths: VaultInfoPaths | null;
  /** `null` while the list is read. */
  backupSections: VaultBackupSection[] | null;
  unlockedFolder: UnlockedFolderInfo | null;
  keyStatus: VaultKeyStatus | null | "reading";
  storeBytes: VaultRuntimeStats["storeBytes"];
  heldBytes: VaultRuntimeStats["heldBytes"];
  filesBytes: VaultRuntimeStats["filesBytes"];
}

function nothingRead(vaultId: string): ReadParts {
  return {
    vaultId,
    settings: "reading",
    paths: null,
    backupSections: null,
    unlockedFolder: null,
    keyStatus: "reading",
    storeBytes: "measuring",
    heldBytes: "measuring",
    filesBytes: "measuring",
  };
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

/**
 * Vault Info: what the list row knows shows at once, and each part read from
 * core (its settings, the data folder, the backups, the unlocked folder, the
 * keys, the sizes) fills its rows as it lands, so a big vault or a sleeping
 * drive never holds the others back.
 */
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
  securityService,
  osNames,
  fallbackVaultRootBase,
}: UseVaultInfoDataOptions) {
  const [read, setRead] = useState<ReadParts | null>(null);
  const [loadFailure, setLoadFailure] = useState<unknown>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  const vaultId = vault?.id ?? null;
  const group =
    vaultId == null ? undefined : groups.find((entry) => entry.groupedVaults.includes(vaultId));
  const groupName = group?.displayName ?? null;
  const groupHidden = group?.hidden === true;

  // StrictMode remounts in development — `cancelled` drops the stale reads.
  // Key the reads on vault *fields* Info shows, not object identity (list refresh).
  useEffect(() => {
    if (!open || vault == null || vaultId == null) {
      setRead(null);
      setLoadFailure(null);
      return;
    }

    const current = vault;
    let cancelled = false;
    setLoadFailure(null);
    setRead((prev) => (prev?.vaultId === current.id ? prev : nothingRead(current.id)));

    const land = (patch: Partial<Omit<ReadParts, "vaultId">>) => {
      if (cancelled) return;
      setRead((prev) => (prev?.vaultId === current.id ? { ...prev, ...patch } : prev));
    };
    const fail = (error: unknown) => {
      if (!cancelled) setLoadFailure(error);
    };
    void backupService
      .listBackups(current.id)
      .then((listing) => land({ backupSections: listing.sections }), fail);
    void folderListService
      .unlockedFolderInfo(current.id)
      .then((unlockedFolder) => land({ unlockedFolder }), fail);
    // Only an open session knows which files wait; a closed vault shows the
    // header's state alone.
    if (current.session === "open") {
      void securityService
        .keyStatus(current.id)
        .catch(() => null)
        .then((keyStatus) => land({ keyStatus }));
    } else {
      land({ keyStatus: null });
    }
    void vaultService
      .diskUsage(current.id)
      .catch(() => null)
      .then((usage) =>
        land({
          storeBytes: usage?.storeBytes ?? null,
          heldBytes: usage?.heldBytes ?? null,
          filesBytes: usage?.filesBytes ?? null,
        }),
      );
    void vaultService.getSettings(current.id).then(
      (settings) => land({ settings: settings ?? null }),
      (error: unknown) => {
        land({ settings: null });
        fail(error);
      },
    );
    void vaultRootService.resolve().then((root) => {
      if (root.status !== "found") {
        fail(vaultRootGoneRpcError());
        return;
      }
      const base = vaultRootContentorPath(root, fallbackVaultRootBase);
      const shown = vaultStoreDisplayPaths(base, current.id);
      land({
        paths: {
          storePath: shown.storePath,
          backupsPath: shown.backupsPath,
          storeOpenPath: vaultRootUprivOpenPath(base, `vaults/${current.id}/store`),
          backupsOpenPath: vaultRootUprivOpenPath(base, `vaults/${current.id}/backups`),
        },
      });
    }, fail);

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
    vault?.keyCount,
    vault?.passwordChange,
    vaultService,
    backupService,
    vaultRootService,
    folderListService,
    securityService,
    fallbackVaultRootBase,
    loadAttempt,
  ]);

  // A data folder gone shows nothing of it: the window reports and closes.
  const gone = loadFailure !== null && shouldBumpVaultRootEpoch(loadFailure);
  const snapshot = useMemo<VaultInfoSnapshot | null>(() => {
    if (!open || !vault || gone) return null;
    const landed = read?.vaultId === vault.id ? read : nothingRead(vault.id);
    return {
      vault,
      settings: landed.settings,
      kdfPreset: vault.unlockPreset ?? null,
      groupName,
      groupHidden,
      backupSections: landed.backupSections,
      runtime: {
        ...UNAVAILABLE_RUNTIME_STATS,
        storeBytes: landed.storeBytes,
        heldBytes: landed.heldBytes,
        filesBytes: landed.filesBytes,
      },
      passwordInSession: lifecycleService.hasPasswordInSession(vault.id),
      unlockedFolder: landed.unlockedFolder,
      keyStatus: landed.keyStatus,
      paths: landed.paths,
      locale,
      osNames,
    };
  }, [open, vault, gone, read, groupName, groupHidden, lifecycleService, locale, osNames]);

  return {
    snapshot,
    loadError: loadFailure !== null,
    loadFailure,
    retryLoad: () => {
      if (vaultId) setRead(nothingRead(vaultId));
      setLoadAttempt((n) => n + 1);
    },
  };
}
