import { useId } from "react";
import {
  KDF_UNLOCK_OPTION_META,
  KDF_UNLOCK_PRESETS,
  changeKdfFormIsDowngrade,
  requireVaultConfigEditLockedI18nKey,
  type ChangeKdfFieldsState,
  type KdfUnlockPreset,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { PasswordInput } from "@/components/ui";
import { PolicyRadioOption, settingsControlClass, SettingsField } from "./vaultSettingsForm";

interface VaultChangeKdfFieldsProps {
  /** Current unlock cost from `store/header/vault.header`. */
  currentPreset: KdfUnlockPreset;
  rewrapBlocked: boolean;
  fields: ChangeKdfFieldsState;
  onChange: (patch: Partial<ChangeKdfFieldsState>) => void;
  /** Wrong current password — ring and message on that field. */
  passwordFieldError?: string | null;
  error?: string | null;
  /** This change is already running. */
  busy?: boolean;
}

export function VaultChangeKdfFields({
  currentPreset,
  rewrapBlocked,
  fields,
  onChange,
  passwordFieldError,
  error,
  busy = false,
}: VaultChangeKdfFieldsProps) {
  const { t } = useTranslation();
  const passwordId = useId();
  const presetGroup = useId();

  const presetChanged = fields.nextPreset !== currentPreset;
  const downgrade = changeKdfFormIsDowngrade(currentPreset, fields.nextPreset);
  const locked = rewrapBlocked || busy;

  return (
    <div className="space-y-3">
      {rewrapBlocked ? (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t(requireVaultConfigEditLockedI18nKey("action.change_kdf"))}
        </p>
      ) : null}

      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.settings.change_kdf_intro")}
      </p>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("warning.kdf_change_backups")}
      </p>

      <SettingsField label={t("vault.change_kdf.current")} htmlFor={passwordId} disabled={locked}>
        <PasswordInput
          id={passwordId}
          value={fields.password}
          disabled={locked}
          aria-invalid={passwordFieldError ? true : undefined}
          aria-errormessage={passwordFieldError ? `${passwordId}-error` : undefined}
          onChange={(e) => onChange({ password: e.target.value })}
          autoComplete="current-password"
          inputClassName={[
            settingsControlClass,
            "aria-invalid:ring-2 aria-invalid:ring-on-error-container aria-invalid:focus:ring-on-error-container",
          ].join(" ")}
        />
        {passwordFieldError ? (
          <p id={`${passwordId}-error`} role="alert" className="text-xs text-on-error-container">
            {passwordFieldError}
          </p>
        ) : null}
      </SettingsField>

      <SettingsField label={t("modal.settings.field.kdf.unlock_preset")} disabled={locked}>
        <div
          role="radiogroup"
          aria-label={t("modal.settings.field.kdf.unlock_preset")}
          className="grid gap-2"
        >
          {KDF_UNLOCK_PRESETS.map((preset) => {
            const meta = KDF_UNLOCK_OPTION_META[preset];
            return (
              <PolicyRadioOption
                key={preset}
                groupName={presetGroup}
                value={preset}
                checked={fields.nextPreset === preset}
                disabled={locked}
                title={t(meta.titleKey)}
                description={t(meta.descKey)}
                badge={meta.badge}
                tone={meta.tone}
                onSelect={() => onChange({ nextPreset: preset })}
              />
            );
          })}
        </div>
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
