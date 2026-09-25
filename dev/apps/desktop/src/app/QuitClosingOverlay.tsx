import { LOADING_BUDGET_MS } from "@upriv/shared";
import { useState } from "react";
import { LoadingBudgetHint, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import { useLoadingBudget } from "@upriv/shared/react";
import { useDesktopEvent } from "@/lib/useDesktopEvent";

/**
 * Shown after "Close and quit" while the daemon flushes open vaults.
 * Appear delay is 0: this wait is the whole window, and a blank freeze looks hung.
 */
export function QuitClosingOverlay() {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const budget = useLoadingBudget(active, LOADING_BUDGET_MS.vaultPipeline, { appearDelayMs: 0 });

  useDesktopEvent("quit_closing", () => {
    setActive(true);
  });

  return (
    <Modal
      open={active}
      title={t("quit.closing.title")}
      onClose={() => {}}
      dismissible={false}
      panelClassName="max-w-md"
    >
      <div className="flex flex-col items-center text-center" aria-busy="true">
        <span
          className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-accent/30 border-t-accent"
          aria-hidden
        />
        <p className="mt-4 text-sm text-on-surface-variant">{t("quit.closing.body")}</p>
        {budget.visible ? (
          <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
        ) : null}
      </div>
    </Modal>
  );
}
