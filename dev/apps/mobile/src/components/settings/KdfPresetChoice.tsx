import { useState } from "react";
import {
  DEFAULT_KDF_OTHER_PRESET,
  KDF_UNLOCK_MAIN_PRESETS,
  KDF_UNLOCK_OPTION_META,
  KDF_UNLOCK_OTHER_PRESETS,
  kdfPresetIsOther,
  type KdfUnlockPreset,
} from "@upriv/shared";
import { Select } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { PolicyRadioOption } from "./PolicyRadioOption";
import { FieldHint, RadioGroup } from "./settingsFields";

/**
 * The unlock RAM, at create and on the Unlock RAM screen (desktop
 * `KdfPresetChoice` parity): three presets as radios, and Another amount,
 * whose list holds every other step from 32 MiB to 4 GiB. The list shows
 * always and waits until its option is chosen; choosing that option takes the
 * amount the list shows.
 */
export function KdfPresetChoice({
  value,
  disabled = false,
  onChange,
}: {
  /** The chosen preset; `null` checks no option. */
  value: KdfUnlockPreset | null;
  disabled?: boolean;
  onChange: (preset: KdfUnlockPreset) => void;
}) {
  const { t } = useTranslation();
  const otherChosen = value !== null && kdfPresetIsOther(value);
  /** What the list shows while another option is chosen: the last amount picked there. */
  const [otherPick, setOtherPick] = useState<KdfUnlockPreset>(
    value !== null && otherChosen ? value : DEFAULT_KDF_OTHER_PRESET,
  );
  const shownOther = value !== null && otherChosen ? value : otherPick;
  const otherMeta = KDF_UNLOCK_OPTION_META[shownOther];

  return (
    <RadioGroup>
      {KDF_UNLOCK_MAIN_PRESETS.map((preset) => {
        const meta = KDF_UNLOCK_OPTION_META[preset];
        return (
          <PolicyRadioOption
            key={preset}
            value={preset}
            checked={value === preset}
            disabled={disabled}
            title={t(meta.titleKey)}
            description={t(meta.descKey)}
            badge={meta.badge}
            tone={meta.tone}
            onSelect={() => onChange(preset)}
          />
        );
      })}
      <PolicyRadioOption
        value="other"
        checked={otherChosen}
        disabled={disabled}
        title={t("modal.settings.option.kdf.other")}
        description={t("modal.settings.option.kdf.other_desc")}
        badge={otherChosen ? otherMeta.badge : undefined}
        tone={otherChosen ? otherMeta.tone : undefined}
        onSelect={() => onChange(shownOther)}
        footer={
          <>
            <Select
              value={shownOther}
              disabled={disabled}
              accessibilityLabel={t("modal.settings.option.kdf.other")}
              options={KDF_UNLOCK_OTHER_PRESETS.map((preset) => ({
                value: preset,
                label: t(KDF_UNLOCK_OPTION_META[preset].titleKey),
              }))}
              onChange={(preset) => {
                setOtherPick(preset);
                onChange(preset);
              }}
            />
            <FieldHint>{t(otherMeta.descKey)}</FieldHint>
          </>
        }
      />
    </RadioGroup>
  );
}
