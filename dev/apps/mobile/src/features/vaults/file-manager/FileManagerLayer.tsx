import { memo, useCallback, useEffect } from "react";
import {
  FILE_MANAGER_PICKER_CACHE_WIPE_RETRY_MS,
  fileManagerBlockingPrompt,
  fileManagerDismissIntent,
  isVaultCloseWritesLocked,
  vaultCloseActivityLabelKey,
  type VaultPipelineListStatus,
} from "@upriv/shared";
import { useFileManagerSelector, useFileManagerShell } from "@upriv/shared/react";
import { useTranslation } from "@/i18n";
import { useLogService } from "@/platform/services";
import { useFileManager } from "./FileManagerContext";
import { retryPendingPickerCacheWipes, setPickerCacheWipeFailedReporter } from "./lib/osFileImport";
import { FileManagerDock } from "./shell/FileManagerDock";
import { FileManagerModal } from "./shell/FileManagerModal";
import { FileManagerWorkspace } from "./workspace/FileManagerWorkspace";

const NO_PIPELINE_STATUS: VaultPipelineListStatus = {};

/**
 * Drawn from the open file managers only, not their workspaces: typing in one
 * vault draws that vault's workspace and leaves this frame and the dock alone.
 */
export const FileManagerLayer = memo(function FileManagerLayer({
  pipelineListStatus = NO_PIPELINE_STATUS,
  onCloseVault,
}: {
  pipelineListStatus?: VaultPipelineListStatus;
  /** After the user saves or discards from a lock prompt, close that vault. */
  onCloseVault?: (vaultId: string) => void;
}) {
  const { t } = useTranslation();
  const logService = useLogService();
  const { getEntry, getState, minimize, maximize, dismiss, dispatchWorkspace } = useFileManager();
  const { entries, maximizedVaultId, focusedVaultId } = useFileManagerShell();
  const maximizedEntry = entries.find((entry) => entry.vaultId === maximizedVaultId) ?? null;
  const suspendMinimize = useFileManagerSelector((state) =>
    Boolean(maximizedVaultId && state.entries[maximizedVaultId]?.workspace.unsavedPrompt),
  );
  const closeActivityKey = maximizedEntry
    ? vaultCloseActivityLabelKey(maximizedEntry.vaultId, pipelineListStatus)
    : null;

  const requestDismiss = useCallback(
    (vaultId: string) => {
      const entry = getEntry(vaultId);
      if (!entry) {
        dismiss(vaultId);
        return;
      }

      const prompt = fileManagerBlockingPrompt(fileManagerDismissIntent(entry));
      if (prompt) {
        if (getState().maximizedVaultId !== vaultId) {
          maximize(vaultId);
        }
        if (entry.workspace.unsavedPrompt?.type !== prompt.type) {
          dispatchWorkspace(vaultId, { type: "set_unsaved_prompt", prompt });
        }
        return;
      }

      dismiss(vaultId);
    },
    [dismiss, dispatchWorkspace, getEntry, getState, maximize],
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
      {entries.length > 0 ? (
        <FileManagerModal
          open={maximizedEntry !== null}
          keepMounted
          title={maximizedEntry ? t("modal.file_manager.title") : ""}
          contextTitle={maximizedEntry?.displayName}
          activityLabel={closeActivityKey ? t(closeActivityKey) : undefined}
          suspendMinimize={suspendMinimize}
          onMinimize={() => {
            if (!maximizedEntry || suspendMinimize) return;
            minimize(maximizedEntry.vaultId);
          }}
          onDismiss={() => {
            if (maximizedEntry) requestDismiss(maximizedEntry.vaultId);
          }}
        >
          {entries.map((entry) => (
            <FileManagerWorkspace
              key={entry.vaultId}
              vaultId={entry.vaultId}
              active={entry.vaultId === maximizedVaultId}
              writesLocked={isVaultCloseWritesLocked(entry.vaultId, pipelineListStatus)}
              onDismissConfirmed={dismiss}
              onVaultCloseConfirmed={onCloseVault}
            />
          ))}
        </FileManagerModal>
      ) : null}
      <FileManagerDock
        entries={entries}
        focusedVaultId={focusedVaultId}
        maximizedVaultId={maximizedVaultId}
        onMinimize={minimize}
        onRestore={maximize}
        onDismiss={requestDismiss}
      />
    </>
  );
});
