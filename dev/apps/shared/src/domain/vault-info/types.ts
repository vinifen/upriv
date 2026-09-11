import type { VaultBackupEntry } from "../backups";
import type { VaultListItem } from "../vault-list";
import type { KdfUnlockPreset, VaultSettingsConfig } from "../vault-settings";

export interface VaultRuntimeStats {
  openCount: number;
  lastOpenedAt: string | null;
  sessionRamBytes: number | null;
  contentsBytes: number;
  logicalFileCount: number;
}

export interface VaultInfoSnapshot {
  vault: VaultListItem;
  settings: VaultSettingsConfig | null;
  kdfPreset: KdfUnlockPreset | null;
  groupName: string | null;
  /** True when the vault’s current group is hidden (locks the vault hidden switch). */
  groupHidden: boolean;
  backups: VaultBackupEntry[];
  runtime: VaultRuntimeStats;
  passwordInSession: boolean;
  /** Resolved mount point when parent is known; shown even when vault is closed. */
  workspacePath: string | null;
  /** True when the vault session is open (mount is live vs predicted). */
  workspacePathIsActive: boolean;
  contentsPath: string;
  backupsPath: string;
  locale: string;
}
