import { useEffect, useId, useState } from "react";
import { Button, Modal, PasswordInput } from "@/components/ui";
import { useTranslation } from "@/i18n";
import type { I18nKey } from "@/i18n/types";
import {
  requiresPasswordForLifecycle,
  resolveVaultPasswordHint,
  type VaultListItem,
  type VaultLifecycleIntent,
} from "@upriv/shared";
import { useVaultLifecycleService, useVaultService } from "@/platform/services";
import { isTauri } from "@/lib/tauri/invoke";
import { validateMockLifecyclePassword } from "@/platform/mocks/services/vaultLifecycleService";
import { VaultPasswordHintCallout } from "./VaultPasswordHintCallout";
import { SettingsField } from "@/components/settings";

const lifecyclePasswordClass =
  "w-full rounded-lg border border-transparent bg-surface-container-highest px-2.5 py-2 text-sm text-on-surface outline-none focus:border-[var(--accent)] sm:px-3 sm:py-2.5";

interface VaultLifecycleModalProps {
  vault: VaultListItem | null;
  intent: VaultLifecycleIntent | null;
  open: boolean;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (password: string | null) => void;
}

function modalTitleKey(intent: VaultLifecycleIntent): I18nKey {
  switch (intent) {
    case "unlock":
      return "unlock.title";
    case "seal":
      return "close.dialog.seal_title";
    case "close":
      return "close.dialog.title";
  }
}

function confirmLabelKey(intent: VaultLifecycleIntent): I18nKey {
  switch (intent) {
    case "unlock":
      return "unlock.submit";
    case "seal":
      return "action.seal";
    case "close":
      return "action.lock";
  }
}

export function VaultLifecycleModal({
  vault,
  intent,
  open,
  submitting = false,
  onClose,
  onConfirm,
}: VaultLifecycleModalProps) {
  const { t } = useTranslation();
  const vaultService = useVaultService();
  const lifecycleService = useVaultLifecycleService();
  const passwordId = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [requiresPassword, setRequiresPassword] = useState(false);

  useEffect(() => {
    if (!open || !vault || !intent) {
      setRequiresPassword(false);
      return;
    }
    let cancelled = false;
    void Promise.all([
      vaultService.getSettings(vault.id),
      lifecycleService.hasDiskSession(vault.id),
    ]).then(([settings, diskSession]) => {
      if (cancelled || !settings) return;
      setRequiresPassword(
        requiresPasswordForLifecycle(
          vault,
          intent,
          settings.security.mode,
          lifecycleService.hasPasswordInSession(vault.id),
          diskSession,
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [lifecycleService, open, vault, intent, vaultService]);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setError(null);
  }, [open, vault?.id, intent]);

  if (!open || !vault || !intent) return null;

  const handleConfirm = () => {
    const useRealPassword =
      isTauri() &&
      (vault.storageMode === "plain" || vault.storageMode === "encrypted_dir");
    if (
      requiresPassword &&
      !useRealPassword &&
      !validateMockLifecyclePassword(password)
    ) {
      setError(t("error.wrong_password"));
      return;
    }
    if (requiresPassword && useRealPassword && password.trim().length === 0) {
      setError(t("error.wrong_password"));
      return;
    }
    onConfirm(requiresPassword ? password : null);
  };

  const canSubmit = !submitting && (!requiresPassword || password.length > 0);
  const passwordHint = resolveVaultPasswordHint(vault);

  return (
    <Modal
      open={open}
      title={t(modalTitleKey(intent), { name: vault.displayName })}
      onClose={onClose}
      panelClassName="max-w-md"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={submitting} onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button
            variant={intent === "seal" ? "danger" : "primary"}
            size="sm"
            disabled={!canSubmit}
            onClick={handleConfirm}
          >
            {submitting ? t("close.dialog.submitting") : t(confirmLabelKey(intent))}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-0.5 pb-1">
        {intent === "close" ? (
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {t("close.dialog.close_hint")}
          </p>
        ) : null}
        {intent === "seal" ? (
          <>
            <p className="text-sm leading-relaxed text-on-surface-variant">
              {t("close.dialog.seal_hint")}
            </p>
            <p className="text-sm leading-relaxed text-on-surface-variant">
              {t("close.dialog.seal_confirm")}
            </p>
          </>
        ) : null}
        {requiresPassword && passwordHint ? <VaultPasswordHintCallout hint={passwordHint} /> : null}
        {requiresPassword ? (
          <SettingsField label={t("unlock.password")} htmlFor={passwordId}>
            <PasswordInput
              id={passwordId}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && canSubmit) handleConfirm();
              }}
              autoComplete={intent === "unlock" ? "current-password" : "off"}
              autoFocus
              inputClassName={lifecyclePasswordClass}
            />
          </SettingsField>
        ) : null}
        {error ? <p className="text-sm text-on-error-container">{error}</p> : null}
      </div>
    </Modal>
  );
}
