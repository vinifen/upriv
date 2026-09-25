import type { I18nKey } from "../../../i18n/catalog";
import { isVaultErrorCode, type VaultErrorCode } from "./codes";

/** User-facing: maps upriv-core wire codes → i18n keys. Keep in sync with `locales/*.json`. */
export const VAULT_ERROR_I18N_KEYS = {
  vault_not_found: "error.vault_not_found",
  wrong_password: "error.wrong_password",
  vault_already_open: "error.vault_already_open",
  vault_not_open: "error.vault_not_open",
  vault_already_exists: "error.vault_already_exists",
  vault_unlock_blocked: "error.vault_unlock_blocked",
  insufficient_ram: "error.insufficient_ram",
  insufficient_ram_export: "error.insufficient_ram_export",
  vault_store_invalid: "error.vault_store_invalid",
  vault_rewrap_unavailable: "error.vault_rewrap_unavailable",
  vault_groups_invalid: "error.vault_groups_invalid",
  vault_group_not_found: "error.vault_group_not_found",
  vault_saf_unavailable: "error.vault_saf_unavailable",
  upriv_plain_unavailable: "error.upriv_plain_unavailable",
  vault_config_busy: "error.vault_config_busy",
  vault_path_not_found: "error.vault_path_not_found",
  vault_path_exists: "error.vault_path_exists",
  vault_file_too_large: "error.vault_file_too_large",
  vault_locked: "error.vault_locked",
  vault_mount_failed: "error.vault_mount_failed",
  import_archive_not_found: "error.import_archive_not_found",
  import_source_unreadable: "error.import_source_unreadable",
  vault_must_be_closed: "error.vault_must_be_closed",
} as const satisfies Record<VaultErrorCode, I18nKey>;

export type VaultErrorI18nKey = (typeof VAULT_ERROR_I18N_KEYS)[VaultErrorCode];

export function vaultErrorI18nKey(code: string): VaultErrorI18nKey | null {
  if (!isVaultErrorCode(code)) return null;
  return VAULT_ERROR_I18N_KEYS[code];
}

/** Known vault wire code → i18n key (use in UI instead of hardcoded `t("error.…")`). */
export function requireVaultErrorI18nKey(code: VaultErrorCode): VaultErrorI18nKey {
  return VAULT_ERROR_I18N_KEYS[code];
}

const CREDENTIAL_CHALLENGE_KEYS = new Set<I18nKey>([
  VAULT_ERROR_I18N_KEYS.wrong_password,
  VAULT_ERROR_I18N_KEYS.vault_unlock_blocked,
  VAULT_ERROR_I18N_KEYS.insufficient_ram,
]);

/** Stay on the password dialog — do not dismiss into the pipeline overlay. */
export function isVaultCredentialChallengeI18nKey(key: I18nKey): boolean {
  return CREDENTIAL_CHALLENGE_KEYS.has(key);
}
