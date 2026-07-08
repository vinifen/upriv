import type { I18nKey } from "../../i18n/catalog";
import { DISPLAY_NAME_ERROR_I18N_KEYS } from "../vault/errors/nameMessages";
import type { CreateVaultValidationCode } from "./validate";

/** User-facing: maps wizard validation codes → i18n keys. Keep in sync with `locales/*.json`. */
export const CREATE_VAULT_ERROR_I18N_KEYS = {
  ...DISPLAY_NAME_ERROR_I18N_KEYS,
  duplicate: "vault.create.error.duplicate",
  source_missing: "vault.create.error.source_missing",
  import_file_missing: "vault.create.error.import_file_missing",
  password_empty: "vault.create.error.password_empty",
  password_mismatch: "vault.create.error.password_mismatch",
  password_not_validated: "vault.create.error.password_not_validated",
  password_wrong: "error.wrong_password",
} as const satisfies Record<CreateVaultValidationCode, I18nKey>;

export type CreateVaultErrorI18nKey =
  (typeof CREATE_VAULT_ERROR_I18N_KEYS)[CreateVaultValidationCode];

export function createVaultErrorI18nKey(code: CreateVaultValidationCode): CreateVaultErrorI18nKey {
  return CREATE_VAULT_ERROR_I18N_KEYS[code];
}
