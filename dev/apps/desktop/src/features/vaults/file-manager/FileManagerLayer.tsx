import { useCallback } from "react";
import { useTranslation } from "@/i18n";
import { useFileManager } from "./FileManagerContext";
import { hasUnsavedWorkspaceChanges } from "./lib/fileManagerWorkspaceTypes";
import { FileManagerDock } from "./shell/FileManagerDock";
import { FileManagerModal } from "./shell/FileManagerModal";
import { FileManagerWorkspace } from "./workspace/FileManagerWorkspace";

export function FileManagerLayer() {
  const { t } = useTranslation();
  const {
    maximizedEntry,
    maximizedVaultId,
    entries,
    entryOrder,
    minimize,
    maximize,
    dismiss,
    focusedVaultId,
    dispatchWorkspace,
  } = useFileManager();
  const openEntries = entryOrder
    .map((id) => entries[id])
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const suspendMinimize = Boolean(maximizedEntry?.workspace.unsavedPrompt);

  const handleDismissConfirmed = useCallback(
    (vaultId: string) => {
      dismiss(vaultId);
    },
    [dismiss],
  );

  const requestDismiss = useCallback(
    (vaultId: string) => {
      const entry = entries[vaultId];
      if (!entry) {
        dismiss(vaultId);
        return;
      }

      if (hasUnsavedWorkspaceChanges(entry.workspace)) {
        if (maximizedVaultId !== vaultId) {
          maximize(vaultId);
        }
        if (entry.workspace.unsavedPrompt?.type === "dismiss_workspace") {
          return;
        }
        dispatchWorkspace(vaultId, {
          type: "set_unsaved_prompt",
          prompt: { type: "dismiss_workspace" },
        });
        return;
      }

      dismiss(vaultId);
    },
    [dismiss, dispatchWorkspace, entries, maximize, maximizedVaultId],
  );

  return (
    <>
      <FileManagerModal
        open={maximizedEntry !== null}
        title={
          maximizedEntry ? t("modal.file_manager.title", { name: maximizedEntry.displayName }) : ""
        }
        suspendMinimize={suspendMinimize}
        onMinimize={() => {
          if (!maximizedEntry || suspendMinimize) return;
          minimize(maximizedEntry.vaultId);
        }}
        onDismiss={() => {
          if (maximizedEntry) requestDismiss(maximizedEntry.vaultId);
        }}
      >
        {maximizedEntry ? (
          <FileManagerWorkspace
            entry={maximizedEntry}
            onDismissConfirmed={() => handleDismissConfirmed(maximizedEntry.vaultId)}
          />
        ) : null}
      </FileManagerModal>
      <FileManagerDock
        entries={openEntries}
        focusedVaultId={focusedVaultId}
        maximizedVaultId={maximizedVaultId}
        onMinimize={minimize}
        onRestore={maximize}
        onDismiss={requestDismiss}
      />
    </>
  );
}
