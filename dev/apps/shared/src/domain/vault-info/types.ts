import type { VaultBackupSection } from "../backups";
import type { UnlockedFolderInfo } from "../folder-lists";
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

export interface VaultInfoSnapshot {
  vault: VaultListItem;
  settings: VaultSettingsConfig | null;
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
  storePath: string;
  backupsPath: string;
  /** Where the system file manager opens `storePath` (`vaultRootUprivOpenPath`). */
  storeOpenPath: string;
  backupsOpenPath: string;
  locale: string;
}
