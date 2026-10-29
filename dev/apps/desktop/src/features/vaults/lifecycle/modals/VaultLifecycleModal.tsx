import { useEffect, useId, useState } from "react";
import { Button, LoadingBudgetHint, Modal, PasswordInput } from "@/components/ui";
import { useTranslation } from "@/i18n";
import type { I18nKey } from "@/i18n/types";
import {
  LOADING_BUDGET_MS,
  lifecycleBusyLabelKey,
  requireVaultErrorI18nKey,
  resolveVaultPasswordHint,
  VAULT_ERROR_CODES,
  type VaultListItem,
} from "@upriv/shared";
import { useLoadingBudget } from "@upriv/shared/react";
import { useVaultLifecycleService } from "@/platform/services";
import { VaultPasswordHintCallout } from "./VaultPasswordHintCallout";
import { SettingsField } from "@/components/settings";

const lifecyclePasswordClass =
  "w-full rounded-lg border border-transparent bg-surface-container-highest px-2.5 py-2 text-sm text-on-surface outline-none focus:border-[var(--accent)] sm:px-3 sm:py-2.5";

interface VaultLifecycleModalProps {
  vault: VaultListItem | null;
  open: boolean;
  submitting?: boolean;
  pipelineStep?: number;
  budgetStartedAt?: number;
  verifyErrorKey?: I18nKey | null;
  /** Prefill after a failed attempt — the field, not the session RAM map. */
  initialPassword?: string;
  onClose: () => void;
  onConfirm: (password: string) => void;
}

/** Unlock password dialog. Lock starts the close without a dialog. */
export function VaultLifecycleModal({
  vault,
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
  const lifecycleService = useVaultLifecycleService();
  const passwordId = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPassword("");
      return;
    }
    setPassword(initialPassword ?? "");
    setError(null);
  }, [open, vault?.id, initialPassword]);

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

  if (!open || !vault) return null;

  const handleConfirm = () => {
    if (!lifecycleService.validateLifecyclePassword(password)) {
      setError(t(requireVaultErrorI18nKey(VAULT_ERROR_CODES.WRONG_PASSWORD)));
      return;
    }
    setError(null);
    onConfirm(password);
  };

  const canSubmit = !submitting && lifecycleService.validateLifecyclePassword(password);
  const passwordHint = resolveVaultPasswordHint(vault);

  return (
    <Modal
      open={open}
      title={t("unlock.title")}
      titleIcon="lock-open"
      contextTitle={vault.displayName}
      onClose={onClose}
      dismissible
      panelClassName="max-w-md"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="primary" size="sm" disabled={!canSubmit} onClick={handleConfirm}>
            {submitting
              ? budgetStartedAt != null
                ? t(lifecycleBusyLabelKey("unlock", pipelineStep))
                : t("vault.status.queued")
              : t("unlock.submit")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 px-0.5 pb-1">
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
              autoComplete="current-password"
              autoFocus
              inputClassName={lifecyclePasswordClass}
            />
          </SettingsField>
          {passwordHint ? <VaultPasswordHintCallout hint={passwordHint} /> : null}
        </div>
        {error ? <p className="text-sm text-on-error-container">{error}</p> : null}
        {budget.visible ? (
          <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
        ) : null}
      </div>
    </Modal>
  );
}
