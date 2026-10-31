import { useEffect, useState } from "react";
import { Modal as RnModal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  Button,
  Checkbox,
  LoadingBudgetHint,
  Modal,
  ModalFooterActions,
  Toast,
} from "@/components/ui";
import { useTranslation } from "@/i18n";
import {
  LOADING_BUDGET_MS,
  unsavedPromptBodyKey,
  unsavedPromptConfirmsAllFiles,
  unsavedPromptIsImport,
} from "@upriv/shared";
import { useLoadingBudget } from "@upriv/shared/react";
import { useTheme } from "@/theme";
import type { FileManagerApi } from "../hooks/useVaultFileManager";

interface FileManagerDialogsProps {
  fm: FileManagerApi;
  promptsOpen?: boolean;
}

export function FileManagerDialogs({ fm, promptsOpen = true }: FileManagerDialogsProps) {
  const { t } = useTranslation();
  const { typography, colors } = useTheme();
  const saveBudget = useLoadingBudget(fm.unsavedSaving, LOADING_BUDGET_MS.vaultPipeline);
  const { abandonUnsavedSave } = fm;

  useEffect(() => {
    if (saveBudget.timedOut) abandonUnsavedSave();
  }, [abandonUnsavedSave, saveBudget.timedOut]);

  /** The prompt holds through a save, so the files do not change under it. */
  const cancelUnsavedPrompt = () => {
    if (!fm.unsavedSaving) fm.dispatch({ type: "set_unsaved_prompt", prompt: null });
  };
  const deleteTarget = fm.workspace.deleteTarget;
  const unsavedPrompt = fm.workspace.unsavedPrompt;
  const isMultiFilePrompt = unsavedPromptConfirmsAllFiles(unsavedPrompt);
  const isImportInProgressPrompt = unsavedPromptIsImport(unsavedPrompt);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const closeDelete = () => {
    setDontAskAgain(false);
    fm.dispatch({ type: "set_delete_target", target: null });
  };

  const handleConfirmDelete = () => {
    const persistPref = dontAskAgain;
    setDontAskAgain(false);
    fm.confirmDelete();
    if (persistPref) fm.stopAskingBeforeDelete();
  };

  return (
    <>
      <Modal
        open={promptsOpen && deleteTarget !== null}
        title={t("modal.file_manager.delete.title")}
        titleIcon="trash"
        contextTitle={deleteTarget?.name}
        panelClassName="max-w-md"
        onClose={closeDelete}
        footer={
          <ModalFooterActions layout="dialog">
            <Button label={t("action.cancel")} variant="ghost" size="sm" onPress={closeDelete} />
            <Button
              label={t("action.delete")}
              variant="danger"
              size="sm"
              onPress={handleConfirmDelete}
            />
          </ModalFooterActions>
        }
      >
        {deleteTarget ? (
          <View style={{ gap: 12 }}>
            <Text style={[typography.body, { color: colors.onSurfaceVariant }]}>
              {deleteTarget.isFolder
                ? t("modal.file_manager.delete.body_folder", { name: deleteTarget.name })
                : t("modal.file_manager.delete.body_file", { name: deleteTarget.name })}
            </Text>
            <Pressable
              onPress={() => setDontAskAgain((prev) => !prev)}
              style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: dontAskAgain }}
              accessibilityLabel={t("modal.file_manager.delete.dont_ask_again")}
            >
              <Checkbox checked={dontAskAgain} interactive={false} />
              <Text style={[typography.body, { color: colors.onSurfaceVariant, flex: 1 }]}>
                {t("modal.file_manager.delete.dont_ask_again")}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </Modal>

      <Modal
        open={promptsOpen && unsavedPrompt !== null}
        title={
          isImportInProgressPrompt
            ? t("modal.file_manager.import_in_progress.title")
            : t("modal.file_manager.unsaved.title")
        }
        titleIcon="file"
        panelClassName="max-w-md"
        onClose={cancelUnsavedPrompt}
        footer={
          isImportInProgressPrompt ? (
            <ModalFooterActions layout="dialog">
              <Button
                label={t("modal.file_manager.import_in_progress.close_and_cancel")}
                variant="danger"
                size="sm"
                onPress={fm.cancelImportAndClose}
              />
              <Button
                label={t("modal.file_manager.import_in_progress.stay")}
                variant="primary"
                size="sm"
                onPress={() => fm.dispatch({ type: "set_unsaved_prompt", prompt: null })}
              />
            </ModalFooterActions>
          ) : (
            <ModalFooterActions layout="dialog">
              <Button
                label={t("action.cancel")}
                variant="ghost"
                size="sm"
                disabled={fm.unsavedSaving}
                onPress={cancelUnsavedPrompt}
              />
              <Button
                label={
                  isMultiFilePrompt
                    ? t("modal.file_manager.unsaved.discard_all")
                    : t("modal.file_manager.unsaved.discard")
                }
                variant="danger"
                size="sm"
                disabled={fm.unsavedSaving}
                onPress={fm.confirmUnsaved}
              />
              <Button
                label={
                  isMultiFilePrompt
                    ? t("modal.file_manager.unsaved.save_all")
                    : t("modal.file_manager.unsaved.save_and_close")
                }
                variant="primary"
                size="sm"
                disabled={fm.unsavedSaving}
                onPress={fm.confirmSaveUnsaved}
              />
            </ModalFooterActions>
          )
        }
      >
        <Text style={[typography.body, { color: colors.onSurfaceVariant }]}>
          {unsavedPrompt ? t(unsavedPromptBodyKey(unsavedPrompt)) : null}
        </Text>
        {saveBudget.visible ? (
          <LoadingBudgetHint budgetMs={saveBudget.budgetMs} remainingMs={saveBudget.remainingMs} />
        ) : null}
      </Modal>

      {promptsOpen || !fm.toast ? (
        <Toast toast={fm.toast} onDismiss={fm.dismissToast} bottomExtra={56} />
      ) : (
        <RnModal
          transparent
          visible
          animationType="none"
          statusBarTranslucent
          onRequestClose={fm.dismissToast}
        >
          <View pointerEvents="box-none" style={styles.toastHost}>
            <Toast toast={fm.toast} onDismiss={fm.dismissToast} bottomExtra={56} />
          </View>
        </RnModal>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  toastHost: {
    flex: 1,
  },
});
