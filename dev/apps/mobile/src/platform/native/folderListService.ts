import { isSafContentUri, type FolderListService } from "@upriv/shared";
import { rpcFolderStatus, rpcVaultUnlockedFolderInfo } from "@/lib/rpc";
import { mountTree } from "./safVaultRoot";

/**
 * Native → `upriv-ffi` `folder_status` and `vault_unlocked_folder_info`. A
 * row's picked tree is mounted before its check, so Rust reaches it.
 */
export const nativeFolderListService: FolderListService = {
  status(list, path, vaultId) {
    if (isSafContentUri(path)) mountTree(path);
    return rpcFolderStatus(list, path, vaultId);
  },
  unlockedFolderInfo: (vaultId) => rpcVaultUnlockedFolderInfo(vaultId),
};
