import type { I18nKey } from "../../i18n/catalog";
import type { DisplayNameValidationCode } from "../vault/displayName";
import { DISPLAY_NAME_ERROR_I18N_KEYS } from "../vault/errors/nameMessages";

export type FileNameErrorCode = DisplayNameValidationCode | "duplicate";

/** User-facing: file/folder rename validation → i18n keys. */
export const FILE_NAME_ERROR_I18N_KEYS = {
  ...DISPLAY_NAME_ERROR_I18N_KEYS,
  duplicate: "vault.name.duplicate",
} as const satisfies Record<FileNameErrorCode, I18nKey>;

export type FileNameErrorI18nKey = (typeof FILE_NAME_ERROR_I18N_KEYS)[FileNameErrorCode];

export function fileNameErrorI18nKey(code: FileNameErrorCode): FileNameErrorI18nKey {
  return FILE_NAME_ERROR_I18N_KEYS[code];
}
