import { describe, expect, it } from "vitest";
import {
  unsavedPromptBodyKey,
  unsavedPromptConfirmsAllFiles,
  unsavedPromptIsImport,
} from "../unsavedPrompt";

describe("unsaved prompt copy", () => {
  it("uses save-all for the workspace and several tabs", () => {
    expect(unsavedPromptConfirmsAllFiles({ type: "dismiss_workspace" })).toBe(true);
    expect(unsavedPromptConfirmsAllFiles({ type: "close_tabs", paths: ["/a"] })).toBe(true);
    expect(unsavedPromptConfirmsAllFiles({ type: "close_tab", path: "/a" })).toBe(false);
    expect(unsavedPromptConfirmsAllFiles(null)).toBe(false);
  });

  it("treats a dismiss during an import as the import prompt", () => {
    expect(unsavedPromptIsImport({ type: "import_in_progress" })).toBe(true);
    expect(unsavedPromptIsImport({ type: "dismiss_workspace" })).toBe(false);
  });

  it("names what each prompt closes", () => {
    expect(unsavedPromptBodyKey({ type: "dismiss_workspace" })).toBe(
      "modal.file_manager.unsaved.workspace_body",
    );
    expect(unsavedPromptBodyKey({ type: "import_in_progress" })).toBe(
      "modal.file_manager.import_in_progress.body",
    );
    expect(unsavedPromptBodyKey({ type: "close_tab", path: "/a" })).toBe(
      "modal.file_manager.unsaved.body",
    );
  });
});
