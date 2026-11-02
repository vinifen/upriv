import { useEffect } from "react";
import {
  LOADING_BUDGET_MS,
  vaultClosePromptBodyKey,
  vaultClosePromptTitleKey,
  type VaultClosePrompt,
} from "@upriv/shared";
import { useLoadingBudget } from "@upriv/shared/react";
import { Button, LoadingBudgetHint, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";

interface VaultClosePromptModalProps {
  prompt: VaultClosePrompt | null;
  /** The vault's name when the prompt is for one vault. */
  vaultName?: string;
  saving: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
  onSaveTimeout: () => void;
  /** Import: stop storing the files still waiting, then close once the current one lands. */
  onCancelImport: () => void;
}

/**
 * Asks from the vault list before a close, for one vault or every open one,
 * and leaves the file manager where it is: unsaved drafts are saved or
 * discarded; a running import keeps the vault open or is cut short.
 */
export function VaultClosePromptModal({
  prompt,
  vaultName,
  saving,
  onCancel,
  onDiscard,
  onSave,
  onSaveTimeout,
  onCancelImport,
}: VaultClosePromptModalProps) {
  const { t } = useTranslation();
  const open = prompt !== null;
  const budget = useLoadingBudget(open && saving, LOADING_BUDGET_MS.vaultPipeline);

  useEffect(() => {
    if (budget.timedOut) onSaveTimeout();
  }, [budget.timedOut, onSaveTimeout]);

  if (!prompt) return null;
  const unsaved = prompt.blocker === "unsaved";

  return (
    <Modal
      open={open}
      title={t(vaultClosePromptTitleKey(prompt))}
      contextTitle={prompt.all ? undefined : vaultName}
      titleIcon="file"
      onClose={onCancel}
      panelClassName="max-w-md"
      rootClassName="z-[130]"
      footer={
        unsaved ? (
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
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="danger" size="sm" onClick={onCancelImport}>
              {t("modal.file_manager.import_in_progress.close_and_cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={onCancel}>
              {t("modal.file_manager.import_in_progress.stay")}
            </Button>
          </div>
        )
      }
    >
      <p className="text-sm leading-relaxed text-on-surface-variant">
        {t(vaultClosePromptBodyKey(prompt))}
      </p>
      {unsaved && budget.visible ? (
        <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
      ) : null}
    </Modal>
  );
}
