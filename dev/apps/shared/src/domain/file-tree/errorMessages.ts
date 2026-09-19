import type { I18nKey } from "../../i18n/catalog";
import type { DisplayNameValidationCode } from "../vault/displayName";
import { DISPLAY_NAME_ERROR_I18N_KEYS } from "../vault/errors/nameMessages";

export type FileNameErrorCode = Exclude<DisplayNameValidationCode, "trailing"> | "duplicate";

/** User-facing: file/folder rename validation → i18n keys. Trailing space/dot is stripped, not shown. */
export const FILE_NAME_ERROR_I18N_KEYS = {
  empty: DISPLAY_NAME_ERROR_I18N_KEYS.empty,
  invalid_chars: DISPLAY_NAME_ERROR_I18N_KEYS.invalid_chars,
  reserved: DISPLAY_NAME_ERROR_I18N_KEYS.reserved,
  too_long: DISPLAY_NAME_ERROR_I18N_KEYS.too_long,
  duplicate: "vault.name.duplicate",
} as const satisfies Record<FileNameErrorCode, I18nKey>;

export type FileNameErrorI18nKey = (typeof FILE_NAME_ERROR_I18N_KEYS)[FileNameErrorCode];

export function fileNameErrorI18nKey(code: FileNameErrorCode): FileNameErrorI18nKey {
  return FILE_NAME_ERROR_I18N_KEYS[code];
}
