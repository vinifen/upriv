import { createPortal } from "react-dom";
import { Button, Modal } from "@/components/ui";
import { useTranslation } from "@/i18n";
import type { useVaultFileManager } from "./useVaultFileManager";

type FileManagerApi = ReturnType<typeof useVaultFileManager>;

interface FileManagerDialogsProps {
  fm: FileManagerApi;
}

export function FileManagerDialogs({ fm }: FileManagerDialogsProps) {
  const { t } = useTranslation();
  const deleteTarget = fm.workspace.deleteTarget;
  const unsavedPrompt = fm.workspace.unsavedPrompt;

  return (
    <>
      <Modal
        open={deleteTarget !== null}
        title={t("modal.file_manager.delete.title")}
        onClose={() => fm.dispatch({ type: "set_delete_target", target: null })}
        panelClassName="max-w-md"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => fm.dispatch({ type: "set_delete_target", target: null })}>
              {t("action.cancel")}
            </Button>
            <Button variant="danger" size="sm" onClick={fm.confirmDelete}>
              {t("action.delete")}
            </Button>
          </div>
        }
      >
        {deleteTarget ? (
          <p className="text-sm leading-relaxed text-on-surface-variant">
            {deleteTarget.isFolder
              ? t("modal.file_manager.delete.body_folder", { name: deleteTarget.name })
              : t("modal.file_manager.delete.body_file", { name: deleteTarget.name })}
          </p>
        ) : null}
      </Modal>

      <Modal
        open={unsavedPrompt !== null}
        title={t("modal.file_manager.unsaved.title")}
        onClose={() => fm.dispatch({ type: "set_unsaved_prompt", prompt: null })}
        panelClassName="max-w-md"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => fm.dispatch({ type: "set_unsaved_prompt", prompt: null })}>
              {t("action.cancel")}
            </Button>
            <Button variant="danger" size="sm" onClick={fm.confirmUnsaved}>
              {t("modal.file_manager.unsaved.discard")}
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {t("modal.file_manager.unsaved.body")}
        </p>
      </Modal>

      {fm.workspace.toastMessage
        ? createPortal(
            <div className="pointer-events-none fixed bottom-20 left-1/2 z-[130] max-w-[min(90vw,24rem)] -translate-x-1/2 rounded-xl bg-surface-container-high px-4 py-3 text-center text-sm text-on-surface shadow-modal">
              {fm.workspace.toastMessage}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
