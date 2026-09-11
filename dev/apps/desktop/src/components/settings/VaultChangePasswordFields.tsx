import { useId } from "react";
import type { ChangePasswordFieldsState } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { createVaultErrorI18nKey } from "@/lib/errorMessages";
import { PasswordInput } from "@/components/ui";
import { settingsControlClass, SettingsField } from "./vaultSettingsForm";

interface VaultChangePasswordFieldsProps {
  fields: ChangePasswordFieldsState;
  onChange: (patch: Partial<ChangePasswordFieldsState>) => void;
  error?: string | null;
}

export function VaultChangePasswordFields({
  fields,
  onChange,
  error,
}: VaultChangePasswordFieldsProps) {
  const { t } = useTranslation();
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();

  const passwordsMatch =
    fields.newPassword.length > 0 && fields.newPassword === fields.confirmPassword;

  return (
    <div className="space-y-3">
      <SettingsField label={t("vault.change_password.current")} htmlFor={currentId}>
        <PasswordInput
          id={currentId}
          value={fields.currentPassword}
          onChange={(e) => onChange({ currentPassword: e.target.value })}
          autoComplete="current-password"
          inputClassName={settingsControlClass}
        />
      </SettingsField>

      <SettingsField label={t("vault.change_password.new")} htmlFor={newId}>
        <PasswordInput
          id={newId}
          value={fields.newPassword}
          onChange={(e) => onChange({ newPassword: e.target.value })}
          autoComplete="new-password"
          inputClassName={settingsControlClass}
        />
      </SettingsField>

      <SettingsField label={t("vault.change_password.confirm")} htmlFor={confirmId}>
        <PasswordInput
          id={confirmId}
          value={fields.confirmPassword}
          onChange={(e) => onChange({ confirmPassword: e.target.value })}
          autoComplete="new-password"
          inputClassName={settingsControlClass}
        />
      </SettingsField>

      {fields.confirmPassword.length > 0 && !passwordsMatch ? (
        <p className="text-xs text-on-error-container">
          {t(createVaultErrorI18nKey("password_mismatch"))}
        </p>
      ) : null}
      {fields.newPassword.length > 0 && fields.newPassword === fields.currentPassword ? (
        <p className="text-xs text-on-error-container">
          {t("vault.change_password.same_as_current")}
        </p>
      ) : null}
      {error ? <p className="text-xs text-on-error-container">{error}</p> : null}
    </div>
  );
}
