import { useCallback } from "react";
import { useTranslation } from "@/i18n";
import { useFileManager } from "./FileManagerContext";
import {
  fileManagerBlockingPrompt,
  fileManagerDismissIntent,
  isVaultCloseWritesLocked,
  type VaultPipelineListStatus,
} from "@upriv/shared";
import { FileManagerDock } from "./shell/FileManagerDock";
import { FileManagerModal } from "./shell/FileManagerModal";
import { FileManagerWorkspace } from "./workspace/FileManagerWorkspace";

export function FileManagerLayer({
  pipelineListStatus = {},
}: {
  pipelineListStatus?: VaultPipelineListStatus;
}) {
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

      const prompt = fileManagerBlockingPrompt(fileManagerDismissIntent(entry));
      if (prompt) {
        if (maximizedVaultId !== vaultId) {
          maximize(vaultId);
        }
        if (entry.workspace.unsavedPrompt?.type !== prompt.type) {
          dispatchWorkspace(vaultId, { type: "set_unsaved_prompt", prompt });
        }
        return;
      }

      dismiss(vaultId);
    },
    [dismiss, dispatchWorkspace, entries, maximize, maximizedVaultId],
  );

  return (
    <>
      {openEntries.length > 0 ? (
        <FileManagerModal
          open={maximizedEntry !== null}
          keepMounted
          title={maximizedEntry ? t("modal.file_manager.title") : ""}
          contextTitle={maximizedEntry?.displayName}
          titleIcon="file-manager"
          suspendMinimize={suspendMinimize}
          onMinimize={() => {
            if (!maximizedEntry || suspendMinimize) return;
            minimize(maximizedEntry.vaultId);
          }}
          onDismiss={() => {
            if (maximizedEntry) requestDismiss(maximizedEntry.vaultId);
          }}
        >
          {openEntries.map((entry) => {
            const active = entry.vaultId === maximizedVaultId;
            return (
              <div
                key={entry.vaultId}
                hidden={!active}
                className={active ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "hidden"}
              >
                <FileManagerWorkspace
                  entry={entry}
                  active={active}
                  writesLocked={isVaultCloseWritesLocked(entry.vaultId, pipelineListStatus)}
                  onDismissConfirmed={() => handleDismissConfirmed(entry.vaultId)}
                />
              </div>
            );
          })}
        </FileManagerModal>
      ) : null}
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
