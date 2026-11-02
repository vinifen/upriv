import type { I18nKey } from "../../i18n/catalog";
import type { FileManagerEntry } from "../file-manager/dockReducer";
import { hasUnsavedWorkspaceChanges } from "../file-manager/workspaceTypes";

/** What a close the person asked for waits on, read from the vault's file manager. */
export type VaultCloseBlocker = "unsaved" | "import";

/**
 * Unsaved drafts first, then an import still storing files. `null` when the
 * close may start. `unsavedResolved`: the drafts were just saved or discarded,
 * and the workspace can still read as unsaved until the next render.
 */
export function vaultCloseBlocker(
  entry: Pick<FileManagerEntry, "importInFlight" | "workspace"> | null,
  unsavedResolved: boolean,
): VaultCloseBlocker | null {
  if (!entry) return null;
  if (!unsavedResolved && hasUnsavedWorkspaceChanges(entry.workspace)) return "unsaved";
  if (entry.importInFlight) return "import";
  return null;
}

/**
 * The vault list asks before a close, for one vault or every open one; the
 * file manager stays where it is. Unsaved drafts are saved or discarded; an
 * import keeps the vault open, or stops storing the files still waiting and
 * closes once the file being written lands.
 */
export interface VaultClosePrompt {
  blocker: VaultCloseBlocker;
  vaultIds: readonly string[];
  /** Close all: once answered, every open vault joins the close queue. */
  all: boolean;
}

export function vaultClosePromptTitleKey(prompt: VaultClosePrompt): I18nKey {
  return prompt.blocker === "unsaved"
    ? "modal.file_manager.unsaved.title"
    : "modal.file_manager.import_in_progress.title";
}

export function vaultClosePromptBodyKey(prompt: VaultClosePrompt): I18nKey {
  if (prompt.blocker === "unsaved") {
    return prompt.all
      ? "modal.file_manager.unsaved.close_all_body"
      : "modal.file_manager.unsaved.close_vault_body";
  }
  return prompt.all
    ? "modal.file_manager.import_in_progress.close_all_body"
    : "modal.file_manager.import_in_progress.close_vault_body";
}
