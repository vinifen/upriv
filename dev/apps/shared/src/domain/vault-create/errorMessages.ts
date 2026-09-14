import type { I18nKey } from "../../i18n/catalog";
import { DISPLAY_NAME_ERROR_I18N_KEYS } from "../vault/errors/nameMessages";
import type { CreateVaultValidationCode } from "./validate";

/** User-facing: maps wizard validation codes → i18n keys. Keep in sync with `locales/*.json`. */
export const CREATE_VAULT_ERROR_I18N_KEYS = {
  ...DISPLAY_NAME_ERROR_I18N_KEYS,
  duplicate: "vault.create.error.duplicate",
  source_missing: "vault.create.error.source_missing",
  import_file_missing: "vault.create.error.import_file_missing",
  import_not_available: "vault.create.error.import_not_available",
  password_empty: "vault.create.error.password_empty",
  password_too_short: "vault.create.error.password_too_short",
  password_mismatch: "vault.create.error.password_mismatch",
  password_not_validated: "vault.create.error.password_not_validated",
  password_wrong: "error.wrong_password",
  group_missing: "vault.create.error.group_missing",
  group_name_empty: "vault.create.error.group_name_empty",
  group_name_too_long: "vault.create.error.group_name_too_long",
  group_name_invalid: "vault.create.error.group_name_invalid",
  mount_path_empty: "modal.workspace.error.empty",
  mount_path_not_absolute: "modal.workspace.error.not_absolute",
  mount_path_saf_tree: "modal.workspace.error.saf_tree_child",
  mount_path_reserved: "modal.workspace.error.reserved",
  mount_path_root_unknown: "modal.workspace.error.unavailable",
  plain_not_available: "vault.create.error.plain_not_available",
} as const satisfies Record<CreateVaultValidationCode, I18nKey>;

export type CreateVaultErrorI18nKey =
  (typeof CREATE_VAULT_ERROR_I18N_KEYS)[CreateVaultValidationCode];

export function createVaultErrorI18nKey(code: CreateVaultValidationCode): CreateVaultErrorI18nKey {
  return CREATE_VAULT_ERROR_I18N_KEYS[code];
}
