import type { I18nKey } from "../../i18n/catalog";

/** User-facing: client-only app settings errors → i18n keys. */
export const APP_SETTINGS_ERROR_I18N_KEYS = {
  SAVE_FAILED: "error.settings_save_failed",
} as const satisfies Record<"SAVE_FAILED", I18nKey>;

export type AppSettingsErrorI18nKey =
  (typeof APP_SETTINGS_ERROR_I18N_KEYS)[keyof typeof APP_SETTINGS_ERROR_I18N_KEYS];

export function appSettingsErrorI18nKey(
  key: keyof typeof APP_SETTINGS_ERROR_I18N_KEYS,
): AppSettingsErrorI18nKey {
  return APP_SETTINGS_ERROR_I18N_KEYS[key];
}
