import { View } from "react-native";
import {
  KDF_UNLOCK_OPTION_META,
  KDF_UNLOCK_PRESETS,
  changeKdfFormIsDowngrade,
  type ChangeKdfFieldsState,
  type KdfUnlockPreset,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { spacing } from "@/theme/tokens";
import { PolicyRadioOption } from "./PolicyRadioOption";
import { FieldHint, FieldLabel, PasswordInput, RadioGroup, Warning } from "./settingsFields";

export function VaultChangeKdfFields({
  currentPreset,
  vaultOpen,
  fields,
  onChange,
  error,
}: {
  /** Current unlock cost from `contents/vault.header`. */
  currentPreset: KdfUnlockPreset;
  vaultOpen: boolean;
  fields: ChangeKdfFieldsState;
  onChange: (patch: Partial<ChangeKdfFieldsState>) => void;
  error?: string | null;
}) {
  const { t } = useTranslation();
  const presetChanged = fields.nextPreset !== currentPreset;
  const downgrade = changeKdfFormIsDowngrade(currentPreset, fields.nextPreset);

  return (
    <View style={{ gap: spacing.md }}>
      {vaultOpen ? <FieldHint>{t("vault.change_kdf.vault_open")}</FieldHint> : null}
      <FieldHint>{t("modal.settings.change_kdf_intro")}</FieldHint>
      <FieldHint>{t("warning.kdf_change_backups")}</FieldHint>
      <FieldLabel>{t("vault.change_kdf.current")}</FieldLabel>
      <PasswordInput
        value={fields.password}
        onChangeText={(password) => onChange({ password })}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <FieldLabel>{t("modal.settings.field.kdf.unlock_preset")}</FieldLabel>
      <RadioGroup>
        {KDF_UNLOCK_PRESETS.map((preset) => {
          const meta = KDF_UNLOCK_OPTION_META[preset];
          return (
            <PolicyRadioOption
              key={preset}
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
      </RadioGroup>
      {downgrade ? <FieldHint>{t("vault.change_kdf.downgrade_warn")}</FieldHint> : null}
      {!presetChanged && fields.password.length > 0 ? (
        <Warning>{t("vault.change_kdf.same_as_current")}</Warning>
      ) : null}
      {error ? <Warning>{error}</Warning> : null}
    </View>
  );
}
