import type { VaultRootService } from "@upriv/shared";
import {
  rpcDataFolderApply,
  rpcDataFolderList,
  rpcDataFolderSearch,
  rpcDataFolderSize,
  rpcDataFolderStatus,
  rpcPickDirectory,
  rpcVaultRootResolve,
  rpcVaultRootSuggestedCustomPath,
} from "@/lib/rpc";

/** Electron → upriv-daemon data folder calls (+ shell folder picker). */
export const desktopVaultRootService: VaultRootService = {
  resolve: (options) => rpcVaultRootResolve(options),
  list: (options) => rpcDataFolderList(options?.newList ?? false),
  size: () => rpcDataFolderSize(),
  status: (path) => rpcDataFolderStatus(path),
  apply: (request) => rpcDataFolderApply(request),
  search: (job) => rpcDataFolderSearch(job),
  suggestedCustomRootPath: () => rpcVaultRootSuggestedCustomPath(),
  pickFolder: (defaultPath, title) => rpcPickDirectory(defaultPath, title),
};
