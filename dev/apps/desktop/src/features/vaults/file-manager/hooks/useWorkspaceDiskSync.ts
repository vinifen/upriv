import { useEffect, useRef } from "react";
import { fileBaseName } from "@upriv/shared";
import { isTauri } from "@/lib/tauri";
import { TAURI_EVENTS, type WorkspaceChangedEvent } from "@/lib/tauri/workspaceEvent";
import { reconcileWorkspace } from "@/platform/tauri/workspaceFsStore";
import { useTranslation } from "@/i18n";
import type { FileManagerEntry } from "../fileManagerTypes";
import type { VaultWorkspaceAction } from "../lib/vaultWorkspaceReducer";

interface UseWorkspaceDiskSyncOptions {
  entries: Record<string, FileManagerEntry>;
  dispatchWorkspace: (vaultId: string, action: VaultWorkspaceAction) => void;
  onConflictToast: (message: string) => void;
}

/**
 * Listens for backend workspace filesystem events and reconciles the in-memory
 * mirror with disk (external editors, file manager, etc.).
 */
export function useWorkspaceDiskSync({
  entries,
  dispatchWorkspace,
  onConflictToast,
}: UseWorkspaceDiskSyncOptions): void {
  const { t } = useTranslation();
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const dispatchRef = useRef(dispatchWorkspace);
  dispatchRef.current = dispatchWorkspace;

  const toastRef = useRef(onConflictToast);
  toastRef.current = onConflictToast;

  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;

    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen<WorkspaceChangedEvent>(TAURI_EVENTS.WORKSPACE_CHANGED, (event) => {
        const { vaultId } = event.payload;
        const entry = entriesRef.current[vaultId];
        const dirtyPaths = entry?.workspace.dirtyPaths ?? [];

        void reconcileWorkspace(vaultId, { dirtyPaths }).then((result) => {
          if (entry) {
            dispatchRef.current(vaultId, { type: "tree_mutated", revision: result.revision });
            if (result.conflicts.length > 0) {
              dispatchRef.current(vaultId, {
                type: "set_external_conflicts",
                paths: result.conflicts,
              });
              const first = result.conflicts[0];
              const name = fileBaseName(first);
              const extra =
                result.conflicts.length > 1
                  ? tRef.current("modal.file_manager.toast.external_conflict_more", {
                      count: result.conflicts.length - 1,
                    })
                  : "";
              toastRef.current(
                tRef.current("modal.file_manager.toast.external_conflict", { name }) + extra,
              );
            }
          } else if (result.revision > 0) {
            // Mirror updated even when the file-manager UI is closed.
          }
        });
      }).then((dispose) => {
        unlisten = dispose;
      });
    });

    return () => {
      unlisten?.();
    };
  }, []);
}
