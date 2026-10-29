import { describe, expect, it } from "vitest";
import {
  createDefaultWorkspaceState,
  fileEditorWordWrap,
  fileMarkdownOutlineOpen,
  fileMarkdownView,
  fileSearchQuery,
  hasUnsavedWorkspaceChanges,
  isPathDirty,
  resolveUnsavedPrompt,
  sessionPathKind,
  vaultWorkspaceReducer,
} from "../workspaceReducer";

describe("createDefaultWorkspaceState", () => {
  it("starts with root expanded and no dirty tabs", () => {
    const state = createDefaultWorkspaceState();
    expect(state.expandedPaths).toEqual(["/"]);
    expect(state.openTabs).toEqual([]);
    expect(state.sessionCreatedPaths).toEqual([]);
    expect(state.sessionModifiedPaths).toEqual([]);
    expect(state.fileStates).toEqual({});
    expect(hasUnsavedWorkspaceChanges(state)).toBe(false);
  });
});

describe("vaultWorkspaceReducer", () => {
  it("opens a file and selects it as active tab", () => {
    const state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "open_file",
      path: "/notes/nested.md",
    });
    expect(state.openTabs).toEqual(["/notes/nested.md"]);
    expect(state.activeTabPath).toBe("/notes/nested.md");
    expect(state.selectedPath).toBe("/notes/nested.md");
    expect(state.expandedPaths).toEqual(expect.arrayContaining(["/", "/notes"]));
  });

  it("marks editor drafts dirty and clears on mark_saved as modified", () => {
    let state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "open_file",
      path: "/a.md",
    });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/a.md",
      content: "hello",
    });
    expect(isPathDirty(state, "/a.md")).toBe(true);
    expect(sessionPathKind(state, "/a.md")).toBe("modified");
    expect(hasUnsavedWorkspaceChanges(state)).toBe(true);

    state = vaultWorkspaceReducer(state, {
      type: "mark_saved",
      path: "/a.md",
      content: "hello",
    });
    expect(isPathDirty(state, "/a.md")).toBe(false);
    expect(state.sessionModifiedPaths).toEqual(["/a.md"]);
    expect(sessionPathKind(state, "/a.md")).toBe("modified");
    expect(sessionPathKind(state, "/")).toBe("modified");
  });

  it("marks create/import as created and prefers created over modified on folders", () => {
    let state = createDefaultWorkspaceState();
    state = vaultWorkspaceReducer(state, {
      type: "mark_session_created",
      paths: ["/notes/new.md"],
    });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/notes/old.md",
      content: "x",
    });
    expect(sessionPathKind(state, "/notes/new.md")).toBe("created");
    expect(sessionPathKind(state, "/notes/old.md")).toBe("modified");
    expect(sessionPathKind(state, "/notes")).toBe("created");
  });

  it("keeps created cue after save of a new file", () => {
    let state = createDefaultWorkspaceState();
    state = vaultWorkspaceReducer(state, {
      type: "mark_session_created",
      paths: ["/new.md"],
    });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/new.md",
      content: "x",
    });
    state = vaultWorkspaceReducer(state, {
      type: "mark_saved",
      path: "/new.md",
      content: "x",
    });
    expect(sessionPathKind(state, "/new.md")).toBe("created");
    expect(state.sessionModifiedPaths).toEqual([]);
  });

  it("prompts before closing a dirty tab", () => {
    let state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "open_file",
      path: "/a.md",
    });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/a.md",
      content: "x",
    });
    state = vaultWorkspaceReducer(state, { type: "request_close_tab", path: "/a.md" });
    expect(state.unsavedPrompt).toEqual({ type: "close_tab", path: "/a.md" });
    expect(state.openTabs).toContain("/a.md");
  });

  it("closes a clean tab without prompt", () => {
    let state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "open_file",
      path: "/a.md",
    });
    state = vaultWorkspaceReducer(state, { type: "request_close_tab", path: "/a.md" });
    expect(state.openTabs).toEqual([]);
    expect(state.unsavedPrompt).toBeNull();
    expect(state.selectedPath).toBeNull();
    expect(state.activeTabPath).toBeNull();
  });

  it("moves selectedPath to the next tab when the selected tab closes", () => {
    let state = createDefaultWorkspaceState();
    state = vaultWorkspaceReducer(state, { type: "open_file", path: "/a.md" });
    state = vaultWorkspaceReducer(state, { type: "open_file", path: "/b.md" });
    expect(state.selectedPath).toBe("/b.md");
    state = vaultWorkspaceReducer(state, { type: "close_tab", path: "/b.md" });
    expect(state.openTabs).toEqual(["/a.md"]);
    expect(state.activeTabPath).toBe("/a.md");
    expect(state.selectedPath).toBe("/a.md");
  });

  it("keeps a folder selection when an unrelated tab closes", () => {
    let state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "open_file",
      path: "/a.md",
    });
    state = vaultWorkspaceReducer(state, { type: "select_path", path: "/docs" });
    state = vaultWorkspaceReducer(state, { type: "close_tab", path: "/a.md" });
    expect(state.selectedPath).toBe("/docs");
  });

  it("switches tabs freely while the active tab is dirty (VS Code-style)", () => {
    let state = createDefaultWorkspaceState();
    state = vaultWorkspaceReducer(state, { type: "open_file", path: "/a.md" });
    state = vaultWorkspaceReducer(state, { type: "open_file", path: "/b.md" });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/b.md",
      content: "dirty",
    });
    state = vaultWorkspaceReducer(state, { type: "request_active_tab", path: "/a.md" });
    expect(state.unsavedPrompt).toBeNull();
    expect(state.activeTabPath).toBe("/a.md");
    expect(isPathDirty(state, "/b.md")).toBe(true);
  });

  it("keeps a folder closed when import tries to expand it again", () => {
    let state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "expand_folder",
      path: "/docs",
    });
    state = vaultWorkspaceReducer(state, { type: "toggle_folder", path: "/docs" });
    expect(state.expandedPaths).not.toContain("/docs");
    state = vaultWorkspaceReducer(state, { type: "expand_folder", path: "/docs" });
    expect(state.expandedPaths).not.toContain("/docs");
    state = vaultWorkspaceReducer(state, { type: "open_file", path: "/docs/a.md" });
    expect(state.expandedPaths).not.toContain("/docs");
    expect(state.openTabs).toEqual(["/docs/a.md"]);
    state = vaultWorkspaceReducer(state, { type: "expand_folder", path: "/docs", force: true });
    expect(state.expandedPaths).toContain("/docs");
    state = vaultWorkspaceReducer(state, { type: "expand_folder", path: "/docs" });
    expect(state.expandedPaths).toContain("/docs");
  });

  it("toggles folder expansion without changing the selected path", () => {
    let state = createDefaultWorkspaceState();
    state = vaultWorkspaceReducer(state, { type: "open_file", path: "/a.md" });
    expect(state.selectedPath).toBe("/a.md");
    state = vaultWorkspaceReducer(state, { type: "toggle_folder", path: "/docs" });
    expect(state.expandedPaths).toContain("/docs");
    expect(state.selectedPath).toBe("/a.md");
    state = vaultWorkspaceReducer(state, { type: "toggle_folder", path: "/docs" });
    expect(state.expandedPaths).not.toContain("/docs");
    expect(state.selectedPath).toBe("/a.md");
  });

  it("remaps paths after rename and keeps session cues", () => {
    let state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "open_file",
      path: "/old.md",
    });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/old.md",
      content: "x",
    });
    state = vaultWorkspaceReducer(state, {
      type: "mark_saved",
      path: "/old.md",
      content: "x",
    });
    state = vaultWorkspaceReducer(state, {
      type: "remap_paths",
      map: { "/old.md": "/new.md" },
    });
    expect(state.openTabs).toEqual(["/new.md"]);
    expect(state.activeTabPath).toBe("/new.md");
    expect(state.dirtyPaths).toEqual([]);
    expect(state.sessionModifiedPaths).toEqual(["/new.md"]);
    expect(state.editorDrafts["/new.md"]).toBe("x");
  });

  it("remaps descendant tabs, drafts, dirty, and expanded paths when a folder moves", () => {
    let state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "open_file",
      path: "/notes/a.md",
    });
    state = vaultWorkspaceReducer(state, { type: "expand_folder", path: "/notes/sub" });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/notes/a.md",
      content: "draft",
    });
    state = vaultWorkspaceReducer(state, {
      type: "remap_paths",
      map: { "/notes": "/docs" },
    });
    expect(state.openTabs).toEqual(["/docs/a.md"]);
    expect(state.activeTabPath).toBe("/docs/a.md");
    expect(state.selectedPath).toBe("/docs/a.md");
    expect(state.expandedPaths).toEqual(expect.arrayContaining(["/", "/docs", "/docs/sub"]));
    expect(state.expandedPaths).not.toContain("/notes");
    expect(state.expandedPaths).not.toContain("/notes/sub");
    expect(state.editorDrafts["/docs/a.md"]).toBe("draft");
    expect(state.editorDrafts["/notes/a.md"]).toBeUndefined();
    expect(state.dirtyPaths).toEqual(["/docs/a.md"]);
    expect(state.sessionModifiedPaths).toEqual(expect.arrayContaining(["/docs"]));
  });

  it("discard_unsaved_and closes a dirty tab after discard", () => {
    let state = vaultWorkspaceReducer(createDefaultWorkspaceState(), {
      type: "open_file",
      path: "/a.md",
    });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/a.md",
      content: "x",
    });
    state = vaultWorkspaceReducer(state, { type: "request_close_tab", path: "/a.md" });
    state = vaultWorkspaceReducer(state, {
      type: "discard_unsaved_and",
      next: resolveUnsavedPrompt(state, state.unsavedPrompt!),
    });
    expect(state.openTabs).toEqual([]);
    expect(hasUnsavedWorkspaceChanges(state)).toBe(false);
    expect(sessionPathKind(state, "/a.md")).toBeNull();
  });

  it("remove_paths drops tabs, drafts, and session markers", () => {
    let state = createDefaultWorkspaceState();
    state = vaultWorkspaceReducer(state, { type: "open_file", path: "/a.md" });
    state = vaultWorkspaceReducer(state, { type: "open_file", path: "/b.md" });
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/a.md",
      content: "x",
    });
    state = vaultWorkspaceReducer(state, {
      type: "mark_saved",
      path: "/a.md",
      content: "x",
    });
    state = vaultWorkspaceReducer(state, { type: "remove_paths", paths: ["/a.md"] });
    expect(state.openTabs).toEqual(["/b.md"]);
    expect(state.dirtyPaths).toEqual([]);
    expect(state.sessionModifiedPaths).toEqual([]);
    expect(state.editorDrafts["/a.md"]).toBeUndefined();
  });

  it("reorders open tabs by drag fromPath → toPath index", () => {
    let state = createDefaultWorkspaceState();
    for (const path of ["/a.md", "/b.md", "/c.md"]) {
      state = vaultWorkspaceReducer(state, { type: "open_file", path });
    }
    expect(state.openTabs).toEqual(["/a.md", "/b.md", "/c.md"]);

    state = vaultWorkspaceReducer(state, {
      type: "reorder_tabs",
      fromPath: "/a.md",
      toPath: "/c.md",
    });
    expect(state.openTabs).toEqual(["/b.md", "/c.md", "/a.md"]);
    expect(state.activeTabPath).toBe("/c.md");

    state = vaultWorkspaceReducer(state, {
      type: "reorder_tabs",
      fromPath: "/a.md",
      toPath: "/b.md",
    });
    expect(state.openTabs).toEqual(["/a.md", "/b.md", "/c.md"]);

    const same = vaultWorkspaceReducer(state, {
      type: "reorder_tabs",
      fromPath: "/a.md",
      toPath: "/a.md",
    });
    expect(same).toBe(state);
  });

  it("hydrate_persisted restores layout fields without drafts", () => {
    let state = createDefaultWorkspaceState();
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/tmp.md",
      content: "x",
    });
    state = vaultWorkspaceReducer(state, {
      type: "hydrate_persisted",
      openTabs: ["/a.md"],
      activeTabPath: "/a.md",
      expandedPaths: ["/", "/notes"],
      selectedPath: "/a.md",
      explorerCollapsed: true,
      fileStates: { "/a.md": { markdownView: "source", markdownOutlineOpen: false } },
    });
    expect(state.openTabs).toEqual(["/a.md"]);
    expect(state.activeTabPath).toBe("/a.md");
    expect(state.expandedPaths).toEqual(["/", "/notes"]);
    expect(fileMarkdownView(state, "/a.md")).toBe("source");
    expect(fileMarkdownOutlineOpen(state, "/a.md")).toBe(false);
    expect(state.explorerCollapsed).toBe(true);
    expect(state.dirtyPaths).toEqual(["/tmp.md"]);
  });

  it("keeps the markdown view per file and ignores a repeat", () => {
    const initial = createDefaultWorkspaceState();
    const action = { type: "set_file_markdown_view", path: "/a.md", view: "source" } as const;
    const source = vaultWorkspaceReducer(initial, action);
    expect(fileMarkdownView(source, "/a.md")).toBe("source");
    expect(fileMarkdownView(source, "/b.md")).toBe("preview");
    expect(vaultWorkspaceReducer(source, action)).toBe(source);
  });

  it("hides and shows the explorer and ignores a repeat", () => {
    const initial = createDefaultWorkspaceState();
    expect(initial.explorerCollapsed).toBe(false);
    const hidden = vaultWorkspaceReducer(
      { ...initial, contextMenu: { x: 1, y: 1, path: "/a.md" } },
      { type: "set_explorer_collapsed", collapsed: true },
    );
    expect(hidden.explorerCollapsed).toBe(true);
    expect(hidden.contextMenu).toBeNull();
    const again = vaultWorkspaceReducer(hidden, {
      type: "set_explorer_collapsed",
      collapsed: true,
    });
    expect(again).toBe(hidden);
    const shown = vaultWorkspaceReducer(hidden, {
      type: "set_explorer_collapsed",
      collapsed: false,
    });
    expect(shown.explorerCollapsed).toBe(false);
  });

  it("opens and closes the markdown outline per file and ignores a repeat", () => {
    const initial = createDefaultWorkspaceState();
    expect(fileMarkdownOutlineOpen(initial, "/a.md")).toBe(true);
    const action = { type: "set_file_markdown_outline_open", path: "/a.md", open: false } as const;
    const closed = vaultWorkspaceReducer(initial, action);
    expect(fileMarkdownOutlineOpen(closed, "/a.md")).toBe(false);
    expect(vaultWorkspaceReducer(closed, action)).toBe(closed);
    const open = vaultWorkspaceReducer(closed, { ...action, open: true });
    expect(fileMarkdownOutlineOpen(open, "/a.md")).toBe(true);
  });

  it("start_rename shows a hidden explorer so the name field is visible", () => {
    let state = createDefaultWorkspaceState();
    state = vaultWorkspaceReducer(state, { type: "open_file", path: "/a.md" });
    state = vaultWorkspaceReducer(state, { type: "set_explorer_collapsed", collapsed: true });
    state = vaultWorkspaceReducer(state, { type: "start_rename", path: "/a.md" });
    expect(state.explorerCollapsed).toBe(false);
    expect(state.renamingPath).toBe("/a.md");
  });

  it("closes other clean tabs and activates the kept one", () => {
    let state = createDefaultWorkspaceState();
    for (const path of ["/a.md", "/b.md", "/c.md"]) {
      state = vaultWorkspaceReducer(state, { type: "open_file", path });
    }
    state = vaultWorkspaceReducer(state, {
      type: "request_close_tabs",
      paths: ["/a.md", "/c.md"],
    });
    expect(state.openTabs).toEqual(["/b.md"]);
    expect(state.activeTabPath).toBe("/b.md");
    expect(state.unsavedPrompt).toBeNull();
  });

  it("prompts once before closing several tabs when one is dirty", () => {
    let state = createDefaultWorkspaceState();
    for (const path of ["/a.md", "/b.md", "/c.md"]) {
      state = vaultWorkspaceReducer(state, { type: "open_file", path });
    }
    state = vaultWorkspaceReducer(state, { type: "set_editor_draft", path: "/a.md", content: "x" });
    state = vaultWorkspaceReducer(state, {
      type: "request_close_tabs",
      paths: ["/a.md", "/b.md", "/c.md", "/gone.md"],
    });
    expect(state.unsavedPrompt).toEqual({
      type: "close_tabs",
      paths: ["/a.md", "/b.md", "/c.md"],
    });
    expect(state.openTabs).toHaveLength(3);

    state = vaultWorkspaceReducer(state, {
      type: "discard_unsaved_and",
      next: resolveUnsavedPrompt(state, state.unsavedPrompt!),
    });
    expect(state.openTabs).toEqual([]);
    expect(state.activeTabPath).toBeNull();
    expect(hasUnsavedWorkspaceChanges(state)).toBe(false);
  });

  it("start_rename expands the ancestors of the renamed path", () => {
    let state = createDefaultWorkspaceState();
    state = vaultWorkspaceReducer(state, { type: "open_file", path: "/notes/deep/a.md" });
    state = vaultWorkspaceReducer(state, { type: "toggle_folder", path: "/notes" });
    expect(state.expandedPaths).not.toContain("/notes");

    state = vaultWorkspaceReducer(state, { type: "start_rename", path: "/notes/deep/a.md" });
    expect(state.renamingPath).toBe("/notes/deep/a.md");
    expect(state.expandedPaths).toEqual(expect.arrayContaining(["/", "/notes", "/notes/deep"]));
    expect(state.userCollapsedPaths).not.toContain("/notes");
  });

  it("handles per-file markdown view, outline, and search with path remapping and removal", () => {
    let state = createDefaultWorkspaceState();
    expect(fileMarkdownView(state, "/a.md")).toBe("preview");
    expect(fileMarkdownOutlineOpen(state, "/a.md")).toBe(true);
    expect(fileSearchQuery(state, "/a.md")).toBe("");

    // Set per-file markdown view
    state = vaultWorkspaceReducer(state, {
      type: "set_file_markdown_view",
      path: "/notes/todo.md",
      view: "source",
    });
    expect(fileMarkdownView(state, "/notes/todo.md")).toBe("source");
    expect(fileMarkdownView(state, "/notes/other.md")).toBe("preview");

    // Set per-file outline
    state = vaultWorkspaceReducer(state, {
      type: "set_file_markdown_outline_open",
      path: "/notes/todo.md",
      open: false,
    });
    expect(fileMarkdownOutlineOpen(state, "/notes/todo.md")).toBe(false);
    expect(fileMarkdownOutlineOpen(state, "/notes/other.md")).toBe(true);

    // Set per-file search
    state = vaultWorkspaceReducer(state, {
      type: "set_file_search_query",
      path: "/notes/todo.md",
      query: "secret_password",
    });
    expect(fileSearchQuery(state, "/notes/todo.md")).toBe("secret_password");
    expect(fileSearchQuery(state, "/notes/other.md")).toBe("");

    // Remap paths on folder rename
    state = vaultWorkspaceReducer(state, {
      type: "remap_paths",
      map: { "/notes": "/archive" },
    });
    expect(fileMarkdownView(state, "/archive/todo.md")).toBe("source");
    expect(fileMarkdownOutlineOpen(state, "/archive/todo.md")).toBe(false);
    expect(fileSearchQuery(state, "/archive/todo.md")).toBe("secret_password");
    expect(state.fileStates["/notes/todo.md"]).toBeUndefined();

    // Remove paths on file delete
    state = vaultWorkspaceReducer(state, {
      type: "remove_paths",
      paths: ["/archive/todo.md"],
    });
    expect(state.fileStates["/archive/todo.md"]).toBeUndefined();
    expect(fileMarkdownView(state, "/archive/todo.md")).toBe("preview");

    // Remove folder purges child fileStates
    state = vaultWorkspaceReducer(state, {
      type: "set_file_markdown_view",
      path: "/folder/doc.md",
      view: "source",
    });
    expect(state.fileStates["/folder/doc.md"]).toBeDefined();
    state = vaultWorkspaceReducer(state, {
      type: "remove_paths",
      paths: ["/folder"],
    });
    expect(state.fileStates["/folder/doc.md"]).toBeUndefined();
  });

  it("sets the tree split percent per vault and ignores a repeat", () => {
    let state = createDefaultWorkspaceState();
    expect(state.treeSplitPercent).toBeNull();

    state = vaultWorkspaceReducer(state, { type: "set_tree_split_percent", percent: 35 });
    expect(state.treeSplitPercent).toBe(35);
    expect(vaultWorkspaceReducer(state, { type: "set_tree_split_percent", percent: 35 })).toBe(
      state,
    );
  });

  it("toggles word wrap per file, wrapped by default", () => {
    let state = createDefaultWorkspaceState();
    expect(fileEditorWordWrap(state, null)).toBe(true);
    expect(fileEditorWordWrap(state, "/note.txt")).toBe(true);

    state = vaultWorkspaceReducer(state, {
      type: "set_file_word_wrap",
      path: "/note.txt",
      wrap: false,
    });
    expect(fileEditorWordWrap(state, "/note.txt")).toBe(false);
    expect(fileEditorWordWrap(state, "/other.txt")).toBe(true);
  });
});

