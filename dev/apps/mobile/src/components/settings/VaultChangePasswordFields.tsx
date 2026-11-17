import {
  createVaultErrorI18nKey,
  requireVaultConfigEditLockedI18nKey,
  type ChangePasswordFieldsState,
  type PasswordWeakness,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { View } from "react-native";
import { PasswordWeaknessNotice } from "@/components/ui";
import { spacing } from "@/theme/tokens";
import { FieldHint, FieldLabel, PasswordInput, SwitchRow, Warning } from "./settingsFields";

export function VaultChangePasswordFields({
  fields,
  onChange,
  backUpFirst,
  onBackUpFirstChange,
  weakness,
  passwordFieldError,
  error,
  blocked = false,
  busy = false,
}: {
  fields: ChangePasswordFieldsState;
  onChange: (patch: Partial<ChangePasswordFieldsState>) => void;
  /** **Back up first**: on each time the window opens. */
  backUpFirst: boolean;
  onBackUpFirstChange: (on: boolean) => void;
  /** What is wrong with the new password; `null` when nothing is. */
  weakness: PasswordWeakness | null;
  passwordFieldError?: string | null;
  error?: string | null;
  /** Blocked when the vault is not strictly closed (`vault_closed` gate). */
  blocked?: boolean;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const passwordsMatch =
    fields.newPassword.length > 0 && fields.newPassword === fields.confirmPassword;
  const locked = blocked || busy;

  return (
    <View style={{ gap: spacing.md }}>
      {blocked ? (
        <FieldHint>{t(requireVaultConfigEditLockedI18nKey("action.change_password"))}</FieldHint>
      ) : null}
      <FieldLabel disabled={locked}>{t("vault.change_password.current")}</FieldLabel>
      <PasswordInput
        value={fields.currentPassword}
        disabled={locked}
        invalid={Boolean(passwordFieldError)}
        onChangeText={(currentPassword) => onChange({ currentPassword })}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {passwordFieldError ? <Warning>{passwordFieldError}</Warning> : null}
      <FieldLabel disabled={locked}>{t("vault.change_password.new")}</FieldLabel>
      <PasswordInput
        value={fields.newPassword}
        disabled={locked}
        onChangeText={(newPassword) => onChange({ newPassword })}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <PasswordWeaknessNotice weakness={weakness} />
      <FieldLabel disabled={locked}>{t("vault.change_password.confirm")}</FieldLabel>
      <PasswordInput
        value={fields.confirmPassword}
        disabled={locked}
        onChangeText={(confirmPassword) => onChange({ confirmPassword })}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {fields.confirmPassword.length > 0 && !passwordsMatch ? (
        <Warning>{t(createVaultErrorI18nKey("password_mismatch"))}</Warning>
      ) : null}
      {fields.newPassword.length > 0 && fields.newPassword === fields.currentPassword ? (
        <Warning>{t("vault.change_password.same_as_current")}</Warning>
      ) : null}
      <SwitchRow
        label={t("vault.change_password.backup_switch")}
        hint={t("vault.change_password.backup_note")}
        value={backUpFirst}
        disabled={locked}
        onValueChange={onBackUpFirstChange}
      />
      {!backUpFirst ? <Warning>{t("vault.change_password.backup_off_warn")}</Warning> : null}
      {error ? <Warning>{error}</Warning> : null}
    </View>
  );
}
