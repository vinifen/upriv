import { listChanges } from "./changes";
import {
  APP_BACKUP_LIST,
  APP_UNLOCKED_LIST,
  VAULT_BACKUP_LIST,
  VAULT_UNLOCKED_LIST,
  type AppBackupChoice,
  type AppBackupFolders,
  type AppUnlockedChoice,
  type AppUnlockedFolders,
  type DeviceGroups,
  type DeviceId,
  type ListChanges,
  type VaultBackupChoice,
  type VaultUnlockedChoice,
  type VaultUnlockedFolder,
} from "./types";

/** What an app settings save changes in the app's lists (`lists` of `app_settings_save`). */
export interface AppListChanges {
  unlockedFolders: ListChanges<AppUnlockedChoice>;
  backups: ListChanges<AppBackupChoice>;
}

/** What a vault settings save changes in the vault's lists (`lists` of `vault_config_save`). */
export interface VaultListChanges {
  unlockedFolder: ListChanges<VaultUnlockedChoice>;
  backup: ListChanges<VaultBackupChoice>;
}

/** What a save did beyond its own file. */
export interface ListsSaved {
  /**
   * Ids of vaults whose `config.toml` kept its previous content: a device
   * group renamed or removed in System settings did not change there, and
   * that vault's own settings can make the change.
   */
  unchangedVaults: string[];
  /** `upriv-unlocked` folders of deleted rows that stayed: they hold files or could not be reached. */
  keptFolders: string[];
}

export const NO_LISTS_SAVED: ListsSaved = { unchangedVaults: [], keptFolders: [] };

/** An app settings save that leaves the lists as they are. */
export const NO_APP_LIST_CHANGES: AppListChanges = {
  unlockedFolders: { groups: {} },
  backups: { groups: {} },
};

/** A vault settings save that leaves the lists as they are. */
export const NO_VAULT_LIST_CHANGES: VaultListChanges = {
  unlockedFolder: { groups: {} },
  backup: { groups: {} },
};

function withoutHere<F extends string>(changes: ListChanges<F>, hereId: DeviceId | null) {
  if (!hereId || !(hereId in changes.groups)) return changes;
  const groups = { ...changes.groups };
  delete groups[hereId];
  return { groups };
}

/** Which of this device's groups a gate keeps as they are: a change set leaves them out. */
export interface ListLocks {
  /** This device's unlocked folder group (the app's: `no_open_session`; a vault's: `vault_quiet`). */
  unlockedHere: boolean;
}

/** The app's lists as a save sends them: what changed from `saved` to `draft`. */
export function appListChanges(
  saved: { unlocked_folders: AppUnlockedFolders; backups: AppBackupFolders },
  draft: { unlocked_folders: AppUnlockedFolders; backups: AppBackupFolders },
  hereId: DeviceId | null,
  locks: ListLocks,
): AppListChanges {
  const unlocked = listChanges(
    saved.unlocked_folders.devices,
    draft.unlocked_folders.devices,
    APP_UNLOCKED_LIST,
  );
  return {
    unlockedFolders: locks.unlockedHere ? withoutHere(unlocked, hereId) : unlocked,
    backups: listChanges(saved.backups.devices, draft.backups.devices, APP_BACKUP_LIST),
  };
}

/** A vault's lists as a save sends them: what changed from `saved` to `draft`. */
export function vaultListChanges(
  saved: {
    unlocked_folder: VaultUnlockedFolder;
    backup: { devices: DeviceGroups<VaultBackupChoice> };
  },
  draft: {
    unlocked_folder: VaultUnlockedFolder;
    backup: { devices: DeviceGroups<VaultBackupChoice> };
  },
  hereId: DeviceId | null,
  locks: ListLocks,
): VaultListChanges {
  const unlocked = listChanges(
    saved.unlocked_folder.devices,
    draft.unlocked_folder.devices,
    VAULT_UNLOCKED_LIST,
  );
  return {
    unlockedFolder: locks.unlockedHere ? withoutHere(unlocked, hereId) : unlocked,
    backup: listChanges(saved.backup.devices, draft.backup.devices, VAULT_BACKUP_LIST),
  };
}

export function isEmptyAppListChanges(changes: AppListChanges): boolean {
  return (
    Object.keys(changes.unlockedFolders.groups).length === 0 &&
    Object.keys(changes.backups.groups).length === 0
  );
}

export function isEmptyVaultListChanges(changes: VaultListChanges): boolean {
  return (
    Object.keys(changes.unlockedFolder.groups).length === 0 &&
    Object.keys(changes.backup.groups).length === 0
  );
}

/** Read `unchangedVaults` / `keptFolders` of a save reply. */
export function parseListsSaved(raw: unknown): ListsSaved {
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const strings = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return { unchangedVaults: strings(body.unchangedVaults), keptFolders: strings(body.keptFolders) };
}
