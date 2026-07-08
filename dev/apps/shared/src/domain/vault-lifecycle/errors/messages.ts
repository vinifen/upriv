import type { I18nKey } from "../../../i18n/catalog";
import type { VaultPipelineErrorCode } from "./codes";

/** User-facing: pipeline wire codes → i18n keys. Keep in sync with `locales/*.json`. */
export const VAULT_PIPELINE_ERROR_I18N_KEYS = {
  insufficient_ram: "error.insufficient_ram",
  archive_test_failed: "error.archive_test_failed",
} as const satisfies Record<VaultPipelineErrorCode, I18nKey>;

export type VaultPipelineErrorI18nKey =
  (typeof VAULT_PIPELINE_ERROR_I18N_KEYS)[VaultPipelineErrorCode];

export function vaultPipelineErrorI18nKey(
  code: VaultPipelineErrorCode,
): VaultPipelineErrorI18nKey {
  return VAULT_PIPELINE_ERROR_I18N_KEYS[code];
}
