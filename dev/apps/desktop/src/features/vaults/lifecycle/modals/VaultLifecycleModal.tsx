import { useEffect, useId, useState } from "react";
import { Button, LoadingBudgetHint, Modal, PasswordInput } from "@/components/ui";
import { useTranslation } from "@/i18n";
import type { I18nKey } from "@/i18n/types";
import {
  LOADING_BUDGET_MS,
  lifecycleBusyLabelKey,
  requiresPasswordForLifecycle,
  requireVaultErrorI18nKey,
  resolveVaultPasswordHint,
  storageModeIsPlaintext,
  VAULT_ERROR_CODES,
  type VaultListItem,
  type VaultLifecycleIntent,
} from "@upriv/shared";
import { useLoadingBudget } from "@upriv/shared/react";
import { useVaultLifecycleService, useVaultService } from "@/platform/services";
import { VaultPasswordHintCallout } from "./VaultPasswordHintCallout";
import { SettingsField } from "@/components/settings";

const lifecyclePasswordClass =
  "w-full rounded-lg border border-transparent bg-surface-container-highest px-2.5 py-2 text-sm text-on-surface outline-none focus:border-[var(--accent)] sm:px-3 sm:py-2.5";

interface VaultLifecycleModalProps {
  vault: VaultListItem | null;
  intent: VaultLifecycleIntent | null;
  open: boolean;
  submitting?: boolean;
  pipelineStep?: number;
  budgetStartedAt?: number;
  verifyErrorKey?: I18nKey | null;
  /** Prefill after a failed attempt — the field, not the session RAM map. */
  initialPassword?: string;
  onClose: () => void;
  onConfirm: (password: string | null) => void;
}

function modalTitleKey(intent: VaultLifecycleIntent): I18nKey {
  switch (intent) {
    case "unlock":
      return "unlock.title";
    case "close":
      return "close.dialog.title";
  }
}

function confirmLabelKey(intent: VaultLifecycleIntent): I18nKey {
  switch (intent) {
    case "unlock":
      return "unlock.submit";
    case "close":
      return "action.lock";
  }
}

export function VaultLifecycleModal({
  vault,
  intent,
  open,
  submitting = false,
  pipelineStep = 0,
  budgetStartedAt,
  verifyErrorKey = null,
  initialPassword,
  onClose,
  onConfirm,
}: VaultLifecycleModalProps) {
  const { t } = useTranslation();
  const vaultService = useVaultService();
  const lifecycleService = useVaultLifecycleService();
  const passwordId = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Unlock always needs a password (`requiresPasswordForLifecycle`) — do not wait on settings.
  const [requiresPassword, setRequiresPassword] = useState(intent === "unlock");
  const [settingsLoading, setSettingsLoading] = useState(false);

  useEffect(() => {
    if (!open || !vault || !intent) {
      setRequiresPassword(false);
      setSettingsLoading(false);
      return;
    }
    setRequiresPassword(intent === "unlock");
    if (intent === "unlock") {
      setSettingsLoading(false);
      return;
    }
    let cancelled = false;
    setSettingsLoading(true);
    vaultService
      .getSettings(vault.id)
      .then((settings) => {
        if (cancelled) return;
        if (!settings) {
          setRequiresPassword(true);
          return;
        }
        setRequiresPassword(requiresPasswordForLifecycle(vault, intent, settings.security.mode));
      })
      .catch(() => {
        if (!cancelled) setRequiresPassword(true);
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, vault, intent, vaultService]);

  useEffect(() => {
    if (!open) return;
    setPassword(initialPassword ?? "");
    setError(null);
  }, [open, vault?.id, intent, initialPassword]);

  useEffect(() => {
    if (!verifyErrorKey) return;
    setError(t(verifyErrorKey));
  }, [t, verifyErrorKey]);

  const budget = useLoadingBudget(
    open && submitting && budgetStartedAt != null,
    LOADING_BUDGET_MS.vaultPipeline,
    {
      startedAt: budgetStartedAt,
    },
  );

  if (!open || !vault || !intent) return null;

  const handleConfirm = () => {
    if (requiresPassword && !lifecycleService.validateLifecyclePassword(password)) {
      setError(t(requireVaultErrorI18nKey(VAULT_ERROR_CODES.WRONG_PASSWORD)));
      return;
    }
    setError(null);
    onConfirm(requiresPassword ? password : null);
  };

  const canSubmit =
    !submitting &&
    !settingsLoading &&
    (!requiresPassword || lifecycleService.validateLifecyclePassword(password));
  const passwordHint = resolveVaultPasswordHint(vault);

  return (
    <Modal
      open={open}
      title={t(modalTitleKey(intent))}
      titleIcon={intent === "unlock" ? "lock-open" : "lock"}
      contextTitle={vault.displayName}
      onClose={onClose}
      dismissible
      panelClassName="max-w-md"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {submitting && intent === "unlock" ? null : (
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("action.cancel")}
            </Button>
          )}
          <Button variant="primary" size="sm" disabled={!canSubmit} onClick={handleConfirm}>
            {submitting
              ? budgetStartedAt != null
                ? t(lifecycleBusyLabelKey(intent, pipelineStep))
                : t("vault.status.queued")
              : t(confirmLabelKey(intent))}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-0.5 pb-1">
        {intent === "close" ? (
          <>
            {storageModeIsPlaintext(vault.storageMode) ? (
              <p className="text-sm leading-relaxed text-on-surface-variant">
                {t("close.dialog.close_hint_plain")}
              </p>
            ) : null}
            {requiresPassword ? (
              <p className="text-sm leading-relaxed text-on-surface-variant">
                {t("close.dialog.close_hint_prompt")}
              </p>
            ) : null}
            {!storageModeIsPlaintext(vault.storageMode) && !requiresPassword ? (
              <p className="text-sm leading-relaxed text-on-surface-variant">
                {t("close.dialog.close_hint")}
              </p>
            ) : null}
          </>
        ) : null}
        {requiresPassword ? (
          <div className="space-y-2">
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
                readOnly={submitting}
                inputClassName={lifecyclePasswordClass}
              />
            </SettingsField>
            {passwordHint ? <VaultPasswordHintCallout hint={passwordHint} /> : null}
          </div>
        ) : null}
        {error ? <p className="text-sm text-on-error-container">{error}</p> : null}
        {budget.visible ? (
          <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
        ) : null}
      </div>
    </Modal>
  );
}
