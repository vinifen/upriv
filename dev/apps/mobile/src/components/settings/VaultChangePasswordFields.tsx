import { createVaultErrorI18nKey, type ChangePasswordFieldsState } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { View } from "react-native";
import { spacing } from "@/theme/tokens";
import { FieldLabel, PasswordInput, Warning } from "./settingsFields";

export function VaultChangePasswordFields({
  fields,
  onChange,
  error,
}: {
  fields: ChangePasswordFieldsState;
  onChange: (patch: Partial<ChangePasswordFieldsState>) => void;
  error?: string | null;
}) {
  const { t } = useTranslation();
  const passwordsMatch =
    fields.newPassword.length > 0 && fields.newPassword === fields.confirmPassword;

  return (
    <View style={{ gap: spacing.md }}>
      <FieldLabel>{t("vault.change_password.current")}</FieldLabel>
      <PasswordInput
        value={fields.currentPassword}
        onChangeText={(currentPassword) => onChange({ currentPassword })}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <FieldLabel>{t("vault.change_password.new")}</FieldLabel>
      <PasswordInput
        value={fields.newPassword}
        onChangeText={(newPassword) => onChange({ newPassword })}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <FieldLabel>{t("vault.change_password.confirm")}</FieldLabel>
      <PasswordInput
        value={fields.confirmPassword}
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
