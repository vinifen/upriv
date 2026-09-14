import type { I18nKey } from "../../i18n/catalog";
import { isRpcError } from "../core-rpc/errors";
import { isVaultPipelineError } from "../vault-lifecycle/errors/codes";
import { vaultPipelineErrorI18nKey } from "../vault-lifecycle/errors/messages";
import { isVaultErrorCode, vaultErrorI18nKey } from "../vault";
import { VAULT_ROOT_ERROR_CODES, isVaultRootErrorCode } from "../vault-root/errors";
import { vaultRootErrorI18nKey } from "../vault-root/messages";
import { isWorkspaceErrorCode, workspaceErrorI18nKey } from "../workspace/errors";

/**
 * Maps a caught error to an i18n key for user-facing UI.
 * Pipeline / vault / vault-root / workspace wire codes — not protocol/bridge-only `RpcError`s.
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
  if (isVaultPipelineError(error)) return vaultPipelineErrorI18nKey(error.code);
  if (isRpcError(error) && isVaultErrorCode(error.code)) return vaultErrorI18nKey(error.code);
  if (isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.IO_ERROR) {
    return vaultRootErrorI18nKey(VAULT_ROOT_ERROR_CODES.IO_ERROR);
  }
  if (isRpcError(error) && error.code === VAULT_ROOT_ERROR_CODES.BUSY) {
    return vaultRootErrorI18nKey(VAULT_ROOT_ERROR_CODES.BUSY);
  }
  if (isRpcError(error) && isVaultRootErrorCode(error.code)) {
    return vaultRootErrorI18nKey(error.code);
  }
  if (isRpcError(error) && isWorkspaceErrorCode(error.code)) {
    return workspaceErrorI18nKey(error.code);
  }
  return null;
}
