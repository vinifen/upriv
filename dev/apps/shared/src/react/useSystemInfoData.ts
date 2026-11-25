import { useEffect, useMemo, useState } from "react";
import {
  resolveVaultDisplayStatus,
  shouldBumpVaultRootEpoch,
  vaultRootGoneRpcError,
} from "../domain";
import type {
  AppSettingsConfig,
  DataFolderListView,
  DeviceInfo,
  OsNames,
  SystemInfoSnapshot,
  VaultGroup,
  VaultListItem,
  VaultRootResolveResult,
} from "../domain";
import type { DeviceService, VaultRootService } from "../services";

export type SystemInfoAppVersion = NonNullable<SystemInfoSnapshot["app"]>;

export interface UseSystemInfoDataOptions {
  open: boolean;
  vaults: readonly VaultListItem[];
  groups: readonly VaultGroup[];
  settings: AppSettingsConfig;
  vaultRootService: VaultRootService;
  deviceService: DeviceService;
  /** The OS names devices are named by (`useOsNames`). */
  osNames: OsNames;
  getVersion: () => Promise<SystemInfoAppVersion> | SystemInfoAppVersion;
  /** Effective list show-hidden (persisted always-show or session). */
  showHiddenVaults?: boolean;
}

/** What core answers, each part on its own; `null` until it lands. */
interface ReadParts {
  app: SystemInfoAppVersion | null;
  device: DeviceInfo | null;
  root: VaultRootResolveResult | null;
  dataFolders: DataFolderListView | null;
  /** `"measuring"` until it lands, `null` when the measure failed. */
  dataFolderBytes: number | null | "measuring";
}

const NOTHING_READ: ReadParts = {
  app: null,
  device: null,
  root: null,
  dataFolders: null,
  dataFolderBytes: "measuring",
};

/** The walk of the data folder each service runs now, while it runs. */
const measuring = new WeakMap<VaultRootService, Promise<number>>();

/**
 * The size of the data folder in use. A walk of every file is slow on a slow
 * drive, so a window opened again while one runs joins it instead of starting
 * another beside it on core's folder lane.
 */
function measureDataFolder(service: VaultRootService): Promise<number> {
  const running = measuring.get(service);
  if (running) return running;
  const walk = service.size().finally(() => measuring.delete(service));
  measuring.set(service, walk);
  return walk;
}

/**
 * System Info: the settings and the list show at once, and each part read
 * from core fills its rows as it lands, so a slow data folder never holds
 * the version or the device back.
 */
export function useSystemInfoData({
  open,
  vaults,
  groups,
  settings,
  vaultRootService,
  deviceService,
  osNames,
  getVersion,
  showHiddenVaults = false,
}: UseSystemInfoDataOptions) {
  const [read, setRead] = useState<ReadParts>(NOTHING_READ);
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
  const lastOpenedRaw = settings.app.last_opened_vault ?? "";
  const lastOpenedIsHidden = vaults.some(
    (vault) => vault.id === lastOpenedRaw && Boolean(vault.hidden),
  );
  const lastOpenedVault = lastOpenedIsHidden && !showHiddenVaults ? "" : lastOpenedRaw;

  // StrictMode remounts in development — `cancelled` drops the stale reads.
  useEffect(() => {
    if (!open) {
      setRead(NOTHING_READ);
      setLoadFailure(null);
      return;
    }
    let cancelled = false;
    setLoadFailure(null);
    const land = (patch: Partial<ReadParts>) => {
      if (!cancelled) setRead((current) => ({ ...current, ...patch }));
    };
    const fail = (error: unknown) => {
      if (!cancelled) setLoadFailure(error);
    };
    void Promise.resolve()
      .then(getVersion)
      .then((app) => land({ app }), fail);
    deviceService.info().then((device) => land({ device }), fail);
    vaultRootService.resolve().then((root) => {
      land({ root });
      if (root.status !== "found") fail(vaultRootGoneRpcError());
    }, fail);
    vaultRootService.list().then((dataFolders) => land({ dataFolders }), fail);
    // Its row alone shows the failure, a dash: a data folder gone is the
    // resolve's to report.
    measureDataFolder(vaultRootService).then(
      (dataFolderBytes) => land({ dataFolderBytes }),
      () => land({ dataFolderBytes: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [open, vaultRootService, deviceService, getVersion, loadAttempt]);

  // A data folder gone shows nothing of it: the window reports and closes.
  const gone = loadFailure !== null && shouldBumpVaultRootEpoch(loadFailure);
  const snapshot = useMemo<SystemInfoSnapshot | null>(
    () =>
      open && !gone
        ? {
            ...read,
            osNames,
            inventory: { vaultsTotal, vaultsOpen, groupsTotal },
            ui: settings.ui,
            logging: settings.logging,
            unlockedFolders: settings.unlocked_folders,
            backups: settings.backups,
            lastOpenedVault,
          }
        : null,
    [
      open,
      gone,
      read,
      osNames,
      vaultsTotal,
      vaultsOpen,
      groupsTotal,
      settings.ui,
      settings.logging,
      settings.unlocked_folders,
      settings.backups,
      lastOpenedVault,
    ],
  );

  return {
    snapshot,
    loadError: loadFailure !== null,
    loadFailure,
    retryLoad: () => {
      setRead(NOTHING_READ);
      setLoadAttempt((n) => n + 1);
    },
  };
}
