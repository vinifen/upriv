import { describe, expect, it } from "vitest";
import { createDefaultWorkspaceState } from "../../file-manager/workspaceTypes";
import {
  vaultCloseBlocker,
  vaultClosePromptBodyKey,
  vaultClosePromptTitleKey,
} from "../closePrompt";

const clean = createDefaultWorkspaceState();
const dirty = { ...clean, dirtyPaths: ["/a.md"] };

describe("vaultCloseBlocker", () => {
  it("lets a vault with no file manager, or nothing pending, close", () => {
    expect(vaultCloseBlocker(null, false)).toBeNull();
    expect(vaultCloseBlocker({ importInFlight: false, workspace: clean }, false)).toBeNull();
  });

  it("asks about unsaved drafts first, then an import", () => {
    expect(vaultCloseBlocker({ importInFlight: true, workspace: dirty }, false)).toBe("unsaved");
    expect(vaultCloseBlocker({ importInFlight: true, workspace: clean }, false)).toBe("import");
  });

  it("skips drafts already saved or discarded, but still waits for an import", () => {
    expect(vaultCloseBlocker({ importInFlight: false, workspace: dirty }, true)).toBeNull();
    expect(vaultCloseBlocker({ importInFlight: true, workspace: dirty }, true)).toBe("import");
  });
});

describe("vault close prompt copy", () => {
  it("says the vault closes after the answer, for one vault or all", () => {
    const one = { blocker: "unsaved" as const, vaultIds: ["a"], all: false };
    const all = { blocker: "unsaved" as const, vaultIds: ["a", "b"], all: true };
    expect(vaultClosePromptTitleKey(one)).toBe("modal.file_manager.unsaved.title");
    expect(vaultClosePromptBodyKey(one)).toBe("modal.file_manager.unsaved.close_vault_body");
    expect(vaultClosePromptBodyKey(all)).toBe("modal.file_manager.unsaved.close_all_body");
  });

  it("names the import that keeps a vault open", () => {
    const one = { blocker: "import" as const, vaultIds: ["a"], all: false };
    const all = { blocker: "import" as const, vaultIds: ["a", "b"], all: true };
    expect(vaultClosePromptTitleKey(one)).toBe("modal.file_manager.import_in_progress.title");
    expect(vaultClosePromptBodyKey(one)).toBe(
      "modal.file_manager.import_in_progress.close_vault_body",
    );
    expect(vaultClosePromptBodyKey(all)).toBe(
      "modal.file_manager.import_in_progress.close_all_body",
    );
  });
});
