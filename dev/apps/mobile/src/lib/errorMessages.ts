import { errorDisplayI18nKey, isRpcError } from "@upriv/shared";
import type { I18nKey } from "@/i18n";

/** Android SAF vault-root codes from Kotlin `SafVaultRoot` / `toSafRpcError`. */
const SAF_ERROR_I18N: Record<string, I18nKey> = {
  saf_unauthorized: "modal.vault_root_setup.error_saf_unauthorized",
  saf_create_failed: "modal.vault_root_setup.error_saf_create_failed",
  saf_write_failed: "modal.vault_root_setup.error_io",
  saf_invalid_tree: "modal.vault_root_setup.error_saf_unauthorized",
};

/** Mobile error → i18n key (shared domain codes; no Electron bridge codes yet). */
export function mobileErrorI18nKey(
  error: unknown,
  fallback: I18nKey = "error.unexpected",
): I18nKey {
  if (isRpcError(error) && error.code === "log_file_too_large") {
    return "toast.logs_file_too_large";
  }
  if (isRpcError(error) && SAF_ERROR_I18N[error.code]) {
    return SAF_ERROR_I18N[error.code];
  }
  return (errorDisplayI18nKey(error) as I18nKey | null) ?? fallback;
}
