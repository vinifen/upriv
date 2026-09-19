import { useEffect, useRef } from "react";
import {
  parseWorkspaceSnapshot,
  sanitizeWorkspaceSnapshot,
  serializeWorkspaceSnapshot,
  snapshotsEqual,
  UPRIV_WORKSPACE_PATH,
  workspaceSnapshotFromState,
  workspaceStateFromSnapshot,
  type VaultFileSystemService,
  type VaultWorkspaceAction,
  type VaultWorkspaceState,
} from "@upriv/shared";

interface UseWorkspacePersistenceOptions {
  vaultId: string;
  workspace: VaultWorkspaceState;
  fs: VaultFileSystemService;
  dispatch: (action: VaultWorkspaceAction) => void;
}

function writeWorkspaceSnapshot(
  fs: VaultFileSystemService,
  vaultId: string,
  state: VaultWorkspaceState,
  lastWrittenRef: { current: string | null },
): void {
  const snapshot = workspaceSnapshotFromState(state);
  const sanitized = sanitizeWorkspaceSnapshot(snapshot, fs.getFileTree(vaultId));
  const raw = serializeWorkspaceSnapshot(sanitized);
  if (lastWrittenRef.current === raw) return;
  fs.setFileContent(vaultId, UPRIV_WORKSPACE_PATH, raw);
  lastWrittenRef.current = raw;
}

/** Sync read when opening FM for a vault with no in-memory entry yet (avoids empty→hydrate flash). */
export function loadPersistedWorkspaceState(
  fs: VaultFileSystemService,
  vaultId: string,
): VaultWorkspaceState | null {
  const file = fs.getFileContent(vaultId, UPRIV_WORKSPACE_PATH);
  if (!file?.content) return null;
  const parsed = parseWorkspaceSnapshot(file.content);
  if (!parsed) return null;
  const sanitized = sanitizeWorkspaceSnapshot(parsed, fs.getFileTree(vaultId));
  return workspaceStateFromSnapshot(sanitized);
}

/**
 * Write layout on each layout action (skip if unchanged). Flush on unmount.
 * Hydrate is a backstop when the host did not seed via `loadPersistedWorkspaceState`.
 * Prefer `key={vaultId}` on the host.
 */
export function useWorkspacePersistence({
  vaultId,
  workspace,
  fs,
  dispatch,
}: UseWorkspacePersistenceOptions): { flush: () => void } {
  const hydratedRef = useRef(false);
  const lastWrittenRef = useRef<string | null>(null);
  /** Bound to this mount’s vault — unmount flush must not use a switched vault’s layout. */
  const layoutRef = useRef({ vaultId, workspace });
  layoutRef.current = { vaultId, workspace };

  const flush = () => {
    writeWorkspaceSnapshot(fs, vaultId, workspace, lastWrittenRef);
  };

  useEffect(() => {
    hydratedRef.current = false;
    lastWrittenRef.current = null;
  }, [vaultId]);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    const file = fs.getFileContent(vaultId, UPRIV_WORKSPACE_PATH);
    if (!file?.content) return;

    const parsed = parseWorkspaceSnapshot(file.content);
    if (!parsed) return;

    const sanitized = sanitizeWorkspaceSnapshot(parsed, fs.getFileTree(vaultId));
    lastWrittenRef.current = serializeWorkspaceSnapshot(sanitized);

    const current = workspaceSnapshotFromState(layoutRef.current.workspace);
    if (snapshotsEqual(current, sanitized)) return;

    dispatch({
      type: "hydrate_persisted",
      openTabs: sanitized.openTabs,
      activeTabPath: sanitized.activeTabPath,
      expandedPaths: sanitized.expandedPaths,
      selectedPath: sanitized.selectedPath,
    });
  }, [dispatch, fs, vaultId]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const { vaultId: id, workspace: state } = layoutRef.current;
    if (id !== vaultId) return;
    writeWorkspaceSnapshot(fs, id, state, lastWrittenRef);
    // Persist layout fields only — ignore drafts / dirty / session cues / drag UI.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional field list
  }, [
    vaultId,
    workspace.openTabs,
    workspace.activeTabPath,
    workspace.expandedPaths,
    workspace.selectedPath,
  ]);

  useEffect(() => {
    const id = vaultId;
    return () => {
      const latest = layoutRef.current;
      if (latest.vaultId !== id) return;
      writeWorkspaceSnapshot(fs, id, latest.workspace, lastWrittenRef);
    };
  }, [fs, vaultId]);

  return { flush };
}
