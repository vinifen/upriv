import { useEffect } from "react";
import { LOADING_BUDGET_MS } from "@upriv/shared";
import { useLoadingBudget } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { Button, LoadingBudgetHint, Modal, ModalFooterActions } from "@/components/ui";
import { useTheme } from "@/theme";
import { Text } from "react-native";

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
  const { typography, colors } = useTheme();
  const budget = useLoadingBudget(open && saving, LOADING_BUDGET_MS.vaultPipeline);

  useEffect(() => {
    if (budget.timedOut) onSaveTimeout();
  }, [budget.timedOut, onSaveTimeout]);

  return (
    <Modal
      open={open}
      title={t("modal.file_manager.unsaved.title")}
      titleIcon="file"
      panelClassName="max-w-md"
      onClose={onCancel}
      footer={
        <ModalFooterActions layout="dialog">
          <Button
            label={t("action.cancel")}
            variant="ghost"
            size="sm"
            disabled={saving}
            onPress={onCancel}
          />
          <Button
            label={t("modal.file_manager.unsaved.discard_all")}
            variant="danger"
            size="sm"
            disabled={saving}
            onPress={onDiscard}
          />
          <Button
            label={t("modal.file_manager.unsaved.save_all")}
            variant="primary"
            size="sm"
            disabled={saving}
            onPress={onSave}
          />
        </ModalFooterActions>
      }
    >
      <Text style={[typography.body, { color: colors.onSurfaceVariant }]}>
        {t("modal.file_manager.unsaved.close_all_body")}
      </Text>
      {budget.visible ? (
        <LoadingBudgetHint budgetMs={budget.budgetMs} remainingMs={budget.remainingMs} />
      ) : null}
    </Modal>
  );
}
