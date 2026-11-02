import { memo, useCallback } from "react";
import { useTranslation } from "@/i18n";
import { useFileManager } from "./FileManagerContext";
import { fileManagerBlockingPrompt, fileManagerDismissIntent } from "@upriv/shared";
import { useFileManagerSelector, useFileManagerShell } from "@upriv/shared/react";
import { FileManagerDock } from "./shell/FileManagerDock";
import { FileManagerModal } from "./shell/FileManagerModal";
import { FileManagerWorkspace } from "./workspace/FileManagerWorkspace";

/**
 * Drawn from the open file managers only, not their workspaces: typing in one
 * vault draws that vault's workspace and leaves this frame and the dock alone.
 */
export const FileManagerLayer = memo(function FileManagerLayer() {
  const { t } = useTranslation();
  const { getEntry, getState, minimize, maximize, dismiss, dispatchWorkspace } = useFileManager();
  const { entries, maximizedVaultId, focusedVaultId } = useFileManagerShell();
  const maximizedEntry = entries.find((entry) => entry.vaultId === maximizedVaultId) ?? null;
  const suspendMinimize = useFileManagerSelector((state) =>
    Boolean(maximizedVaultId && state.entries[maximizedVaultId]?.workspace.unsavedPrompt),
  );

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

  return (
    <>
      {entries.length > 0 ? (
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
          {entries.map((entry) => {
            const active = entry.vaultId === maximizedVaultId;
            return (
              <div
                key={entry.vaultId}
                hidden={!active}
                className={active ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "hidden"}
              >
                <FileManagerWorkspace
                  vaultId={entry.vaultId}
                  active={active}
                  onDismissConfirmed={dismiss}
                />
              </div>
            );
          })}
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
