import type { DeviceRef } from "../device";
import type { FolderState, FolderSwitch } from "../folder-lists";

/** One zip in the Backups window: the `backup_list` entry. */
export interface VaultBackupEntry {
  /** Selects this zip: `<folder>/<file>` or `<folder>/saves/<file>`, never a path. */
  key: string;
  stamp: string;
  /** On-disk name, `<stamp>-<id>.zip`, or `<stamp>-<id> <name>.zip` once named. */
  fileName: string;
  /** The name the person gave it; empty when it has none. Naming a backup pins it. */
  name: string;
  /** ISO-8601 from the stamp. */
  createdAt: string;
  sizeBytes: number;
  /** A pin under `saves/`: keep-last never deletes it. */
  saved: boolean;
  /** Where the zip is on this device. */
  path: string;
  /**
   * Its header unlocks with less RAM than the vault's does now: someone who
   * has the zip guesses the password at that lower cost. No row names a
   * password.
   */
  lowerUnlockRam: boolean;
}

/** Which folder a section shows. */
export type BackupSectionKind =
  | "data_folder"
  /** The folder this device writes to now, when it is not the data folder. */
  | "in_use"
  /** A folder Upriv no longer writes to or deletes from on its own. */
  | "other";

/** One folder's backups, and what that folder can do now. */
export interface VaultBackupSection {
  /** `data`, a folder reference, or `use`: names the folder for `backup_folder_forget`. */
  folder: string;
  kind: BackupSectionKind;
  path: string;
  /** The device that wrote there; `null` for the data folder. */
  device: DeviceRef | null;
  status: FolderState;
  entries: VaultBackupEntry[];
}

/** `backup_list`: one section per folder, the data folder first, then the folder in use. */
export interface VaultBackupListing {
  sections: VaultBackupSection[];
}

/** A finished Back up now, and the switches its folder needed. */
export interface VaultBackupSaved {
  backup: VaultBackupEntry;
  switches: FolderSwitch[];
}
