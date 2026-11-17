import type { FolderListService } from "@upriv/shared";
import { rpcFolderStatus, rpcVaultUnlockedFolderInfo } from "@/lib/rpc";

/** Desktop → daemon `folder_status` and `vault_unlocked_folder_info`. */
export const desktopFolderListService: FolderListService = {
  status: (list, path, vaultId) => rpcFolderStatus(list, path, vaultId),
  unlockedFolderInfo: (vaultId) => rpcVaultUnlockedFolderInfo(vaultId),
};
