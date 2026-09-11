import { useId } from "react";
import {
  KDF_UNLOCK_OPTION_META,
  KDF_UNLOCK_PRESETS,
  changeKdfFormIsDowngrade,
  type ChangeKdfFieldsState,
  type KdfUnlockPreset,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { PasswordInput } from "@/components/ui";
import { PolicyRadioOption, settingsControlClass, SettingsField } from "./vaultSettingsForm";

interface VaultChangeKdfFieldsProps {
  /** Current unlock cost from `contents/vault.header`. */
  currentPreset: KdfUnlockPreset;
  vaultOpen: boolean;
  fields: ChangeKdfFieldsState;
  onChange: (patch: Partial<ChangeKdfFieldsState>) => void;
  error?: string | null;
}

export function VaultChangeKdfFields({
  currentPreset,
  vaultOpen,
  fields,
  onChange,
  error,
}: VaultChangeKdfFieldsProps) {
  const { t } = useTranslation();
  const passwordId = useId();
  const presetGroup = useId();

  const presetChanged = fields.nextPreset !== currentPreset;
  const downgrade = changeKdfFormIsDowngrade(currentPreset, fields.nextPreset);

  return (
    <div className="space-y-3">
      {vaultOpen ? (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t("vault.change_kdf.vault_open")}
        </p>
      ) : null}

      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("modal.settings.change_kdf_intro")}
      </p>
      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t("warning.kdf_change_backups")}
      </p>

      <SettingsField label={t("vault.change_kdf.current")} htmlFor={passwordId}>
        <PasswordInput
          id={passwordId}
          value={fields.password}
          onChange={(e) => onChange({ password: e.target.value })}
          autoComplete="current-password"
          inputClassName={settingsControlClass}
        />
      </SettingsField>

      <SettingsField label={t("modal.settings.field.kdf.unlock_preset")}>
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
