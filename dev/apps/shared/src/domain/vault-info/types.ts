import type { VaultBackupSection } from "../backups";
import type { OsNames } from "../device";
import type { UnlockedFolderInfo } from "../folder-lists";
import type { VaultKeyStatus } from "../vault/keyChanges";
import type { VaultListItem } from "../vault-list";
import type { KdfUnlockPreset, VaultSettingsConfig } from "../vault-settings";

export interface VaultRuntimeStats {
  /** `null` when core does not report a counter (do not invent one). */
  openCount: number | null;
  lastOpenedAt: string | null;
  sessionRamBytes: number | null;
  /** Regular-file bytes in `store/`. `null` when that measurement did not run. */
  storeBytes: number | null | "measuring";
  /** Regular-file bytes set aside in `held/`, measured with `storeBytes`. */
  heldBytes: number | null | "measuring";
  /** About what the vault's files hold, as core last recorded it. */
  filesBytes: number | null | "measuring";
  logicalFileCount: number | null;
}

/** Where the vault's files sit in the data folder, as shown and as the file manager opens them. */
export interface VaultInfoPaths {
  storePath: string;
  backupsPath: string;
  /** Where the system file manager opens `storePath` (`vaultRootUprivOpenPath`). */
  storeOpenPath: string;
  backupsOpenPath: string;
}

/**
 * What Vault Info shows. The list row is known at once; each part read from
 * core fills its rows as it lands (`"reading"`, `"measuring"`, or `null`
 * while read, as each field says), so a slow one never holds the others.
 */
export interface VaultInfoSnapshot {
  vault: VaultListItem;
  /** `config.toml`; `"reading"` while it is read, `null` when it could not be. */
  settings: VaultSettingsConfig | null | "reading";
  kdfPreset: KdfUnlockPreset | null;
  groupName: string | null;
  /** True when the vault’s current group is hidden (locks the vault hidden switch). */
  groupHidden: boolean;
  /** The folders that hold its zips, the folder in use among them; `null` while the list is read. */
  backupSections: VaultBackupSection[] | null;
  runtime: VaultRuntimeStats;
  passwordInSession: boolean;
  /** The vault's unlocked folder on this device; `null` while it is read. */
  unlockedFolder: UnlockedFolderInfo | null;
  /**
   * Where an open vault's keys stand; `null` while it has no open session or
   * the answer did not come, `"reading"` while it is read.
   */
  keyStatus: VaultKeyStatus | null | "reading";
  /** `null` while the data folder in use is read. */
  paths: VaultInfoPaths | null;
  locale: string;
  /** The OS names the backup folders' devices are named by. */
  osNames: OsNames;
}
