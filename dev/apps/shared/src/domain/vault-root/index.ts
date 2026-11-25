export type {
  AppDistribution,
  DataFolderApplied,
  DataFolderListView,
  DataFolderSearchResult,
  IncompleteReplacePolicy,
  VaultRootBootstrapPrefs,
  VaultRootRelocateNotice,
  VaultRootPrivateRoot,
  VaultRootResolveResult,
  VaultRootResolveSource,
} from "./types";
export { DATA_FOLDER_LIST_FILE } from "./types";
export {
  isSafContentUri,
  SAF_VAULT_ROOT,
  vaultRootContentorPath,
  vaultRootLogsDisplayPath,
  vaultRootUprivDisplayPath,
  vaultRootUprivOpenPath,
  vaultStoreDisplayPaths,
} from "./paths";
export {
  VAULT_ROOT_ERROR_CODES,
  isVaultRootErrorCode,
  isVaultRootGoneError,
  shouldBumpVaultRootEpoch,
  vaultRootGoneRpcError,
} from "./errors";
export type { VaultRootErrorCode, VaultRootIntegrityCode } from "./errors";
export { dataFolderChangeMessage } from "./change";
export {
  VAULT_ROOT_ERROR_I18N_KEYS,
  isVaultRootMessageCode,
  vaultRootErrorI18nKey,
} from "./messages";
export type { VaultRootErrorI18nKey } from "./messages";
export {
  parseDataFolderApplied,
  parseDataFolderList,
  parseDataFolderSearch,
  parseDataFolderSize,
  parseVaultRootPrivateRoot,
  parseVaultRootResolve,
} from "./parse";
export {
  DATA_FOLDER_GATE_IDLE,
  confirmNotesForReplacePolicy,
  dataFolderGate,
} from "./dataFolderIntent";
export type { DataFolderGate, VaultRootConfirmAction } from "./dataFolderIntent";
