import { View } from "react-native";
import {
  COMPRESSION_PRESETS,
  compressionPresetFromSevenZip,
  sevenZipPatchFromCompressionPreset,
  type CompressionPreset,
  type VaultSettingsConfig,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { spacing } from "@/theme/tokens";
import { PolicyRadioOption } from "./PolicyRadioOption";
import { FieldHint, FieldLabel, RadioGroup, SwitchRow } from "./settingsFields";

export function VaultSettingsSevenZipSection({
  config,
  onChange,
  disabled = false,
  embedded = false,
}: {
  config: VaultSettingsConfig["seven_zip"];
  onChange: (patch: Partial<VaultSettingsConfig["seven_zip"]>) => void;
  disabled?: boolean;
  /** Nested under a parent radio (export format) — skip the standalone intro. */
  embedded?: boolean;
}) {
  const { t } = useTranslation();
  const preset = compressionPresetFromSevenZip(config);

  const setPreset = (next: CompressionPreset) => {
    onChange(sevenZipPatchFromCompressionPreset(next));
  };

  return (
    <View style={{ gap: spacing.sm }}>
      {embedded ? null : (
        <FieldHint disabled={disabled}>{t("modal.settings.section.seven_zip_intro")}</FieldHint>
      )}
      <FieldLabel disabled={disabled}>{t("modal.settings.field.seven_zip.compression")}</FieldLabel>
      <FieldHint disabled={disabled}>
        {t("modal.settings.field.seven_zip.compression_help")}
      </FieldHint>
      <RadioGroup>
        {COMPRESSION_PRESETS.map((value) => (
          <PolicyRadioOption
            key={value}
            value={value}
            checked={preset === value}
            disabled={disabled}
            title={t(`modal.settings.option.seven_zip.compression.${value}`)}
            description={t(`modal.settings.option.seven_zip.compression.${value}_desc`)}
            onSelect={() => setPreset(value)}
          />
        ))}
      </RadioGroup>
      <SwitchRow
        label={t("modal.settings.field.seven_zip.encrypt_file_names_label")}
        hint={t("modal.settings.field.seven_zip.encrypt_file_names_help")}
        value={config.encrypt_file_names}
        disabled={disabled}
        onValueChange={(encrypt_file_names) => onChange({ encrypt_file_names })}
      />
      {!disabled && !config.encrypt_file_names ? (
        <FieldHint>{t("modal.settings.field.seven_zip.encrypt_file_names_off_warn")}</FieldHint>
      ) : null}
    </View>
  );
}
