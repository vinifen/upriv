import type { FolderStatus, UnlockedFolderInfo } from "../../domain/folder-lists";

/** Which list a row of the unlocked folder or backup lists belongs to. */
export type FolderStatusList = "unlocked" | "backup";

/**
 * The rows of the unlocked folder and backup lists as this device sees them:
 * each row's status within its own limit, and a vault's unlocked folder here.
 */
export interface FolderListService {
  /** `vaultId` names the vault of a vault's list; `null` is the app's. */
  status(list: FolderStatusList, path: string, vaultId: string | null): Promise<FolderStatus>;
  unlockedFolderInfo(vaultId: string): Promise<UnlockedFolderInfo>;
}
