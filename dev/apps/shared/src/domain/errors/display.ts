import type { I18nKey } from "../../i18n/catalog";
import { isRpcError } from "../core-rpc/errors";
import { dataFolderExportErrorI18nKey, isDataFolderExportErrorCode } from "../data-folder-export";
import { isJobErrorCode, jobErrorI18nKey } from "../jobs";
import { isVaultPipelineError } from "../vault-lifecycle/errors/codes";
import { vaultPipelineErrorI18nKey } from "../vault-lifecycle/errors/messages";
import { isVaultErrorCode, vaultErrorI18nKey } from "../vault";
import { isVaultRootMessageCode, vaultRootErrorI18nKey } from "../vault-root/messages";

/**
 * Maps a caught error to an i18n key for user-facing UI.
 * Pipeline / vault / data folder wire codes — not protocol/bridge-only `RpcError`s.
 * Returns `null` for internal/log-only errors — log `error.message` (English) instead.
 */
export function errorDisplayI18nKey(error: unknown): I18nKey | null {
  if (isRpcError(error) && error.code === "log_file_too_large") {
    return "toast.logs_file_too_large";
  }
  if (isRpcError(error) && error.code === "internal_error") {
    return "error.internal";
  }
  if (isRpcError(error) && error.code === "not_implemented") {
    return "error.not_implemented";
  }
  if (isRpcError(error) && error.code === "open_path_failed") {
    return "modal.file_manager.toast.open_system_failed";
  }
  if (isRpcError(error) && error.code === "open_terminal_failed") {
    return "modal.file_manager.toast.open_terminal_failed";
  }
  if (isVaultPipelineError(error)) return vaultPipelineErrorI18nKey(error.code);
  if (isRpcError(error) && isVaultErrorCode(error.code)) return vaultErrorI18nKey(error.code);
  if (isRpcError(error) && isDataFolderExportErrorCode(error.code)) {
    return dataFolderExportErrorI18nKey(error.code);
  }
  if (isRpcError(error) && isJobErrorCode(error.code)) return jobErrorI18nKey(error.code);
  if (isRpcError(error) && isVaultRootMessageCode(error.code)) {
    return vaultRootErrorI18nKey(error.code);
  }
  return null;
}
