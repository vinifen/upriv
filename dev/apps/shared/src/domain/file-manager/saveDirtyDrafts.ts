import type { VaultWorkspaceState } from "./workspaceTypes";

/**
 * Each pass writes drafts that changed while the previous write was in flight.
 * Past this, the text is still moving and the caller must not close the vault.
 */
export const MAX_DIRTY_DRAFT_SAVE_PASSES = 8;

export type DirtyDraftSaveStatus = "saved" | "cancelled" | "missing_draft" | "failed";

export interface DirtyDraftVault {
  vaultId: string;
  workspace: VaultWorkspaceState;
}

/**
 * Write every dirty editor draft. Re-reads after each write so a keystroke that
 * landed during the write is stored before the caller closes the vault.
 * A path whose current text was already stored is skipped, so a stale dirty
 * flag does not loop.
 */
export async function saveDirtyVaultDrafts(args: {
  readVaults: () => readonly DirtyDraftVault[];
  writeFile: (vaultId: string, path: string, content: string) => Promise<void>;
  markSaved: (vaultId: string, path: string, content: string) => void;
  isCancelled: () => boolean;
}): Promise<DirtyDraftSaveStatus> {
  const written = new Map<string, string>();
  let passes = 0;
  for (;;) {
    if (args.isCancelled()) return "cancelled";
    let wrote = false;
    for (const vault of args.readVaults()) {
      for (const path of vault.workspace.dirtyPaths) {
        if (args.isCancelled()) return "cancelled";
        const current = args.readVaults().find((item) => item.vaultId === vault.vaultId);
        if (!current?.workspace.dirtyPaths.includes(path)) continue;
        const content = current.workspace.editorDrafts[path];
        if (content === undefined) return "missing_draft";
        const key = `${vault.vaultId}\0${path}`;
        if (written.get(key) === content) continue;
        try {
          await args.writeFile(vault.vaultId, path, content);
        } catch {
          return "failed";
        }
        if (args.isCancelled()) return "cancelled";
        const fresh = args.readVaults().find((item) => item.vaultId === vault.vaultId);
        const freshContent = fresh?.workspace.editorDrafts[path];
        const stillSame =
          fresh?.workspace.dirtyPaths.includes(path) === true && freshContent === content;
        written.set(key, content);
        if (!stillSame) {
          wrote = true;
          continue;
        }
        args.markSaved(vault.vaultId, path, content);
        wrote = true;
      }
    }
    if (!wrote) return "saved";
    passes += 1;
    if (passes < MAX_DIRTY_DRAFT_SAVE_PASSES) continue;
    const pending = args.readVaults().some((vault) =>
      vault.workspace.dirtyPaths.some((path) => {
        const content = vault.workspace.editorDrafts[path];
        return written.get(`${vault.vaultId}\0${path}`) !== content;
      }),
    );
    return pending ? "failed" : "saved";
  }
}

/**
 * Editor cache of the last stored bytes. A clean draft is the text just saved
 * (including a save started outside this file manager), so the cache must
 * match it before a later discard shows the editor.
 */
export function withSavedDraftDiskContents(
  disk: Record<string, string>,
  workspace: Pick<VaultWorkspaceState, "dirtyPaths" | "editorDrafts">,
): Record<string, string> {
  const dirty = new Set(workspace.dirtyPaths);
  let next: Record<string, string> | null = null;
  for (const [path, draft] of Object.entries(workspace.editorDrafts)) {
    if (dirty.has(path) || disk[path] === draft) continue;
    next ??= { ...disk };
    next[path] = draft;
  }
  return next ?? disk;
}
