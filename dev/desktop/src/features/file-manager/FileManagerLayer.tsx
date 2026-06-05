import { useTranslation } from "@/i18n";
import { useFileManager } from "./FileManagerContext";
import { FileManagerDock } from "./FileManagerDock";
import { FileManagerModal } from "./FileManagerModal";
import { FileManagerWorkspace } from "./FileManagerWorkspace";

export function FileManagerLayer() {
  const { t } = useTranslation();
  const { maximizedEntry, minimizedEntries, minimize, maximize, close } = useFileManager();

  return (
    <>
      <FileManagerModal
        open={maximizedEntry !== null}
        title={
          maximizedEntry
            ? t("modal.file_manager.title", { name: maximizedEntry.displayName })
            : ""
        }
        onMinimize={() => {
          if (maximizedEntry) minimize(maximizedEntry.vaultId);
        }}
        onClose={() => {
          if (maximizedEntry) close(maximizedEntry.vaultId);
        }}
      >
        {maximizedEntry ? <FileManagerWorkspace entry={maximizedEntry} /> : null}
      </FileManagerModal>
      <FileManagerDock
        entries={minimizedEntries}
        onRestore={maximize}
        onClose={close}
      />
    </>
  );
}
