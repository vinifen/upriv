import type { I18nKey } from "../../i18n/catalog";

/** User-facing: client-only app settings errors → i18n keys. */
export const APP_SETTINGS_ERROR_I18N_KEYS = {
  SAVE_FAILED: "error.settings_save_failed",
  /** Context rejected vault-root wire mutation without setup* (should be rare after Save strips `app`). */
  INVALID_REQUEST: "error.settings_invalid_request",
} as const satisfies Record<"SAVE_FAILED" | "INVALID_REQUEST", I18nKey>;

export type AppSettingsErrorI18nKey =
  (typeof APP_SETTINGS_ERROR_I18N_KEYS)[keyof typeof APP_SETTINGS_ERROR_I18N_KEYS];

export function appSettingsErrorI18nKey(
  key: keyof typeof APP_SETTINGS_ERROR_I18N_KEYS,
): AppSettingsErrorI18nKey {
  return APP_SETTINGS_ERROR_I18N_KEYS[key];
}