describe("discard_all_dirty", () => {
  it("drops every unsaved draft", () => {
    let state = createDefaultWorkspaceState();
    state = vaultWorkspaceReducer(state, {
      type: "set_editor_draft",
      path: "/a.md",
      content: "x",
    });
    state = vaultWorkspaceReducer(state, {
      type: "set_unsaved_prompt",
      prompt: { type: "close_vault" },
    });
    state = vaultWorkspaceReducer(state, { type: "discard_all_dirty" });
    expect(state.dirtyPaths).toEqual([]);
    expect(state.editorDrafts).toEqual({});
    expect(state.unsavedPrompt).toBeNull();
  });
});

describe("resolveUnsavedPrompt", () => {
  it("maps prompt types to follow-up actions", () => {
    expect(
      resolveUnsavedPrompt(createDefaultWorkspaceState(), { type: "close_tab", path: "/a" }),
    ).toEqual({
      type: "close_tab",
      path: "/a",
    });
    expect(
      resolveUnsavedPrompt(createDefaultWorkspaceState(), { type: "close_tabs", paths: ["/a"] }),
    ).toEqual({ type: "close_tabs", paths: ["/a"] });
    expect(
      resolveUnsavedPrompt(createDefaultWorkspaceState(), { type: "dismiss_workspace" }),
    ).toEqual({ type: "set_unsaved_prompt", prompt: null });
    expect(resolveUnsavedPrompt(createDefaultWorkspaceState(), { type: "close_vault" })).toEqual({
      type: "set_unsaved_prompt",
      prompt: null,
    });
    expect(
      resolveUnsavedPrompt(createDefaultWorkspaceState(), { type: "close_vault_import" }),
    ).toEqual({ type: "set_unsaved_prompt", prompt: null });
    expect(
      resolveUnsavedPrompt(createDefaultWorkspaceState(), { type: "import_in_progress" }),
    ).toEqual({ type: "set_unsaved_prompt", prompt: null });
  });
});

