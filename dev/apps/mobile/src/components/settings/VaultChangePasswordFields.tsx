import {
  createVaultErrorI18nKey,
  requireVaultConfigEditLockedI18nKey,
  type ChangePasswordFieldsState,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { View } from "react-native";
import { spacing } from "@/theme/tokens";
import { FieldHint, FieldLabel, PasswordInput, Warning } from "./settingsFields";

export function VaultChangePasswordFields({
  fields,
  onChange,
  passwordFieldError,
  error,
  rewrapBlocked = false,
  busy = false,
}: {
  fields: ChangePasswordFieldsState;
  onChange: (patch: Partial<ChangePasswordFieldsState>) => void;
  passwordFieldError?: string | null;
  error?: string | null;
  rewrapBlocked?: boolean;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const passwordsMatch =
    fields.newPassword.length > 0 && fields.newPassword === fields.confirmPassword;
  const locked = rewrapBlocked || busy;

  return (
    <View style={{ gap: spacing.md }}>
      {rewrapBlocked ? (
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
      {error ? <Warning>{error}</Warning> : null}
    </View>
  );
}
