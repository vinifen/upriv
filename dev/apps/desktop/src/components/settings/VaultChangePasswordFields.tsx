import { useId } from "react";
import { requireVaultConfigEditLockedI18nKey, type ChangePasswordFieldsState } from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { createVaultErrorI18nKey } from "@/lib/errorMessages";
import { PasswordInput } from "@/components/ui";
import { settingsControlClass, SettingsField } from "./vaultSettingsForm";

interface VaultChangePasswordFieldsProps {
  fields: ChangePasswordFieldsState;
  onChange: (patch: Partial<ChangePasswordFieldsState>) => void;
  /** Wrong current password — ring and message on that field. */
  passwordFieldError?: string | null;
  /** Form-level failure (backup, closed vault, mismatch). */
  error?: string | null;
  /** Blocked when vault is not strictly closed (`vault_closed` gate). */
  rewrapBlocked?: boolean;
  /** This change is already running. */
  busy?: boolean;
}

const invalidPasswordClass =
  "aria-invalid:ring-2 aria-invalid:ring-on-error-container aria-invalid:focus:ring-on-error-container";

export function VaultChangePasswordFields({
  fields,
  onChange,
  passwordFieldError,
  error,
  rewrapBlocked = false,
  busy = false,
}: VaultChangePasswordFieldsProps) {
  const { t } = useTranslation();
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();

  const passwordsMatch =
    fields.newPassword.length > 0 && fields.newPassword === fields.confirmPassword;
  const locked = rewrapBlocked || busy;

  return (
    <div className="space-y-3">
      {rewrapBlocked ? (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t(requireVaultConfigEditLockedI18nKey("action.change_password"))}
        </p>
      ) : null}
      <SettingsField
        label={t("vault.change_password.current")}
        htmlFor={currentId}
        disabled={locked}
      >
        <PasswordInput
          id={currentId}
          value={fields.currentPassword}
          disabled={locked}
          aria-invalid={passwordFieldError ? true : undefined}
          aria-errormessage={passwordFieldError ? `${currentId}-error` : undefined}
          onChange={(e) => onChange({ currentPassword: e.target.value })}
          autoComplete="current-password"
          inputClassName={[settingsControlClass, invalidPasswordClass].join(" ")}
        />
        {passwordFieldError ? (
          <p id={`${currentId}-error`} role="alert" className="text-xs text-on-error-container">
            {passwordFieldError}
          </p>
        ) : null}
      </SettingsField>

      <SettingsField label={t("vault.change_password.new")} htmlFor={newId} disabled={locked}>
        <PasswordInput
          id={newId}
          value={fields.newPassword}
          disabled={locked}
          onChange={(e) => onChange({ newPassword: e.target.value })}
          autoComplete="new-password"
          inputClassName={settingsControlClass}
        />
      </SettingsField>

      <SettingsField
        label={t("vault.change_password.confirm")}
        htmlFor={confirmId}
        disabled={locked}
      >
        <PasswordInput
          id={confirmId}
          value={fields.confirmPassword}
          disabled={locked}
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
