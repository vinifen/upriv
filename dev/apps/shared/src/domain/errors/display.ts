import type { I18nKey } from "../../i18n/catalog";
import { isRpcError } from "../core-rpc/errors";
import { isVaultPipelineError } from "../vault-lifecycle/errors/codes";
import { vaultPipelineErrorI18nKey } from "../vault-lifecycle/errors/messages";
import { isVaultErrorCode } from "../vault/errors/codes";
import { vaultErrorI18nKey } from "../vault/errors/messages";
import { isVaultRootErrorCode } from "../vault-root/errors";
import { vaultRootErrorI18nKey } from "../vault-root/messages";

/**
 * Maps a caught error to an i18n key for user-facing UI.
 * Pipeline / vault / vault-root wire codes — not protocol/bridge-only `RpcError`s.
 * Returns `null` for internal/log-only errors — log `error.message` (English) instead.
 */
export function errorDisplayI18nKey(error: unknown): I18nKey | null {
  if (isVaultPipelineError(error)) return vaultPipelineErrorI18nKey(error.code);
  if (isRpcError(error) && isVaultErrorCode(error.code)) return vaultErrorI18nKey(error.code);
  if (isRpcError(error) && isVaultRootErrorCode(error.code)) {
    return vaultRootErrorI18nKey(error.code);
  }
  return null;
}
