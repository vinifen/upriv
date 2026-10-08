import type { I18nKey } from "../../i18n/catalog";
import type { UnsavedPromptAction } from "./workspaceTypes";

/** Save all / discard all: every dirty file, not one tab. */
export function unsavedPromptConfirmsAllFiles(prompt: UnsavedPromptAction | null): boolean {
  return (
    prompt?.type === "dismiss_workspace" ||
    prompt?.type === "close_vault" ||
    prompt?.type === "close_tabs"
  );
}

export function unsavedPromptIsImport(prompt: UnsavedPromptAction | null): boolean {
  return prompt?.type === "import_in_progress" || prompt?.type === "close_vault_import";
}

/** Body copy for the file-manager prompt. Lock continues into vault close. */
export function unsavedPromptBodyKey(prompt: UnsavedPromptAction): I18nKey {
  switch (prompt.type) {
    case "import_in_progress":
      return "modal.file_manager.import_in_progress.body";
    case "close_vault_import":
      return "modal.file_manager.import_in_progress.close_vault_body";
    case "close_vault":
      return "modal.file_manager.unsaved.close_vault_body";
    case "dismiss_workspace":
    case "close_tabs":
      return "modal.file_manager.unsaved.workspace_body";
    case "close_tab":
      return "modal.file_manager.unsaved.body";
  }
}
