import { useEffect, useRef, useState } from "react";
import {
  parseWorkspaceSnapshot,
  sanitizeWorkspaceSnapshot,
  serializedLayoutSnapshot,
  serializeWorkspaceSnapshot,
  snapshotsEqual,
  workspaceSnapshotToHydrate,
  UPRIV_WORKSPACE_PATH,
  workspaceSnapshotFromState,
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

/**
 * Write layout on each layout action (skip if unchanged). Flush on unmount.
 * The file manager shell opens first; this effect hydrates tabs from the vault file.
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
        const merged = workspaceSnapshotToHydrate(mountSnapshot, current, sanitized);
        if (merged) {
          // Keep the on-disk bytes as last-written until the overlay differs,
          // so a chrome toggle made during the load is saved with the tabs.
          lastWrittenRef.current = serializeWorkspaceSnapshot(sanitized);
          activeDispatch({
            type: "hydrate_persisted",
            openTabs: merged.openTabs,
            activeTabPath: merged.activeTabPath,
            expandedPaths: merged.expandedPaths,
            selectedPath: merged.selectedPath,
            markdownView: merged.markdownView,
            explorerCollapsed: merged.explorerCollapsed,
            markdownOutlineOpen: merged.markdownOutlineOpen,
          });
          return;
        }
        if (!snapshotsEqual(current, sanitized)) {
          lastWrittenRef.current = null;
          persistAfterDivergence = true;
        } else {
          lastWrittenRef.current = serializeWorkspaceSnapshot(sanitized);
        }
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
    workspace.markdownView,
    workspace.explorerCollapsed,
    workspace.markdownOutlineOpen,
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
