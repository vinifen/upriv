import { describe, expect, it } from "vitest";
import {
  createDefaultWorkspaceState,
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
    });
    expect(state.openTabs).toEqual(["/a.md"]);
    expect(state.activeTabPath).toBe("/a.md");
    expect(state.expandedPaths).toEqual(["/", "/notes"]);
    expect(state.dirtyPaths).toEqual(["/tmp.md"]);
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
      resolveUnsavedPrompt(createDefaultWorkspaceState(), { type: "dismiss_workspace" }),
    ).toEqual({ type: "set_unsaved_prompt", prompt: null });
    expect(
      resolveUnsavedPrompt(createDefaultWorkspaceState(), { type: "import_in_progress" }),
    ).toEqual({ type: "set_unsaved_prompt", prompt: null });
  });
});
