import { describe, expect, it } from "vitest";
import {
  unsavedPromptBodyKey,
  unsavedPromptConfirmsAllFiles,
  unsavedPromptIsImport,
} from "../unsavedPrompt";

describe("unsaved prompt copy", () => {
  it("uses save-all for the workspace, a vault lock, and several tabs", () => {
    expect(unsavedPromptConfirmsAllFiles({ type: "dismiss_workspace" })).toBe(true);
    expect(unsavedPromptConfirmsAllFiles({ type: "close_vault" })).toBe(true);
    expect(unsavedPromptConfirmsAllFiles({ type: "close_tabs", paths: ["/a"] })).toBe(true);
    expect(unsavedPromptConfirmsAllFiles({ type: "close_tab", path: "/a" })).toBe(false);
    expect(unsavedPromptConfirmsAllFiles(null)).toBe(false);
  });

  it("treats a lock during import as an import prompt that closes the vault", () => {
    expect(unsavedPromptIsImport({ type: "import_in_progress" })).toBe(true);
    expect(unsavedPromptIsImport({ type: "close_vault_import" })).toBe(true);
    expect(unsavedPromptIsImport({ type: "close_vault" })).toBe(false);
  });

  it("tells a vault lock that the vault closes, and a file-manager dismiss that it does not", () => {
    expect(unsavedPromptBodyKey({ type: "close_vault" })).toBe(
      "modal.file_manager.unsaved.close_vault_body",
    );
    expect(unsavedPromptBodyKey({ type: "dismiss_workspace" })).toBe(
      "modal.file_manager.unsaved.workspace_body",
    );
    expect(unsavedPromptBodyKey({ type: "close_vault_import" })).toBe(
      "modal.file_manager.import_in_progress.close_vault_body",
    );
    expect(unsavedPromptBodyKey({ type: "import_in_progress" })).toBe(
      "modal.file_manager.import_in_progress.body",
    );
    expect(unsavedPromptBodyKey({ type: "close_tab", path: "/a" })).toBe(
      "modal.file_manager.unsaved.body",
    );
  });
});
