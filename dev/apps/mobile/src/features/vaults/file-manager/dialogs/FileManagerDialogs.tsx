import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Checkbox, Modal, ModalFooterActions, Toast } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import { useTheme } from "@/theme";
import type { FileManagerApi } from "../hooks/useVaultFileManager";

interface FileManagerDialogsProps {
  fm: FileManagerApi;
}

export function FileManagerDialogs({ fm }: FileManagerDialogsProps) {
  const { t } = useTranslation();
  const { typography, colors } = useTheme();
  const { patchSettings } = useAppSettingsContext();
  const deleteTarget = fm.workspace.deleteTarget;
  const unsavedPrompt = fm.workspace.unsavedPrompt;
  const isDismissWorkspacePrompt = unsavedPrompt?.type === "dismiss_workspace";
  const [dontAskAgain, setDontAskAgain] = useState(false);

  const closeDelete = () => {
    setDontAskAgain(false);
    fm.dispatch({ type: "set_delete_target", target: null });
  };

  const handleConfirmDelete = () => {
    const persistPref = dontAskAgain;
    setDontAskAgain(false);
    fm.confirmDelete();
    if (persistPref) {
      void patchSettings({ ui: { file_manager_confirm_delete: false } });
    }
  };

  return (
    <>
      <Modal
        open={deleteTarget !== null}
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
        open={unsavedPrompt !== null}
        title={t("modal.file_manager.unsaved.title")}
        titleIcon="file"
        panelClassName="max-w-md"
        onClose={() => fm.dispatch({ type: "set_unsaved_prompt", prompt: null })}
        footer={
          <ModalFooterActions layout="dialog">
            <Button
              label={t("action.cancel")}
              variant="ghost"
              size="sm"
              onPress={() => fm.dispatch({ type: "set_unsaved_prompt", prompt: null })}
            />
            <Button
              label={
                isDismissWorkspacePrompt
                  ? t("modal.file_manager.unsaved.discard_all")
                  : t("modal.file_manager.unsaved.discard")
              }
              variant="danger"
              size="sm"
              onPress={fm.confirmUnsaved}
            />
            <Button
              label={
                isDismissWorkspacePrompt
                  ? t("modal.file_manager.unsaved.save_all")
                  : t("modal.file_manager.unsaved.save_and_close")
              }
              variant="primary"
              size="sm"
              onPress={fm.confirmSaveUnsaved}
            />
          </ModalFooterActions>
        }
      >
        <Text style={[typography.body, { color: colors.onSurfaceVariant }]}>
          {isDismissWorkspacePrompt
            ? t("modal.file_manager.unsaved.workspace_body")
            : t("modal.file_manager.unsaved.body")}
        </Text>
      </Modal>

      <Toast message={fm.toastMessage} onDismiss={fm.dismissToast} bottomExtra={56} />
    </>
  );
}
