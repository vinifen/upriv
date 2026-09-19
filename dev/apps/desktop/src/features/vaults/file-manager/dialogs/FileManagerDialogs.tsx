import { useState } from "react";
import { Button, Modal, Toast } from "@/components/ui";
import { useAppSettingsContext } from "@/features/system/settings";
import { useTranslation } from "@/i18n";
import type { FileManagerApi } from "../hooks/useVaultFileManager";

interface FileManagerDialogsProps {
  fm: FileManagerApi;
}

export function FileManagerDialogs({ fm }: FileManagerDialogsProps) {
  const { t } = useTranslation();
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
        onClose={closeDelete}
        panelClassName="max-w-md"
        rootClassName="z-[120]"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={closeDelete}>
              {t("action.cancel")}
            </Button>
            <Button variant="danger" size="sm" onClick={handleConfirmDelete}>
              {t("action.delete")}
            </Button>
          </div>
        }
      >
        {deleteTarget ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-relaxed text-on-surface-variant">
              {deleteTarget.isFolder
                ? t("modal.file_manager.delete.body_folder", { name: deleteTarget.name })
                : t("modal.file_manager.delete.body_file", { name: deleteTarget.name })}
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-on-surface-variant">
              <input
                type="checkbox"
                checked={dontAskAgain}
                onChange={(event) => setDontAskAgain(event.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-outline-variant/50 bg-surface-container-high text-accent focus:ring-accent/50"
              />
              {t("modal.file_manager.delete.dont_ask_again")}
            </label>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={unsavedPrompt !== null}
        title={t("modal.file_manager.unsaved.title")}
        titleIcon="file"
        onClose={() => fm.dispatch({ type: "set_unsaved_prompt", prompt: null })}
        panelClassName="max-w-md"
        rootClassName="z-[120]"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fm.dispatch({ type: "set_unsaved_prompt", prompt: null })}
            >
              {t("action.cancel")}
            </Button>
            <Button variant="danger" size="sm" onClick={fm.confirmUnsaved}>
              {isDismissWorkspacePrompt
                ? t("modal.file_manager.unsaved.discard_all")
                : t("modal.file_manager.unsaved.discard")}
            </Button>
            <Button variant="primary" size="sm" onClick={fm.confirmSaveUnsaved}>
              {isDismissWorkspacePrompt
                ? t("modal.file_manager.unsaved.save_all")
                : t("modal.file_manager.unsaved.save_and_close")}
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {isDismissWorkspacePrompt
            ? t("modal.file_manager.unsaved.workspace_body")
            : t("modal.file_manager.unsaved.body")}
        </p>
      </Modal>

      <Toast message={fm.toastMessage} onDismiss={fm.dismissToast} className="bottom-20 z-[130]" />
    </>
  );
}
