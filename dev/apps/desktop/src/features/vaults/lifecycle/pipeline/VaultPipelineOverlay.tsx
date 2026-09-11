import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Button, LoadingBudgetHint } from "@/components/ui";
import { acquireScrollLock, releaseScrollLock } from "@/components/ui/scrollLock";
import { useTranslation } from "@/i18n";
import type { I18nKey } from "@/i18n/types";
import { LOADING_BUDGET_MS, type VaultListItem } from "@upriv/shared";
import { useLoadingBudget } from "@upriv/shared/react";

interface VaultPipelineOverlayProps {
  vault: VaultListItem | null;
  open: boolean;
  title: string;
  hint: string;
  stepKeys: readonly I18nKey[];
  activeStep: number;
  errorKey?: I18nKey | null;
  onBackground: () => void;
  onDismissError?: () => void;
}

export function VaultPipelineOverlay({
  vault,
  open,
  title,
  hint,
  stepKeys,
  activeStep,
  errorKey = null,
  onBackground,
  onDismissError,
}: VaultPipelineOverlayProps) {
  const { t } = useTranslation();
  const failed = errorKey !== null;
  const budget = useLoadingBudget(open && !failed, LOADING_BUDGET_MS.vaultPipeline);

  useEffect(() => {
    if (!open) return;
    acquireScrollLock();
    return () => releaseScrollLock();
  }, [open]);

  useEffect(() => {
    if (!open || failed) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onBackground();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onBackground, failed]);

  if (!open || !vault) return null;

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-[var(--modal-scrim)] backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-busy={!failed}
        className="mx-4 w-full max-w-md rounded-2xl bg-surface-container-high p-6 shadow-modal"
      >
        <h2 className="font-display text-lg font-semibold text-on-surface">{title}</h2>
        <p className="mt-1 text-sm text-on-surface-variant">{hint}</p>

        {failed ? (
          <p className="mt-4 text-sm leading-relaxed text-on-error-container">{t(errorKey)}</p>
        ) : (
          <>
            <ol className="mt-5 space-y-2.5">
              {stepKeys.map((stepKey, index) => (
                <PipelineStepRow
                  key={stepKey}
                  label={t(stepKey)}
                  state={index < activeStep ? "done" : index === activeStep ? "active" : "pending"}
                />
              ))}
            </ol>

            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-surface-container">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
                style={{
                  width: `${Math.round(((activeStep + 1) / stepKeys.length) * 100)}%`,
                }}
              />
            </div>
            {budget.visible ? (
              <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
            ) : null}
          </>
        )}

        {failed ? (
          <div className="mt-5">
            <Button variant="secondary" size="sm" className="w-full" onClick={onDismissError}>
              {t("action.close")}
            </Button>
          </div>
        ) : (
          <div className="mt-5 space-y-2">
            <p className="text-xs leading-relaxed text-on-surface-variant">
              {t("pipeline.background_hint")}
            </p>
            <Button variant="secondary" size="sm" className="w-full" onClick={onBackground}>
              {t("pipeline.action.background")}
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function PipelineStepRow({
  label,
  state,
}: {
  label: string;
  state: "pending" | "active" | "done";
}) {
  return (
    <li
      className={[
        "flex items-center gap-2.5 text-sm",
        state === "pending" ? "text-on-surface-variant/50" : "text-on-surface",
      ].join(" ")}
    >
      <span
        aria-hidden
        className={[
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
          state === "done" ? "bg-vault-open/20 text-vault-open" : "",
          state === "active" ? "bg-accent/20 text-accent animate-pulse" : "",
          state === "pending" ? "bg-surface-container text-on-surface-variant/40" : "",
        ].join(" ")}
      >
        {state === "done" ? "✓" : state === "active" ? "…" : "·"}
      </span>
      <span>{label}</span>
    </li>
  );
}
