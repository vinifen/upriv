import { describe, expect, it } from "vitest";
import { vaultRowFixture } from "../../vault/tests/fixtures.shared";
import {
  createEmptyFileManagerState,
  fileManagerBlockingPrompt,
  fileManagerDismissIntent,
  fileManagerReducer,
} from "../dockReducer";
import { persistWorkspaceSnapshot, UPRIV_WORKSPACE_PATH } from "../workspaceSnapshot";
import { createDefaultWorkspaceState } from "../workspaceTypes";
import type { FileTreeNode } from "../../file-tree";

const openNotes = vaultRowFixture({
  id: "notes",
  displayName: "Notes",
  session: "open",
});
const openWork = vaultRowFixture({
  id: "work",
  displayName: "Work",
  session: "open",
});

describe("fileManagerReducer", () => {
  it("opens an eligible vault maximized and focused", () => {
    const state = fileManagerReducer(createEmptyFileManagerState(), {
      type: "open_from_vault",
      vault: openNotes,
    });
    expect(state.order).toEqual(["notes"]);
    expect(state.maximizedVaultId).toBe("notes");
    expect(state.focusedVaultId).toBe("notes");
    expect(state.entries.notes?.surface).toBe("maximized");
    expect(state.entries.notes?.displayName).toBe("Notes");
  });

  it("ignores vaults that are not open", () => {
    const state = fileManagerReducer(createEmptyFileManagerState(), {
      type: "open_from_vault",
      vault: vaultRowFixture({ id: "closed", session: null }),
    });
    expect(state).toEqual(createEmptyFileManagerState());
  });

  it("minimizes the current maximized vault when opening another", () => {
    let state = fileManagerReducer(createEmptyFileManagerState(), {
      type: "open_from_vault",
      vault: openNotes,
    });
    state = fileManagerReducer(state, { type: "open_from_vault", vault: openWork });
    expect(state.entries.notes?.surface).toBe("minimized");
    expect(state.maximizedVaultId).toBe("work");
    expect(state.order).toEqual(["notes", "work"]);
  });

  it("maximize restores a minimized vault and focuses it", () => {
    let state = fileManagerReducer(createEmptyFileManagerState(), {
      type: "open_from_vault",
      vault: openNotes,
    });
    state = fileManagerReducer(state, { type: "minimize", vaultId: "notes" });
    expect(state.maximizedVaultId).toBeNull();
    state = fileManagerReducer(state, { type: "maximize", vaultId: "notes" });
    expect(state.entries.notes?.surface).toBe("maximized");
    expect(state.maximizedVaultId).toBe("notes");
    expect(state.focusedVaultId).toBe("notes");
  });

  it("dismiss and purge drop the entry", () => {
    let state = fileManagerReducer(createEmptyFileManagerState(), {
      type: "open_from_vault",
      vault: openNotes,
    });
    state = fileManagerReducer(state, { type: "dismiss", vaultId: "notes" });
    expect(state.entries.notes).toBeUndefined();
    expect(state.order).toEqual([]);

    state = fileManagerReducer(state, { type: "open_from_vault", vault: openNotes });
    state = fileManagerReducer(state, { type: "purge_for_vault_close", vaultId: "notes" });
    expect(state.order).toEqual([]);
  });

  it("sync_with_vault_list keeps closing sessions and drops closed or unknown ids", () => {
    let state = fileManagerReducer(createEmptyFileManagerState(), {
      type: "open_from_vault",
      vault: openNotes,
    });
    state = fileManagerReducer(state, { type: "open_from_vault", vault: openWork });
    state = fileManagerReducer(state, {
      type: "sync_with_vault_list",
      vaults: [
        vaultRowFixture({ id: "notes", session: "closing" }),
        vaultRowFixture({ id: "gone-elsewhere", session: "open" }),
      ],
    });
    expect(state.order).toEqual(["notes"]);
    expect(state.entries.work).toBeUndefined();
  });

  it("forwards workspace actions to the nested reducer", () => {
    let state = fileManagerReducer(createEmptyFileManagerState(), {
      type: "open_from_vault",
      vault: openNotes,
    });
    state = fileManagerReducer(state, {
      type: "workspace",
      vaultId: "notes",
      action: { type: "open_file", path: "/a.md" },
    });
    expect(state.entries.notes?.workspace.openTabs).toEqual(["/a.md"]);
    expect(state.entries.notes?.workspace.activeTabPath).toBe("/a.md");
  });

  it("tracks import-in-flight independently of minimize and opening another vault", () => {
    let state = fileManagerReducer(createEmptyFileManagerState(), {
      type: "open_from_vault",
      vault: openNotes,
    });
    state = fileManagerReducer(state, {
      type: "set_import_in_flight",
      vaultId: "notes",
      inFlight: true,
    });
    expect(state.entries.notes?.importInFlight).toBe(true);

    state = fileManagerReducer(state, { type: "minimize", vaultId: "notes" });
    expect(state.entries.notes?.surface).toBe("minimized");
    expect(state.entries.notes?.importInFlight).toBe(true);

    state = fileManagerReducer(state, { type: "open_from_vault", vault: openWork });
    expect(state.entries.notes?.importInFlight).toBe(true);
    expect(state.entries.work?.importInFlight).toBe(false);
    expect(state.maximizedVaultId).toBe("work");
  });

  it("blocks dismiss while an import is in flight ahead of unsaved drafts", () => {
    const workspace = {
      ...createDefaultWorkspaceState(),
      dirtyPaths: ["/a.md"],
    };
    expect(fileManagerDismissIntent({ importInFlight: true, workspace })).toBe(
      "import_in_progress",
    );
    expect(fileManagerBlockingPrompt("import_in_progress")).toEqual({
      type: "import_in_progress",
    });
    expect(fileManagerDismissIntent({ importInFlight: false, workspace })).toBe("unsaved");
    expect(
      fileManagerDismissIntent({
        importInFlight: false,
        workspace: createDefaultWorkspaceState(),
      }),
    ).toBe("dismiss");
  });
});

describe("persistWorkspaceSnapshot", () => {
  it("writes a sanitized snapshot for the vault", async () => {
    const tree: FileTreeNode = {
      name: "",
      type: "folder",
      children: [{ name: "a.md", type: "file" }],
    };
    const written: Record<string, string> = {};
    const workspace = {
      ...createDefaultWorkspaceState(),
      openTabs: ["/a.md", "/missing.md"],
      activeTabPath: "/missing.md",
      selectedPath: "/a.md",
    };

    await persistWorkspaceSnapshot(
      {
        getFileTree: () => tree,
        setFileContent: (_vaultId, path, content) => {
          written[path] = content;
          return 1;
        },
      },
      "notes",
      workspace,
    );

    expect(written[UPRIV_WORKSPACE_PATH]).toContain('"/a.md"');
    expect(written[UPRIV_WORKSPACE_PATH]).not.toContain("missing.md");
  });
});
