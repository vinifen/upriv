import type { I18nKey } from "../../../i18n/catalog";
import type { DisplayNameValidationCode } from "../displayName";

/** User-facing: display/file name validation → i18n. Shared by vault-create and file-tree. */
export const DISPLAY_NAME_ERROR_I18N_KEYS = {
  empty: "vault.name.empty",
  invalid_chars: "vault.name.invalid_chars",
  trailing: "vault.name.trailing",
  reserved: "vault.name.reserved",
  too_long: "vault.name.too_long",
} as const satisfies Record<DisplayNameValidationCode, I18nKey>;

export type DisplayNameErrorI18nKey =
  (typeof DISPLAY_NAME_ERROR_I18N_KEYS)[DisplayNameValidationCode];

export function displayNameErrorI18nKey(code: DisplayNameValidationCode): DisplayNameErrorI18nKey {
  return DISPLAY_NAME_ERROR_I18N_KEYS[code];
}
