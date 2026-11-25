import type { DeviceSystem } from "../device";

/**
 * Saved lists of folders, one group per device: the data folder, the
 * unlocked folders, and the backup folders. On the current device one choice
 * is selected; the order of a list is its priority when the selection fails.
 * Core owns the lists, their checks, and their failover; this module holds
 * their shape and the pure edits a draft makes.
 */

/** A device ID: 32 lowercase hex characters, core's `DeviceId`. */
export type DeviceId = string;

/** Which list a row belongs to: each keeps out of the folders Upriv makes for the others. */
export type FolderListKind = "data_folder" | "unlocked" | "backup";

/** Why a row's path is refused (core `PathIssue`). */
export type FolderPathIssue = "empty" | "not_absolute" | "reserved" | "overlap";

/** The folder Upriv makes for unlocked folders inside a row. */
export const UNLOCKED_CONTAINER = "upriv-unlocked";
/** The folder Upriv makes for the app's backups inside a row. */
export const SHARED_BACKUPS_CONTAINER = "upriv-backups";
/** Longest row name, in characters. */
export const ROW_NAME_MAX_CHARS = 80;

/** Nothing selected: only the app's unlocked folders and a lost data folder. */
export const NOTHING_SELECTED = "none";

/** A list's choice on a device: a row number, a fixed choice, or nothing. */
export type Selection<F extends string> = number | F | typeof NOTHING_SELECTED;

/** A folder the person added to a device group. */
export interface FolderRow {
  /** Given when the row is made, never reused while its group exists. */
  number: number;
  /** Up to `ROW_NAME_MAX_CHARS`; empty shows "Folder N". */
  name: string;
  path: string;
}

/** What one list keeps for one device. */
export interface DeviceGroup<F extends string> {
  system: DeviceSystem;
  selected: Selection<F>;
  next_number: number;
  rows: FolderRow[];
}

/** One list's device groups, keyed by device ID. */
export type DeviceGroups<F extends string> = Record<DeviceId, DeviceGroup<F>>;

/** What one list is: its fixed choices, its default, and where its rows may be. */
export interface FolderListPolicy<F extends string> {
  kind: FolderListKind;
  /** Fixed choices, in this order: after the rows in priority, above them on screen. */
  fixed: readonly F[];
  /** What a device with no group uses, and what a group falls back to when its last selected row goes. */
  fallback: Selection<F>;
  /** Nothing selected is a state of this list. */
  allowsNothing: boolean;
}

export type DataFolderChoice = "default";
export type AppUnlockedChoice = "beside";
export type VaultUnlockedChoice = "inherit";
export type AppBackupChoice = "data_folder";
export type VaultBackupChoice = "inherit" | "data_folder";

export const DATA_FOLDER_LIST: FolderListPolicy<DataFolderChoice> = {
  kind: "data_folder",
  fixed: ["default"],
  fallback: "default",
  allowsNothing: false,
};
export const APP_UNLOCKED_LIST: FolderListPolicy<AppUnlockedChoice> = {
  kind: "unlocked",
  fixed: ["beside"],
  fallback: NOTHING_SELECTED,
  allowsNothing: true,
};
export const VAULT_UNLOCKED_LIST: FolderListPolicy<VaultUnlockedChoice> = {
  kind: "unlocked",
  fixed: ["inherit"],
  fallback: "inherit",
  allowsNothing: false,
};
export const APP_BACKUP_LIST: FolderListPolicy<AppBackupChoice> = {
  kind: "backup",
  fixed: ["data_folder"],
  fallback: "data_folder",
  allowsNothing: false,
};
export const VAULT_BACKUP_LIST: FolderListPolicy<VaultBackupChoice> = {
  kind: "backup",
  fixed: ["inherit", "data_folder"],
  fallback: "inherit",
  allowsNothing: false,
};

/** An encrypted vault's own choice for its unlocked folder, on every device, in screen order. */
export const ENCRYPTED_FOLDER_SWITCHES = ["inherit", "on", "off"] as const;

export type EncryptedFolderSwitch = (typeof ENCRYPTED_FOLDER_SWITCHES)[number];

/** `[unlocked_folders]` of `settings.toml`. */
export interface AppUnlockedFolders {
  /** Every device: encrypted vaults get an unlocked folder too. */
  encrypted_vaults: boolean;
  devices: DeviceGroups<AppUnlockedChoice>;
}

/** `[unlocked_folder]` of a vault's `config.toml`. */
export interface VaultUnlockedFolder {
  encrypted: EncryptedFolderSwitch;
  devices: DeviceGroups<VaultUnlockedChoice>;
}

/** `[backups]` of `settings.toml`. */
export interface AppBackupFolders {
  devices: DeviceGroups<AppBackupChoice>;
}

/** What a save changes in one device group. A part left out did not change. */
export interface GroupChange<F extends string> {
  /** Another device's group goes. The current device's group goes row by row. */
  remove?: true;
  /** Every row of the group, in order; `next_number` comes with it. */
  rows?: FolderRow[];
  next_number?: number;
  selected?: Selection<F>;
}

/** What a save changes in one list, per device group. */
export interface ListChanges<F extends string> {
  groups: Record<DeviceId, GroupChange<F>>;
}

/**
 * A changed row path is checked after this pause, so typing asks core once
 * the path settles rather than on every key.
 */
export const FOLDER_PATH_CHECK_DELAY_MS = 500;
