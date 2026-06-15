import { useTranslation } from "@/i18n";
import { useFileManager } from "./FileManagerContext";
import { FileManagerDock } from "./shell/FileManagerDock";
import { FileManagerModal } from "./shell/FileManagerModal";
import { FileManagerWorkspace } from "./workspace/FileManagerWorkspace";

export function FileManagerLayer() {
  const { t } = useTranslation();
  const { maximizedEntry, entries, entryOrder, minimize, maximize, dismiss, focusedVaultId } =
    useFileManager();
  const openEntries = entryOrder
    .map((id) => entries[id])
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  return (
    <>
      <FileManagerModal
        open={maximizedEntry !== null}
        title={
          maximizedEntry ? t("modal.file_manager.title", { name: maximizedEntry.displayName }) : ""
        }
        onMinimize={() => {
          if (maximizedEntry) minimize(maximizedEntry.vaultId);
        }}
        onDismiss={() => {
          if (maximizedEntry) dismiss(maximizedEntry.vaultId);
        }}
      >
        {maximizedEntry ? <FileManagerWorkspace entry={maximizedEntry} /> : null}
      </FileManagerModal>
      <FileManagerDock
        entries={openEntries}
        focusedVaultId={focusedVaultId}
        maximizedVaultId={maximizedEntry?.vaultId ?? null}
        onMinimize={minimize}
        onRestore={maximize}
        onDismiss={dismiss}
      />
    </>
  );
}
