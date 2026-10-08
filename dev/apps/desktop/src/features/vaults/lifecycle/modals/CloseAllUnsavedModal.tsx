import { useEffect } from "react";
import { LOADING_BUDGET_MS } from "@upriv/shared";
import { useLoadingBudget } from "@upriv/shared/react";
import { Button, LoadingBudgetHint, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";

interface CloseAllUnsavedModalProps {
  open: boolean;
  saving: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
  onSaveTimeout: () => void;
}

/** One unsaved-changes prompt for every open vault, then queue each one to close. */
export function CloseAllUnsavedModal({
  open,
  saving,
  onCancel,
  onDiscard,
  onSave,
  onSaveTimeout,
}: CloseAllUnsavedModalProps) {
  const { t } = useTranslation();
  const budget = useLoadingBudget(open && saving, LOADING_BUDGET_MS.vaultPipeline);

  useEffect(() => {
    if (budget.timedOut) onSaveTimeout();
  }, [budget.timedOut, onSaveTimeout]);

  return (
    <Modal
      open={open}
      title={t("modal.file_manager.unsaved.title")}
      titleIcon="file"
      onClose={onCancel}
      panelClassName="max-w-md"
      rootClassName="z-[130]"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
            {t("action.cancel")}
          </Button>
          <Button variant="danger" size="sm" disabled={saving} onClick={onDiscard}>
            {t("modal.file_manager.unsaved.discard_all")}
          </Button>
          <Button variant="primary" size="sm" disabled={saving} onClick={onSave}>
            {t("modal.file_manager.unsaved.save_all")}
          </Button>
        </div>
      }
    >
      <p className="text-sm leading-relaxed text-on-surface-variant">
        {t("modal.file_manager.unsaved.close_all_body")}
      </p>
      {budget.visible ? (
        <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
      ) : null}
    </Modal>
  );
}
