import { useId } from "react";
import {
  changeKdfFormIsDowngrade,
  requireVaultConfigEditLockedI18nKey,
  type ChangeKdfFieldsState,
  type KdfUnlockPreset,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { PasswordInput } from "@/components/ui";
import {
  KdfPresetChoice,
  settingsControlClass,
  settingsInvalidControlClass,
  SettingsField,
} from "./vaultSettingsForm";

interface VaultChangeKdfFieldsProps {
  /** Current unlock cost from `store/header/vault.header`. */
  currentPreset: KdfUnlockPreset;
  /** Blocked when the vault is not strictly closed (`vault_closed` gate). */
  blocked: boolean;
  fields: ChangeKdfFieldsState;
  onChange: (patch: Partial<ChangeKdfFieldsState>) => void;
  /** Wrong current password — ring and message on that field. */
  passwordFieldError?: string | null;
  error?: string | null;
}

/**
 * The Unlock RAM screen, as every change screen lays out: what the change
 * does, the vault's password, then its choice. The footer's action takes
 * both.
 */
export function VaultChangeKdfFields({
  currentPreset,
  blocked,
  fields,
  onChange,
  passwordFieldError,
  error,
}: VaultChangeKdfFieldsProps) {
  const { t } = useTranslation();
  const passwordId = useId();

  const presetChanged = fields.nextPreset !== currentPreset;
  const downgrade = changeKdfFormIsDowngrade(currentPreset, fields.nextPreset);

  return (
    <div className="space-y-3">
      {blocked ? (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t(requireVaultConfigEditLockedI18nKey("action.change_kdf"))}
        </p>
      ) : null}

      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.settings.change_kdf_intro")}
      </p>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("vault.change_kdf.backups_note")}
      </p>

      <SettingsField label={t("vault.change_kdf.current")} htmlFor={passwordId} disabled={blocked}>
        <PasswordInput
          id={passwordId}
          value={fields.password}
          disabled={blocked}
          aria-invalid={passwordFieldError ? true : undefined}
          aria-errormessage={passwordFieldError ? `${passwordId}-error` : undefined}
          onChange={(e) => onChange({ password: e.target.value })}
          autoComplete="current-password"
          inputClassName={[settingsControlClass, settingsInvalidControlClass].join(" ")}
        />
        {passwordFieldError ? (
          <p id={`${passwordId}-error`} role="alert" className="text-xs text-on-error-container">
            {passwordFieldError}
          </p>
        ) : null}
      </SettingsField>

      <SettingsField label={t("modal.settings.field.kdf.unlock_preset")} disabled={blocked}>
        <KdfPresetChoice
          value={fields.nextPreset}
          disabled={blocked}
          onChange={(nextPreset) => onChange({ nextPreset })}
        />
      </SettingsField>

      {downgrade ? (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t("vault.change_kdf.downgrade_warn")}
        </p>
      ) : null}
      {!presetChanged && fields.password.length > 0 ? (
        <p className="text-xs text-on-error-container">{t("vault.change_kdf.same_as_current")}</p>
      ) : null}
      {error ? <p className="text-xs text-on-error-container">{error}</p> : null}
    </div>
  );
}
