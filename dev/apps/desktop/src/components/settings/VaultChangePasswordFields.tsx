import { useId } from "react";
import {
  requireVaultConfigEditLockedI18nKey,
  VAULT_PASSWORD_HINT_MAX_LENGTH,
  type ChangePasswordFieldsState,
  type PasswordWeakness,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { createVaultErrorI18nKey } from "@/lib/errorMessages";
import { PasswordInput, PasswordWeaknessNotice, SwitchRow } from "@/components/ui";
import {
  settingsControlClass,
  settingsInvalidControlClass,
  SettingsField,
} from "./vaultSettingsForm";

interface VaultChangePasswordFieldsProps {
  fields: ChangePasswordFieldsState;
  onChange: (patch: Partial<ChangePasswordFieldsState>) => void;
  /** **Back up first**: on each time the window opens. */
  backUpFirst: boolean;
  onBackUpFirstChange: (on: boolean) => void;
  /** What is wrong with the new password; `null` when nothing is. */
  weakness: PasswordWeakness | null;
  /** A refused current password — ring and message on that field. */
  passwordFieldError?: string | null;
  /** Form-level failure (no room, closed vault, mismatch). */
  error?: string | null;
  /** Blocked when the vault is not strictly closed (`vault_closed` gate). */
  blocked?: boolean;
}

export function VaultChangePasswordFields({
  fields,
  onChange,
  backUpFirst,
  onBackUpFirstChange,
  weakness,
  passwordFieldError,
  error,
  blocked = false,
}: VaultChangePasswordFieldsProps) {
  const { t } = useTranslation();
  const currentId = useId();
  const newId = useId();
  const weaknessId = useId();
  const confirmId = useId();
  const hintId = useId();

  const passwordsMatch =
    fields.newPassword.length > 0 && fields.newPassword === fields.confirmPassword;

  return (
    <div className="space-y-3">
      {blocked ? (
        <p className="text-xs leading-relaxed text-on-surface-variant">
          {t(requireVaultConfigEditLockedI18nKey("action.change_password"))}
        </p>
      ) : null}
      <SettingsField
        label={t("vault.change_password.current")}
        htmlFor={currentId}
        disabled={blocked}
      >
        <PasswordInput
          id={currentId}
          value={fields.currentPassword}
          disabled={blocked}
          aria-invalid={passwordFieldError ? true : undefined}
          aria-errormessage={passwordFieldError ? `${currentId}-error` : undefined}
          onChange={(e) => onChange({ currentPassword: e.target.value })}
          autoComplete="current-password"
          inputClassName={[settingsControlClass, settingsInvalidControlClass].join(" ")}
        />
        {passwordFieldError ? (
          <p id={`${currentId}-error`} role="alert" className="text-xs text-on-error-container">
            {passwordFieldError}
          </p>
        ) : null}
      </SettingsField>

      <SettingsField label={t("vault.change_password.new")} htmlFor={newId} disabled={blocked}>
        <PasswordInput
          id={newId}
          value={fields.newPassword}
          disabled={blocked}
          aria-describedby={weaknessId}
          onChange={(e) => onChange({ newPassword: e.target.value })}
          autoComplete="new-password"
          inputClassName={settingsControlClass}
        />
        <PasswordWeaknessNotice id={weaknessId} weakness={weakness} />
      </SettingsField>

      <SettingsField
        label={t("vault.change_password.confirm")}
        htmlFor={confirmId}
        disabled={blocked}
      >
        <PasswordInput
          id={confirmId}
          value={fields.confirmPassword}
          disabled={blocked}
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

      <SettingsField
        label={t("vault.change_password.hint")}
        htmlFor={hintId}
        hint={t("vault.change_password.hint_help")}
        disabled={blocked}
      >
        <input
          id={hintId}
          type="text"
          value={fields.passwordHint}
          maxLength={VAULT_PASSWORD_HINT_MAX_LENGTH}
          disabled={blocked}
          onChange={(e) => onChange({ passwordHint: e.target.value })}
          autoComplete="off"
          className={settingsControlClass}
        />
      </SettingsField>

      <SwitchRow
        checked={backUpFirst}
        disabled={blocked}
        onChange={onBackUpFirstChange}
        label={t("vault.change_password.backup_switch")}
        hint={t("vault.change_password.backup_note")}
      />
      {!backUpFirst ? (
        <p className="text-xs leading-relaxed text-on-error-container">
          {t("vault.change_password.backup_off_warn")}
        </p>
      ) : null}
      {error ? <p className="text-xs text-on-error-container">{error}</p> : null}
    </div>
  );
}
