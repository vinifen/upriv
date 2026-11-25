import { View } from "react-native";
import {
  changeKdfFormIsDowngrade,
  requireVaultConfigEditLockedI18nKey,
  type ChangeKdfFieldsState,
  type KdfUnlockPreset,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { spacing } from "@/theme/tokens";
import { KdfPresetChoice } from "./KdfPresetChoice";
import { FieldHint, FieldLabel, PasswordInput, Warning } from "./settingsFields";

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
}: {
  /** Current unlock cost from `store/header/vault.header`. */
  currentPreset: KdfUnlockPreset;
  /** Blocked when the vault is not strictly closed (`vault_closed` gate). */
  blocked: boolean;
  fields: ChangeKdfFieldsState;
  onChange: (patch: Partial<ChangeKdfFieldsState>) => void;
  passwordFieldError?: string | null;
  error?: string | null;
}) {
  const { t } = useTranslation();
  const presetChanged = fields.nextPreset !== currentPreset;
  const downgrade = changeKdfFormIsDowngrade(currentPreset, fields.nextPreset);

  return (
    <View style={{ gap: spacing.md }}>
      {blocked ? (
        <FieldHint>{t(requireVaultConfigEditLockedI18nKey("action.change_kdf"))}</FieldHint>
      ) : null}
      <FieldHint>{t("modal.settings.change_kdf_intro")}</FieldHint>
      <FieldHint>{t("vault.change_kdf.backups_note")}</FieldHint>
      <FieldLabel disabled={blocked}>{t("vault.change_kdf.current")}</FieldLabel>
      <PasswordInput
        value={fields.password}
        disabled={blocked}
        invalid={Boolean(passwordFieldError)}
        onChangeText={(password) => onChange({ password })}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {passwordFieldError ? <Warning>{passwordFieldError}</Warning> : null}
      <FieldLabel disabled={blocked}>{t("modal.settings.field.kdf.unlock_preset")}</FieldLabel>
      <KdfPresetChoice
        value={fields.nextPreset}
        disabled={blocked}
        onChange={(nextPreset) => onChange({ nextPreset })}
      />
      {downgrade ? <FieldHint>{t("vault.change_kdf.downgrade_warn")}</FieldHint> : null}
      {!presetChanged && fields.password.length > 0 ? (
        <Warning>{t("vault.change_kdf.same_as_current")}</Warning>
      ) : null}
      {error ? <Warning>{error}</Warning> : null}
    </View>
  );
}
