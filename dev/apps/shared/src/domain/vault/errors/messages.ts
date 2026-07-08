import type { I18nKey } from "../../../i18n/catalog";
import { isVaultErrorCode, type VaultErrorCode } from "./codes";

/** User-facing: maps upriv-core wire codes → i18n keys. Keep in sync with `locales/*.json`. */
export const VAULT_ERROR_I18N_KEYS = {
  wrong_password: "error.wrong_password",
  vault_already_open: "error.vault_already_open",
  sync_mismatch: "error.sync_mismatch",
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
