import { useCallback, useEffect } from "react";
import {
  FILE_MANAGER_PICKER_CACHE_WIPE_RETRY_MS,
  fileManagerBlockingPrompt,
  fileManagerDismissIntent,
  isVaultCloseWritesLocked,
  type VaultPipelineListStatus,
} from "@upriv/shared";
import { useTranslation } from "@/i18n";
import { useLogService } from "@/platform/services";
import { useFileManager } from "./FileManagerContext";
import { retryPendingPickerCacheWipes, setPickerCacheWipeFailedReporter } from "./lib/osFileImport";
import { FileManagerDock } from "./shell/FileManagerDock";
import { FileManagerModal } from "./shell/FileManagerModal";
import { FileManagerWorkspace } from "./workspace/FileManagerWorkspace";

export function FileManagerLayer({
  pipelineListStatus = {},
}: {
  pipelineListStatus?: VaultPipelineListStatus;
}) {
  const { t } = useTranslation();
  const logService = useLogService();
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

  useEffect(() => {
    setPickerCacheWipeFailedReporter(() => {
      void logService.recordImportCacheWipeFailed().catch(() => {
        /* session log is best-effort */
      });
    });
    const timer = setInterval(() => {
      void retryPendingPickerCacheWipes();
    }, FILE_MANAGER_PICKER_CACHE_WIPE_RETRY_MS);
    return () => {
      clearInterval(timer);
      setPickerCacheWipeFailedReporter(null);
      void retryPendingPickerCacheWipes();
    };
  }, [logService]);

  return (
    <>
      {openEntries.length > 0 ? (
        <FileManagerModal
          open={maximizedEntry !== null}
          keepMounted
          title={maximizedEntry ? t("modal.file_manager.title") : ""}
          contextTitle={maximizedEntry?.displayName}
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
              <FileManagerWorkspace
                key={entry.vaultId}
                entry={entry}
                active={active}
                writesLocked={isVaultCloseWritesLocked(entry.vaultId, pipelineListStatus)}
                onDismissConfirmed={() => handleDismissConfirmed(entry.vaultId)}
              />
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
