import { useEffect, useRef, useState } from "react";
import {
  parseWorkspaceSnapshot,
  sanitizeWorkspaceSnapshot,
  serializedLayoutSnapshot,
  serializeWorkspaceSnapshot,
  snapshotsEqual,
  shouldHydratePersistedWorkspace,
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
  /** Skip layout writes (import in flight — pending tabs are RAM-only). */
  suspend?: boolean;
}

async function writeWorkspaceSnapshot(
  fs: VaultFileSystemService,
  vaultId: string,
  state: VaultWorkspaceState,
  lastWrittenRef: { current: string | null },
): Promise<void> {
  const raw = serializedLayoutSnapshot(state, await fs.getFileTree(vaultId));
  if (lastWrittenRef.current === raw) return;
  await fs.setFileContent(vaultId, UPRIV_WORKSPACE_PATH, raw);
  lastWrittenRef.current = raw;
}

/** Read when opening FM for a vault with no in-memory entry yet (avoids empty→hydrate flash). */
export async function loadPersistedWorkspaceState(
  fs: VaultFileSystemService,
  vaultId: string,
): Promise<VaultWorkspaceState | null> {
  try {
    const file = await fs.getFileContent(vaultId, UPRIV_WORKSPACE_PATH);
    if (!file?.content) return null;
    const parsed = parseWorkspaceSnapshot(file.content);
    if (!parsed) return null;
    try {
      const tree = await fs.getFileTree(vaultId);
      return workspaceStateFromSnapshot(sanitizeWorkspaceSnapshot(parsed, tree));
    } catch {
      return workspaceStateFromSnapshot(parsed);
    }
  } catch {
    return null;
  }
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
  suspend = false,
}: UseWorkspacePersistenceOptions): { flush: () => void } {
  const hydratedRef = useRef(false);
  const lastWrittenRef = useRef<string | null>(null);
  const [hydrateGen, setHydrateGen] = useState(0);
  /** Bound to this mount’s vault — unmount flush must not use a switched vault’s layout. */
  const layoutRef = useRef({ vaultId, workspace });
  layoutRef.current = { vaultId, workspace };
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;
  const fsRef = useRef(fs);
  fsRef.current = fs;

  const flush = () => {
    if (!hydratedRef.current) return;
    void writeWorkspaceSnapshot(fsRef.current, vaultId, workspace, lastWrittenRef).catch(() => {
      /* Persist is best-effort while open; close still flushes separately. */
    });
  };

  useEffect(() => {
    let cancelled = false;
    hydratedRef.current = false;
    lastWrittenRef.current = null;
    const mountSnapshot = workspaceSnapshotFromState(layoutRef.current.workspace);
    let persistAfterDivergence = false;
    const activeFs = fsRef.current;
    const activeDispatch = dispatchRef.current;

    void (async () => {
      try {
        const file = await activeFs.getFileContent(vaultId, UPRIV_WORKSPACE_PATH);
        if (cancelled) return;
        if (!file?.content) return;

        const parsed = parseWorkspaceSnapshot(file.content);
        if (!parsed) return;

        const tree = await activeFs.getFileTree(vaultId);
        if (cancelled) return;
        const sanitized = sanitizeWorkspaceSnapshot(parsed, tree);
        const current = workspaceSnapshotFromState(layoutRef.current.workspace);
        if (!shouldHydratePersistedWorkspace(mountSnapshot, current, sanitized)) {
          if (!snapshotsEqual(current, sanitized)) {
            lastWrittenRef.current = null;
            persistAfterDivergence = true;
          } else {
            lastWrittenRef.current = serializeWorkspaceSnapshot(sanitized);
          }
          return;
        }
        lastWrittenRef.current = serializeWorkspaceSnapshot(sanitized);
        activeDispatch({
          type: "hydrate_persisted",
          openTabs: sanitized.openTabs,
          activeTabPath: sanitized.activeTabPath,
          expandedPaths: sanitized.expandedPaths,
          selectedPath: sanitized.selectedPath,
        });
      } catch {
        /* Missing / corrupt layout → start clean. Persist still enabled. */
      } finally {
        if (!cancelled) {
          hydratedRef.current = true;
          if (persistAfterDivergence) setHydrateGen((n) => n + 1);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Only re-run on vault switch. Parent re-renders pass a new `dispatch` lambda
    // and must not recapture mount as the live layout (that clobbers open tabs).
  }, [vaultId]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const { vaultId: id, workspace: state } = layoutRef.current;
    if (id !== vaultId) return;
    if (state.dragSourcePath || state.dropTargetPath || suspend) return;
    void writeWorkspaceSnapshot(fsRef.current, id, state, lastWrittenRef).catch(() => {
      /* Persist is best-effort while open. */
    });
    // Persist layout fields only — skip while a drag is active so hover-expand
    // cannot race OS file import.
  }, [
    vaultId,
    hydrateGen,
    workspace.openTabs,
    workspace.activeTabPath,
    workspace.expandedPaths,
    workspace.selectedPath,
    workspace.dragSourcePath,
    workspace.dropTargetPath,
    suspend,
  ]);

  useEffect(() => {
    const id = vaultId;
    return () => {
      if (!hydratedRef.current) return;
      const latest = layoutRef.current;
      if (latest.vaultId !== id) return;
      void writeWorkspaceSnapshot(fsRef.current, id, latest.workspace, lastWrittenRef).catch(() => {
        /* Vault may already be closed; layout is flushed before vault_close. */
      });
    };
  }, [vaultId]);

  return { flush };
}