describe("sessionPathKind", () => {
  /** The rule as a plain scan: the path itself, or a folder above a listed path. */
  function listed(paths: readonly string[], path: string): boolean {
    if (paths.includes(path)) return true;
    if (path === "/") return paths.some((p) => p !== "/");
    return paths.some((p) => p.startsWith(`${path}/`));
  }

  const lists: string[][] = [
    [],
    ["/"],
    ["/a"],
    ["/ab/c.txt"],
    ["/a/b/c.txt", "/a/d.md"],
    ["/x/y", "/x"],
  ];
  const queries = ["/", "/a", "/ab", "/a/b", "/a/b/c.txt", "/a/b/c", "/a/d.md", "/x", "/x/y", "/z"];

  it("matches the listed path and every folder above it", () => {
    for (const created of lists) {
      for (const modified of lists) {
        const state = {
          ...createDefaultWorkspaceState(),
          sessionCreatedPaths: [...created],
          sessionModifiedPaths: [...modified],
        };
        for (const path of queries) {
          const want = listed(created, path)
            ? "created"
            : listed(modified, path)
              ? "modified"
              : null;
          expect(sessionPathKind(state, path), `${created} | ${modified} | ${path}`).toBe(want);
        }
      }
    }
  });

  it("follows each new list the reducer makes", () => {
    let state = createDefaultWorkspaceState();
    expect(sessionPathKind(state, "/Photos")).toBeNull();
    state = vaultWorkspaceReducer(state, {
      type: "mark_session_created",
      paths: ["/Photos/day1/a.jpg"],
    });
    expect(sessionPathKind(state, "/Photos")).toBe("created");
    expect(sessionPathKind(state, "/Photos/day2")).toBeNull();
    state = vaultWorkspaceReducer(state, {
      type: "mark_session_created",
      paths: ["/Photos/day2/b.jpg"],
    });
    expect(sessionPathKind(state, "/Photos/day2")).toBe("created");
  });
});
