import { useEffect, useRef } from "react";
import type { I18nKey } from "@upriv/shared";
import { LOADING_BUDGET_MS } from "@upriv/shared";
import { Button, LoadingBudgetHint } from "@/components/ui";
import { useLoadingBudget } from "@/hooks/useLoadingBudget";
import { useTranslation } from "@/i18n";
import type { VaultRootConfirmAction } from "./vaultRootSettingsIntent";

interface VaultRootConfirmFooterProps {
  busy: boolean;
  /** Gate unresolved (incomplete without policy, missing path, …) or no draft change. */
  blocked: boolean;
  confirmOpen: boolean;
  /** Side-effect reminders shown only while confirming. */
  noteKeys?: readonly I18nKey[];
  /**
   * Blocking gates (Setup / Repair / Recovery) use Continue;
   * Data folder uses Apply.
   * @default "continue"
   */
  primaryAction?: VaultRootConfirmAction;
  /** Style the confirm button as danger (e.g. incomplete delete). */
  confirmDanger?: boolean;
  /** Shown above the primary when not confirming (e.g. folder inspect in progress). */
  idleStatusKey?: I18nKey;
  /** Success line (e.g. Applied) — replaces idle/confirm copy while set. */
  successKey?: I18nKey;
  /** First click — open the confirm step. */
  onRequestPrimary: () => void;
  /** Second click — run the side effects. */
  onConfirmPrimary: () => void;
  onCancelConfirm: () => void;
  /** Budget exhausted while `busy` — parent must clear busy and surface retry/error. */
  onBusyTimeout?: () => void;
}

/**
 * Two-step primary footer: first click opens confirm + notes; second click commits.
 * Primary stays first in the DOM so Cancel mounts below / left of the click target
 * (`flex-col` + `sm:flex-row-reverse`) and does not flash under the pointer.
 */
export function VaultRootConfirmFooter({
  busy,
  blocked,
  confirmOpen,
  noteKeys = [],
  primaryAction = "continue",
  confirmDanger = false,
  idleStatusKey,
  successKey,
  onRequestPrimary,
  onConfirmPrimary,
  onCancelConfirm,
  onBusyTimeout,
}: VaultRootConfirmFooterProps) {
  const { t } = useTranslation();
  const primaryDisabled = busy || blocked;
  const isApply = primaryAction === "apply";
  const showIdleStatus = !confirmOpen && !successKey && idleStatusKey != null;
  const budget = useLoadingBudget(busy && !successKey, LOADING_BUDGET_MS.vaultRoot);
  const timedOutNotified = useRef(false);

  useEffect(() => {
    if (!busy) {
      timedOutNotified.current = false;
      return;
    }
    if (!budget.timedOut || timedOutNotified.current) return;
    timedOutNotified.current = true;
    onBusyTimeout?.();
  }, [budget.timedOut, busy, onBusyTimeout]);

  return (
    <div className="flex flex-col gap-3" aria-busy={showIdleStatus || busy || undefined}>
      <div className="text-sm" aria-live="polite">
        {successKey ? (
          <p className="text-vault-open" role="status">
            {t(successKey)}
          </p>
        ) : confirmOpen ? (
          <div className="space-y-1.5 text-on-surface-variant">
            <p>
              {t(
                isApply
                  ? "modal.data_folder.apply_confirm"
                  : "modal.vault_root_gate.continue_confirm",
              )}
            </p>
            {noteKeys.map((key) => (
              <p key={key} className="text-on-error-container">
                {t(key)}
              </p>
            ))}
            {busy && budget.visible ? (
              <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
            ) : null}
          </div>
        ) : showIdleStatus ? (
          <p className="text-on-surface-variant" role="status">
            {t(idleStatusKey)}
          </p>
        ) : busy && budget.visible ? (
          <div className="text-on-surface-variant">
            <p role="status">{t("modal.vault_root_setup.busy")}</p>
            <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:flex-wrap sm:justify-start [&_button]:w-full sm:[&_button]:w-auto">
        <Button
          variant={confirmOpen && confirmDanger ? "danger" : "primary"}
          size="md"
          disabled={primaryDisabled}
          onClick={confirmOpen ? onConfirmPrimary : onRequestPrimary}
        >
          {confirmOpen
            ? t(
                isApply
                  ? "modal.data_folder.apply_confirm_action"
                  : "modal.vault_root_gate.continue_confirm_action",
              )
            : t(isApply ? "action.apply" : "action.continue")}
        </Button>
        {confirmOpen ? (
          <Button variant="ghost" size="md" disabled={busy} onClick={onCancelConfirm}>
            {t("action.cancel")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
