import { useId, useState } from "react";
import { VAULT_PASSWORD_HINT_MAX_LENGTH } from "@/constants/vault";
import { Button, PasswordInput } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { settingsControlClass, SettingsField } from "./vaultSettingsForm";

interface VaultChangePasswordPanelProps {
  passwordHint: string;
  onPasswordHintChange: (passwordHint: string) => void;
  /** Mock until Tauri `vault_change_password`. */
  onPasswordChanged?: () => void;
}

export function VaultChangePasswordPanel({
  passwordHint,
  onPasswordHintChange,
  onPasswordChanged,
}: VaultChangePasswordPanelProps) {
  const { t } = useTranslation();
  const hintId = useId();
  const currentId = useId();
  const newId = useId();
  const confirmId = useId();

  const [expanded, setExpanded] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmit =
    !submitting &&
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    passwordsMatch &&
    newPassword !== currentPassword;

  const resetForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
    setSuccess(false);
    setSubmitting(false);
  };

  const handleCancel = () => {
    resetForm();
    setExpanded(false);
  };

  const handleStart = () => {
    resetForm();
    setExpanded(true);
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    if (newPassword !== confirmPassword) {
      setError(t("vault.create.password_mismatch"));
      return;
    }
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 700));
      // Mock: wrong password simulation for demo (any password except "wrong")
      if (currentPassword === "wrong") {
        setError(t("error.wrong_password"));
        return;
      }
      setSuccess(true);
      onPasswordChanged?.();
      resetForm();
      setExpanded(false);
    } finally {
      setSubmitting(false);
    }
  };

  const hintField = (
    <SettingsField
      label={t("modal.settings.password_hint")}
      htmlFor={hintId}
      hint={t("modal.settings.field.security.password_hint_help")}
    >
      <input
        id={hintId}
        type="text"
        value={passwordHint}
        maxLength={VAULT_PASSWORD_HINT_MAX_LENGTH}
        onChange={(e) => onPasswordHintChange(e.target.value)}
        className={settingsControlClass}
        autoComplete="off"
      />
    </SettingsField>
  );

  return (
    <div className="space-y-3 pt-4">
      <div>
        <p className="text-sm font-medium text-on-surface">{t("modal.settings.change_password")}</p>
        <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
          {t("modal.settings.change_password_help")}
        </p>
      </div>

      {!expanded ? (
        <>
          <Button variant="secondary" size="sm" onClick={handleStart}>
            {t("modal.settings.change_password")}
          </Button>
          {hintField}
        </>
      ) : (
        <div className="space-y-3 rounded-lg bg-surface-container p-2.5 ring-1 ring-outline-variant/25 sm:p-3">
          <p className="text-xs leading-relaxed text-on-error-container/90">
            {t("warning.password_change_backups")}
          </p>

          {hintField}

          <SettingsField label={t("vault.change_password.current")} htmlFor={currentId}>
            <PasswordInput
              id={currentId}
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                setError(null);
                setSuccess(false);
              }}
              autoComplete="current-password"
              inputClassName={settingsControlClass}
            />
          </SettingsField>

          <SettingsField label={t("vault.change_password.new")} htmlFor={newId}>
            <PasswordInput
              id={newId}
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                setError(null);
                setSuccess(false);
              }}
              autoComplete="new-password"
              inputClassName={settingsControlClass}
            />
          </SettingsField>

          <SettingsField label={t("vault.change_password.confirm")} htmlFor={confirmId}>
            <PasswordInput
              id={confirmId}
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                setError(null);
                setSuccess(false);
              }}
              autoComplete="new-password"
              inputClassName={settingsControlClass}
            />
          </SettingsField>

          {confirmPassword.length > 0 && !passwordsMatch ? (
            <p className="text-xs text-on-error-container">{t("vault.create.password_mismatch")}</p>
          ) : null}
          {newPassword.length > 0 && newPassword === currentPassword ? (
            <p className="text-xs text-on-error-container">{t("vault.change_password.same_as_current")}</p>
          ) : null}
          {error ? <p className="text-xs text-on-error-container">{error}</p> : null}
          {success ? (
            <p className="text-xs text-vault-open">{t("vault.change_password.success")}</p>
          ) : null}

          <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:justify-end [&_button]:w-full sm:[&_button]:w-auto">
            <Button variant="ghost" size="sm" disabled={submitting} onClick={handleCancel}>
              {t("action.cancel")}
            </Button>
            <Button variant="primary" size="sm" disabled={!canSubmit} onClick={() => void handleSubmit()}>
              {submitting ? t("vault.change_password.submitting") : t("vault.change_password.submit")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
